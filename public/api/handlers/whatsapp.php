<?php
/**
 * Handler whatsapp: bandeja de conversaciones para el equipo. La configuración
 * (credenciales, mensajes automáticos, respuestas rápidas, catálogo de estatus)
 * vive en el handler whatsapp_config, un módulo aparte dentro de Admin Tools.
 *
 * Visibilidad igual a Citas/Episodios: quien tiene el flag "manage" ve y gestiona
 * todo; el resto solo ve conversaciones "generales" (sin asignar) o asignadas a sí
 * mismo.
 */

require_once __DIR__ . '/../../includes/whatsapp.php';

const WA_PRIORITIES = ['baja', 'normal', 'alta'];
// Mismo set que ofrece el propio selector de reacciones de WhatsApp.
const WA_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function handle_whatsapp(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('whatsapp', 'manage');

    switch ($action) {
        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $statusId = isset($_GET['status_id']) && $_GET['status_id'] !== '' ? (int)$_GET['status_id'] : null;
            $priority = in_array($_GET['priority'] ?? '', WA_PRIORITIES, true) ? $_GET['priority'] : null;
            $assignedUserId = isset($_GET['assigned_user_id']) && $_GET['assigned_user_id'] !== '' ? (int)$_GET['assigned_user_id'] : null;

            $where = ['c.is_archived = 0'];
            $params = [];
            if (!$canManage) {
                $where[] = '(c.assigned_user_id IS NULL OR c.assigned_user_id = ?)';
                $params[] = (int)$me['id'];
            } elseif ($assignedUserId !== null) {
                $where[] = 'c.assigned_user_id = ?';
                $params[] = $assignedUserId;
            }
            if ($statusId !== null) {
                $where[] = 'c.status_id = ?';
                $params[] = $statusId;
            }
            if ($priority !== null) {
                $where[] = 'c.priority = ?';
                $params[] = $priority;
            }
            if ($q !== '') {
                $where[] = "(c.wa_id LIKE ? OR c.contact_name LIKE ? OR " . sql_full_name('p') . ' LIKE ?)';
                $like = '%' . $q . '%';
                $params = array_merge($params, [$like, $like, $like]);
            }

            $sql = 'SELECT ' . wa_conversation_select() . '
                    FROM wa_conversations c
                    LEFT JOIN wa_statuses s ON s.id = c.status_id
                    LEFT JOIN users u ON u.id = c.assigned_user_id
                    LEFT JOIN patients p ON p.id = c.patient_id
                    WHERE ' . implode(' AND ', $where) . '
                    ORDER BY c.last_message_at DESC';
            $st = db()->prepare($sql);
            $st->execute($params);

            $statuses = db()->query('SELECT id, skey, label, color, sort_order FROM wa_statuses WHERE is_active = 1 ORDER BY sort_order')->fetchAll();
            $users = $canManage
                ? db()->query('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name')->fetchAll()
                : [];

            json_ok([
                'conversations' => array_map('format_wa_conversation', $st->fetchAll()),
                'can_manage'    => $canManage,
                'statuses'      => $statuses,
                'users'         => $users,
            ]);
        }

        case 'get': {
            $conv = find_wa_conversation((int)($_GET['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            wa_mark_read($conv['id']);
            json_ok(['conversation' => format_wa_conversation($conv)]);
        }

        case 'messages': {
            $conv = find_wa_conversation((int)($_GET['conversation_id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : null;
            $sql = 'SELECT m.*, u.full_name AS sent_by_name FROM wa_messages m
                    LEFT JOIN users u ON u.id = m.sent_by
                    WHERE m.conversation_id = ?' . ($beforeId ? ' AND m.id < ?' : '') . '
                    ORDER BY m.id DESC LIMIT 50';
            $params = [$conv['id']];
            if ($beforeId) {
                $params[] = $beforeId;
            }
            $st = db()->prepare($sql);
            $st->execute($params);
            $rows = array_reverse(array_map('format_wa_message', $st->fetchAll()));
            json_ok(['messages' => $rows]);
        }

        case 'send': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['conversation_id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $body = trim((string)($b['body'] ?? ''));
            if ($body === '') {
                json_error('Escribe un mensaje', 422);
            }
            if (!wa_within_session_window($conv)) {
                json_error(
                    'Han pasado más de 24h desde el último mensaje del cliente. Solo se pueden enviar plantillas '
                    . 'aprobadas por Meta desde Meta Business Manager; espera a que el cliente vuelva a escribir.',
                    422
                );
            }
            $result = wa_send_text($conv['wa_id'], $body, (int)$me['id'], $conv['id']);
            if (!$result['ok']) {
                json_error('WhatsApp rechazó el mensaje: ' . json_encode($result['response'], JSON_UNESCAPED_UNICODE), 502);
            }
            log_activity('whatsapp', 'message_send', 'Envió mensaje a ' . $conv['wa_id'], 'wa_conversation', $conv['id']);
            json_ok();
        }

        /**
         * Adjunta y envía un archivo (foto, video, audio o documento). Multipart,
         * no JSON — se sube primero a disco (registro propio, sin depender de que
         * Meta lo conserve) y luego a Meta para obtener el media_id con el que se
         * arma el mensaje.
         */
        case 'send_media': {
            $conv = find_wa_conversation((int)($_POST['conversation_id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            if (!wa_within_session_window($conv)) {
                json_error(
                    'Han pasado más de 24h desde el último mensaje del cliente. Solo se pueden enviar plantillas '
                    . 'aprobadas por Meta desde Meta Business Manager; espera a que el cliente vuelva a escribir.',
                    422
                );
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                if (!empty($_FILES['file']) && in_array($_FILES['file']['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                    json_error('El archivo es demasiado grande para este servidor', 422);
                }
                json_error('No se recibió el archivo', 422);
            }
            $file = $_FILES['file'];
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            $mime = @mime_content_type($file['tmp_name']) ?: 'application/octet-stream';
            $type = wa_media_type_for_mime($mime);
            $maxBytes = wa_media_max_bytes($type);
            if ($file['size'] > $maxBytes) {
                json_error('El archivo supera el límite de ' . (int)($maxBytes / 1024 / 1024) . ' MB para ' . $type, 422);
            }

            $storedName = bin2hex(random_bytes(20));
            $localPath = wa_media_dir() . $storedName;
            if (!move_uploaded_file($file['tmp_name'], $localPath)) {
                json_error('No se pudo guardar el archivo', 500);
            }
            @chmod($localPath, 0644);
            $filename = $type === 'document' ? (mb_substr(trim((string)($file['name'] ?? '')), 0, 200) ?: 'documento') : null;
            $caption = trim((string)($_POST['caption'] ?? ''));

            try {
                $metaMediaId = wa_upload_media($localPath, $mime);
            } catch (Throwable $e) {
                @unlink($localPath);
                json_error($e->getMessage(), 502);
            }

            $result = wa_send_media(
                $conv['wa_id'], $type, $metaMediaId, $caption, (int)$me['id'], $conv['id'],
                $storedName, $mime, (int)$file['size'], $filename
            );
            if (!$result['ok']) {
                json_error('WhatsApp rechazó el archivo: ' . json_encode($result['response'], JSON_UNESCAPED_UNICODE), 502);
            }
            // Audio no admite caption en la API de Meta: si el agente escribió algo,
            // se manda aparte como texto normal en vez de perderlo en silencio.
            if ($type === 'audio' && $caption !== '') {
                wa_send_text($conv['wa_id'], $caption, (int)$me['id'], $conv['id']);
            }
            log_activity('whatsapp', 'message_send_media', "Envió un adjunto ($type) a " . $conv['wa_id'], 'wa_conversation', $conv['id']);
            json_ok();
        }

        /** Reacciona (o quita la reacción, con emoji = '') a un mensaje propio o del cliente. */
        case 'react': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['conversation_id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            if (!wa_within_session_window($conv)) {
                json_error('Han pasado más de 24h desde el último mensaje del cliente; ya no se pueden mandar reacciones.', 422);
            }
            $emoji = trim((string)($b['emoji'] ?? ''));
            if ($emoji !== '' && !in_array($emoji, WA_REACTION_EMOJIS, true)) {
                json_error('Emoji de reacción no válido', 422);
            }
            $st = db()->prepare('SELECT id, wa_message_id FROM wa_messages WHERE id = ? AND conversation_id = ?');
            $st->execute([(int)($b['message_id'] ?? 0), $conv['id']]);
            $msg = $st->fetch();
            if (!$msg || !$msg['wa_message_id']) {
                json_error('No se puede reaccionar a este mensaje', 422);
            }
            $result = wa_send_reaction($conv['wa_id'], $msg['wa_message_id'], $emoji);
            if (!$result['ok']) {
                json_error('WhatsApp rechazó la reacción: ' . json_encode($result['response'], JSON_UNESCAPED_UNICODE), 502);
            }
            db()->prepare('UPDATE wa_messages SET reaction_agent = ? WHERE id = ?')
                ->execute([$emoji !== '' ? $emoji : null, $msg['id']]);
            json_ok();
        }

        case 'assign': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $userId = isset($b['assigned_user_id']) && $b['assigned_user_id'] !== '' ? (int)$b['assigned_user_id'] : null;
            if ($userId !== null) {
                $st = db()->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
                $st->execute([$userId]);
                if (!$st->fetch()) {
                    json_error('El usuario asignado no es válido', 422);
                }
            }
            db()->prepare('UPDATE wa_conversations SET assigned_user_id = ?, updated_at = ? WHERE id = ?')
                ->execute([$userId, date('Y-m-d H:i:s'), $conv['id']]);
            log_activity('whatsapp', 'conversation_assign', "Reasignó la conversación con {$conv['wa_id']}", 'wa_conversation', $conv['id']);
            json_ok();
        }

        case 'set_status': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $statusId = (int)($b['status_id'] ?? 0);
            $st = db()->prepare('SELECT id FROM wa_statuses WHERE id = ? AND is_active = 1');
            $st->execute([$statusId]);
            if (!$st->fetch()) {
                json_error('Estatus no válido', 422);
            }
            db()->prepare('UPDATE wa_conversations SET status_id = ?, updated_at = ? WHERE id = ?')
                ->execute([$statusId, date('Y-m-d H:i:s'), $conv['id']]);
            log_activity('whatsapp', 'conversation_status', "Cambió el estatus de la conversación con {$conv['wa_id']}", 'wa_conversation', $conv['id']);
            json_ok();
        }

        case 'set_priority': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $priority = $b['priority'] ?? '';
            if (!in_array($priority, WA_PRIORITIES, true)) {
                json_error('Prioridad no válida', 422);
            }
            db()->prepare('UPDATE wa_conversations SET priority = ?, updated_at = ? WHERE id = ?')
                ->execute([$priority, date('Y-m-d H:i:s'), $conv['id']]);
            json_ok();
        }

        case 'link_patient': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            $patientId = (int)($b['patient_id'] ?? 0);
            $st = db()->prepare('SELECT id FROM patients WHERE id = ? AND is_deleted = 0');
            $st->execute([$patientId]);
            if (!$st->fetch()) {
                json_error('Paciente no encontrado', 404);
            }
            db()->prepare('UPDATE wa_conversations SET patient_id = ?, updated_at = ? WHERE id = ?')
                ->execute([$patientId, date('Y-m-d H:i:s'), $conv['id']]);
            log_activity('whatsapp', 'conversation_link_patient', "Vinculó la conversación con {$conv['wa_id']} a un paciente", 'wa_conversation', $conv['id']);
            json_ok();
        }

        case 'unlink_patient': {
            $b = request_body();
            $conv = find_wa_conversation((int)($b['id'] ?? 0));
            require_wa_access($conv, $me, $canManage);
            db()->prepare('UPDATE wa_conversations SET patient_id = NULL, updated_at = ? WHERE id = ?')
                ->execute([date('Y-m-d H:i:s'), $conv['id']]);
            json_ok();
        }

        case 'quick_replies': {
            $st = db()->query('SELECT id, title, body FROM wa_quick_replies WHERE is_active = 1 ORDER BY title');
            json_ok(['quick_replies' => $st->fetchAll()]);
        }

        case 'statuses': {
            $st = db()->query('SELECT id, skey, label, color, sort_order, is_default FROM wa_statuses WHERE is_active = 1 ORDER BY sort_order');
            json_ok(['statuses' => $st->fetchAll()]);
        }

        /** Total de no leídos visibles para el usuario — barato, para el sondeo global del sonido de notificación. */
        case 'unread_count': {
            $where = 'is_archived = 0 AND unread_count > 0';
            $params = [];
            if (!$canManage) {
                $where .= ' AND (assigned_user_id IS NULL OR assigned_user_id = ?)';
                $params[] = (int)$me['id'];
            }
            $st = db()->prepare("SELECT COALESCE(SUM(unread_count), 0) c FROM wa_conversations WHERE $where");
            $st->execute($params);
            json_ok(['count' => (int)$st->fetch()['c']]);
        }

        /** Conversaciones con no leídos, para la campanita de la barra superior. */
        case 'unread_list': {
            $where = 'c.is_archived = 0 AND c.unread_count > 0';
            $params = [];
            if (!$canManage) {
                $where .= ' AND (c.assigned_user_id IS NULL OR c.assigned_user_id = ?)';
                $params[] = (int)$me['id'];
            }
            $st = db()->prepare(
                "SELECT c.id, c.wa_id, c.contact_name, c.unread_count, c.last_message_at
                 FROM wa_conversations c WHERE $where ORDER BY c.last_message_at DESC LIMIT 8"
            );
            $st->execute($params);
            json_ok(['conversations' => $st->fetchAll()]);
        }
    }
}

function wa_conversation_select(): string
{
    return 'c.*, s.label AS status_label, s.color AS status_color, u.full_name AS assigned_name,
            p.file_number, ' . sql_full_name('p') . ' AS patient_name';
}

function find_wa_conversation(int $id): array
{
    $st = db()->prepare(
        'SELECT ' . wa_conversation_select() . '
         FROM wa_conversations c
         LEFT JOIN wa_statuses s ON s.id = c.status_id
         LEFT JOIN users u ON u.id = c.assigned_user_id
         LEFT JOIN patients p ON p.id = c.patient_id
         WHERE c.id = ?'
    );
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Conversación no encontrada', 404);
    }
    return $row;
}

/** Visible/editable si es general (sin asignar), si el usuario es el responsable, o si administra el módulo. */
function require_wa_access(array $conv, array $me, bool $canManage): void
{
    if ($canManage) {
        return;
    }
    $assigned = $conv['assigned_user_id'] ?? null;
    if ($assigned !== null && (int)$assigned !== (int)$me['id']) {
        json_error('No tienes acceso a esta conversación', 403);
    }
}

function wa_mark_read(int $conversationId): void
{
    db()->prepare('UPDATE wa_conversations SET unread_count = 0 WHERE id = ?')->execute([$conversationId]);
}

function format_wa_conversation(array $c): array
{
    $c['id'] = (int)$c['id'];
    $c['patient_id'] = $c['patient_id'] !== null ? (int)$c['patient_id'] : null;
    $c['appointment_id'] = $c['appointment_id'] !== null ? (int)$c['appointment_id'] : null;
    $c['status_id'] = $c['status_id'] !== null ? (int)$c['status_id'] : null;
    $c['assigned_user_id'] = $c['assigned_user_id'] !== null ? (int)$c['assigned_user_id'] : null;
    $c['unread_count'] = (int)$c['unread_count'];
    $c['is_archived'] = (bool)$c['is_archived'];
    $c['within_session_window'] = wa_within_session_window($c);
    return $c;
}

function format_wa_message(array $m): array
{
    $m['id'] = (int)$m['id'];
    $m['conversation_id'] = (int)$m['conversation_id'];
    $m['sent_by'] = $m['sent_by'] !== null ? (int)$m['sent_by'] : null;
    $m['media_size'] = $m['media_size'] !== null ? (int)$m['media_size'] : null;
    $m['media_url'] = $m['media_path'] ? 'whatsapp_media.php?message_id=' . $m['id'] : null;
    unset($m['media_path']); // ruta local en disco: nunca sale de la API
    return $m;
}
