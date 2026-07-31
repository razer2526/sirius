<?php
/**
 * Descarga del respaldo de la base de datos (Admin Tools > Backup > Exportar).
 * Se entrega como archivo JSON; solo para administradores.
 *
 *   respaldo.php?grupos=usuarios,pacientes,config
 */

require_once __DIR__ . '/includes/auth.php';
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

$requested = array_filter(array_map('trim', explode(',', (string)($_GET['grupos'] ?? ''))));
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

$json = json_encode($backup, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
$total = array_sum(array_map('count', $backup['tables']));
log_activity('backup', 'export', 'Descargó respaldo (' . implode(', ', $requested) . ") · $total registros");

$name = 'sirius-respaldo-' . date('Ymd-His') . '.json';
header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . strlen($json));
header('Cache-Control: private, no-store');
echo $json;
