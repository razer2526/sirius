<?php
/**
 * Entrega las imágenes pegadas en las notas del Pizarrón.
 * uploads/board está denegado por .htaccess: este es el único camino (mismo patrón que
 * marketing_asset.php y archivo.php).
 *
 *   board_asset.php?id=12   → imagen #12
 *
 * El id es secuencial, así que no basta con verificar la sesión: una imagen de la nota
 * PRIVADA de alguien se sirve solo a su dueño. Las de notas del pizarrón público, a
 * cualquiera con acceso al módulo.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';

session_boot();
$me = current_user();
if (!$me) {
    header('Location: login.php');
    exit;
}
if (!user_can('pizarron')) {
    http_response_code(403);
    exit('No tienes permiso para ver esta imagen.');
}

$st = db()->prepare(
    'SELECT a.stored_name, i.scope, i.owner_id
     FROM board_assets a JOIN board_items i ON i.id = a.item_id
     WHERE a.id = ?'
);
$st->execute([(int)($_GET['id'] ?? 0)]);
$row = $st->fetch();

// Misma respuesta para "no existe" y "no es tuya": no se revela qué ids existen.
if (!$row || ($row['scope'] === 'private' && (int)$row['owner_id'] !== (int)$me['id'])) {
    http_response_code(404);
    exit('Sin imagen.');
}

$path = __DIR__ . '/uploads/board/' . basename($row['stored_name']);
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
