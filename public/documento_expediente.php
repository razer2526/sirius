<?php
/**
 * Entrega un documento adjunto al expediente (estudios previos, imagenología,
 * historial viejo…). Los archivos viven fuera del alcance web
 * (uploads/expedientes está denegado por .htaccess): este es el único camino,
 * y verifica sesión y visibilidad del expediente antes de leer un solo byte.
 *
 *   documento_expediente.php?id=12            → vista en el navegador
 *   documento_expediente.php?id=12&download=1 → descarga
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';
require_once __DIR__ . '/api/handlers/patients.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
$me = current_user();
if (!user_can('expedientes')) {
    http_response_code(403);
    exit('No tienes permiso para ver documentos de expedientes.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM patient_documents WHERE id = ?');
$st->execute([$id]);
$doc = $st->fetch();
if (!$doc) {
    http_response_code(404);
    exit('Documento no encontrado.');
}

$patient = find_patient((int)$doc['patient_id']);
if (!patient_is_visible($patient, $me)) {
    http_response_code(403);
    exit('No tienes acceso a este expediente.');
}

$path = __DIR__ . '/uploads/expedientes/' . basename($doc['stored_name']);
if (!is_file($path)) {
    http_response_code(404);
    exit('El archivo ya no existe en el servidor.');
}

$download = !empty($_GET['download']);
if ($download) {
    log_activity('expedientes', 'patient_doc_download', "Descargó documento \"{$doc['name']}\"", 'patient_document', $id);
}

header('Content-Type: ' . ($doc['mime'] ?: 'application/octet-stream'));
header('Content-Length: ' . filesize($path));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . basename($doc['name']) . '"');
header('Cache-Control: private, no-store');
readfile($path);
