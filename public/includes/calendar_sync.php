<?php
/**
 * Sincronización entrante Google → Sirius (sondeo por cron, no webhooks).
 *
 * En cada corrida se pide a Google la VENTANA de eventos que importan (de CALSYNC_PAST_MONTHS atrás
 * a CALSYNC_FUTURE_MONTHS adelante, con los recurrentes ya expandidos en instancias) y se compara con
 * `appointments`: lo nuevo se importa, lo modificado se actualiza, lo cancelado se cancela y lo que
 * ya está al día se salta. No se usa el syncToken de Google: con un calendario que tiene un evento
 * diario desde hace años, cualquier cambio a la serie devolvía miles de instancias (todas las del
 * pasado y el futuro lejano), y las instancias que van entrando a la ventana con el paso del tiempo
 * nunca volvían a entregarse. La ventana se vuelve a revisar completa cada vez y es barata:
 * unos cientos de eventos, comparados por su fecha de modificación.
 *
 * Reglas que evitan inundar de avisos al equipo:
 *  - La primera sincronización (o la que sigue a reconectar la cuenta) importa en silencio.
 *  - Después, los cambios de una corrida se avisan juntos: hasta CALSYNC_NOTIFY_INDIVIDUAL
 *    uno por uno; más que eso, un solo aviso-resumen.
 *  - Un evento que ya está al día no se vuelve a procesar ni a avisar (ver gcal_ts()).
 *  - Un evento que falla no detiene a los demás.
 */

require_once __DIR__ . '/google_calendar.php';
require_once __DIR__ . '/log.php';
require_once __DIR__ . '/webpush.php';

const CALSYNC_TIMEZONE = 'America/Mexico_City';
const CALSYNC_PAST_MONTHS = 1;      // la ventana empieza hace un mes…
const CALSYNC_FUTURE_MONTHS = 6;    // …y llega hasta dentro de seis (los recurrentes se expanden sin fin)
const CALSYNC_NOTIFY_INDIVIDUAL = 3;

/**
 * Punto de entrada del cron: revisa la ventana de eventos de Google y la refleja en Sirius.
 *
 * `sync_token` (campo heredado de la config) ahora solo marca "ya se hizo una sincronización
 * completa sin errores"; vacío = primera vez o cuenta recién reconectada → importa en silencio.
 *
 * @param callable|null $fetch función ($query): array que pide una página de eventos a Google
 *                             (en pruebas se sustituye por datos simulados).
 */
function gcal_sync_pull(?callable $fetch = null): array
{
    $cfg = gcal_config();
    $calendarId = $cfg['calendar_id'];
    $silent = (trim((string)$cfg['sync_token']) === '');
    $stats = ['imported' => 0, 'updated' => 0, 'cancelled' => 0, 'skipped' => 0, 'errors' => 0, 'first_error' => ''];
    $changes = [];
    $fetch = $fetch ?? static function (array $query) use ($calendarId): array {
        return gcal_api_request('GET', '/calendars/' . rawurlencode($calendarId) . '/events', null, $query);
    };

    $base = [
        'singleEvents' => 'true',
        'showDeleted'  => 'true',
        'maxResults'   => 250,
        'orderBy'      => 'startTime',
        'timeMin'      => gmdate('Y-m-d\TH:i:s\Z', strtotime('-' . CALSYNC_PAST_MONTHS . ' month')),
        'timeMax'      => gmdate('Y-m-d\TH:i:s\Z', strtotime('+' . CALSYNC_FUTURE_MONTHS . ' month')),
    ];
    $pageToken = null;
    $pages = 0;
    do {
        $query = $base + ($pageToken ? ['pageToken' => $pageToken] : []);
        $resp = $fetch($query);
        foreach ($resp['items'] ?? [] as $event) {
            try {
                $result = apply_gcal_event($event, $changes);
            } catch (Throwable $e) {
                // Un evento problemático no debe impedir procesar el resto ni dejar la corrida a medias.
                $result = 'errors';
                if ($stats['first_error'] === '') {
                    $stats['first_error'] = $e->getMessage();
                }
                error_log('gcal_sync_pull evento ' . ($event['id'] ?? '?') . ': ' . $e->getMessage());
            }
            $stats[$result] = ($stats[$result] ?? 0) + 1;
        }
        $pageToken = $resp['nextPageToken'] ?? null;
    } while ($pageToken && ++$pages < 40);   // tope de seguridad: 40 páginas × 250 eventos

    if ($stats['imported'] + $stats['updated'] + $stats['cancelled'] > 0) {
        log_activity('calendario', 'gcal_sync',
            "Google Calendar: {$stats['imported']} nueva(s), {$stats['updated']} actualizada(s), {$stats['cancelled']} cancelada(s)"
            . ($silent ? ' (sincronización inicial, sin avisos)' : ''));
    }
    // Con errores no se marca como inicializada: la próxima corrida lo intenta de nuevo
    // (lo que ya quedó al día se salta solo y no vuelve a avisar).
    if ($stats['errors'] === 0 && $silent) {
        gcal_save(['sync_token' => 'ventana:' . gmdate('Y-m-d\TH:i:s\Z')]);
    }
    if (!$silent) {
        notify_gcal_changes($changes);
    }
    return $stats;
}

/**
 * Aplica un evento de Google a `appointments`. Devuelve: imported|updated|cancelled|skipped.
 * Los cambios que ameritan aviso se agregan a $changes; quien llama decide cómo avisarlos.
 */
function apply_gcal_event(array $event, array &$changes = []): string
{
    $eventId = (string)($event['id'] ?? '');
    if ($eventId === '') {
        return 'skipped';
    }

    $st = db()->prepare('SELECT * FROM appointments WHERE google_event_id = ?');
    $st->execute([$eventId]);
    $existing = $st->fetch();
    $updatedAt = gcal_ts($event['updated'] ?? null);

    // Evento que Sirius creó pero cuyo id no quedó guardado (falló al anotarlo): se vuelve a enlazar
    // por la propiedad privada que Sirius le puso, en vez de importarlo como una cita duplicada.
    if (!$existing) {
        $siriusId = (int)($event['extendedProperties']['private']['sirius_appointment_id'] ?? 0);
        if ($siriusId > 0) {
            $st = db()->prepare("SELECT * FROM appointments WHERE id = ? AND (google_event_id IS NULL OR google_event_id = '')");
            $st->execute([$siriusId]);
            $own = $st->fetch();
            if ($own) {
                db()->prepare('UPDATE appointments SET google_event_id = ?, google_updated_at = ? WHERE id = ?')
                    ->execute([$eventId, $updatedAt, $own['id']]);
                return 'skipped';
            }
        }
    }

    if (($event['status'] ?? '') === 'cancelled') {
        if ($existing && $existing['status'] !== 'cancelada') {
            db()->prepare("UPDATE appointments SET status = 'cancelada', google_updated_at = ? WHERE id = ?")
                ->execute([$updatedAt, $existing['id']]);
            $changes[] = ['kind' => 'cancelled', 'assigned' => $existing['assigned_user_id'] ?? null,
                          'title' => 'Cita cancelada', 'body' => "\"{$existing['title']}\" fue cancelada desde Google Calendar."];
            return 'cancelled';
        }
        return 'skipped';
    }

    // Evita reprocesar un evento ya al día o el eco de un cambio que Sirius acaba de empujar a Google.
    if ($existing && $updatedAt !== null) {
        $stored = gcal_ts($existing['google_updated_at'] ?? null);
        if ($stored !== null && $stored >= $updatedAt) {
            return 'skipped';
        }
    }

    [$startSql, $endSql] = gcal_event_bounds($event);
    if ($startSql === null) {
        return 'skipped';
    }

    $title = trim((string)($event['summary'] ?? '')) ?: '(Sin título)';
    $location = trim((string)($event['location'] ?? '')) ?: null;
    $notes = trim((string)($event['description'] ?? '')) ?: null;
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
        $changes[] = ['kind' => 'updated', 'assigned' => $existing['assigned_user_id'] ?? null,
                      'title' => 'Cita actualizada', 'body' => "\"$title\" cambió · " . date('d/m H:i', strtotime($startSql))];
        return 'updated';
    }

    // Sin google_event_id conocido: el evento se creó directo en Google. Se importa como cita general.
    db()->prepare(
        "INSERT INTO appointments (title, service, location, start_at, end_at, attendees, notes, status, google_event_id, google_updated_at, source)
         VALUES (?, 'otro', ?, ?, ?, ?, ?, 'programada', ?, ?, 'google')"
    )->execute([$title, $location, $startSql, $endSql, $attendeesJson, $notes, $eventId, $updatedAt]);
    // Sin assigned_user_id (se importa como cita general): se avisa a todos los que ven el módulo.
    $changes[] = ['kind' => 'imported', 'assigned' => null,
                  'title' => 'Nueva cita en el calendario', 'body' => "\"$title\" · " . date('d/m H:i', strtotime($startSql))];
    return 'imported';
}

/**
 * Inicio y fin de un evento de Google en hora local de Sirius ('Y-m-d H:i:s').
 * Los eventos de todo el día (start.date, sin hora) se importan de las 00:00 a las 23:59;
 * en Google la fecha de fin de esos eventos es exclusiva (el día siguiente al último).
 * @return array{0:?string,1:?string} [null, null] si el evento no tiene fechas usables
 */
function gcal_event_bounds(array $event): array
{
    $start = $event['start']['dateTime'] ?? null;
    $end = $event['end']['dateTime'] ?? null;
    if ($start && $end) {
        return [gcal_to_sql_datetime($start), gcal_to_sql_datetime($end)];
    }
    $startDay = $event['start']['date'] ?? null;
    $endDay = $event['end']['date'] ?? null;
    if ($startDay && preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDay)) {
        $last = $startDay;
        if ($endDay && preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDay) && $endDay > $startDay) {
            $last = date('Y-m-d', strtotime($endDay . ' -1 day'));
        }
        return [$startDay . ' 00:00:00', $last . ' 23:59:00'];
    }
    return [null, null];
}

/**
 * Avisa los cambios de una corrida: hasta CALSYNC_NOTIFY_INDIVIDUAL uno por uno; si hay más,
 * un solo aviso-resumen (así un lote grande no llena de avisos los dispositivos del equipo).
 * Nunca lanza: un push roto no debe poder tirar el resto de la corrida.
 */
function notify_gcal_changes(array $changes): void
{
    if (!$changes) {
        return;
    }
    try {
        if (count($changes) <= CALSYNC_NOTIFY_INDIVIDUAL) {
            foreach ($changes as $c) {
                notify_appt_change(['assigned_user_id' => $c['assigned']], $c['title'], $c['body']);
            }
            return;
        }
        $by = ['imported' => 0, 'updated' => 0, 'cancelled' => 0];
        foreach ($changes as $c) {
            $by[$c['kind']]++;
        }
        $parts = [];
        if ($by['imported']) {
            $parts[] = $by['imported'] . ' nueva(s)';
        }
        if ($by['updated']) {
            $parts[] = $by['updated'] . ' actualizada(s)';
        }
        if ($by['cancelled']) {
            $parts[] = $by['cancelled'] . ' cancelada(s)';
        }
        notify_appt_change(['assigned_user_id' => null], 'Cambios en el calendario',
            count($changes) . ' cambios desde Google Calendar: ' . implode(', ', $parts) . '.');
    } catch (Throwable $e) {
        error_log('notify_gcal_changes: ' . $e->getMessage());
    }
}

/**
 * Avisa del lado de Sirius un cambio que llegó de Google Calendar — a diferencia de un cambio
 * hecho en Sirius, aquí nadie en el equipo sabe todavía qué pasó (ver appointments.php para el
 * criterio del lado Sirius, más conservador porque quien edita ya sabe lo que cambió).
 *
 * Nunca lanza.
 */
function notify_appt_change(array $appt, string $title, string $body): void
{
    $assignedUserId = isset($appt['assigned_user_id']) && $appt['assigned_user_id'] !== null
        ? (int)$appt['assigned_user_id'] : null;
    try {
        if ($assignedUserId !== null) {
            webpush_notify($assignedUserId, $title, $body, '#/calendario');
        } else {
            notify_module_users('calendario', $title, $body, '#/calendario');
        }
    } catch (Throwable $e) {
        error_log('notify_appt_change: ' . $e->getMessage());
    }
}

function gcal_to_sql_datetime(string $rfc3339): string
{
    $d = new DateTime($rfc3339);
    $d->setTimezone(new DateTimeZone(CALSYNC_TIMEZONE));
    return $d->format('Y-m-d H:i:s');
}
