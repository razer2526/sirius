<?php
/**
 * Entrega la miniatura de referencia de una publicación de Marketing.
 * uploads/marketing está denegado por .htaccess: este es el único camino
 * (mismo patrón que archivo.php para Archivos).
 *
 *   marketing_asset.php?id=12  → miniatura de la publicación #12
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
if (!user_can('marketing')) {
    http_response_code(403);
    exit('No tienes permiso para ver esta imagen.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT thumbnail_file FROM content_posts WHERE id = ?');
$st->execute([$id]);
$post = $st->fetch();
if (!$post || !$post['thumbnail_file']) {
    http_response_code(404);
    exit('Sin miniatura.');
}

$path = __DIR__ . '/uploads/marketing/' . basename($post['thumbnail_file']);
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
