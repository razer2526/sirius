<?php
/**
 * Pruebas unitarias y estructurales de Sirius (sin dependencias).
 *   php tests/run.php
 */

require __DIR__ . '/bootstrap.php';

putenv('SIRIUS_CONFIG=' . tests_write_config());

require_once SIRIUS_PUBLIC . '/includes/db.php';
require_once SIRIUS_PUBLIC . '/install/schema.php';
require_once SIRIUS_PUBLIC . '/includes/auth.php';
require_once SIRIUS_PUBLIC . '/includes/csrf.php';
require_once SIRIUS_PUBLIC . '/includes/permissions.php';
require_once SIRIUS_PUBLIC . '/includes/employees.php';
require_once SIRIUS_PUBLIC . '/includes/backup.php';
require_once SIRIUS_PUBLIC . '/includes/branding.php';
require_once SIRIUS_PUBLIC . '/includes/services.php';
require_once SIRIUS_PUBLIC . '/includes/lab_catalog.php';

$pdo = db();

echo "Esquema\n";
test('el esquema se instala dos veces sin error (idempotencia)', function () use ($pdo) {
    sirius_install_schema($pdo, false);
    sirius_install_schema($pdo, false);
    foreach (['users', 'login_attempts', 'employee_profiles', 'remember_tokens', 'settings'] as $t) {
        $pdo->query("SELECT 1 FROM $t LIMIT 1");
    }
});

test('cada tabla del esquema está escrita en MySQL y en SQLite', function () {
    $src = file_get_contents(SIRIUS_PUBLIC . '/install/schema.php');
    preg_match_all("/^\s+'([a-z_]+)' => \"CREATE TABLE IF NOT EXISTS/m", $src, $m);
    $count = array_count_values($m[1]);
    $bad = array_keys(array_filter($count, fn($n) => $n !== 2));
    ok(!$bad, 'tablas sin pareja MySQL/SQLite: ' . implode(', ', $bad));
    ok(count($count) >= 50, 'se esperaban al menos 50 tablas, hay ' . count($count));
});

test('el DDL de MySQL no usa palabras reservadas como nombre de columna', function () {
    $src = file_get_contents(SIRIUS_PUBLIC . '/install/schema.php');
    // Solo el bloque MySQL (hasta el primer CREATE TABLE de SQLite que repite 'users').
    $mysql = substr($src, 0, strpos($src, "'users' => \"CREATE TABLE", strpos($src, "'users' => \"CREATE TABLE") + 10));
    foreach (['lines', 'groups', 'rank', 'key', 'condition', 'desc', 'order', 'column', 'index', 'table'] as $word) {
        ok(!preg_match('/^\s+' . $word . '\s+(INT|VARCHAR|TEXT|DATE|DECIMAL|TINYINT|BIGINT|CHAR|JSON|TIMESTAMP|DATETIME)/mi', $mysql),
            "columna con palabra reservada de MySQL: $word");
    }
});

echo "\nEmpleados\n";
test('antigüedad: casos de borde de mes y año', function () {
    $tz = new DateTimeZone('America/Mexico_City');
    $d = fn(string $s) => new DateTimeImmutable($s, $tz);
    $t = employee_tenure('2026-01-31', $d('2026-03-01'));
    eq([0, 1, 1], [$t['years'], $t['months'], $t['days']], '31-ene → 1-mar');
    $t = employee_tenure('2024-02-29', $d('2025-02-28'));
    eq([1, 0, 0], [$t['years'], $t['months'], $t['days']], '29-feb → 28-feb siguiente');
    $t = employee_tenure('2026-10-08', $d('2026-10-08'));
    eq('Hoy es su primer día', $t['text']);
    $t = employee_tenure('2026-12-01', $d('2026-10-08'));
    eq(false, $t['started']);
    eq(null, employee_tenure('', $d('2026-10-08')));
});

test('vacaciones: solo cuentan los días de la jornada', function () {
    $tz = new DateTimeZone('America/Mexico_City');
    $sched = employee_normalize_schedule(['days' => [
        'mon' => ['on' => true, 'from' => '09:00', 'to' => '17:00'],
        'tue' => ['on' => true, 'from' => '09:00', 'to' => '17:00'],
        'wed' => ['on' => true, 'from' => '09:00', 'to' => '17:00'],
        'thu' => ['on' => true, 'from' => '09:00', 'to' => '17:00'],
        'fri' => ['on' => true, 'from' => '09:00', 'to' => '17:00'],
    ]]);
    $fri = new DateTimeImmutable('2026-10-09', $tz);
    $mon = new DateTimeImmutable('2026-10-12', $tz);
    eq(2, employee_count_days($fri, $mon, $sched)['days'], 'vie→lun con jornada L-V');
    eq(4, employee_count_days($fri, $mon, employee_empty_schedule())['days'], 'sin jornada cuenta días naturales');
    eq(40.0, employee_weekly_hours($sched));
});

test('jornada: rechaza horas inválidas y salida antes de la entrada', function () {
    throws(fn() => employee_normalize_schedule(['days' => ['mon' => ['on' => true, 'from' => '25:00', 'to' => '17:00']]]));
    throws(fn() => employee_normalize_schedule(['days' => ['mon' => ['on' => true, 'from' => '18:00', 'to' => '09:00']]]));
});

echo "\nPermisos\n";
test('permisos por módulo, flags y mode_flags', function () use ($pdo) {
    $mk = function (string $user, string $role) use ($pdo): array {
        $pdo->prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
            ->execute([$user, password_hash('x', PASSWORD_DEFAULT), $user, $role]);
        return ['id' => (int)$pdo->lastInsertId(), 'username' => $user, 'role' => $role];
    };
    $admin = $mk('t_admin', 'administrador');
    $std = $mk('t_std', 'estandar');
    $pdo->prepare('INSERT INTO user_permissions (user_id, module_key, flags) VALUES (?, ?, ?)')
        ->execute([$std['id'], 'inventario', json_encode(['manage' => true])]);
    $pdo->prepare('INSERT INTO user_permissions (user_id, module_key, flags) VALUES (?, ?, ?)')
        ->execute([$std['id'], 'admision', json_encode([])]);

    ok(user_can_for($admin, 'backup'), 'el administrador accede a todo');
    ok(!user_can_for($std, 'backup'), 'el estándar no accede a lo no concedido');
    ok(user_can_for($std, 'inventario'));
    ok(user_can_for($std, 'perfil') && user_can_for($std, 'configuracion'), 'perfil y configuración siempre disponibles');
    ok(!user_can_for($std, 'modulo_que_no_existe'));
    ok(user_flag_for($std, 'inventario', 'manage'));
    ok(user_flag_for($admin, 'inventario', 'manage'), 'el administrador hereda los flags');
    ok(!user_flag_for($admin, 'admision', 'wizard'), 'el wizard (mode_flag) NO se hereda por rol');
    ok(!user_flag_for($std, 'admision', 'wizard'));
});

echo "\nAutenticación\n";
test('CSRF: acepta el token de la sesión y rechaza otro', function () {
    $_SESSION['csrf_token'] = str_repeat('a', 64);
    $_SERVER['HTTP_X_CSRF_TOKEN'] = str_repeat('a', 64);
    ok(csrf_verify());
    $_SERVER['HTTP_X_CSRF_TOKEN'] = str_repeat('b', 64);
    ok(!csrf_verify());
    unset($_SERVER['HTTP_X_CSRF_TOKEN']);
    ok(!csrf_verify(), 'sin token no pasa');
});

test('el login se bloquea por IP tras demasiados intentos fallidos', function () {
    $_SERVER['REMOTE_ADDR'] = '203.0.113.7';
    for ($i = 0; $i < LOGIN_IP_MAX_FAILS; $i++) {
        $_SESSION = [];   // cada intento desde una sesión nueva: solo el freno por IP puede detenerlo
        $r = attempt_login('no_existe', 'x');
        eq(false, $r['ok']);
        ok(!str_contains($r['error'], 'esta red'), 'aún no debía bloquear en el intento ' . ($i + 1));
    }
    $_SESSION = [];
    $r = attempt_login('no_existe', 'x');
    ok(str_contains($r['error'], 'esta red'), 'debía bloquear la IP: ' . $r['error']);
    $_SERVER['REMOTE_ADDR'] = '203.0.113.8';
    $_SESSION = [];
    ok(!str_contains(attempt_login('no_existe', 'x')['error'], 'esta red'), 'otra IP no se ve afectada');
});

echo "\nRespaldos\n";
test('respaldo cifrado: ida y vuelta, contraseña incorrecta y archivo alterado', function () {
    $backup = backup_create(['usuarios', 'config']);
    $env = backup_encrypt($backup, 'contraseña-larga-123');
    ok(backup_is_encrypted($env));
    ok(!str_contains(json_encode($env), 't_admin'), 'el sobre no debe contener datos en claro');
    eq($backup['tables'], backup_decrypt($env, 'contraseña-larga-123')['tables']);
    throws(fn() => backup_decrypt($env, 'otra-contraseña-123'), 'incorrecta');
    $tampered = $env;
    $tampered['ciphertext'] = base64_encode('x' . base64_decode($env['ciphertext']));
    throws(fn() => backup_decrypt($tampered, 'contraseña-larga-123'));
    throws(fn() => backup_encrypt($backup, 'corta'), 'al menos');
});

test('respaldo: restaurar en modo reemplazo devuelve los mismos registros', function () use ($pdo) {
    $before = (int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
    $backup = backup_create(['usuarios']);
    $restored = backup_restore($backup, true);
    eq($before, (int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c']);
    ok($restored['users'] === $before);
});

echo "\nOtros\n";
test('lab_save_test normaliza un sexo nulo a "A" en vez de romper NOT NULL', function () use ($pdo) {
    $id = lab_save_test(['name' => 'Glucosa de prueba', 'unit' => 'mg/dL'], [
        ['sex' => null, 'min_value' => 70, 'max_value' => 100],
        ['sex' => 'x', 'min_value' => 1, 'max_value' => 2],
        ['sex' => 'F', 'min_value' => 3, 'max_value' => 4],
    ], null);
    $rows = $pdo->query("SELECT sex FROM lab_reference_ranges WHERE test_id = $id ORDER BY sort_order")->fetchAll(PDO::FETCH_COLUMN);
    eq(['A', 'A', 'F'], $rows);
});

test('el nombre de la clínica sale de settings y tiene respaldo', function () {
    ok(app_clinic_name() !== '');
});

test('el catálogo de servicios define llaves permitidas por etapa', function () {
    foreach (array_keys(SERVICE_LABELS) as $svc) {
        ok(count(service_allowed_keys($svc, 'admission')) > 5, "sin campos de admisión para $svc");
    }
});

echo "\nEstructura del proyecto\n";
test('todo archivo JS de assets/js está en el precaché (SHELL) de sw.js', function () {
    $sw = file_get_contents(SIRIUS_PUBLIC . '/sw.js');
    $missing = [];
    foreach (array_merge(glob(SIRIUS_PUBLIC . '/assets/js/*.js'), glob(SIRIUS_PUBLIC . '/assets/js/*.json'), glob(SIRIUS_PUBLIC . '/assets/js/modules/*.js')) as $f) {
        $rel = ltrim(str_replace(SIRIUS_PUBLIC, '', str_replace('\\', '/', $f)), '/');
        if (!str_contains($sw, "'$rel'")) {
            $missing[] = $rel;
        }
    }
    ok(!$missing, 'faltan en SHELL: ' . implode(', ', $missing));
});

test('cada ruta de la API tiene su handler y cada módulo su archivo JS', function () {
    $index = file_get_contents(SIRIUS_PUBLIC . '/api/index.php');
    preg_match_all("/'([a-z_]+)'\s*=>\s*\['([a-z_]+\.php)',\s*(?:'([a-z_]+)'|null)\]/", $index, $m, PREG_SET_ORDER);
    ok(count($m) >= 35, 'se esperaban 35 rutas, hay ' . count($m));
    $modules = require SIRIUS_PUBLIC . '/includes/modules.php';
    foreach ($m as $row) {
        [, $resource, $file] = $row;
        $module = $row[3] ?? '';
        $path = SIRIUS_PUBLIC . '/api/handlers/' . $file;
        ok(is_file($path), "falta el handler $file");
        ok(str_contains(file_get_contents($path), "function handle_$resource("), "$file no define handle_$resource()");
        if ($module !== '') {
            ok(isset($modules[$module]), "la ruta $resource exige el módulo inexistente $module");
        }
    }
    foreach (array_keys($modules) as $key) {
        ok(is_file(SIRIUS_PUBLIC . "/assets/js/modules/$key.js"), "falta assets/js/modules/$key.js");
    }
});

test('CSP: la política existe, es restrictiva y la app no usa scripts en línea', function () {
    $ht = file_get_contents(SIRIUS_PUBLIC . '/.htaccess');
    ok(preg_match('/Header set Content-Security-Policy(-Report-Only)? "([^"]+)"/', $ht, $m), 'falta la cabecera Content-Security-Policy en .htaccess');
    $policy = $m[2];
    ok(str_contains($policy, "default-src 'self'") && str_contains($policy, "object-src 'none'"), 'política demasiado abierta');
    $scriptSrc = preg_match('/script-src ([^;]+)/', $policy, $s) ? $s[1] : '';
    ok(!str_contains($scriptSrc, 'unsafe-inline') && !str_contains($scriptSrc, 'unsafe-eval'), 'script-src no debe permitir unsafe-inline/unsafe-eval');
    $bad = [];
    $files = array_merge(glob(SIRIUS_PUBLIC . '/*.php'), glob(SIRIUS_PUBLIC . '/assets/js/*.js'), glob(SIRIUS_PUBLIC . '/assets/js/modules/*.js'));
    foreach ($files as $f) {
        if (basename($f) === 'bascula_prueba.php') {
            continue;   // diagnóstico: tiene su propia política en .htaccess
        }
        $src = file_get_contents($f);
        $inlineScript = '/<script(?![^>]*src=)[^>]*>/i';
        $inlineHandler = '/\son(click|change|submit|input|load|error)\s*=\s*["\x27]/i';
        if (preg_match($inlineScript, $src, $mm) || preg_match($inlineHandler, $src, $mm)) {
            $bad[] = basename($f) . ' (' . trim($mm[0]) . ')';
        }
    }
    ok(!$bad, 'scripts o manejadores en línea en: ' . implode(', ', $bad));
});

test('todos los PHP de public/ pasan php -l', function () {
    $bad = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(SIRIUS_PUBLIC, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        $p = $f->getPathname();
        if (substr($p, -4) !== '.php' || str_contains(str_replace('\\', '/', $p), '/vendor/') || str_ends_with($p, 'config.php')) {
            continue;
        }
        exec('"' . PHP_BINARY . '" -l ' . escapeshellarg($p) . ' 2>&1', $out, $code);
        if ($code !== 0) {
            $bad[] = $p;
        }
        $out = [];
    }
    ok(!$bad, 'errores de sintaxis en: ' . implode(', ', $bad));
});

tests_finish();
