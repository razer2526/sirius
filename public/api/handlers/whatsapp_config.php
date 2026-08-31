<?php
/**
 * Handler whatsapp_config: configuración del módulo WhatsApp (Admin Tools).
 * Credenciales, mensajes automáticos (bienvenida/ausencia), respuestas rápidas
 * y el catálogo de estatus que usa la bandeja (handler whatsapp.php).
 */

require_once __DIR__ . '/../../includes/whatsapp.php';

function handle_whatsapp_config(string $action): void
{
    switch ($action) {
        case 'get_config': {
            json_ok(['config' => wa_public_config()]);
        }

        case 'save_config': {
            $b = request_body();
            wa_save($b);
            log_activity('whatsapp_config', 'credentials_save', 'Actualizó la configuración de WhatsApp');
            json_ok(['config' => wa_public_config()]);
        }

        case 'test_connection': {
            try {
                [$code, $resp] = wa_api_request('GET', '');
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            if ($code < 200 || $code >= 300) {
                json_error('Meta respondió con un error: ' . json_encode($resp, JSON_UNESCAPED_UNICODE), 422);
            }
            json_ok(['response' => $resp]);
        }

        case 'statuses_list': {
            $st = db()->query('SELECT * FROM wa_statuses ORDER BY sort_order');
            json_ok(['statuses' => $st->fetchAll()]);
        }

        case 'statuses_save': {
            $b = request_body();
            $skey = trim((string)($b['skey'] ?? ''));
            $label = trim((string)($b['label'] ?? ''));
            if ($skey === '' || $label === '') {
                json_error('Captura la clave y la etiqueta del estatus', 422);
            }
            $color = trim((string)($b['color'] ?? 'slate')) ?: 'slate';
            $sortOrder = (int)($b['sort_order'] ?? 0);
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);

            if ($id > 0) {
                db()->prepare('UPDATE wa_statuses SET skey = ?, label = ?, color = ?, sort_order = ?, is_active = ? WHERE id = ?')
                    ->execute([$skey, $label, $color, $sortOrder, $isActive, $id]);
            } else {
                db()->prepare('INSERT INTO wa_statuses (skey, label, color, sort_order, is_active) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$skey, $label, $color, $sortOrder, $isActive]);
                $id = (int)db()->lastInsertId();
            }
            log_activity('whatsapp_config', 'status_save', "Guardó el estatus \"$label\"", 'wa_status', $id);
            json_ok(['id' => $id]);
        }

        case 'statuses_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT is_default FROM wa_statuses WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Estatus no encontrado', 404);
            }
            if ((int)$row['is_default'] === 1) {
                json_error('No se puede eliminar el estatus por defecto', 422);
            }
            $st = db()->prepare('SELECT COUNT(*) c FROM wa_conversations WHERE status_id = ?');
            $st->execute([$id]);
            if ((int)$st->fetch()['c'] > 0) {
                json_error('Hay conversaciones con este estatus; reasígnalas antes de eliminarlo', 422);
            }
            db()->prepare('DELETE FROM wa_statuses WHERE id = ?')->execute([$id]);
            log_activity('whatsapp_config', 'status_delete', 'Eliminó un estatus', 'wa_status', $id);
            json_ok();
        }

        case 'auto_messages_list': {
            $st = db()->query('SELECT * FROM wa_auto_messages');
            json_ok(['auto_messages' => array_map('format_wa_auto_message', $st->fetchAll())]);
        }

        case 'auto_messages_save': {
            $b = request_body();
            $type = trim((string)($b['type'] ?? ''));
            if (!in_array($type, ['welcome', 'away'], true)) {
                json_error('Tipo de mensaje automático no válido', 422);
            }
            $body = trim((string)($b['body'] ?? ''));
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $schedule = null;
            if ($type === 'away' && isset($b['schedule']) && is_array($b['schedule'])) {
                $schedule = json_encode($b['schedule'], JSON_UNESCAPED_UNICODE);
            }
            $st = db()->prepare('SELECT id FROM wa_auto_messages WHERE type = ?');
            $st->execute([$type]);
            if ($st->fetch()) {
                $sql = 'UPDATE wa_auto_messages SET is_active = ?, body = ?, updated_at = ?'
                    . ($type === 'away' ? ', schedule = ?' : '') . ' WHERE type = ?';
                $params = [$isActive, $body, date('Y-m-d H:i:s')];
                if ($type === 'away') {
                    $params[] = $schedule;
                }
                $params[] = $type;
                db()->prepare($sql)->execute($params);
            } else {
                db()->prepare('INSERT INTO wa_auto_messages (type, is_active, body, schedule) VALUES (?, ?, ?, ?)')
                    ->execute([$type, $isActive, $body, $schedule]);
            }
            log_activity('whatsapp_config', 'auto_message_save', "Actualizó el mensaje automático \"$type\"");
            json_ok();
        }

        case 'quick_replies_list': {
            $st = db()->query('SELECT * FROM wa_quick_replies ORDER BY title');
            json_ok(['quick_replies' => $st->fetchAll()]);
        }

        case 'quick_replies_save': {
            $b = request_body();
            $title = trim((string)($b['title'] ?? ''));
            $body = trim((string)($b['body'] ?? ''));
            if ($title === '' || $body === '') {
                json_error('Captura el título y el texto de la respuesta rápida', 422);
            }
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);
            $me = current_user();

            if ($id > 0) {
                db()->prepare('UPDATE wa_quick_replies SET title = ?, body = ?, is_active = ?, updated_at = ? WHERE id = ?')
                    ->execute([$title, $body, $isActive, date('Y-m-d H:i:s'), $id]);
            } else {
                db()->prepare('INSERT INTO wa_quick_replies (title, body, is_active, created_by) VALUES (?, ?, ?, ?)')
                    ->execute([$title, $body, $isActive, (int)$me['id']]);
                $id = (int)db()->lastInsertId();
            }
            log_activity('whatsapp_config', 'quick_reply_save', "Guardó la respuesta rápida \"$title\"", 'wa_quick_reply', $id);
            json_ok(['id' => $id]);
        }

        case 'quick_replies_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            db()->prepare('DELETE FROM wa_quick_replies WHERE id = ?')->execute([$id]);
            log_activity('whatsapp_config', 'quick_reply_delete', 'Eliminó una respuesta rápida', 'wa_quick_reply', $id);
            json_ok();
        }
    }
}

/** Configuración sin exponer el token/secreto completos. */
function wa_public_config(): array
{
    $cfg = wa_config();
    foreach (['access_token', 'app_secret'] as $secretField) {
        $val = (string)$cfg[$secretField];
        $cfg[$secretField] = '';
        $cfg["has_$secretField"] = $val !== '';
        $cfg["{$secretField}_hint"] = $val === '' ? '' : str_repeat('•', 8) . substr($val, -4);
    }
    $cfg['is_connected'] = wa_is_connected();
    return $cfg;
}

function format_wa_auto_message(array $m): array
{
    $m['id'] = (int)$m['id'];
    $m['is_active'] = (bool)$m['is_active'];
    $m['schedule'] = $m['schedule'] ? (json_decode($m['schedule'], true) ?: null) : null;
    return $m;
}
