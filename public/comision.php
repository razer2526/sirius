<?php
/**
 * Entrega el PDF de un estado de cuenta de comisiones, generado al vuelo
 * (no se guarda copia en disco: el snapshot ya vive en commission_statements,
 * igual que cotizacion.php con quotes).
 *
 *   comision.php?id=12            → vista en el navegador
 *   comision.php?id=12&download=1 → descarga
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
if (!(is_admin_role($me) || user_flag('apps', 'comisiones'))) {
    http_response_code(403);
    exit('No tienes acceso a Comisiones.');
}

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT * FROM commission_statements WHERE id = ?');
$st->execute([$id]);
$statement = $st->fetch();
if (!$statement) {
    http_response_code(404);
    exit('Estado de cuenta no encontrado.');
}
$statement['lines'] = json_decode($statement['lines'], true);

$download = !empty($_GET['download']);
$partyName = $statement['lines']['party_name'] ?? 'comisiones';
$slug = preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT', $partyName) ?: 'comisiones');
$fileName = 'comisiones-' . trim($slug, '-') . '-' . preg_replace('/[^A-Za-z0-9\-]/', '', $statement['folio']) . '.pdf';

try {
    $pdf = render_commission_pdf($statement);
} catch (Throwable $e) {
    error_log('comision.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el PDF: ' . (app_config()['app_env'] === 'dev' ? $e->getMessage() : 'error interno'));
}

if ($download) {
    log_activity('apps', 'commission_statement_download', "Descargó estado de cuenta {$statement['folio']}", 'commission_statement', $id);
}

header('Content-Type: application/pdf');
header('Content-Length: ' . strlen($pdf));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $fileName . '"');
header('Cache-Control: private, no-store');
echo $pdf;
