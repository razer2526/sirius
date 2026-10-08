<?php
/**
 * Instalador de Sirius: crea tablas (idempotente) y siembra el usuario Admin.
 * Uso: abrir install/setup.php, escribir la install_key de config.php y pulsar "Aplicar".
 *
 * La clave se manda por POST y NO por la URL (?key=): una URL queda en los logs de
 * acceso del servidor y en el historial del navegador. Por eso ?key= ya no se acepta.
 *
 * Este endpoint sigue vivo DESPUÉS de la primera instalación: en cada
 * actualización que traiga cambios de esquema (tablas o columnas nuevas),
 * se vuelve a abrir esta página para aplicarlos — es idempotente y nunca
 * borra datos. La primera instalación normalmente se hace con el asistente
 * visual (install/index.php), que además escribe config.php y crea el
 * administrador con las credenciales que tú elijas.
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/csrf.php';
require_once __DIR__ . '/schema.php';

const SETUP_MAX_FAILS = 5;       // intentos fallidos permitidos por sesión
const SETUP_LOCK_SECONDS = 600;  // espera tras agotarlos

session_boot();
$cfg = app_config();

/** Formulario mínimo (HTML) para pedir la clave. */
function setup_form(string $message = ''): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    $msg = $message !== '' ? '<p style="color:#b91c1c">' . htmlspecialchars($message) . '</p>' : '';
    echo '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>Sirius — Actualizar base de datos</title></head>'
        . '<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem">'
        . '<h1 style="font-size:1.25rem">Actualizar la base de datos</h1>'
        . '<p style="color:#475569">Escribe la clave de instalación (<code>install_key</code> de <code>config.php</code>). '
        . 'Es idempotente: crea lo que falte y nunca borra datos.</p>' . $msg
        . '<form method="post"><input type="hidden" name="_csrf" value="' . htmlspecialchars(csrf_token()) . '">'
        . '<input type="password" name="key" autocomplete="off" required autofocus style="width:100%;padding:.5rem;margin:.5rem 0">'
        . '<button type="submit" style="padding:.5rem 1rem">Aplicar</button></form></body></html>';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    setup_form();
}

$now = time();
if (($_SESSION['setup_fails'] ?? 0) >= SETUP_MAX_FAILS && ($now - ($_SESSION['setup_last_fail'] ?? 0)) < SETUP_LOCK_SECONDS) {
    http_response_code(429);
    setup_form('Demasiados intentos. Espera unos minutos.');
}
if (!csrf_verify()) {
    http_response_code(403);
    setup_form('La sesión expiró. Intenta de nuevo.');
}
$key = (string)($_POST['key'] ?? '');
if (!hash_equals((string)$cfg['install_key'], $key)) {
    $_SESSION['setup_fails'] = (($now - ($_SESSION['setup_last_fail'] ?? 0)) < SETUP_LOCK_SECONDS ? ($_SESSION['setup_fails'] ?? 0) : 0) + 1;
    $_SESSION['setup_last_fail'] = $now;
    error_log('setup.php: clave de instalación incorrecta desde ' . ($_SERVER['REMOTE_ADDR'] ?? '?'));
    sleep(2);
    http_response_code(403);
    setup_form('Clave de instalación incorrecta.');
}
unset($_SESSION['setup_fails'], $_SESSION['setup_last_fail']);

header('Content-Type: text/plain; charset=utf-8');

$pdo = db();
$isMysql = db_driver() === 'mysql';

foreach (sirius_install_schema($pdo, $isMysql) as $line) {
    echo $line . "\n";
}

// ---- Seed: usuario Admin (solo si no hay ninguno; el asistente visual ya
// crea uno con credenciales propias, esto es para desarrollo/emergencia) ----
// La contraseña inicial NO vive en el código (el repositorio es público): sale de
// 'seed_admin_password' en includes/config.php, que no se versiona.
$seedPassword = (string)($cfg['seed_admin_password'] ?? '');
if ($seedPassword === '') {
    echo "Admin: no se sembró (sin 'seed_admin_password' en config.php; usa el asistente install/index.php).\n";
} else {
    $result = sirius_seed_admin($pdo, 'Admin', $seedPassword, 'Administrador');
    foreach ($result['log'] as $line) {
        echo $line . "\n";
    }
    if ($result['created']) {
        echo "Cambia la contraseña tras el primer inicio de sesión.\n";
    }
}

echo "\nInstalación/actualización completa.\n";
