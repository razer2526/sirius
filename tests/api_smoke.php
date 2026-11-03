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

    /** Subida multipart con un archivo (campo "file") y campos de texto. */
    public function upload(string $path, array $fields, string $bytes, string $filename, string $csrf): array
    {
        $boundary = 'sirius' . bin2hex(random_bytes(8));
        $body = '';
        foreach ($fields as $k => $v) {
            $body .= "--$boundary\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
        }
        $body .= "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$filename\"\r\nContent-Type: application/octet-stream\r\n\r\n$bytes\r\n--$boundary--\r\n";
        return $this->req('POST', $path, ["Content-Type: multipart/form-data; boundary=$boundary", 'X-CSRF-Token: ' . $csrf], $body);
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
test('imágenes y notas a mano de una tarea: se suben, se enlazan al guardar y solo las ve quien ve la tarea', function () use ($admin, &$csrf, $mkTask, $getTask, $base, $pdo) {
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==');
    $up = $admin->upload('/api/index.php?r=tasks/asset_upload', [], $png, 'nota-a-mano.png', $csrf);
    eq(200, $up['status'], $up['body']);
    $asset = (int)$up['json']['data']['asset']['id'];
    $url = '/' . $up['json']['data']['asset']['url'];
    $row = $pdo->query("SELECT task_id FROM task_assets WHERE id = $asset")->fetch();
    eq(null, $row['task_id'], 'recién subida: aún sin tarea');

    $bad = $admin->upload('/api/index.php?r=tasks/asset_upload', [], 'esto no es una imagen', 'x.png', $csrf);
    eq(422, $bad['status'], 'un archivo que no es imagen se rechaza aunque se llame .png');

    $u = $admin->json('POST', '/api/index.php?r=users/create', ['username' => 'otro_tareas', 'full_name' => 'Otro', 'password' => 'Clave-prueba-1', 'role' => 'estandar', 'permissions' => ['tareas' => []]], $csrf);
    eq(200, $u['status'], $u['body']);
    $other = new Http($base);
    $otherCsrf = $other->login('otro_tareas', 'Clave-prueba-1');

    eq(200, $admin->req('GET', $url)['status'], 'quien la subió la ve');
    eq(404, $other->req('GET', $url)['status'], 'sin tarea, nadie más la ve');

    $id = $mkTask($admin, $csrf, 'Con imagen', [
        ['t' => 'li', 'align' => 'center', 'runs' => [['s' => 'Pedido']]], ['t' => 'img', 'asset' => $asset],
    ]);
    $t = $getTask($admin, $id);
    eq(['li', 'img'], array_column($t['desc_blocks'], 't'));
    eq('center', $t['desc_blocks'][0]['align']);
    eq($asset, $t['desc_blocks'][1]['asset']);
    $row = $pdo->query("SELECT task_id FROM task_assets WHERE id = $asset")->fetch();
    eq($id, (int)$row['task_id'], 'al guardar la tarea la imagen queda enlazada');
    eq(404, $other->req('GET', $url)['status'], 'quien no ve la tarea no ve su imagen');

    // La imagen de una tarea no se puede colar en otra
    $id2 = $mkTask($admin, $csrf, 'Otra', [['t' => 'p', 'runs' => [['s' => 'texto']]], ['t' => 'img', 'asset' => $asset]]);
    eq(['p'], array_column($getTask($admin, $id2)['desc_blocks'], 't'));

    // Al asignársela, la persona sí ve la imagen
    $uid = (int)$pdo->query("SELECT id FROM users WHERE username = 'otro_tareas'")->fetch()['id'];
    $r = $admin->json('POST', '/api/index.php?r=tasks/save', ['id' => $id, 'title' => 'Con imagen', 'description' => ['v' => 2, 'blocks' => $t['desc_blocks']], 'assigned_to' => [$uid], 'priority' => 'media'], $csrf);
    eq(200, $r['status'], $r['body']);
    eq(200, $other->req('GET', $url)['status'], 'un asignado ve la imagen');

    // Un estándar no sube imágenes a una tarea ajena
    $deny = $other->upload('/api/index.php?r=tasks/asset_upload', ['task_id' => (string)$id], $png, 'x.png', $otherCsrf);
    eq(403, $deny['status'], $deny['body']);
});

test('proyectos: descripción con formato, imágenes y casillas; solo quien ve el proyecto las ve', function () use ($admin, &$csrf, $mkTask, $base, $pdo) {
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==');
    $up = $admin->upload('/api/index.php?r=tasks/asset_upload', [], $png, 'plano.png', $csrf);
    $asset = (int)$up['json']['data']['asset']['id'];
    $url = '/' . $up['json']['data']['asset']['url'];

    $blocks = [
        ['t' => 'li', 'runs' => [['s' => 'Alcance']]],
        ['t' => 'todo', 'runs' => [['s' => 'Cotizar']]],
        ['t' => 'img', 'asset' => $asset],
        ['t' => 'img', 'asset' => 99999],
    ];
    $r = $admin->json('POST', '/api/index.php?r=tasks/project_save', ['name' => 'Remodelación', 'description' => ['v' => 2, 'blocks' => $blocks], 'status' => 'activo', 'assigned_to' => []], $csrf);
    eq(200, $r['status'], $r['body']);
    $pid = (int)$r['json']['data']['id'];
    $getProject = function () use ($admin, $pid) {
        $projects = $admin->json('GET', '/api/index.php?r=tasks/list', null)['json']['data']['projects'];
        return array_values(array_filter($projects, fn($p) => $p['id'] === $pid))[0];
    };
    $p = $getProject();
    eq(['li', 'todo', 'img'], array_column($p['desc_blocks'], 't'), 'la imagen ajena se descarta');
    eq([1, 0], [$p['todo_total'], $p['todo_done']]);
    eq("• Alcance\n☐ Cotizar\n[imagen]", $p['description']);
    eq($pid, (int)$pdo->query("SELECT project_id FROM task_assets WHERE id = $asset")->fetch()['project_id'], 'la imagen queda enlazada al proyecto');

    // Casilla del proyecto
    $c = $admin->json('POST', '/api/index.php?r=tasks/project_toggle_check', ['id' => $pid, 'index' => 0, 'done' => true], $csrf);
    eq(200, $c['status'], $c['body']);
    eq([1, 1], [$getProject()['todo_total'], $getProject()['todo_done']]);
    eq(404, $admin->json('POST', '/api/index.php?r=tasks/project_toggle_check', ['id' => $pid, 'index' => 5, 'done' => true], $csrf)['status'], 'casilla inexistente');

    // Un estándar sin relación con el proyecto no ve la imagen ni marca casillas; con una tarea suya dentro, sí las ve
    $u = $admin->json('POST', '/api/index.php?r=users/create', ['username' => 'miembro_proy', 'full_name' => 'Miembro', 'password' => 'Clave-prueba-1', 'role' => 'estandar', 'permissions' => ['tareas' => []]], $csrf);
    eq(200, $u['status'], $u['body']);
    $uid = (int)$pdo->query("SELECT id FROM users WHERE username = 'miembro_proy'")->fetch()['id'];
    $m = new Http($base);
    $mCsrf = $m->login('miembro_proy', 'Clave-prueba-1');
    eq(404, $m->req('GET', $url)['status'], 'sin relación con el proyecto no ve la imagen');
    eq(403, $m->json('POST', '/api/index.php?r=tasks/project_toggle_check', ['id' => $pid, 'index' => 0, 'done' => false], $mCsrf)['status']);
    $mkTask($admin, $csrf, 'Tarea del proyecto', [['t' => 'p', 'runs' => [['s' => 'x']]]], ['project_id' => $pid, 'assigned_to' => [$uid]]);
    eq(200, $m->req('GET', $url)['status'], 'con una tarea asignada dentro del proyecto sí la ve');

    // Solo quien gestiona Tareas edita la descripción del proyecto (y le sube imágenes)
    eq(403, $m->upload('/api/index.php?r=tasks/asset_upload', ['project_id' => (string)$pid], $png, 'x.png', $mCsrf)['status']);
    eq(403, $m->json('POST', '/api/index.php?r=tasks/project_save', ['id' => $pid, 'name' => 'x'], $mCsrf)['status']);

    // Una descripción en texto plano (cliente anterior) se sigue aceptando
    $r = $admin->json('POST', '/api/index.php?r=tasks/project_save', ['id' => $pid, 'name' => 'Remodelación', 'description' => "Solo texto\nen dos líneas", 'status' => 'activo'], $csrf);
    eq(200, $r['status'], $r['body']);
    eq("Solo texto\nen dos líneas", $getProject()['description']);
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
