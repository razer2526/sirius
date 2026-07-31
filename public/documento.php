<?php
/**
 * Entrega el PDF de un estudio membretado.
 * Los PDFs viven fuera del alcance web (uploads/documentos está denegado por .htaccess):
 * este es el único camino y verifica sesión y permiso de módulo.
 *
 *   documento.php?id=12            → vista en el navegador
 *   documento.php?id=12&download=1 → descarga
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';
require_once __DIR__ . '/includes/pdf_document.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
if (!user_can('apps')) {
    http_response_code(403);
    exit('No tienes permiso para ver estudios membretados.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM documents WHERE id = ?');
$st->execute([$id]);
$doc = $st->fetch();
if (!$doc) {
    http_response_code(404);
    exit('Estudio no encontrado.');
}

$download = !empty($_GET['download']);
$slug = preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT', $doc['patient_name']) ?: 'paciente');
$fileName = trim($slug, '-') . ($doc['folio'] ? '-' . preg_replace('/[^A-Za-z0-9\-]/', '', $doc['folio']) : '') . '.pdf';

try {
    $pdf = render_document_pdf($doc);
} catch (Throwable $e) {
    error_log('documento.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el PDF: ' . (app_config()['app_env'] === 'dev' ? $e->getMessage() : 'error interno'));
}

if ($download) {
    log_activity('apps', 'document_download', "Descargó estudio #$id · {$doc['patient_name']}", 'document', $id);
}

header('Content-Type: application/pdf');
header('Content-Length: ' . strlen($pdf));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $fileName . '"');
header('Cache-Control: private, no-store');
echo $pdf;
