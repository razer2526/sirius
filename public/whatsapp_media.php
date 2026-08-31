<?php
/**
 * Entrega un adjunto de WhatsApp (foto, video, audio, documento). Los archivos
 * viven fuera del alcance web (uploads/whatsapp está denegado por .htaccess):
 * este es el único camino, y verifica sesión y acceso a la conversación antes
 * de leer un solo byte.
 *
 *   whatsapp_media.php?message_id=12            → vista en el navegador
 *   whatsapp_media.php?message_id=12&download=1 → descarga
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
$me = current_user();
if (!user_can('whatsapp')) {
    http_response_code(403);
    exit('No tienes permiso para ver adjuntos de WhatsApp.');
}
$canManage = is_admin_role($me) || user_flag('whatsapp', 'manage');

$id = (int)($_GET['message_id'] ?? 0);
$st = db()->prepare('SELECT * FROM wa_messages WHERE id = ?');
$st->execute([$id]);
$msg = $st->fetch();
if (!$msg || !$msg['media_path']) {
    http_response_code(404);
    exit('Adjunto no encontrado.');
}

$st = db()->prepare('SELECT assigned_user_id, wa_id FROM wa_conversations WHERE id = ?');
$st->execute([(int)$msg['conversation_id']]);
$conv = $st->fetch();
if (!$conv) {
    http_response_code(404);
    exit('Conversación no encontrada.');
}
$assigned = $conv['assigned_user_id'];
if (!$canManage && $assigned !== null && (int)$assigned !== (int)$me['id']) {
    http_response_code(403);
    exit('No tienes acceso a esta conversación.');
}

$path = __DIR__ . '/uploads/whatsapp/' . basename($msg['media_path']);
if (!is_file($path)) {
    http_response_code(404);
    exit('El archivo ya no existe en el servidor.');
}

$download = !empty($_GET['download']);
$name = $msg['media_filename'] ?: 'adjunto';

header('Content-Type: ' . ($msg['media_mime'] ?: 'application/octet-stream'));
header('Content-Length: ' . filesize($path));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . basename($name) . '"');
header('Cache-Control: private, no-store');
readfile($path);
