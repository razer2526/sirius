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
            $p256dh = trim((string)($b['keys']['p256dh'] ?? ''));
            $auth = trim((string)($b['keys']['auth'] ?? ''));

            $pdo = db();
            $st = $pdo->prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?');
            $st->execute([$endpoint]);
            $existing = $st->fetch();
            if ($existing) {
                $pdo->prepare('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ? WHERE id = ?')
                    ->execute([(int)$me['id'], $p256dh ?: null, $auth ?: null, $existing['id']]);
            } else {
                $pdo->prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)')
                    ->execute([(int)$me['id'], $endpoint, $p256dh ?: null, $auth ?: null]);
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

        /** El service worker llama esto al recibir un push (que llega sin contenido, ver
         *  includes/webpush.php). Devuelve lo pendiente para mostrarlo y lo marca leído. */
        case 'pending': {
            $pdo = db();
            $st = $pdo->prepare(
                'SELECT id, title, body, url FROM notifications
                 WHERE user_id = ? AND read_at IS NULL ORDER BY created_at LIMIT 10'
            );
            $st->execute([(int)$me['id']]);
            $items = $st->fetchAll();
            if ($items) {
                $ids = array_column($items, 'id');
                $marks = implode(',', array_fill(0, count($ids), '?'));
                $pdo->prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id IN ($marks)")->execute($ids);
            }
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
            }
            unset($it);
            json_ok(['items' => $items]);
        }
    }
}
