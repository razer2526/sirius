<?php
/** Expediente clínico en PDF, con el membrete configurado (header, footer, marca de agua). */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';
require_once __DIR__ . '/includes/pdf_document.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
if (!user_can('expedientes')) {
    http_response_code(403);
    exit('No tienes permiso para ver expedientes.');
}

$patientId = (int)($_GET['patient_id'] ?? 0);

$st = db()->prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 0');
$st->execute([$patientId]);
$p = $st->fetch();
if (!$p) {
    http_response_code(404);
    exit('Paciente no encontrado.');
}

$st = db()->prepare('SELECT * FROM episodes WHERE patient_id = ? ORDER BY admission_date DESC');
$st->execute([$patientId]);
$allEpisodes = $st->fetchAll();

$me = current_user();
if (is_admin_role($me)) {
    $episodes = $allEpisodes;
} else {
    $episodes = array_values(array_filter($allEpisodes, function ($e) use ($me) {
        return $e['assigned_user_id'] === null || (int)$e['assigned_user_id'] === (int)$me['id'];
    }));
    if ($allEpisodes && !$episodes) {
        http_response_code(403);
        exit('No tienes acceso a este expediente.');
    }
}

$consultsByEpisode = [];
if ($episodes) {
    $ids = array_column($episodes, 'id');
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare(
        "SELECT c.*, u.full_name AS created_by_name FROM consultations c
         LEFT JOIN users u ON u.id = c.created_by
         WHERE c.episode_id IN ($marks) ORDER BY c.consult_date DESC"
    );
    $st->execute($ids);
    foreach ($st->fetchAll() as $row) {
        $consultsByEpisode[$row['episode_id']][] = $row;
    }
}

$studiesByEpisode = [];
if ($episodes) {
    $ids = array_column($episodes, 'id');
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare("SELECT * FROM episode_studies WHERE episode_id IN ($marks) ORDER BY id");
    $st->execute($ids);
    foreach ($st->fetchAll() as $row) {
        $studiesByEpisode[$row['episode_id']][] = $row;
    }
}

$clinicName = 'Laboratorio y Clínica Bosques Polanco';
try {
    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute(['clinic_name']);
    $row = $st->fetch();
    if ($row && $row['svalue']) {
        $clinicName = $row['svalue'];
    }
} catch (Throwable $e) {
}

try {
    $pdf = render_patient_record_pdf($p, $episodes, $consultsByEpisode, $clinicName, null, $studiesByEpisode);
} catch (Throwable $e) {
    error_log('print.php: ' . $e->getMessage());
    http_response_code(500);
    exit('No se pudo generar el PDF: ' . (app_config()['app_env'] === 'dev' ? $e->getMessage() : 'error interno'));
}

log_activity('expedientes', 'patient_print', 'Exportó expediente ' . $p['file_number'], 'patient', $patientId);

$fileName = 'Expediente-' . preg_replace('/[^A-Za-z0-9\-]/', '', $p['file_number']) . '.pdf';
header('Content-Type: application/pdf');
header('Content-Length: ' . strlen($pdf));
header('Content-Disposition: inline; filename="' . $fileName . '"');
header('Cache-Control: private, no-store');
echo $pdf;
