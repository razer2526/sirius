<?php
/**
 * Prueba de integración de Sirius: levanta `php -S` con una base SQLite temporal y recorre
 * el ciclo real de HTTP (login, sesión, CSRF, permisos, respaldo cifrado, setup.php).
 *   php tests/api_smoke.php
 */

require __DIR__ . '/bootstrap.php';

$config = tests_write_config();
putenv('SIRIUS_CONFIG=' . $config);

require_once SIRIUS_PUBLIC . '/includes/db.php';
require_once SIRIUS_PUBLIC . '/install/schema.php';
require_once SIRIUS_PUBLIC . '/includes/backup.php';

// --- Base temporal con un administrador ---
$pdo = db();
sirius_install_schema($pdo, false);
sirius_seed_admin($pdo, 'admin_t', 'Contrasena-de-prueba-1', 'Admin de prueba');

// --- Servidor ---
$port = random_int(18000, 18900);
$base = "http://127.0.0.1:$port";
$proc = proc_open(
    (PHP_OS_FAMILY === 'Windows' ? '' : 'exec ') . '"' . PHP_BINARY . '" -S 127.0.0.1:' . $port . ' -t ' . escapeshellarg(SIRIUS_PUBLIC),
    [0 => ['pipe', 'r'], 1 => ['file', tests_tmp_dir() . '/server.log', 'w'], 2 => ['file', tests_tmp_dir() . '/server.log', 'a']],
    $pipes,
    null,
    array_merge(getenv(), ['SIRIUS_CONFIG' => $config, 'PHP_CLI_SERVER_WORKERS' => '4'])
);
register_shutdown_function(static function () use ($proc) {
    if (!is_resource($proc)) {
        return;
    }
    $pid = proc_get_status($proc)['pid'] ?? 0;
    if (PHP_OS_FAMILY === 'Windows' && $pid) {
        exec('taskkill /F /T /PID ' . (int)$pid . ' >NUL 2>&1');   // php -S cuelga de cmd.exe: hay que matar el árbol
    } else {
        proc_terminate($proc);
    }
});
for ($i = 0; $i < 50; $i++) {
    if (@fsockopen('127.0.0.1', $port, $e, $s, 0.2)) {
        break;
    }
    usleep(100000);
}

/** Cliente HTTP mínimo con jar de cookies por sesión. */
class Http
{
    public array $cookies = [];
    public function __construct(private string $base) {}

    /** @return array{status:int, headers:array, body:string, json:?array} */
    public function req(string $method, string $path, array $headers = [], ?string $body = null): array
    {
        $h = array_merge($headers, $this->cookies ? ['Cookie: ' . implode('; ', array_map(fn($k, $v) => "$k=$v", array_keys($this->cookies), $this->cookies))] : []);
        $ctx = stream_context_create(['http' => [
            'method' => $method, 'header' => implode("\r\n", $h), 'content' => $body ?? '',
            'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 120,
        ]]);
        $text = @file_get_contents($this->base . $path, false, $ctx);
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) {
                $status = (int)$m[1];
            } elseif (stripos($line, 'Set-Cookie:') === 0 && preg_match('/Set-Cookie:\s*([^=]+)=([^;]*)/i', $line, $m)) {
                if ($m[2] === '' || $m[2] === 'deleted') {
                    unset($this->cookies[$m[1]]);
                } else {
                    $this->cookies[$m[1]] = $m[2];
                }
            }
        }
        $json = json_decode((string)$text, true);
        return ['status' => $status, 'headers' => $http_response_header ?? [], 'body' => (string)$text, 'json' => is_array($json) ? $json : null];
    }

    public function form(string $path, array $fields): array
    {
        return $this->req('POST', $path, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($fields));
    }

    public function json(string $method, string $path, ?array $body, string $csrf = ''): array
    {
        $h = ['Content-Type: application/json'];
        if ($csrf !== '') {
            $h[] = 'X-CSRF-Token: ' . $csrf;
        }
        return $this->req($method, $path, $h, $body === null ? null : json_encode($body));
    }

    /** Inicia sesión por login.php y devuelve el token CSRF de la API. */
    public function login(string $user, string $pass): string
    {
        $page = $this->req('GET', '/login.php');
        preg_match('/name="_csrf" value="([0-9a-f]+)"/', $page['body'], $m);
        $r = $this->form('/login.php', ['_csrf' => $m[1] ?? '', 'username' => $user, 'password' => $pass]);
        if ($r['status'] !== 302) {
            throw new Exception("login de $user falló (HTTP {$r['status']})");
        }
        $s = $this->json('GET', '/api/index.php?r=auth/session', null);
        return (string)($s['json']['data']['csrf'] ?? '');
    }
}

$anon = new Http($base);
$admin = new Http($base);
$csrf = '';

echo "Servidor $base\n\nPipeline de la API\n";
test('sin sesión la API responde 401', function () use ($anon) {
    eq(401, $anon->json('GET', '/api/index.php?r=auth/session', null)['status']);
});
test('una ruta inexistente responde 404', function () use ($admin, &$csrf) {
    $csrf = $admin->login('admin_t', 'Contrasena-de-prueba-1');
    ok(strlen($csrf) === 64, 'token CSRF no recibido');
    eq(404, $admin->json('GET', '/api/index.php?r=no_existe/x', null)['status']);
    eq(404, $admin->json('GET', '/api/index.php?r=users/accion_que_no_existe', null)['status']);
});
test('el login con contraseña incorrecta no inicia sesión', function () use ($base) {
    $c = new Http($base);
    $page = $c->req('GET', '/login.php');
    preg_match('/name="_csrf" value="([0-9a-f]+)"/', $page['body'], $m);
    $r = $c->form('/login.php', ['_csrf' => $m[1], 'username' => 'admin_t', 'password' => 'mal']);
    eq(200, $r['status']);
    ok(str_contains($r['body'], 'incorrectos'));
});
test('toda escritura sin token CSRF responde 403', function () use ($admin) {
    $r = $admin->json('POST', '/api/index.php?r=users/create', ['username' => 'x', 'full_name' => 'x', 'password' => '123456']);
    eq(403, $r['status']);
});
test('la sesión del administrador trae sus módulos', function () use ($admin) {
    $d = $admin->json('GET', '/api/index.php?r=auth/session', null)['json']['data'];
    eq('administrador', $d['user']['role']);
    $keys = array_column($d['modules'], 'key');
    ok(in_array('empleados', $keys, true) && in_array('backup', $keys, true));
});

echo "\nPermisos de un usuario estándar\n";
$std = new Http($base);
test('el administrador crea un usuario estándar con un solo módulo', function () use ($admin, &$csrf) {
    $r = $admin->json('POST', '/api/index.php?r=users/create', [
        'username' => 'estandar_t', 'full_name' => 'Estándar de prueba', 'password' => 'Estandar-123', 'role' => 'estandar',
        'permissions' => ['inventario' => []],
    ], $csrf);
    eq(200, $r['status'], $r['body']);
});
test('el estándar no entra a Admin Tools ni a lo no concedido (403)', function () use ($std) {
    $c = $std->login('estandar_t', 'Estandar-123');
    foreach (['employees/users_list', 'users/list', 'backups/info', 'tasks/list', 'papelera/list'] as $route) {
        eq(403, $std->json('GET', '/api/index.php?r=' . $route, null)['status'], $route);
    }
    eq(200, $std->json('GET', '/api/index.php?r=profile/get', null)['status'], 'perfil siempre disponible');
});

echo "\nPlantillas desde el Membretador\n";
$tplBody = fn(string $name, array $tests) => ['name' => $name, 'technique' => 'Espectrofotometría', 'tests' => $tests];
$glu = ['name' => 'Glucosa T', 'unit' => 'mg/dL', 'ranges' => [['sex' => 'A', 'min_value' => '70', 'max_value' => '100']]];
test('sin el privilegio de Membretador no se pueden crear plantillas (403); con él, sí', function () use ($admin, &$csrf, $base, $tplBody, $glu) {
    foreach ([['solo_apps', ['apps' => []]], ['con_memb', ['apps' => ['membretador' => true]]]] as [$u, $perm]) {
        $r = $admin->json('POST', '/api/index.php?r=users/create', ['username' => $u, 'full_name' => $u, 'password' => 'Clave-prueba-1', 'role' => 'estandar', 'permissions' => $perm], $csrf);
        eq(200, $r['status'], $r['body']);
    }
    $a = new Http($base);
    $ca = $a->login('solo_apps', 'Clave-prueba-1');
    eq(403, $a->json('POST', '/api/index.php?r=labs/template_create', $tplBody('Plantilla X', [$glu]), $ca)['status']);
    $b = new Http($base);
    $cb = $b->login('con_memb', 'Clave-prueba-1');
    $r = $b->json('POST', '/api/index.php?r=labs/template_create', $tplBody('Perfil de prueba', [$glu, ['name' => 'Cetonas T', 'ranges' => [['sex' => 'A', 'text_value' => 'Negativo']]]]), $cb);
    eq(200, $r['status'], $r['body']);
    eq(2, $r['json']['data']['item_count']);
});
test('la plantilla se crea con técnica, unidad y referencias, y sale en la lista', function () use ($admin) {
    $list = $admin->json('GET', '/api/index.php?r=labs/studies', null)['json']['data']['studies'];
    $s = array_values(array_filter($list, fn($x) => $x['name'] === 'Perfil de prueba'))[0] ?? null;
    ok($s !== null && $s['item_count'] === 2, 'la plantilla no aparece en la lista');
    $seed = $admin->json('GET', '/api/index.php?r=labs/seed&study_ids=' . $s['id'] . '&sex=F&age=30', null)['json']['data']['studies'][0]['items'];
    eq('Glucosa T', $seed[0]['name']);
    eq('Espectrofotometría', $seed[0]['technique']);
    eq('mg/dL', $seed[0]['unit']);
    eq('Negativo', implode('', $seed[1]['applicable']));
});
test('un nombre repetido se rechaza y una determinación existente se reutiliza sin tocar sus referencias', function () use ($admin, &$csrf, $tplBody) {
    $dup = $admin->json('POST', '/api/index.php?r=labs/template_create', ['name' => 'perfil de PRUEBA', 'tests' => [['name' => 'Otra', 'ranges' => []]]], $csrf);
    eq(422, $dup['status'], 'mismo nombre (sin importar mayúsculas)');
    $changed = ['name' => 'Glucosa T', 'unit' => 'mg/dL', 'ranges' => [['sex' => 'A', 'min_value' => '1', 'max_value' => '2']]];
    $r = $admin->json('POST', '/api/index.php?r=labs/template_create', $tplBody('Segundo perfil', [$changed]), $csrf);
    eq(200, $r['status'], $r['body']);
    eq(['Glucosa T'], $r['json']['data']['reused']);
    $seed = $admin->json('GET', '/api/index.php?r=labs/seed&study_ids=' . $r['json']['data']['id'] . '&sex=F&age=30', null)['json']['data']['studies'][0]['items'];
    ok(str_contains(implode('', $seed[0]['applicable']), '70'), 'las referencias existentes no deben cambiar: ' . json_encode($seed[0]['applicable']));
});
test('se validan nombre, determinaciones y rangos', function () use ($admin, &$csrf) {
    $post = fn(array $b) => $admin->json('POST', '/api/index.php?r=labs/template_create', $b, $csrf)['status'];
    eq(422, $post(['name' => '', 'tests' => [['name' => 'A']]]), 'sin nombre');
    eq(422, $post(['name' => 'Vacía', 'tests' => []]), 'sin determinaciones');
    eq(422, $post(['name' => 'Rango malo', 'tests' => [['name' => 'A', 'ranges' => [['sex' => 'A', 'min_value' => '10', 'max_value' => '5']]]]]), 'mínimo mayor que máximo');
    eq(422, $post(['name' => 'Sexo malo', 'tests' => [['name' => 'A', 'ranges' => [['sex' => 'X', 'min_value' => '1']]]]]), 'sexo inválido');
    eq(422, $post(['name' => 'Sin nombre det', 'tests' => [['name' => '']]]), 'determinación sin nombre');
});

echo "\nFicha de identificación y su correo\n";
require_once SIRIUS_PUBLIC . '/includes/pdf_text.php';
$fichaText = function (Http $http, int $episodeId): string {
    $r = $http->req('GET', '/ficha.php?episode_id=' . $episodeId);
    ok(str_starts_with($r['body'], '%PDF'), 'ficha.php no devolvió un PDF (HTTP ' . $r['status'] . ')');
    $tmp = tests_tmp_dir() . '/ficha_' . $episodeId . '.pdf';
    file_put_contents($tmp, $r['body']);
    return (string)pdf_extract_text($tmp);
};
$createLab = function (Http $http, string $csrf, array $extra) {
    $payload = array_merge([
        'service' => 'laboratorio', 'referring_doctor' => 'Dr. Prueba',
        'patient' => ['first_name' => 'Paciente', 'paternal_surname' => 'Asistido' . random_int(100, 999), 'mobile' => '5512345678'],
        'service_data' => ['pago_metodo' => 'Efectivo', 'medicamentos' => 'ninguno'],
        'study_lines' => [], 'ignore_duplicate' => true,
    ], $extra);
    $r = $http->json('POST', '/api/index.php?r=episodes/create', $payload, $csrf);
    eq(200, $r['status'], $r['body']);
    return (int)$r['json']['data']['episode_id'];
};
test('una admisión del asistido no imprime sexo, grupo sanguíneo, domicilio ni historia clínica como «No referido»', function () use ($admin, &$csrf, $fichaText, $createLab) {
    $id = $createLab($admin, $csrf, ['assisted' => true]);
    $txt = $fichaText($admin, $id);
    ok(str_contains($txt, 'Fecha de nacimiento'), 'la fecha de nacimiento sí se preguntó y se imprime');
    ok(str_contains($txt, 'Teléfono'));
    ok(str_contains($txt, 'dico solicitante'));
    foreach (['Sexo:', 'Grupo sangu', 'Direcci', 'Historia Cl', 'Fumador', 'Anticoagulantes', 'Legrado', 'Anticonceptivos', 'FUR:'] as $absent) {
        ok(!str_contains($txt, $absent), "no debía aparecer «{$absent}» en una ficha del asistido");
    }
});
test('una admisión del formulario completo sí imprime esos campos', function () use ($admin, &$csrf, $fichaText, $createLab) {
    $id = $createLab($admin, $csrf, [
        'patient' => ['first_name' => 'Paciente', 'paternal_surname' => 'Completo' . random_int(100, 999), 'sex' => 'F', 'blood_type' => 'O+', 'street' => 'Calle 1'],
        'service_data' => ['fumador' => true, 'pago_metodo' => 'Efectivo'],
    ]);
    $txt = $fichaText($admin, $id);
    foreach (['Sexo:', 'Grupo sangu', 'Direcci', 'Historia Cl', 'Fumador', 'Anticoagulantes'] as $present) {
        ok(str_contains($txt, $present), "debía aparecer «{$present}» en la ficha del formulario completo");
    }
});
test('si a una admisión asistida se le captura después un dato de historia clínica, ese bloque ya se imprime', function () use ($admin, &$csrf, $fichaText, $createLab) {
    $id = $createLab($admin, $csrf, ['assisted' => true]);
    $r = $admin->json('POST', '/api/index.php?r=episodes/update', ['episode_id' => $id, 'referring_doctor' => 'Dr. Prueba', 'service_data' => ['fumador' => true, 'pago_metodo' => 'Efectivo']], $csrf);
    eq(200, $r['status'], $r['body']);
    $txt = $fichaText($admin, $id);
    ok(str_contains($txt, 'Fumador'));
    ok(!str_contains($txt, 'Sexo:'), 'lo demás sigue sin imprimirse');
});
test('API correo: devuelve los textos vigentes y los originales, y la vista previa escapa el HTML', function () use ($admin, &$csrf) {
    $cfg = $admin->json('GET', '/api/index.php?r=mail/get', null)['json']['data']['config'];
    ok(str_contains($cfg['ficha_subject'], '{paciente}'), 'sin personalizar se muestra el texto original');
    ok(isset($cfg['ficha_defaults']['ficha_message'], $cfg['ficha_vars']['{folio}']));
    $p = $admin->json('POST', '/api/index.php?r=mail/preview', ['ficha_subject' => 'Orden {folio}', 'ficha_message' => '<script>x</script> Hola {paciente}', 'ficha_signature' => 'Firma'], $csrf);
    eq(200, $p['status'], $p['body']);
    $m = $p['json']['data']['mail'];
    eq('Orden 261009-01', $m['subject']);
    ok(str_contains($m['html'], 'María Pérez López') && !str_contains($m['html'], '<script'));
});
test('API correo: guardar los textos y devolverlos; solo administradores', function () use ($admin, &$csrf, $base) {
    $r = $admin->json('POST', '/api/index.php?r=mail/save', ['ficha_subject' => 'Tu ficha, {paciente}', 'ficha_message' => 'Mensaje propio', 'ficha_signature' => 'Mi firma'], $csrf);
    eq(200, $r['status'], $r['body']);
    $cfg = $admin->json('GET', '/api/index.php?r=mail/get', null)['json']['data']['config'];
    eq('Tu ficha, {paciente}', $cfg['ficha_subject']);
    eq('Mi firma', $cfg['ficha_signature']);
    $c = new Http($base);
    $cs = $c->login('con_memb', 'Clave-prueba-1');
    eq(403, $c->json('POST', '/api/index.php?r=mail/preview', ['ficha_message' => 'x'], $cs)['status'], 'un estándar no accede');
});

echo "\nTareas con casillas en la descripción\n";
$todo = fn(string $t, bool $done = false) => ['t' => 'todo', 'done' => $done, 'runs' => [['s' => $t]]];
$mkTask = function (Http $http, string $csrf, string $title, array $blocks, array $extra = []) {
    $r = $http->json('POST', '/api/index.php?r=tasks/save', array_merge([
        'title' => $title, 'description' => ['v' => 2, 'blocks' => $blocks], 'priority' => 'media',
    ], $extra), $csrf);
    eq(200, $r['status'], $r['body']);
    return (int)$r['json']['data']['id'];
};
$getTask = function (Http $http, int $id): array {
    $tasks = $http->json('GET', '/api/index.php?r=tasks/list', null)['json']['data']['tasks'];
    $t = array_values(array_filter($tasks, fn($x) => $x['id'] === $id))[0] ?? null;
    ok($t !== null, "la tarea $id no aparece en la lista");
    return $t;
};
test('la lista trae la descripción con formato, el avance de casillas y un texto plano de respaldo', function () use ($admin, &$csrf, $todo, $mkTask, $getTask) {
    $id = $mkTask($admin, $csrf, 'Comprar', [
        ['t' => 'p', 'runs' => [['s' => 'Pedido', 'b' => true]]], $todo('Windex'), $todo('Tubos', true),
    ]);
    $t = $getTask($admin, $id);
    eq([2, 1], [$t['todo_total'], $t['todo_done']]);
    eq(3, count($t['desc_blocks']));
    eq(true, $t['desc_blocks'][0]['runs'][0]['b']);
    eq("Pedido\n☐ Windex\n☑ Tubos", $t['description']);
    eq('pendiente', $t['status']);
});
test('una descripción en texto plano (anterior) se lee como párrafos y se guarda tal cual si un cliente viejo la manda', function () use ($admin, &$csrf, $getTask) {
    $r = $admin->json('POST', '/api/index.php?r=tasks/save', ['title' => 'Vieja', 'description' => "línea 1\nlínea 2", 'priority' => 'media'], $csrf);
    $t = $getTask($admin, (int)$r['json']['data']['id']);
    eq(2, count($t['desc_blocks']));
    eq([0, 0], [$t['todo_total'], $t['todo_done']]);
    eq("línea 1\nlínea 2", $t['description']);
});
test('al marcar la última casilla la tarea se completa sola; al desmarcar una, vuelve a pendiente', function () use ($admin, &$csrf, $todo, $mkTask, $getTask) {
    $id = $mkTask($admin, $csrf, 'Lista', [$todo('a'), $todo('b'), $todo('c')]);
    $tg = fn(int $i, bool $d) => $admin->json('POST', '/api/index.php?r=tasks/toggle_check', ['id' => $id, 'index' => $i, 'done' => $d], $csrf);
    $r = $tg(0, true); eq(200, $r['status'], $r['body']); eq(false, $r['json']['data']['completed']);
    $tg(1, true);
    eq('pendiente', $getTask($admin, $id)['status'], 'con 2 de 3 sigue pendiente');
    $r = $tg(2, true);
    eq(true, $r['json']['data']['completed']);
    $t = $getTask($admin, $id);
    eq('completada', $t['status']);
    eq([3, 3], [$t['todo_total'], $t['todo_done']]);
    $tg(1, false);
    $t = $getTask($admin, $id);
    eq('pendiente', $t['status'], 'al desmarcar vuelve a pendiente');
    eq([3, 2], [$t['todo_total'], $t['todo_done']]);
    eq(404, $tg(9, true)['status'], 'una casilla inexistente se rechaza');
});
test('una tarea frecuente con casillas queda al día al marcarlas todas y se reinicia sola en el periodo siguiente', function () use ($admin, &$csrf, $todo, $mkTask, $getTask) {
    $id = $mkTask($admin, $csrf, 'Diaria', [$todo('x'), $todo('y')], ['recurrence' => 'diaria']);
    $tg = fn(int $i) => $admin->json('POST', '/api/index.php?r=tasks/toggle_check', ['id' => $id, 'index' => $i, 'done' => true], $csrf);
    $tg(0);
    eq(false, $getTask($admin, $id)['done_now']);
    $tg(1);
    $t = $getTask($admin, $id);
    eq(true, $t['done_now'], 'al día con todas marcadas');
    eq([2, 2], [$t['todo_total'], $t['todo_done']]);
    // Simula que el periodo guardado es de ayer: hoy las casillas deben verse sin marcar
    $row = db()->query('SELECT description FROM tasks WHERE id = ' . $id)->fetch();
    $d = json_decode($row['description'], true);
    $d['period'] = '2000-01-01';
    db()->prepare('UPDATE tasks SET description = ? WHERE id = ?')->execute([json_encode($d), $id]);
    $t = $getTask($admin, $id);
    eq([2, 0], [$t['todo_total'], $t['todo_done']], 'periodo nuevo: sin marcar');
});
test('un usuario sin acceso a la tarea no puede marcar sus casillas', function () use ($admin, &$csrf, $todo, $mkTask, $base) {
    $id = $mkTask($admin, $csrf, 'Privada', [$todo('a')]);
    // Usuario con el módulo Tareas pero sin la tarea (ni creada por él ni asignada)
    $u = $admin->json('POST', '/api/index.php?r=users/create', ['username' => 'solo_tareas', 'full_name' => 'Solo tareas', 'password' => 'Clave-prueba-1', 'role' => 'estandar', 'permissions' => ['tareas' => []]], $csrf);
    eq(200, $u['status'], $u['body']);
    $c = new Http($base);
    $cs = $c->login('solo_tareas', 'Clave-prueba-1');
    $r = $c->json('POST', '/api/index.php?r=tasks/toggle_check', ['id' => $id, 'index' => 0, 'done' => true], $cs);
    eq(403, $r['status'], $r['body']);
    eq('No tienes acceso a esta tarea', $r['json']['error'] ?? '');
});

echo "\nComisiones por periodo\n";
$comm = (function () use ($admin, &$csrf) {
    $doctor = function (string $name) use ($admin, &$csrf): int {
        $r = $admin->json('POST', '/api/index.php?r=vinculacion/doctors_save', ['name' => $name], $csrf);
        eq(200, $r['status'], $r['body']);
        return (int)$r['json']['data']['id'];
    };
    $studies = fn(array $lines) => ['study_lines' => array_map(fn($l) => ['study_name' => $l[0], 'amount_charged' => $l[1]], $lines)];
    $params = fn(int $doctorId) => ['party_type' => 'doctor', 'party_id' => $doctorId, 'period_start' => date('Y-m-d', strtotime('-1 day')), 'period_end' => date('Y-m-d', strtotime('+1 day'))];
    $preview = function (int $doctorId) use ($admin, $params): array {
        $r = $admin->json('GET', '/api/index.php?r=commissions/preview&' . http_build_query($params($doctorId)), null);
        eq(200, $r['status'], $r['body']);
        return $r['json']['data'];
    };
    return compact('doctor', 'studies', 'params', 'preview');
})();
test('una admisión del asistido (nombre escrito, estudios sin grupo) entra a la cuenta del médico y se liga al guardar', function () use ($admin, &$csrf, $createLab, $comm, $pdo) {
    $docId = $comm['doctor']('Rodolfo Ramírez del Pilar');
    $ep = $createLab($admin, $csrf, ['referring_doctor' => 'Dr. Rodolfo Ramírez', 'assisted' => true] + $comm['studies']([['Biometría hemática', 400], ['FilmArray GI', 0]]));
    eq($docId, (int)$pdo->query('SELECT linked_doctor_id FROM episodes WHERE id = ' . $ep)->fetchColumn(), 'el nombre escrito debía ligarse al único médico que coincide');
    $ep2 = $createLab($admin, $csrf, ['referring_doctor' => 'Dr. Otro Nombre'] + $comm['studies']([['Glucosa', 100]]));
    ok($pdo->query('SELECT linked_doctor_id FROM episodes WHERE id = ' . $ep2)->fetchColumn() === null, 'un nombre sin coincidencia no se liga');

    $d = $comm['preview']($docId);
    eq(['Biometría hemática', 'FilmArray GI'], array_column($d['lines'], 'study_name'));
    eq([40.0, 750.0], array_map('floatval', array_column($d['lines'], 'commission_amount')), 'clínico 10%; FilmArray monto fijo');
    eq(790.0, (float)$d['total']);
});
test('las admisiones capturadas antes de dar de alta al médico también se encuentran por el nombre escrito', function () use ($admin, &$csrf, $createLab, $comm, $pdo) {
    $ep = $createLab($admin, $csrf, ['referring_doctor' => 'Mariana Pérez Gómez'] + $comm['studies']([['Perfil lipídico', 500]]));
    ok($pdo->query('SELECT linked_doctor_id FROM episodes WHERE id = ' . $ep)->fetchColumn() === null);
    $docId = $comm['doctor']('Mariana Pérez Gómez');
    $d = $comm['preview']($docId);
    eq(1, count($d['lines']), 'debía aparecer la admisión anterior');
    eq(50.0, (float)$d['lines'][0]['commission_amount']);
    eq('Mariana Pérez Gómez', $d['lines'][0]['typed_doctor'], 'se avisa que el médico fue escrito a mano');
});
test('si el nombre escrito encaja con dos médicos no se le asigna a ninguno', function () use ($admin, &$csrf, $createLab, $comm, $pdo) {
    $a = $comm['doctor']('Ana López Ruiz');
    $b = $comm['doctor']('Ana López Soto');
    $ep = $createLab($admin, $csrf, ['referring_doctor' => 'Dra. Ana López'] + $comm['studies']([['Glucosa', 100]]));
    ok($pdo->query('SELECT linked_doctor_id FROM episodes WHERE id = ' . $ep)->fetchColumn() === null);
    eq(0, count($comm['preview']($a)['lines']));
    eq(0, count($comm['preview']($b)['lines']));
});
test('el estado de cuenta por periodo se genera con folio y trae el desglose', function () use ($admin, &$csrf, $comm, $pdo) {
    $docId = (int)$pdo->query("SELECT id FROM vinculacion_doctors WHERE name = 'Rodolfo Ramírez del Pilar'")->fetchColumn();
    $r = $admin->json('POST', '/api/index.php?r=commissions/save', $comm['params']($docId), $csrf);
    eq(200, $r['status'], $r['body']);
    $g = $admin->json('GET', '/api/index.php?r=commissions/get&id=' . $r['json']['data']['id'], null)['json']['data']['statement'];
    eq(790.0, (float)$g['total_commission']);
    eq(2, count($g['lines']['items']));
});
test('el PDF del estado de cuenta trae Fecha, Nombre del paciente, Estudios y Monto, y el folio de página', function () use ($admin, $pdo) {
    $id = (int)$pdo->query('SELECT MAX(id) FROM commission_statements')->fetchColumn();
    $r = $admin->req('GET', '/comision.php?id=' . $id);
    ok(str_starts_with($r['body'], '%PDF'), 'comision.php no devolvió un PDF (HTTP ' . $r['status'] . ')');
    $tmp = tests_tmp_dir() . '/comision_' . $id . '.pdf';
    file_put_contents($tmp, $r['body']);
    $txt = (string)pdf_extract_text($tmp);
    foreach (['FECHA', 'NOMBRE DEL PACIENTE', 'ESTUDIOS', 'MONTO', 'gina 1 de 1'] as $present) {
        ok(str_contains($txt, $present), "debía aparecer «{$present}» en el PDF");
    }
    foreach (['PACIENTE / ESTUDIO', 'COMISI'] as $absent) {
        ok(!str_contains($txt, $absent) || $absent === 'COMISI' && str_contains($txt, 'Total comisi'), "no debía aparecer «{$absent}» como columna");
    }
    ok(str_contains($txt, 'Biometr') && str_contains($txt, 'FilmArray GI'), 'los estudios de una misma visita van juntos en un renglón');
});

test('un estado manual hecho antes de guardar la fecha la toma de sus registros y la imprime como la ventana (AAAA-MM-DD)', function () use ($admin, $pdo) {
    $docId = (int)$pdo->query("SELECT id FROM vinculacion_doctors WHERE name = 'Rodolfo Ramírez del Pilar'")->fetchColumn();
    $items = [['patient_name' => 'Paciente Manual Viejo', 'study_name' => 'FILM ARRAY GASTROINTESTINAL MULTIPLEX', 'amount_charged' => 5300, 'commission_pct' => 14.2, 'commission_amount' => 750]];
    $pdo->prepare("INSERT INTO commission_statements (folio, party_type, party_id, period_start, period_end, `lines`, total_commission, created_by) VALUES ('010126-77', 'doctor', ?, '2026-10-01', '2026-10-31', ?, 750, 1)")
        ->execute([$docId, json_encode(['source' => 'manual', 'party_name' => 'Rodolfo Ramírez del Pilar', 'items' => $items], JSON_UNESCAPED_UNICODE)]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare("INSERT INTO commission_entries (doctor_id, patient_name, entry_date, studies, total_amount, total_commission, statement_id) VALUES (?, 'Paciente Manual Viejo', '2026-10-28', '[]', 5300, 750, ?)")
        ->execute([$docId, $id]);
    $r = $admin->req('GET', '/comision.php?id=' . $id);
    ok(str_starts_with($r['body'], '%PDF'), 'comision.php no devolvió un PDF (HTTP ' . $r['status'] . ')');
    $tmp = tests_tmp_dir() . '/comision_' . $id . '.pdf';
    file_put_contents($tmp, $r['body']);
    $txt = (string)pdf_extract_text($tmp);
    ok(str_contains($txt, '2026-10-28'), 'debía aparecer la fecha 2026-10-28 del registro original');
});

$commPdfText = function (int $id) use ($admin): string {
    $r = $admin->req('GET', '/comision.php?id=' . $id);
    ok(str_starts_with($r['body'], '%PDF'), 'comision.php no devolvió un PDF (HTTP ' . $r['status'] . ')');
    $tmp = tests_tmp_dir() . '/comision_pago_' . $id . '_' . mt_rand() . '.pdf';
    file_put_contents($tmp, $r['body']);
    return (string)pdf_extract_text($tmp);
};
test('un estado de cuenta sin pagar dice «Pendiente de pago» y no lleva clave SPEI', function () use ($pdo, $commPdfText) {
    $id = (int)$pdo->query("SELECT id FROM commission_statements WHERE folio = '010126-77'")->fetchColumn();
    $txt = $commPdfText($id);
    ok(stripos($txt, 'Pendiente de pago') !== false, 'debía decir Pendiente de pago');
    ok(!str_contains($txt, 'rastreo'), 'no debía traer clave de rastreo');
});
test('marcar pagado exige la clave de rastreo SPEI y la imprime junto con el estatus «Pagado»', function () use ($admin, &$csrf, $pdo, $commPdfText) {
    $id = (int)$pdo->query("SELECT id FROM commission_statements WHERE folio = '010126-77'")->fetchColumn();
    foreach (['', 'ab', 'clave con $ raros'] as $bad) {
        eq(422, $admin->json('POST', '/api/index.php?r=commissions/statement_pay', ['id' => $id, 'payment_reference' => $bad], $csrf)['status'], "«{$bad}» no debía aceptarse");
    }
    $r = $admin->json('POST', '/api/index.php?r=commissions/statement_pay', ['id' => $id, 'payment_reference' => 'MBAN 0100 2611 03ABC'], $csrf);
    eq(200, $r['status'], $r['body']);
    eq('MBAN0100261103ABC', $r['json']['data']['payment_reference'], 'la clave se guarda sin espacios');
    $txt = $commPdfText($id);
    ok(stripos($txt, 'Pagado') !== false, 'debía decir Pagado');
    ok(str_contains($txt, 'MBAN0100261103ABC'), 'debía imprimir la clave de rastreo');
    ok(str_contains($txt, 'rastreo SPEI'), 'debía rotular la clave de rastreo SPEI');
    ok(stripos($txt, 'Pendiente de pago') === false, 'ya no debía decir Pendiente de pago');
});
test('un estado pagado no se puede eliminar hasta quitarle el pago', function () use ($admin, &$csrf, $pdo, $commPdfText) {
    $id = (int)$pdo->query("SELECT id FROM commission_statements WHERE folio = '010126-77'")->fetchColumn();
    eq(422, $admin->json('POST', '/api/index.php?r=commissions/statement_delete', ['id' => $id], $csrf)['status']);
    eq(200, $admin->json('POST', '/api/index.php?r=commissions/statement_unpay', ['id' => $id], $csrf)['status']);
    $row = $pdo->query("SELECT paid_at, payment_reference FROM commission_statements WHERE id = $id")->fetch();
    ok($row['paid_at'] === null && $row['payment_reference'] === null, 'al quitar el pago se borra la clave');
    ok(stripos($commPdfText($id), 'Pendiente de pago') !== false);
});
test('la cuenta del médico se filtra por periodo y avisa de los pendientes de otros periodos', function () use ($admin, $pdo) {
    $docId = (int)$pdo->query("SELECT id FROM vinculacion_doctors WHERE name = 'Rodolfo Ramírez del Pilar'")->fetchColumn();
    $ins = $pdo->prepare("INSERT INTO commission_entries (doctor_id, patient_name, entry_date, studies, total_amount, total_commission) VALUES (?, ?, ?, '[]', 100, 10)");
    $ins->execute([$docId, 'Pendiente de octubre', '2026-10-10']);
    $ins->execute([$docId, 'Pendiente de marzo', '2026-03-05']);
    $all = $admin->json('GET', '/api/index.php?r=commissions/entries_list&doctor_id=' . $docId, null)['json']['data'];
    $names = array_column($all['entries'], 'patient_name');
    ok(in_array('Pendiente de marzo', $names, true) && in_array('Pendiente de octubre', $names, true), 'sin periodo trae todo');
    $d = $admin->json('GET', '/api/index.php?r=commissions/entries_list&doctor_id=' . $docId . '&from=2026-09-01&to=2026-10-31', null)['json']['data'];
    $names = array_column($d['entries'], 'patient_name');
    ok(in_array('Pendiente de octubre', $names, true) && !in_array('Pendiente de marzo', $names, true), 'con periodo solo trae ese bimestre');
    eq(1, $d['pending_outside'], 'debía avisar del pendiente de marzo');
    ok(array_key_exists('paid_at', $d['entries'][0]), 'cada registro trae el estado de pago de su estado de cuenta');
});

test('solo el administrador puede marcar pagado, corregir o quitar el pago', function () use ($std, $pdo) {
    $id = (int)$pdo->query("SELECT id FROM commission_statements WHERE folio = '010126-77'")->fetchColumn();
    $csrf = $std->json('GET', '/api/index.php?r=auth/session', null)['json']['data']['csrf'];
    // con acceso a Comisiones, para que el rechazo sea por no ser administrador y no por falta de acceso
    $stdId = (int)$std->json('GET', '/api/index.php?r=auth/session', null)['json']['data']['user']['id'];
    $pdo->prepare("INSERT INTO user_permissions (user_id, module_key, flags) VALUES (?, 'apps', ?)")
        ->execute([$stdId, json_encode(['comisiones' => true])]);
    foreach (['statement_pay', 'statement_unpay'] as $action) {
        $r = $std->json('POST', '/api/index.php?r=commissions/' . $action, ['id' => $id, 'payment_reference' => 'MBAN0100261103ABC'], $csrf);
        ok($r['status'] === 403, "$action debía rechazar a un usuario estándar (HTTP {$r['status']})");
    }
    ok($pdo->query("SELECT paid_at FROM commission_statements WHERE id = $id")->fetchColumn() === null, 'no debía quedar pagado');
});
test('el listado de estados de cuenta se filtra por periodo de generación y por médico', function () use ($admin, $pdo) {
    $docId = (int)$pdo->query("SELECT id FROM vinculacion_doctors WHERE name = 'Rodolfo Ramírez del Pilar'")->fetchColumn();
    $today = date('Y-m-d');
    $in = $admin->json('GET', '/api/index.php?r=commissions/list&from=' . $today . '&to=' . $today, null)['json']['data'];
    ok($in['total'] >= 1, 'los estados generados hoy debían aparecer en un periodo que incluye hoy');
    $out = $admin->json('GET', '/api/index.php?r=commissions/list&from=2020-01-01&to=2020-02-29', null)['json']['data'];
    eq(0, $out['total'], 'un periodo viejo no debía traer estados recientes');
    $mine = $admin->json('GET', '/api/index.php?r=commissions/list&party_type=doctor&party_id=' . $docId, null)['json']['data'];
    ok($mine['total'] >= 1);
    $other = $admin->json('GET', '/api/index.php?r=commissions/list&party_type=doctor&party_id=999999', null)['json']['data'];
    eq(0, $other['total']);
});

test('el listado de estados de cuenta se filtra por estatus de pago', function () use ($admin, &$csrf, $pdo) {
    $id = (int)$pdo->query("SELECT id FROM commission_statements WHERE folio = '010126-77'")->fetchColumn();
    $ids = fn(string $status) => array_map('intval', array_column($admin->json('GET', '/api/index.php?r=commissions/list&status=' . $status, null)['json']['data']['items'], 'id'));
    ok(in_array($id, $ids('pending'), true), 'sin pagar debía salir en Pendiente de pago');
    ok(!in_array($id, $ids('paid'), true), 'sin pagar no debía salir en Pagado');
    eq(200, $admin->json('POST', '/api/index.php?r=commissions/statement_pay', ['id' => $id, 'payment_reference' => 'SPEI-FILTRO-001'], $csrf)['status']);
    ok(in_array($id, $ids('paid'), true), 'pagado debía salir en Pagado');
    ok(!in_array($id, $ids('pending'), true), 'pagado no debía salir en Pendiente de pago');
    $total = $admin->json('GET', '/api/index.php?r=commissions/list', null)['json']['data']['total'];
    eq($total, count($ids('paid')) + count($ids('pending')), 'sin filtro trae todos');
    eq(200, $admin->json('POST', '/api/index.php?r=commissions/statement_unpay', ['id' => $id], $csrf)['status']);
});

echo "\nAdmisión Facial\n";
test('el servicio Facial pide padecimientos, heredofamiliares, medicamentos, alergias, exposición, maquillaje y métricas', function () {
    require_once SIRIUS_PUBLIC . '/includes/services.php';
    $ids = array_column(service_sections('facial', 'admission'), 'id');
    foreach (['fa_app', 'fa_ahf', 'fa_med', 'fa_alergias', 'fa_exp', 'fa_maq', 'fa_piel', 'fa_medidas', 'firma'] as $sec) {
        ok(in_array($sec, $ids, true), "falta la sección $sec");
    }
    eq('Facial', SERVICE_LABELS['facial']);
});
test('una admisión Facial guarda sus datos, descarta llaves ajenas y sale en el expediente impreso', function () use ($admin, &$csrf, $pdo) {
    $r = $admin->json('POST', '/api/index.php?r=episodes/create', [
        'service' => 'facial',
        'patient' => ['first_name' => 'Paciente', 'paternal_surname' => 'Facial' . random_int(100, 999), 'sex' => 'F'],
        'service_data' => [
            'app_acne' => true, 'app_acne_det' => 'Desde 2020',
            'ahf_diabetes' => true, 'ahf_diabetes_det' => 'Madre, viva',
            'alg_fragancias' => true,
            'exp_quimicos' => true, 'exp_quimicos_det' => 'Cloro de alberca',
            'maq_base' => true, 'maq_base_det' => 'Marca Aurora, líquida',
            'met_tipo_piel' => 'Mixta', 'met_alt_facial' => '180', 'met_ancho_bicigomatico' => '130', 'met_ind_facial' => '138.5',
            'llave_inventada' => 'no debe guardarse',
        ],
        'ignore_duplicate' => true,
    ], $csrf);
    eq(200, $r['status'], $r['body']);
    $episodeId = (int)$r['json']['data']['episode_id'];
    $patientId = (int)$r['json']['data']['patient_id'];

    $row = $pdo->prepare('SELECT service, service_data FROM episodes WHERE id = ?');
    $row->execute([$episodeId]);
    $ep = $row->fetch();
    eq('facial', $ep['service']);
    $data = json_decode($ep['service_data'], true);
    eq('Cloro de alberca', $data['exp_quimicos_det']);
    eq('Marca Aurora, líquida', $data['maq_base_det']);
    eq('138.5', (string)$data['met_ind_facial']);
    ok(!isset($data['llave_inventada']), 'una llave que no está en el catálogo no debía guardarse');

    $pdf = $admin->req('GET', '/print.php?patient_id=' . $patientId);
    ok(str_starts_with($pdf['body'], '%PDF'), 'print.php no devolvió un PDF (HTTP ' . $pdf['status'] . ')');
    $tmp = tests_tmp_dir() . '/facial_' . $episodeId . '.pdf';
    file_put_contents($tmp, $pdf['body']);
    $txt = (string)pdf_extract_text($tmp);
    ok(stripos($txt, 'Facial') !== false, 'el expediente debía mencionar el servicio Facial');
    ok(str_contains($txt, 'Marca Aurora'), 'el expediente debía incluir la marca de maquillaje capturada');
    ok(str_contains($txt, 'Mixta'), 'el expediente debía incluir el tipo de piel');
});
test('el calendario acepta citas del servicio Facial', function () use ($admin, &$csrf, $pdo) {
    $r = $admin->json('POST', '/api/index.php?r=appointments/save', [
        'title' => 'Limpieza facial', 'service' => 'facial',
        'start_at' => '2027-01-12 10:00:00', 'end_at' => '2027-01-12 11:00:00',
    ], $csrf);
    eq(200, $r['status'], $r['body']);
    $svc = $pdo->prepare('SELECT service FROM appointments WHERE id = ?');
    $svc->execute([(int)($r['json']['data']['id'] ?? 0)]);
    eq('facial', $svc->fetchColumn());
});

echo "\nRespaldo cifrado\n";
test('respaldo.php entrega un archivo cifrado que se abre con su contraseña', function () use ($admin, &$csrf) {
    $r = $admin->form('/respaldo.php', ['_csrf' => $csrf, 'grupos' => 'usuarios,config', 'password' => 'una-contraseña-larga']);
    eq(200, $r['status'], $r['body']);
    ok($r['json']['sirius_backup_encrypted'] ?? false, 'el archivo no salió cifrado');
    ok(!str_contains($r['body'], 'admin_t'), 'hay datos en claro');
    $plain = backup_decrypt($r['json'], 'una-contraseña-larga');
    ok(isset($plain['tables']['users']));
});
test('respaldo.php sin CSRF por POST responde 403 y rechaza contraseñas cortas', function () use ($admin, &$csrf) {
    eq(403, $admin->form('/respaldo.php', ['grupos' => 'usuarios', 'password' => 'una-contraseña-larga'])['status']);
    eq(422, $admin->form('/respaldo.php', ['_csrf' => $csrf, 'grupos' => 'usuarios', 'password' => 'corta'])['status']);
});
test('un estándar no puede descargar respaldos', function () use ($std) {
    $csrf = $std->json('GET', '/api/index.php?r=auth/session', null)['json']['data']['csrf'];
    eq(403, $std->form('/respaldo.php', ['_csrf' => $csrf, 'grupos' => 'usuarios'])['status']);
});

echo "\ninstall/setup.php\n";
test('setup.php muestra un formulario y NO acepta la clave por la URL', function () use ($base) {
    $c = new Http($base);
    $r = $c->req('GET', '/install/setup.php?key=clave-de-prueba');
    eq(200, $r['status']);
    ok(str_contains($r['body'], '<form') && !str_contains($r['body'], 'completa'), 'la clave en la URL no debía ejecutar nada');
});
test('setup.php rechaza una clave incorrecta y aplica con la correcta', function () use ($base) {
    $c = new Http($base);
    $page = $c->req('GET', '/install/setup.php');
    preg_match('/name="_csrf" value="([0-9a-f]+)"/', $page['body'], $m);
    eq(403, $c->form('/install/setup.php', ['_csrf' => $m[1], 'key' => 'mal'])['status']);
    $ok = $c->form('/install/setup.php', ['_csrf' => $m[1], 'key' => 'clave-de-prueba']);
    eq(200, $ok['status']);
    ok(str_contains($ok['body'], 'Instalación/actualización completa'), 'no terminó la instalación');
});

echo "\nPáginas públicas\n";
test('login y manifest usan el nombre de la clínica de settings', function () use ($base, $pdo) {
    $pdo->prepare("UPDATE settings SET svalue = ? WHERE skey = 'clinic_name'")->execute(['Clínica de Prueba SA']);
    $c = new Http($base);
    $login = $c->req('GET', '/login.php')['body'];
    ok(str_contains($login, 'Clínica de Prueba SA'), 'login sin el nombre; log del servidor: ' . @file_get_contents(tests_tmp_dir() . '/server.log'));
    $manifest = $c->req('GET', '/manifest.php');
    ok(str_contains((string)($manifest['json']['name'] ?? ''), 'Clínica de Prueba SA'), 'manifest: HTTP ' . $manifest['status'] . ' ' . substr($manifest['body'], 0, 300));
    ok(!in_array($manifest['json']['orientation'] ?? 'any', ['portrait', 'landscape', 'portrait-primary', 'landscape-primary'], true), 'el manifest no debe bloquear la orientación (en una tablet no se podría girar)');
});

tests_finish();
