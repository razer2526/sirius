<?php
/**
 * Sincronización entrante Google → Sirius (sondeo por cron, no webhooks).
 *
 * Usa el syncToken incremental de Google Calendar: cada corrida solo trae lo que
 * cambió desde la última vez. Un evento creado/editado/cancelado directo en Google
 * se refleja en `appointments`; si el evento no tiene origen en Sirius (no existe
 * un google_event_id que lo enlace), se importa como cita general nueva.
 */

require_once __DIR__ . '/google_calendar.php';
require_once __DIR__ . '/log.php';

const CALSYNC_TIMEZONE = 'America/Mexico_City';

/** Punto de entrada del cron: trae los cambios pendientes de Google. */
function gcal_sync_pull(bool $isRetry = false): array
{
    $cfg = gcal_config();
    $calendarId = $cfg['calendar_id'];
    $syncToken = $cfg['sync_token'];
    $stats = ['imported' => 0, 'updated' => 0, 'cancelled' => 0, 'skipped' => 0];
    $pageToken = null;
    $nextSyncToken = null;

    do {
        $query = ['singleEvents' => 'true', 'showDeleted' => 'true', 'maxResults' => 250];
        if ($pageToken) {
            $query['pageToken'] = $pageToken;
        } elseif ($syncToken !== '') {
            $query['syncToken'] = $syncToken;
        } else {
            // Primera sincronización: no hay de dónde partir, se limita la ventana
            // para no importar años de historial de la cuenta conectada.
            $query['timeMin'] = gmdate('Y-m-d\TH:i:s\Z', strtotime('-1 month'));
        }

        try {
            $resp = gcal_api_request(
                'GET',
                '/calendars/' . rawurlencode($calendarId) . '/events',
                null,
                $query
            );
        } catch (Throwable $e) {
            $expired = stripos($e->getMessage(), '410') !== false
                || stripos($e->getMessage(), 'fullSyncRequired') !== false
                || stripos($e->getMessage(), 'sync token') !== false;
            if ($expired && !$isRetry && $syncToken !== '') {
                // El syncToken ya no es válido (expiró o la cuenta se reconectó): se reinicia desde cero.
                gcal_save(['sync_token' => '']);
                return gcal_sync_pull(true);
            }
            throw $e;
        }

        foreach ($resp['items'] ?? [] as $event) {
            $result = apply_gcal_event($event);
            $stats[$result] = ($stats[$result] ?? 0) + 1;
        }
        $pageToken = $resp['nextPageToken'] ?? null;
        if (isset($resp['nextSyncToken'])) {
            $nextSyncToken = $resp['nextSyncToken'];
        }
    } while ($pageToken);

    if ($nextSyncToken !== null) {
        gcal_save(['sync_token' => $nextSyncToken]);
    }
    return $stats;
}

/** Aplica un evento de Google a `appointments`. Devuelve: imported|updated|cancelled|skipped. */
function apply_gcal_event(array $event): string
{
    $eventId = (string)($event['id'] ?? '');
    if ($eventId === '') {
        return 'skipped';
    }

    $st = db()->prepare('SELECT * FROM appointments WHERE google_event_id = ?');
    $st->execute([$eventId]);
    $existing = $st->fetch();
    $updatedAt = $event['updated'] ?? null;

    if (($event['status'] ?? '') === 'cancelled') {
        if ($existing && $existing['status'] !== 'cancelada') {
            db()->prepare("UPDATE appointments SET status = 'cancelada', google_updated_at = ? WHERE id = ?")
                ->execute([$updatedAt, $existing['id']]);
            log_activity(
                'calendario', 'appointment_cancel_google',
                'Google canceló "' . $existing['title'] . '"', 'appointment', (int)$existing['id']
            );
            return 'cancelled';
        }
        return 'skipped';
    }

    // Evita reprocesar el eco de un cambio que Sirius acaba de empujar a Google.
    if ($existing && $existing['google_updated_at'] !== null && $updatedAt !== null
        && $existing['google_updated_at'] >= $updatedAt) {
        return 'skipped';
    }

    $start = $event['start']['dateTime'] ?? null;
    $end = $event['end']['dateTime'] ?? null;
    if (!$start || !$end) {
        return 'skipped'; // evento de día completo (sin hora): fuera de alcance por ahora
    }

    $title = trim((string)($event['summary'] ?? '')) ?: '(Sin título)';
    $location = trim((string)($event['location'] ?? '')) ?: null;
    $notes = trim((string)($event['description'] ?? '')) ?: null;
    $startSql = gcal_to_sql_datetime($start);
    $endSql = gcal_to_sql_datetime($end);
    $attendees = [];
    foreach ($event['attendees'] ?? [] as $a) {
        if (!empty($a['email']) && empty($a['self'])) {
            $attendees[] = ['email' => $a['email'], 'name' => $a['displayName'] ?? ''];
        }
    }
    $attendeesJson = json_encode($attendees, JSON_UNESCAPED_UNICODE);

    if ($existing) {
        db()->prepare(
            "UPDATE appointments SET title=?, location=?, start_at=?, end_at=?, attendees=?, notes=?, status=?, google_updated_at=?
             WHERE id=?"
        )->execute([
            $title, $location, $startSql, $endSql, $attendeesJson, $notes,
            $existing['status'] === 'cancelada' ? 'programada' : $existing['status'],
            $updatedAt, $existing['id'],
        ]);
        log_activity(
            'calendario', 'appointment_update_google',
            'Google actualizó "' . $title . '"', 'appointment', (int)$existing['id']
        );
        return 'updated';
    }

    // Sin google_event_id conocido: el evento se creó directo en Google. Se importa como cita general.
    db()->prepare(
        "INSERT INTO appointments (title, service, location, start_at, end_at, attendees, notes, status, google_event_id, google_updated_at, source)
         VALUES (?, 'otro', ?, ?, ?, ?, ?, 'programada', ?, ?, 'google')"
    )->execute([$title, $location, $startSql, $endSql, $attendeesJson, $notes, $eventId, $updatedAt]);
    $newId = (int)db()->lastInsertId();
    log_activity(
        'calendario', 'appointment_import_google',
        'Importó cita de Google "' . $title . '"', 'appointment', $newId
    );
    return 'imported';
}

function gcal_to_sql_datetime(string $rfc3339): string
{
    $d = new DateTime($rfc3339);
    $d->setTimezone(new DateTimeZone(CALSYNC_TIMEZONE));
    return $d->format('Y-m-d H:i:s');
}
