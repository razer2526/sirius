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
