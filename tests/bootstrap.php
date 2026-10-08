<?php
/**
 * Arranque común de las pruebas automáticas de Sirius.
 *
 * - Crea una carpeta temporal con una config.php propia (SQLite) y apunta SIRIUS_CONFIG a ella:
 *   las pruebas NUNCA tocan public/includes/config.php ni la base de desarrollo.
 * - Mini framework de aserciones, sin dependencias (el proyecto no usa Composer).
 *
 * Uso:   php tests/run.php          pruebas unitarias y estructurales
 *        php tests/api_smoke.php    prueba de integración contra php -S
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

define('SIRIUS_ROOT', str_replace('\\', '/', dirname(__DIR__)));
define('SIRIUS_PUBLIC', SIRIUS_ROOT . '/public');

/** Carpeta temporal de esta corrida; se borra al terminar. */
function tests_tmp_dir(): string
{
    static $dir = null;
    if ($dir === null) {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'sirius-tests-' . getmypid() . '-' . bin2hex(random_bytes(3));
        mkdir($dir, 0775, true);
        register_shutdown_function(static function () use ($dir) {
            foreach (glob($dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($dir);
        });
    }
    return $dir;
}

/** Escribe la config de pruebas y devuelve su ruta. */
function tests_write_config(): string
{
    $dir = tests_tmp_dir();
    $cfg = $dir . '/config.php';
    $db = str_replace('\\', '/', $dir . '/test.sqlite');
    file_put_contents($cfg, "<?php\nreturn [\n"
        . "  'db' => ['driver' => 'sqlite', 'sqlite_path' => '$db'],\n"
        . "  'app_env' => 'dev',\n"
        . "  'install_key' => 'clave-de-prueba',\n"
        . "  'cron_key' => 'cron-de-prueba',\n"
        . "  'ca_bundle' => '',\n"
        . "];\n");
    return $cfg;
}

/* ---------------- Aserciones ---------------- */

$GLOBALS['__tests'] = ['pass' => 0, 'fail' => 0, 'failures' => []];

function test(string $name, callable $fn): void
{
    try {
        $fn();
        $GLOBALS['__tests']['pass']++;
        echo "  ok   $name\n";
    } catch (Throwable $e) {
        $GLOBALS['__tests']['fail']++;
        $GLOBALS['__tests']['failures'][] = $name;
        echo "  FAIL $name\n       " . str_replace("\n", "\n       ", $e->getMessage()) . "\n";
    }
}

function eq($expected, $actual, string $msg = ''): void
{
    if ($expected !== $actual) {
        throw new Exception(($msg !== '' ? "$msg: " : '') . 'esperado ' . var_export($expected, true) . ', obtenido ' . var_export($actual, true));
    }
}

function ok($cond, string $msg = 'la condición debía ser verdadera'): void
{
    if (!$cond) {
        throw new Exception($msg);
    }
}

function throws(callable $fn, string $contains = ''): void
{
    try {
        $fn();
    } catch (Throwable $e) {
        if ($contains !== '' && stripos($e->getMessage(), $contains) === false) {
            throw new Exception("la excepción \"{$e->getMessage()}\" no contiene \"$contains\"");
        }
        return;
    }
    throw new Exception('debía lanzar una excepción');
}

function tests_finish(): void
{
    $t = $GLOBALS['__tests'];
    echo "\n{$t['pass']} correctas, {$t['fail']} con fallo\n";
    if ($t['fail']) {
        echo "Fallaron:\n  - " . implode("\n  - ", $t['failures']) . "\n";
        exit(1);
    }
    exit(0);
}
