<?php
/**
 * Entrega las imágenes de Marketing: la miniatura de una publicación o un archivo
 * de la biblioteca de recursos.
 * uploads/marketing está denegado por .htaccess: este es el único camino
 * (mismo patrón que archivo.php para Archivos).
 *
 *   marketing_asset.php?id=12     → miniatura de la publicación #12
 *   marketing_asset.php?asset=7   → recurso #7 de la biblioteca
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
// Marketing vive dentro de Apps desde que dejó de ser módulo del sidebar.
if (!user_can('apps')) {
    http_response_code(403);
    exit('No tienes permiso para ver esta imagen.');
}

$assetId = (int)($_GET['asset'] ?? 0);
if ($assetId > 0) {
    $st = db()->prepare('SELECT stored_name FROM marketing_assets WHERE id = ?');
    $st->execute([$assetId]);
    $row = $st->fetch();
    $stored = $row ? $row['stored_name'] : null;
} else {
    $id = (int)($_GET['id'] ?? 0);
    $st = db()->prepare('SELECT thumbnail_file FROM content_posts WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    $stored = $row ? $row['thumbnail_file'] : null;
}

if (!$stored) {
    http_response_code(404);
    exit('Sin imagen.');
}

$path = __DIR__ . '/uploads/marketing/' . basename($stored);
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
