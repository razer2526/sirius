<?php
/**
 * Entrega el PDF de la ficha de identificación de una admisión, generado al vuelo
 * (no se guarda copia en disco, igual que cotizacion.php y comision.php).
 *
 *   ficha.php?episode_id=12            → vista en el navegador
 *   ficha.php?episode_id=12&download=1 → descarga
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
if (!user_can('admision') && !user_can('expedientes')) {
    http_response_code(403);
    exit('No tienes acceso a las fichas de admisión.');
}

$episodeId = (int)($_GET['episode_id'] ?? 0);
$episode = ficha_load_episode($episodeId);
if (!$episode) {
    http_response_code(404);
    exit('Admisión no encontrada.');
}

// Un episodio asignado a otro usuario no debe verse a través de esta ruta
if (!is_admin_role($me) && $episode['assigned_user_id'] !== null
    && (int)$episode['assigned_user_id'] !== (int)$me['id']) {
    http_response_code(403);
    exit('Esta admisión está asignada a otro usuario.');
}

$st = db()->prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 0');
$st->execute([(int)$episode['patient_id']]);
$patient = $st->fetch();
if (!$patient) {
    http_response_code(404);
    exit('Paciente no encontrado.');
}

$download = !empty($_GET['download']);
$fileName = 'ficha-' . ficha_slug(trim(($patient['first_name'] ?? '') . ' ' . ($patient['paternal_surname'] ?? '')))
    . '-' . preg_replace('/[^A-Za-z0-9\-]/', '', (string)$patient['file_number']) . '.pdf';

try {
    $pdf = render_ficha_pdf($episode, $patient, ficha_study_lines($episodeId), ficha_clinic_name());
} catch (Throwable $e) {
    error_log('ficha.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el PDF: ' . (app_config()['app_env'] === 'dev' ? $e->getMessage() : 'error interno'));
}

if ($download) {
    log_activity('admision', 'ficha_download', "Descargó la ficha de la admisión #$episodeId", 'episode', $episodeId);
}

header('Content-Type: application/pdf');
header('Content-Length: ' . strlen($pdf));
header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $fileName . '"');
header('Cache-Control: private, no-store');
echo $pdf;
