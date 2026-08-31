<?php
/**
 * Handler appointments: citas del calendario general de la clínica.
 * Visibilidad igual a episodios: admin y usuarios con flag "manage" ven y gestionan
 * todo; los demás solo ven citas "generales" (sin responsable) o asignadas a ellos.
 *
 * Sincronización con Google Calendar (si hay cuenta conectada): Sirius es quien
 * manda al crear/editar/cancelar. Un fallo al hablar con Google nunca bloquea la
 * operación local — solo se registra en el log de errores del servidor.
 */

require_once __DIR__ . '/../../includes/google_calendar.php';

const APPT_SERVICES = ['laboratorio', 'control_peso', 'fisioterapia', 'podologia', 'recoleccion', 'otro'];
const APPT_STATUSES = ['programada', 'confirmada', 'cancelada', 'completada'];
const APPT_TIMEZONE = 'America/Mexico_City';

function handle_appointments(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('calendario', 'manage');

    switch ($action) {
        case 'list': {
            $from = valid_appt_date($_GET['from'] ?? '') ?? date('Y-m-01');
            $to   = valid_appt_date($_GET['to'] ?? '') ?? date('Y-m-t');
            $pdo = db();

            $sql = "SELECT a.*, u.full_name AS assigned_name, p.file_number, "
                . sql_full_name('p') . " AS patient_name
                 FROM appointments a
                 LEFT JOIN users u ON u.id = a.assigned_user_id
                 LEFT JOIN patients p ON p.id = a.patient_id
                 WHERE a.status <> 'cancelada' AND a.start_at <= ? AND a.end_at >= ?";
            $params = ["$to 23:59:59", "$from 00:00:00"];
            if (!$canManage) {
                $sql .= ' AND (a.assigned_user_id IS NULL OR a.assigned_user_id = ?)';
                $params[] = $me['id'];
            }
            $sql .= ' ORDER BY a.start_at';
            $st = $pdo->prepare($sql);
            $st->execute($params);
            $rows = array_map('format_appointment', $st->fetchAll());

            json_ok(['appointments' => $rows, 'can_manage' => $canManage]);
        }

        case 'get': {
            $appt = find_appointment((int)($_GET['id'] ?? 0));
            require_appt_access($appt, $me, $canManage);
            json_ok(['appointment' => format_appointment($appt)]);
        }

        case 'save': {
            $b = request_body();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') {
                json_error('El título es obligatorio', 422);
            }
            $service = in_array($b['service'] ?? '', APPT_SERVICES, true) ? $b['service'] : 'otro';
            $start = valid_appt_datetime($b['start_at'] ?? '');
            $end   = valid_appt_datetime($b['end_at'] ?? '');
            if (!$start || !$end) {
                json_error('Captura fecha y hora de inicio y fin', 422);
            }
            if ($end < $start) {
                json_error('La hora de fin no puede ser antes que la de inicio', 422);
            }
            $location = trim((string)($b['location'] ?? '')) ?: null;
            $notes = trim((string)($b['notes'] ?? '')) ?: null;

            $assignedUserId = isset($b['assigned_user_id']) && $b['assigned_user_id'] !== '' ? (int)$b['assigned_user_id'] : null;
            if ($assignedUserId !== null) {
                $st = db()->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
                $st->execute([$assignedUserId]);
                if (!$st->fetch()) {
                    json_error('El responsable asignado no es válido', 422);
                }
            }
            $patientId = isset($b['patient_id']) && $b['patient_id'] !== '' ? (int)$b['patient_id'] : null;
            if ($patientId !== null) {
                $st = db()->prepare('SELECT id FROM patients WHERE id = ? AND is_deleted = 0');
                $st->execute([$patientId]);
                if (!$st->fetch()) {
                    json_error('Paciente no encontrado', 404);
                }
            }
            $attendees = valid_attendees($b['attendees'] ?? []);

            $id = (int)($b['id'] ?? 0);
            $prevAssignedUserId = null;
            if ($id > 0) {
                $appt = find_appointment($id);
                require_appt_access($appt, $me, $canManage);
                $prevAssignedUserId = $appt['assigned_user_id'] !== null ? (int)$appt['assigned_user_id'] : null;
                db()->prepare(
                    'UPDATE appointments SET title = ?, service = ?, patient_id = ?, location = ?, start_at = ?, end_at = ?,
                     assigned_user_id = ?, attendees = ?, notes = ? WHERE id = ?'
                )->execute([
                    $title, $service, $patientId, $location, $start, $end,
                    $assignedUserId, json_encode($attendees, JSON_UNESCAPED_UNICODE), $notes, $id,
                ]);
                log_activity('calendario', 'appointment_update', "Editó cita \"$title\"", 'appointment', $id);
            } else {
                db()->prepare(
                    'INSERT INTO appointments (title, service, patient_id, location, start_at, end_at, assigned_user_id, attendees, notes, status, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $title, $service, $patientId, $location, $start, $end,
                    $assignedUserId, json_encode($attendees, JSON_UNESCAPED_UNICODE), $notes, 'programada', (int)$me['id'],
                ]);
                $id = (int)db()->lastInsertId();
                log_activity('calendario', 'appointment_create', "Creó cita \"$title\"", 'appointment', $id);
            }
            // Solo a quien se acaba de asignar (no si ya lo estaba, ni si se autoasigna).
            if ($assignedUserId !== null && $assignedUserId !== $prevAssignedUserId && $assignedUserId !== (int)$me['id']) {
                require_once __DIR__ . '/../../includes/webpush.php';
                webpush_notify(
                    $assignedUserId, 'Nueva cita asignada',
                    "\"$title\" · " . date('d/m H:i', strtotime($start)), '#/calendario'
                );
            }
            appointments_sync_to_google($id);
            json_ok(['id' => $id]);
        }

        case 'cancel': {
            $b = request_body();
            $appt = find_appointment((int)($b['id'] ?? 0));
            require_appt_access($appt, $me, $canManage);
            db()->prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ?")->execute([$appt['id']]);
            log_activity('calendario', 'appointment_cancel', "Canceló cita \"{$appt['title']}\"", 'appointment', (int)$appt['id']);
            if ($appt['assigned_user_id'] !== null && (int)$appt['assigned_user_id'] !== (int)$me['id']) {
                require_once __DIR__ . '/../../includes/webpush.php';
                webpush_notify(
                    (int)$appt['assigned_user_id'], 'Cita cancelada',
                    "\"{$appt['title']}\" fue cancelada.", '#/calendario'
                );
            }
            appointments_cancel_on_google($appt);
            json_ok();
        }
    }
}

function find_appointment(int $id): array
{
    $st = db()->prepare(
        "SELECT a.*, u.full_name AS assigned_name, p.file_number, " . sql_full_name('p') . " AS patient_name
         FROM appointments a
         LEFT JOIN users u ON u.id = a.assigned_user_id
         LEFT JOIN patients p ON p.id = a.patient_id
         WHERE a.id = ?"
    );
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Cita no encontrada', 404);
    }
    return $row;
}

/** Visible/editable si es general, si el usuario es el responsable, o si administra el módulo. */
function require_appt_access(array $appt, array $me, bool $canManage): void
{
    if ($canManage) {
        return;
    }
    $assigned = $appt['assigned_user_id'] ?? null;
    if ($assigned !== null && (int)$assigned !== (int)$me['id']) {
        json_error('No tienes acceso a esta cita', 403);
    }
}

function format_appointment(array $a): array
{
    $a['id'] = (int)$a['id'];
    $a['patient_id'] = $a['patient_id'] !== null ? (int)$a['patient_id'] : null;
    $a['assigned_user_id'] = $a['assigned_user_id'] !== null ? (int)$a['assigned_user_id'] : null;
    $a['attendees'] = $a['attendees'] ? (json_decode($a['attendees'], true) ?: []) : [];
    return $a;
}

function valid_appt_date($v): ?string
{
    $v = trim((string)$v);
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}

function valid_appt_datetime($v): ?string
{
    $v = trim((string)$v);
    $v = str_replace('T', ' ', $v);
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $v)) {
        $v .= ':00';
    }
    $d = DateTime::createFromFormat('Y-m-d H:i:s', $v);
    return ($d && $d->format('Y-m-d H:i:s') === $v) ? $v : null;
}

/** Normaliza y valida la lista de invitados externos (correo + nombre opcional). */
function valid_attendees($raw): array
{
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $a) {
        $email = trim((string)($a['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $out[] = ['email' => $email, 'name' => trim((string)($a['name'] ?? ''))];
    }
    return $out;
}

/** Cuerpo del evento de Google Calendar equivalente a una cita de Sirius. */
function appointment_to_gcal_event(array $appt): array
{
    $attendees = $appt['attendees'] ? (json_decode($appt['attendees'], true) ?: []) : [];
    return [
        'summary'     => $appt['title'],
        'location'    => $appt['location'] ?: null,
        'description' => $appt['notes'] ?: null,
        'start'       => ['dateTime' => gcal_rfc3339($appt['start_at']), 'timeZone' => APPT_TIMEZONE],
        'end'         => ['dateTime' => gcal_rfc3339($appt['end_at']), 'timeZone' => APPT_TIMEZONE],
        'attendees'   => array_map(
            fn($a) => array_filter(['email' => $a['email'], 'displayName' => $a['name'] ?: null]),
            $attendees
        ),
        'extendedProperties' => ['private' => ['sirius_appointment_id' => (string)$appt['id']]],
    ];
}

function gcal_rfc3339(string $sqlDatetime): string
{
    return str_replace(' ', 'T', $sqlDatetime);
}

/** Crea o actualiza el evento de Google Calendar de una cita. Nunca lanza: solo registra el error. */
function appointments_sync_to_google(int $id): void
{
    if (!gcal_is_connected()) {
        return;
    }
    try {
        $st = db()->prepare('SELECT * FROM appointments WHERE id = ?');
        $st->execute([$id]);
        $appt = $st->fetch();
        if (!$appt || $appt['status'] === 'cancelada') {
            return;
        }
        $calendarId = gcal_config()['calendar_id'];
        $event = appointment_to_gcal_event($appt);

        if (!empty($appt['google_event_id'])) {
            $result = gcal_api_request(
                'PATCH',
                '/calendars/' . rawurlencode($calendarId) . '/events/' . rawurlencode($appt['google_event_id']),
                $event,
                ['sendUpdates' => 'all']
            );
        } else {
            $result = gcal_api_request(
                'POST',
                '/calendars/' . rawurlencode($calendarId) . '/events',
                $event,
                ['sendUpdates' => 'all']
            );
        }
        db()->prepare('UPDATE appointments SET google_event_id = ?, google_updated_at = ? WHERE id = ?')
            ->execute([$result['id'] ?? $appt['google_event_id'], $result['updated'] ?? null, $id]);
    } catch (Throwable $e) {
        error_log('appointments_sync_to_google #' . $id . ': ' . $e->getMessage());
    }
}

/** Cancela (elimina) el evento de Google Calendar de una cita. Nunca lanza. */
function appointments_cancel_on_google(array $appt): void
{
    if (!gcal_is_connected() || empty($appt['google_event_id'])) {
        return;
    }
    try {
        $calendarId = gcal_config()['calendar_id'];
        gcal_api_request(
            'DELETE',
            '/calendars/' . rawurlencode($calendarId) . '/events/' . rawurlencode($appt['google_event_id']),
            null,
            ['sendUpdates' => 'all']
        );
    } catch (Throwable $e) {
        // 404/410: el evento ya no existe del lado de Google; no es un error real.
        error_log('appointments_cancel_on_google #' . $appt['id'] . ': ' . $e->getMessage());
    }
}
