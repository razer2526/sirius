<?php
/**
 * Entrega un archivo del gestor Archivos.
 * uploads/archivos está denegado por .htaccess: este es el único camino y
 * verifica sesión, permiso de módulo y que el archivo pertenezca al usuario
 * (si es privado) antes de leer un solo byte.
 *
 *   archivo.php?id=12            → vista en el navegador
 *   archivo.php?id=12&download=1 → descarga
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';

session_boot();
$me = current_user();
if (!$me) {
    header('Location: login.php');
    exit;
}
if (!user_can('archivos')) {
    http_response_code(403);
    exit('No tienes permiso para ver archivos.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM files WHERE id = ?');
$st->execute([$id]);
$file = $st->fetch();
if (!$file) {
    http_response_code(404);
    exit('Archivo no encontrado.');
}
if ($file['scope'] === 'private' && (int)$file['owner_id'] !== (int)$me['id']) {
    http_response_code(403);
    exit('Ese archivo pertenece a la carpeta privada de otro usuario.');
}

$path = __DIR__ . '/uploads/archivos/' . basename($file['stored_name']);
if (!is_file($path)) {
    http_response_code(404);
    exit('El archivo ya no está disponible.');
}

$download = !empty($_GET['download']);
if ($download) {
    log_activity('archivos', 'file_download', "Descargó \"{$file['name']}\"", 'file', $id);
}

$safeName = str_replace(['"', "\r", "\n"], '', $file['name']);
header('Content-Type: ' . ($file['mime'] ?: 'application/octet-stream'));
header('Content-Length: ' . filesize($path));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $safeName . '"');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
readfile($path);
