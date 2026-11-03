<?php
/**
 * Entrega las imágenes (y notas manuscritas) de la descripción de una tarea.
 * uploads/tasks está denegado por .htaccess: este es el único camino (mismo patrón que board_asset.php).
 *
 *   task_asset.php?id=12   → imagen #12
 *
 * El id es secuencial, así que no basta con verificar la sesión: una imagen se sirve solo a quien
 * puede ver su tarea (gestores, creador, asignados). Una recién subida y aún sin tarea, solo a quien la subió.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/task_assets.php';

session_boot();
$me = current_user();
if (!$me) {
    header('Location: login.php');
    exit;
}
if (!user_can('tareas')) {
    http_response_code(403);
    exit('No tienes permiso para ver esta imagen.');
}

$st = db()->prepare('SELECT stored_name, task_id, created_by FROM task_assets WHERE id = ?');
$st->execute([(int)($_GET['id'] ?? 0)]);
$row = $st->fetch();

$allowed = false;
if ($row) {
    if ($row['task_id'] === null) {
        $allowed = (int)$row['created_by'] === (int)$me['id'];
    } else {
        $st = db()->prepare('SELECT id, parent_id, created_by FROM tasks WHERE id = ?');
        $st->execute([(int)$row['task_id']]);
        $task = $st->fetch();
        // Si la tarea ya no existe (está en la papelera) la imagen sigue ahí para restaurarla, pero no se muestra a nadie.
        $canManage = is_admin_role($me) || user_flag('tareas', 'manage');
        $allowed = $task && task_user_can_view($task, $me, $canManage);
    }
}

// Misma respuesta para "no existe" y "no es tuya": no se revela qué ids existen.
if (!$row || !$allowed) {
    http_response_code(404);
    exit('Sin imagen.');
}

$path = TASK_ASSET_DIR . basename($row['stored_name']);
if (!is_file($path)) {
    http_response_code(404);
    exit('La imagen ya no está disponible.');
}

$mime = @mime_content_type($path) ?: 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($path));
header('Cache-Control: private, max-age=86400');
header('X-Content-Type-Options: nosniff');
readfile($path);
