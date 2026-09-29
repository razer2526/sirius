<?php
/**
 * Handler push: suscripciones de notificaciones push y la cola de notificaciones
 * pendientes que el service worker consulta al recibir un push vacío.
 *
 * Sin módulo propio (module_key null en el router, como 'assistant'): cualquiera
 * con sesión puede activarlas para sí mismo, es una preferencia personal, no un
 * privilegio del sistema.
 */

function handle_push(string $action): void
{
    $me = current_user();

    switch ($action) {
        /** Llave pública VAPID, para pushManager.subscribe() en el navegador. */
        case 'vapid_key': {
            require_once __DIR__ . '/../../includes/webpush.php';
            json_ok(['key' => webpush_vapid_keys()['public_key']]);
        }

        case 'subscribe': {
            $b = request_body();
            $endpoint = trim((string)($b['endpoint'] ?? ''));
            if ($endpoint === '') {
                json_error('Falta el endpoint de la suscripción', 422);
            }
            // Un 500 mudo aquí dejaría al dispositivo sin suscribirse para siempre sin que nadie lo note.
            if (strlen($endpoint) > 1000) {
                json_error('El servicio de notificaciones de este navegador devolvió una dirección demasiado larga', 422);
            }
            $p256dh = trim((string)($b['keys']['p256dh'] ?? ''));
            $auth = trim((string)($b['keys']['auth'] ?? ''));

            $pdo = db();
            $st = $pdo->prepare('SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?');
            $st->execute([$endpoint]);
            $existing = $st->fetch();
            if ($existing && (int)$existing['user_id'] === (int)$me['id']) {
                // Se reenvía en cada inicio (ver syncPushSubscription): es un upsert y NO debe mover el
                // marcador, o lo que aún no se le entregó a este dispositivo se daría por entregado.
                $pdo->prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?')
                    ->execute([$p256dh ?: null, $auth ?: null, $existing['id']]);
            } elseif ($existing) {
                // Equipo compartido: la suscripción pasa a quien tiene la sesión ahora. Empieza desde lo
                // último que ese usuario ya tenía, no desde cero.
                $pdo->prepare('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, last_notified_id = ? WHERE id = ?')
                    ->execute([(int)$me['id'], $p256dh ?: null, $auth ?: null, push_latest_notification_id((int)$me['id']), $existing['id']]);
            } else {
                // Dispositivo nuevo: solo recibirá lo que llegue de aquí en adelante, no el historial.
                $pdo->prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_notified_id) VALUES (?, ?, ?, ?, ?)')
                    ->execute([(int)$me['id'], $endpoint, $p256dh ?: null, $auth ?: null, push_latest_notification_id((int)$me['id'])]);
            }
            json_ok();
        }

        case 'unsubscribe': {
            $b = request_body();
            $endpoint = trim((string)($b['endpoint'] ?? ''));
            if ($endpoint !== '') {
                db()->prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
                    ->execute([$endpoint, (int)$me['id']]);
            }
            json_ok();
        }

        /** Últimas notificaciones (leídas y no), para la campanita de la barra superior.
         *  A diferencia de 'pending' no marca nada como leído — eso lo hace 'mark_read'
         *  cuando la persona de verdad abre/hace clic en una. */
        case 'list': {
            $st = db()->prepare(
                'SELECT id, title, body, url, created_at, read_at FROM notifications
                 WHERE user_id = ? ORDER BY read_at IS NULL DESC, created_at DESC LIMIT 15'
            );
            $st->execute([(int)$me['id']]);
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
            }
            unset($r);
            json_ok(['items' => $rows]);
        }

        case 'unread_count': {
            $st = db()->prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL');
            $st->execute([(int)$me['id']]);
            json_ok(['count' => (int)$st->fetch()['c']]);
        }

        case 'mark_read': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            db()->prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
                ->execute([date('Y-m-d H:i:s'), $id, (int)$me['id']]);
            json_ok();
        }

        /** Al abrir la campanita: el contador baja a 0 de inmediato, y una nueva
         *  notificación que llegue después vuelve a contar desde ahí. */
        case 'mark_all_read': {
            db()->prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
                ->execute([date('Y-m-d H:i:s'), (int)$me['id']]);
            json_ok();
        }

        /** El service worker llama esto al recibir un push (que llega sin contenido, ver
         *  includes/webpush.php). Devuelve LA SIGUIENTE notificación que ese dispositivo aún no
         *  ha mostrado: el servidor manda un push por notificación, así que cada push entrega
         *  exactamente una. Ya no marca nada como leído: "entregada a este dispositivo" y "vista
         *  por la persona" son cosas distintas (antes eran la misma bandera, y con dos dispositivos
         *  solo el primero en preguntar mostraba el aviso). */
        case 'pending': {
            json_ok(['items' => push_take_next(trim((string)($_GET['endpoint'] ?? '')), (int)$me['id'])]);
        }

        /** Prueba de punta a punta desde la propia app: manda una notificación de verdad a todos
         *  los dispositivos del usuario y devuelve qué respondió el servicio de push de cada uno. */
        case 'test': {
            require_once __DIR__ . '/../../includes/webpush.php';
            $b = request_body();
            $mine = null;
            $endpoint = trim((string)($b['endpoint'] ?? ''));
            if ($endpoint !== '') {
                $st = db()->prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?');
                $st->execute([$endpoint, (int)$me['id']]);
                $row = $st->fetch();
                $mine = $row ? (int)$row['id'] : null;
            }
            $devices = webpush_notify(
                (int)$me['id'],
                'Notificación de prueba',
                'Si ves esto, este dispositivo recibe los avisos de Sirius.',
                '#/dashboard'
            );
            foreach ($devices as &$d) {
                $d['mine'] = $mine !== null && $d['id'] === $mine;
                unset($d['id']);
            }
            unset($d);
            json_ok(['devices' => $devices, 'this_device_registered' => $mine !== null]);
        }
    }
}

/** Última notificación del usuario (0 si no tiene): el punto desde el que empieza a contar un dispositivo. */
function push_latest_notification_id(int $userId): int
{
    $st = db()->prepare('SELECT COALESCE(MAX(id), 0) m FROM notifications WHERE user_id = ?');
    $st->execute([$userId]);
    return (int)$st->fetch()['m'];
}

/**
 * Toma la siguiente notificación sin mostrar de ESTE dispositivo (la más antigua con id mayor a
 * su marcador, sin leer y del usuario de la sesión) y avanza el marcador.
 *
 * El avance es un compare-and-swap (`WHERE last_notified_id = <el que leí>`): dos pushes que llegan
 * a la vez al mismo dispositivo leen el mismo marcador, y sin esto ambos tomarían la misma
 * notificación. El que pierde la carrera reintenta y toma la siguiente.
 *
 * Si el endpoint no pertenece al usuario de la sesión (equipo compartido: otra persona tiene la
 * sesión abierta) devuelve vacío: no se le muestra a nadie el contenido de otro.
 */
function push_take_next(string $endpoint, int $userId): array
{
    if ($endpoint === '') {
        return [];
    }
    $pdo = db();
    for ($try = 0; $try < 10; $try++) {
        $st = $pdo->prepare('SELECT id, last_notified_id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?');
        $st->execute([$endpoint, $userId]);
        $sub = $st->fetch();
        // Se cierra cada cursor antes de escribir: con un SELECT aún abierto, SQLite (desarrollo)
        // se interbloquea cuando dos procesos intentan subir de lectura a escritura a la vez.
        $st->closeCursor();
        if (!$sub) {
            return [];
        }
        $mark = (int)$sub['last_notified_id'];

        $st = $pdo->prepare(
            'SELECT id, title, body, url FROM notifications
             WHERE user_id = ? AND id > ? AND read_at IS NULL ORDER BY id LIMIT 1'
        );
        $st->execute([$userId, $mark]);
        $n = $st->fetch();
        $st->closeCursor();
        if (!$n) {
            return [];
        }

        $upd =$pdo->prepare('UPDATE push_subscriptions SET last_notified_id = ? WHERE id = ? AND last_notified_id = ?');
        $upd->execute([(int)$n['id'], (int)$sub['id'], $mark]);
        if ($upd->rowCount() === 1) {
            $n['id'] = (int)$n['id'];
            return [$n];
        }
    }
    return [];
}
