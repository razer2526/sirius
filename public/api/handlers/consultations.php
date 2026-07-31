<?php
/**
 * Handler consultations: consultas subsecuentes. Requiere módulo 'expedientes'.
 *
 * En Control de peso la consulta tiene dos etapas: la enfermera la crea (y con eso
 * cierra su parte automáticamente) y, después, el responsable asignado al episodio
 * (o un administrador) la completa con los datos médicos de la sesión.
 */

require_once __DIR__ . '/../../includes/services.php';

function handle_consultations(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'create': {
            $b = request_body();
            $episodeId = (int)($b['episode_id'] ?? 0);
            $episode = find_open_episode($episodeId);
            require_episode_visible($episode, $me);

            $notes = trim((string)($b['notes'] ?? ''));
            $params = service_filter_data($episode['service'], 'session', $b['params'] ?? []);
            if ($notes === '' && !$params) {
                json_error('Registra al menos una nota o un parámetro', 422);
            }

            // Control de peso: registrar la consulta es, en sí, cerrar la parte de enfermería.
            $isControlPeso = $episode['service'] === 'control_peso';
            $nurseClosedAt = $isControlPeso ? date('Y-m-d H:i:s') : null;
            $nurseClosedBy = $isControlPeso ? (int)$me['id'] : null;

            db()->prepare(
                'INSERT INTO consultations (episode_id, consult_date, notes, params, created_by, nurse_closed_at, nurse_closed_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $episodeId,
                date('Y-m-d H:i:s'),
                $notes ?: null,
                $params ? json_encode($params, JSON_UNESCAPED_UNICODE) : null,
                (int)$me['id'],
                $nurseClosedAt,
                $nurseClosedBy,
            ]);
            $id = (int)db()->lastInsertId();
            log_activity(
                'expedientes',
                'consultation_create',
                'Consulta subsecuente · folio ' . $episode['file_number'],
                'consultation',
                $id
            );
            json_ok(['id' => $id]);
        }

        /** El médico responsable completa la parte médica y consolida la sesión. */
        case 'complete_doctor': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare(
                'SELECT c.*, e.service, e.assigned_user_id, p.file_number FROM consultations c
                 JOIN episodes e ON e.id = c.episode_id
                 JOIN patients p ON p.id = e.patient_id
                 WHERE c.id = ?'
            );
            $st->execute([$id]);
            $consult = $st->fetch();
            if (!$consult) {
                json_error('Consulta no encontrada', 404);
            }
            if ($consult['service'] !== 'control_peso') {
                json_error('Esta acción solo aplica a Control de peso', 422);
            }
            if (!is_admin_role($me) && (int)($consult['assigned_user_id'] ?? 0) !== (int)$me['id']) {
                json_error('Solo el responsable asignado a este paciente (o un administrador) puede completar la consulta', 403);
            }
            if (!empty($consult['doctor_closed_at'])) {
                json_error('Esta consulta ya fue completada', 422);
            }

            $extra = service_filter_data('control_peso', 'session', $b['params'] ?? []);
            $existing = $consult['params'] ? json_decode($consult['params'], true) : [];
            $merged = is_array($existing) ? array_merge($existing, $extra) : $extra;

            db()->prepare('UPDATE consultations SET params = ?, doctor_closed_at = ?, doctor_closed_by = ? WHERE id = ?')
                ->execute([json_encode($merged, JSON_UNESCAPED_UNICODE), date('Y-m-d H:i:s'), (int)$me['id'], $id]);
            log_activity(
                'expedientes',
                'consultation_complete',
                'Completó consulta médica · folio ' . $consult['file_number'],
                'consultation',
                $id
            );
            json_ok();
        }
    }
}

function find_open_episode(int $episodeId): array
{
    $st = db()->prepare(
        'SELECT e.*, p.file_number, p.is_deleted FROM episodes e
         JOIN patients p ON p.id = e.patient_id WHERE e.id = ?'
    );
    $st->execute([$episodeId]);
    $episode = $st->fetch();
    if (!$episode || (int)$episode['is_deleted'] === 1) {
        json_error('Episodio no encontrado', 404);
    }
    return $episode;
}

/** Un episodio restringido a otro usuario no debe aceptar consultas de quien no tiene acceso. */
function require_episode_visible(array $episode, array $me): void
{
    if (is_admin_role($me)) {
        return;
    }
    $assigned = $episode['assigned_user_id'] ?? null;
    if ($assigned !== null && (int)$assigned !== (int)$me['id']) {
        json_error('No tienes acceso a este expediente', 403);
    }
}
