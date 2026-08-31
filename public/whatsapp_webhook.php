<?php
/**
 * Webhook de WhatsApp Cloud API (Meta). Sin sesión: Meta lo llama directo con su
 * propio verify_token/firma, no con una cookie de Sirius.
 *
 * GET  = verificación del webhook (Meta la hace una vez, al registrar la URL en
 *        el panel de desarrolladores).
 * POST = eventos entrantes (mensajes y acuses de entrega/lectura). Meta exige
 *        respuesta rápida y reintenta si no recibe 200: se guarda primero en BD,
 *        se dispara el automático si aplica, y solo entonces se responde 200.
 *        Cualquier error se registra en el log de errores sin dejar de responder
 *        200, para que Meta nunca reintente en bucle por un fallo nuestro.
 *
 * OJO: PHP convierte los puntos de "hub.mode"/"hub.verify_token"/"hub.challenge"
 * en guiones bajos dentro de $_GET (comportamiento estándar del parser de query
 * strings), por eso se leen como hub_mode/hub_verify_token/hub_challenge.
 */

require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/whatsapp.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    wa_webhook_verify();
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    wa_webhook_receive();
    exit;
}

http_response_code(405);
exit;

function wa_webhook_verify(): void
{
    $cfg = wa_config();
    $mode = (string)($_GET['hub_mode'] ?? '');
    $token = (string)($_GET['hub_verify_token'] ?? '');
    $challenge = (string)($_GET['hub_challenge'] ?? '');
    if ($mode === 'subscribe' && $cfg['verify_token'] !== '' && hash_equals($cfg['verify_token'], $token)) {
        header('Content-Type: text/plain');
        echo $challenge;
        return;
    }
    http_response_code(403);
    echo 'Verificación fallida';
}

function wa_webhook_receive(): void
{
    $raw = (string)file_get_contents('php://input');
    try {
        wa_webhook_verify_signature($raw);
        $payload = json_decode($raw, true) ?: [];
        foreach ($payload['entry'] ?? [] as $entry) {
            foreach ($entry['changes'] ?? [] as $change) {
                $value = $change['value'] ?? [];
                $contact = $value['contacts'][0] ?? null;
                foreach ($value['messages'] ?? [] as $msg) {
                    wa_webhook_handle_inbound($msg, $contact);
                }
                foreach ($value['statuses'] ?? [] as $status) {
                    wa_webhook_handle_status($status);
                }
            }
        }
    } catch (Throwable $e) {
        error_log('whatsapp_webhook: ' . $e->getMessage());
    }
    http_response_code(200);
    echo 'EVENT_RECEIVED';
}

/** Si hay app_secret configurado, exige firma válida; si no hay, no se puede validar (se documenta en Admin Tools). */
function wa_webhook_verify_signature(string $raw): void
{
    $cfg = wa_config();
    if ($cfg['app_secret'] === '') {
        return;
    }
    $header = (string)($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '');
    $expected = 'sha256=' . hash_hmac('sha256', $raw, $cfg['app_secret']);
    if (!hash_equals($expected, $header)) {
        throw new RuntimeException('Firma de webhook inválida');
    }
}

function wa_webhook_handle_inbound(array $msg, ?array $contact): void
{
    $waId = (string)($msg['from'] ?? '');
    if ($waId === '') {
        return;
    }
    $now = date('Y-m-d H:i:s');
    $pdo = db();

    $st = $pdo->prepare('SELECT * FROM wa_conversations WHERE wa_id = ?');
    $st->execute([$waId]);
    $conversation = $st->fetch();
    $isNew = !$conversation;

    if ($isNew) {
        $patientId = wa_find_patient_by_phone($waId);
        $statusId = wa_webhook_default_status_id();
        $contactName = $contact['profile']['name'] ?? null;
        $pdo->prepare(
            'INSERT INTO wa_conversations
                (wa_id, contact_name, patient_id, status_id, last_inbound_at, last_message_at, unread_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
        )->execute([$waId, $contactName, $patientId, $statusId, $now, $now, $now, $now]);
        $conversationId = (int)$pdo->lastInsertId();
    } else {
        $conversationId = (int)$conversation['id'];
        $pdo->prepare(
            'UPDATE wa_conversations SET last_inbound_at = ?, last_message_at = ?, unread_count = unread_count + 1, updated_at = ? WHERE id = ?'
        )->execute([$now, $now, $now, $conversationId]);
    }

    $type = (string)($msg['type'] ?? 'text');
    $body = $type === 'text' ? ($msg['text']['body'] ?? null) : ($msg[$type]['caption'] ?? null);
    $mediaId = $msg[$type]['id'] ?? null;
    $mediaMime = $msg[$type]['mime_type'] ?? null;

    // Las URLs de media de Meta expiran a los pocos minutos: hay que bajar el
    // archivo ahora, no cuando alguien del equipo abra la conversación.
    $media = ($mediaId && wa_is_connected())
        ? wa_download_media($mediaId, $msg[$type]['filename'] ?? null)
        : null;

    $pdo->prepare(
        'INSERT INTO wa_messages
            (conversation_id, direction, wa_message_id, msg_type, body, media_id, media_mime, media_path, media_filename, media_size, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $conversationId, 'in', $msg['id'] ?? null, $type, $body, $mediaId, $mediaMime,
        $media['stored_name'] ?? null, $media['filename'] ?? null, $media['size'] ?? null, 'received', $now,
    ]);

    wa_webhook_maybe_auto_reply($conversationId, $waId, $isNew);
}

function wa_webhook_handle_status(array $status): void
{
    $waMessageId = $status['id'] ?? null;
    $newStatus = (string)($status['status'] ?? '');
    if (!$waMessageId || $newStatus === '') {
        return;
    }
    $error = !empty($status['errors']) ? json_encode($status['errors'], JSON_UNESCAPED_UNICODE) : null;
    db()->prepare('UPDATE wa_messages SET status = ?, error = COALESCE(?, error) WHERE wa_message_id = ?')
        ->execute([$newStatus, $error, $waMessageId]);
}

function wa_webhook_default_status_id(): ?int
{
    $st = db()->prepare('SELECT id FROM wa_statuses WHERE is_default = 1 ORDER BY sort_order LIMIT 1');
    $st->execute();
    $row = $st->fetch();
    return $row ? (int)$row['id'] : null;
}

/** Bienvenida en conversación nueva; ausencia si está fuera de horario y no se mandó otra ya recientemente. */
function wa_webhook_maybe_auto_reply(int $conversationId, string $waId, bool $isNew): void
{
    if (!wa_is_connected()) {
        return;
    }
    if ($isNew) {
        $welcome = wa_webhook_auto_message('welcome');
        if ($welcome && !empty($welcome['is_active']) && !empty($welcome['body'])) {
            wa_send_text($waId, $welcome['body'], null, $conversationId);
        }
        return;
    }
    $away = wa_webhook_auto_message('away');
    if (!$away || empty($away['is_active']) || empty($away['body'])) {
        return;
    }
    if (wa_business_hours_open($away['schedule'] ?? null)) {
        return;
    }
    if (wa_webhook_recent_auto_message($conversationId)) {
        return;
    }
    wa_send_text($waId, $away['body'], null, $conversationId);
}

function wa_webhook_auto_message(string $type): ?array
{
    $st = db()->prepare('SELECT * FROM wa_auto_messages WHERE type = ?');
    $st->execute([$type]);
    $row = $st->fetch();
    return $row ?: null;
}

function wa_webhook_recent_auto_message(int $conversationId): bool
{
    $since = date('Y-m-d H:i:s', time() - WA_AUTO_MESSAGE_COOLDOWN_HOURS * 3600);
    $st = db()->prepare(
        "SELECT 1 FROM wa_messages WHERE conversation_id = ? AND direction = 'out' AND sent_by IS NULL AND created_at >= ? LIMIT 1"
    );
    $st->execute([$conversationId, $since]);
    return (bool)$st->fetch();
}
