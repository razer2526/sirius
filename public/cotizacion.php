<?php
/**
 * Entrega el PDF de una cotización, generado al vuelo (no se guarda copia en disco:
 * los datos ya viven en la tabla quotes, igual que documento.php con documents).
 *
 *   cotizacion.php?id=12            → vista en el navegador
 *   cotizacion.php?id=12&download=1 → descarga
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
$me = current_user();
if (!(is_admin_role($me) || user_flag('apps', 'cotizador'))) {
    http_response_code(403);
    exit('No tienes acceso al Cotizador.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM quotes WHERE id = ?');
$st->execute([$id]);
$quote = $st->fetch();
if (!$quote) {
    http_response_code(404);
    exit('Cotización no encontrada.');
}

$download = !empty($_GET['download']);
$slug = preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT', $quote['client_name']) ?: 'cliente');
$fileName = 'cotizacion-' . trim($slug, '-') . '-' . preg_replace('/[^A-Za-z0-9\-]/', '', $quote['folio']) . '.pdf';

try {
    $pdf = render_quote_pdf($quote);
} catch (Throwable $e) {
    error_log('cotizacion.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el PDF: ' . (app_config()['app_env'] === 'dev' ? $e->getMessage() : 'error interno'));
}

if ($download) {
    log_activity('apps', 'quote_download', "Descargó cotización {$quote['folio']}", 'quote', $id);
}

header('Content-Type: application/pdf');
header('Content-Length: ' . strlen($pdf));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $fileName . '"');
header('Cache-Control: private, no-store');
echo $pdf;
