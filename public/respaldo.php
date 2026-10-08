<?php
/**
 * Descarga del respaldo de la base de datos (Admin Tools > Backup > Exportar).
 * Se entrega como archivo JSON; solo para administradores.
 *
 *   POST  grupos=usuarios,pacientes  [password=…]  _csrf=…   → con password, el archivo sale CIFRADO.
 *   GET   respaldo.php?grupos=…                                → sin cifrar (compatibilidad). La
 *         contraseña nunca viaja por GET: quedaría en los logs.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/csrf.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';
require_once __DIR__ . '/includes/backup.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
if (!user_can('backup') || !is_admin_role(current_user())) {
    http_response_code(403);
    exit('Esta descarga requiere rol de administrador.');
}

$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($isPost && !csrf_verify()) {
    http_response_code(403);
    exit('Token CSRF inválido. Recarga la página e intenta de nuevo.');
}
$password = $isPost ? (string)($_POST['password'] ?? '') : '';
$groupsRaw = (string)($isPost ? ($_POST['grupos'] ?? '') : ($_GET['grupos'] ?? ''));
$requested = array_filter(array_map('trim', explode(',', $groupsRaw)));
if (!$requested) {
    $requested = array_keys(backup_groups());
}

try {
    $backup = backup_create($requested);
} catch (Throwable $e) {
    error_log('respaldo.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el respaldo.');
}

$total = array_sum(array_map('count', $backup['tables']));
$encrypted = $password !== '';
if ($encrypted) {
    try {
        $backup = backup_encrypt($backup, $password);
    } catch (Throwable $e) {
        http_response_code(422);
        exit($e->getMessage());
    }
}
$json = json_encode($backup, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
log_activity('backup', 'export', 'Descargó respaldo ' . ($encrypted ? 'cifrado ' : 'SIN cifrar ') . '(' . implode(', ', $requested) . ") · $total registros");

$name = 'sirius-respaldo-' . date('Ymd-His') . ($encrypted ? '-cifrado' : '') . '.json';
header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . strlen($json));
header('Cache-Control: private, no-store');
echo $json;
