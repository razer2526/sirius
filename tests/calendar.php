<?php
/**
 * Pruebas de la sincronización Google Calendar → Sirius, con eventos de Google simulados.
 * Se incluye desde tests/run.php (comparte su base SQLite temporal).
 */

require_once SIRIUS_PUBLIC . '/includes/calendar_sync.php';

echo "\nCalendario (Google → Sirius)\n";

/** Evento de Google mínimo. */
function t_event(string $id, string $updated, array $extra = []): array
{
    return array_merge([
        'id' => $id, 'status' => 'confirmed', 'summary' => 'Cita de prueba', 'updated' => $updated,
        'start' => ['dateTime' => '2026-10-20T10:00:00-06:00'],
        'end' => ['dateTime' => '2026-10-20T11:00:00-06:00'],
    ], $extra);
}

function t_appt(string $eventId): ?array
{
    $st = db()->prepare('SELECT * FROM appointments WHERE google_event_id = ?');
    $st->execute([$eventId]);
    return $st->fetch() ?: null;
}

test('gcal_ts normaliza las marcas de Google a UTC sin zona ni milisegundos', function () {
    eq('2026-10-08 17:30:12', gcal_ts('2026-10-08T17:30:12.345Z'));
    eq('2026-10-08 17:30:12', gcal_ts('2026-10-08 17:30:12'), 'lo que MySQL devuelve de un DATETIME');
    eq('2026-10-08 17:30:12', gcal_ts('2026-10-08T11:30:12-06:00'));
    eq(null, gcal_ts(''));
    eq(null, gcal_ts(null));
});

test('un evento nuevo de Google se importa y su marca queda en formato DATETIME', function () {
    $changes = [];
    eq('imported', apply_gcal_event(t_event('ev1', '2026-10-08T17:30:12.345Z'), $changes));
    $a = t_appt('ev1');
    eq('2026-10-08 17:30:12', $a['google_updated_at']);
    eq('google', $a['source']);
    eq('2026-10-20 10:00:00', $a['start_at'], 'hora local de Sirius (México)');
    eq(1, count($changes));
    eq('imported', $changes[0]['kind']);
});

test('el mismo evento entregado otra vez NO se reprocesa (ni con el formato viejo de MySQL)', function () {
    $ev = t_event('ev1', '2026-10-08T17:30:12.345Z');
    foreach (['2026-10-08 17:30:12', '2026-10-08T17:30:12.345Z', '2026-10-08T17:30:12Z'] as $stored) {
        db()->prepare('UPDATE appointments SET google_updated_at = ? WHERE google_event_id = ?')->execute([$stored, 'ev1']);
        $changes = [];
        eq('skipped', apply_gcal_event($ev, $changes), "guardado como $stored");
        eq(0, count($changes));
    }
});

test('un evento modificado en Google se actualiza una sola vez', function () {
    $changes = [];
    $ev = t_event('ev1', '2026-10-08T18:00:00.000Z', ['summary' => 'Cita movida']);
    eq('updated', apply_gcal_event($ev, $changes));
    eq('Cita movida', t_appt('ev1')['title']);
    $changes = [];
    eq('skipped', apply_gcal_event($ev, $changes), 'la segunda entrega ya está al día');
});

test('un evento cancelado en Google cancela la cita', function () {
    $changes = [];
    eq('cancelled', apply_gcal_event(['id' => 'ev1', 'status' => 'cancelled', 'updated' => '2026-10-08T19:00:00.000Z'], $changes));
    eq('cancelada', t_appt('ev1')['status']);
    $changes = [];
    eq('skipped', apply_gcal_event(['id' => 'ev1', 'status' => 'cancelled', 'updated' => '2026-10-08T19:00:00.000Z'], $changes));
});

test('un evento de todo el día se importa de 00:00 a 23:59 (la fecha final de Google es exclusiva)', function () {
    $changes = [];
    $ev = ['id' => 'ev_dia', 'status' => 'confirmed', 'summary' => 'Congreso', 'updated' => '2026-10-08T17:30:12.000Z',
           'start' => ['date' => '2026-10-20'], 'end' => ['date' => '2026-10-22']];
    eq('imported', apply_gcal_event($ev, $changes));
    $a = t_appt('ev_dia');
    eq('2026-10-20 00:00:00', $a['start_at']);
    eq('2026-10-21 23:59:00', $a['end_at']);
    $one = ['id' => 'ev_dia2', 'status' => 'confirmed', 'updated' => '2026-10-08T17:30:12.000Z',
            'start' => ['date' => '2026-10-25'], 'end' => ['date' => '2026-10-26']];
    apply_gcal_event($one, $changes);
    eq('2026-10-25 23:59:00', t_appt('ev_dia2')['end_at']);
});

test('un evento creado por Sirius cuyo id no se guardó se enlaza en vez de duplicarse', function () {
    db()->prepare("INSERT INTO appointments (title, start_at, end_at) VALUES ('Mi cita', '2026-10-21 09:00:00', '2026-10-21 10:00:00')")->execute();
    $id = (int)db()->lastInsertId();
    $changes = [];
    $ev = t_event('ev_propio', '2026-10-08T20:00:00.000Z', ['extendedProperties' => ['private' => ['sirius_appointment_id' => (string)$id]]]);
    eq('skipped', apply_gcal_event($ev, $changes));
    eq(0, count($changes));
    eq($id, (int)t_appt('ev_propio')['id']);
    $n = (int)db()->query("SELECT COUNT(*) FROM appointments WHERE title = 'Cita de prueba' AND google_event_id = 'ev_propio'")->fetchColumn();
    eq(0, $n, 'no debe existir una copia importada');
});

test('los avisos se agrupan: pocos por separado, muchos en un solo resumen', function () {
    $pdo = db();
    $admins = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE is_active = 1 AND role IN ('administrador','developper')")->fetchColumn();
    ok($admins >= 1);
    $count = fn() => (int)$pdo->query('SELECT COUNT(*) FROM notifications')->fetchColumn();
    $mk = fn(int $n) => array_map(fn($i) => ['kind' => 'imported', 'assigned' => null, 'title' => 'Nueva cita', 'body' => "Cita $i"], range(1, $n));

    $before = $count();
    notify_gcal_changes($mk(3));
    eq(3 * $admins, $count() - $before, '3 cambios = 3 avisos por usuario');

    $before = $count();
    notify_gcal_changes($mk(40));
    eq(1 * $admins, $count() - $before, '40 cambios = 1 solo aviso-resumen por usuario');

    $before = $count();
    notify_gcal_changes([]);
    eq(0, $count() - $before);
});
