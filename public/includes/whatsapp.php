<?php
/**
 * Config e integración con WhatsApp Cloud API (Meta), cuenta única compartida.
 *
 * Las credenciales (token, phone_number_id, verify_token del webhook) se capturan
 * una vez desde Admin Tools > WhatsApp: Configuración y se guardan en `settings`
 * (skey='whatsapp'), igual que Google Calendar/IA/Correo — nunca en config.php,
 * así se pueden actualizar sin tocar código ni redeploy.
 */

require_once __DIR__ . '/db.php';

const WA_GRAPH_ENDPOINT = 'https://graph.facebook.com';
const WA_TIMEZONE = 'America/Mexico_City';
// No reenviar un mensaje automático a la misma conversación antes de que pase esto,
// para no contestar de nuevo en cada mensaje seguido que llegue fuera de horario.
const WA_AUTO_MESSAGE_COOLDOWN_HOURS = 4;

function wa_defaults(): array
{
    return [
        'business_id'     => '1160164743841575',
        'waba_id'         => '',
        'phone_number_id' => '',
        'access_token'    => '',
        'app_secret'      => '',
        'verify_token'    => '',
        'api_version'     => 'v21.0',
    ];
}

function wa_config(bool $refresh = false): array
{
    static $cfg = null;
    if ($cfg !== null && !$refresh) {
        return $cfg;
    }
    $cfg = wa_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['whatsapp']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
            }
        }
    } catch (Throwable $e) {
        error_log('wa_config: ' . $e->getMessage());
    }
    return $cfg;
}

/**
 * access_token/app_secret nunca se devuelven completos al navegador (ver
 * wa_public_config en el handler), así que si el formulario reenvía el valor
 * vacío no se debe interpretar como "bórralo" — solo se sobreescriben cuando
 * llega un valor nuevo no vacío, igual que ai_save() con la llave de API.
 */
function wa_save(array $values): array
{
    $cfg = wa_config();
    foreach (array_intersect_key($values, wa_defaults()) as $k => $v) {
        $v = trim((string)$v);
        if (in_array($k, ['access_token', 'app_secret'], true) && $v === '') {
            continue;
        }
        $cfg[$k] = $v;
    }
    $cfg['api_version'] = $cfg['api_version'] ?: 'v21.0';

    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['whatsapp']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'whatsapp']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['whatsapp', $json]);
    }
    return wa_config(true);
}

function wa_is_connected(): bool
{
    $cfg = wa_config();
    return $cfg['phone_number_id'] !== '' && $cfg['access_token'] !== '';
}

/**
 * Petición HTTP de bajo nivel, compartida por todas las llamadas a Meta (mensajes,
 * subida/descarga de media). $body puede ser un string (JSON o multipart ya armado)
 * o un CURLFile-aware array (para multipart, curl lo arma solo). Devuelve
 * [código, cuerpo crudo] — el llamador decide si lo decodifica como JSON o lo
 * guarda como binario (descarga de media).
 */
function wa_http(string $method, string $url, array $headers, $body, int $timeout = 30): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CUSTOMREQUEST  => $method,
        ]);
        $ca = (string)(app_config()['ca_bundle'] ?? '');
        if ($ca !== '' && is_file($ca)) {
            curl_setopt($ch, CURLOPT_CAINFO, $ca);
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            // 60/77: el servidor no tiene certificados raíz para validar a Meta
            if ($errno === 60 || $errno === 77) {
                throw new RuntimeException(
                    'El servidor no pudo validar el certificado de Meta: le falta el paquete de '
                    . 'certificados raíz. Indica la ruta de un cacert.pem en la clave "ca_bundle" de config.php.'
                );
            }
            throw new RuntimeException('No se pudo conectar con WhatsApp: ' . $err);
        }
        return [$code, $raw];
    }

    // Respaldo si cURL no está compilado en el servidor. No soporta multipart
    // (CURLFile), así que la subida de media solo funciona con cURL disponible —
    // en HostGator y prácticamente cualquier hosting PHP moderno lo está.
    if (is_array($body)) {
        throw new RuntimeException('Subir archivos a WhatsApp requiere la extensión cURL de PHP.');
    }
    $ctx = stream_context_create(['http' => [
        'method'        => $method,
        'header'        => implode("\r\n", $headers),
        'content'       => $body,
        'timeout'       => $timeout,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) {
            $code = (int)$m[1];
        }
    }
    if ($raw === false) {
        throw new RuntimeException('No se pudo conectar con WhatsApp.');
    }
    return [$code, $raw];
}

function wa_graph_url(string $path): string
{
    return WA_GRAPH_ENDPOINT . '/' . wa_config()['api_version'] . $path;
}

function wa_auth_header(): string
{
    return 'Authorization: Bearer ' . wa_config()['access_token'];
}

/**
 * Petición JSON a la Graph API de Meta. $path es relativo al phone_number_id
 * configurado (ej. '/messages'); pasar $path = '' apunta al propio recurso del
 * número (útil para probar la conexión). Devuelve [código, cuerpo decodificado].
 */
function wa_api_request(string $method, string $path, ?array $body = null, int $timeout = 30): array
{
    if (!wa_is_connected()) {
        throw new RuntimeException('WhatsApp no está configurado: falta el token o el ID del número.');
    }
    $url = wa_graph_url('/' . wa_config()['phone_number_id'] . $path);
    $headers = [wa_auth_header()];
    $payload = $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE);
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    [$code, $raw] = wa_http($method, $url, $headers, $payload, $timeout);
    return [$code, json_decode($raw, true) ?: []];
}

/**
 * Envía un mensaje de texto libre (solo válido dentro de la ventana de 24h) y
 * archiva el mensaje saliente en wa_messages. $sentByUserId = null significa
 * que lo mandó el sistema (bienvenida/ausencia), no una persona.
 */
function wa_send_text(string $waId, string $body, ?int $sentByUserId, int $conversationId): array
{
    [$code, $resp] = wa_api_request('POST', '/messages', [
        'messaging_product' => 'whatsapp',
        'to'                => $waId,
        'type'               => 'text',
        'text'              => ['body' => $body],
    ]);

    $ok = $code >= 200 && $code < 300;
    $waMessageId = $resp['messages'][0]['id'] ?? null;
    $error = $ok ? null : json_encode($resp, JSON_UNESCAPED_UNICODE);

    $now = date('Y-m-d H:i:s');
    $st = db()->prepare(
        'INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body, status, error, sent_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $st->execute([$conversationId, 'out', $waMessageId, 'text', $body, $ok ? 'sent' : 'failed', $error, $sentByUserId, $now]);

    if ($ok) {
        db()->prepare('UPDATE wa_conversations SET last_message_at = ? WHERE id = ?')
            ->execute([$now, $conversationId]);
    }

    return ['ok' => $ok, 'wa_message_id' => $waMessageId, 'response' => $resp];
}

/**
 * Envía (o quita, con $emoji = '') una reacción a un mensaje ya enviado o recibido.
 * A diferencia de wa_send_text/wa_send_media, no crea una fila nueva en wa_messages
 * — WhatsApp trata la reacción como una propiedad del mensaje original, no como un
 * mensaje aparte; el llamador actualiza esa fila directamente.
 */
function wa_send_reaction(string $waId, string $targetWaMessageId, string $emoji): array
{
    [$code, $resp] = wa_api_request('POST', '/messages', [
        'messaging_product' => 'whatsapp',
        'to'                => $waId,
        'type'              => 'reaction',
        'reaction'          => ['message_id' => $targetWaMessageId, 'emoji' => $emoji],
    ]);
    return ['ok' => $code >= 200 && $code < 300, 'response' => $resp];
}

/* ---------- Adjuntos (fotos, video, audio, documentos) ---------- */

/** Directorio de adjuntos de WhatsApp, protegido por .htaccess — se sirven solo por whatsapp_media.php. */
function wa_media_dir(): string
{
    $dir = __DIR__ . '/../../uploads/whatsapp/';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/** Categoría de mensaje de WhatsApp según el MIME (Meta valida el detalle a su vez). */
function wa_media_type_for_mime(string $mime): string
{
    if (str_starts_with($mime, 'image/')) {
        return 'image';
    }
    if (str_starts_with($mime, 'video/')) {
        return 'video';
    }
    if (str_starts_with($mime, 'audio/')) {
        return 'audio';
    }
    return 'document';
}

/** Límites reales de WhatsApp Cloud API por tipo de adjunto. */
function wa_media_max_bytes(string $type): int
{
    return match ($type) {
        'image' => 5 * 1024 * 1024,
        'video', 'audio' => 16 * 1024 * 1024,
        default => 100 * 1024 * 1024,
    };
}

/** Sube un archivo local a Meta y devuelve su media_id, para referenciarlo al enviar el mensaje. */
function wa_upload_media(string $localPath, string $mime): string
{
    if (!wa_is_connected()) {
        throw new RuntimeException('WhatsApp no está configurado: falta el token o el ID del número.');
    }
    $url = wa_graph_url('/' . wa_config()['phone_number_id'] . '/media');
    $body = [
        'messaging_product' => 'whatsapp',
        'type'              => $mime,
        'file'              => new CURLFile($localPath, $mime),
    ];
    [$code, $raw] = wa_http('POST', $url, [wa_auth_header()], $body, 60);
    $resp = json_decode($raw, true) ?: [];
    if ($code < 200 || $code >= 300 || empty($resp['id'])) {
        throw new RuntimeException('Meta rechazó el archivo: ' . json_encode($resp, JSON_UNESCAPED_UNICODE));
    }
    return $resp['id'];
}

/** Resuelve la URL temporal (expira en minutos) de un media_id de Meta. */
function wa_fetch_media_meta(string $mediaId): array
{
    [$code, $raw] = wa_http('GET', wa_graph_url('/' . $mediaId), [wa_auth_header()], null, 30);
    $resp = json_decode($raw, true) ?: [];
    if ($code < 200 || $code >= 300 || empty($resp['url'])) {
        throw new RuntimeException('No se pudo obtener la URL del archivo en Meta.');
    }
    return $resp;
}

/**
 * Descarga un adjunto entrante y lo guarda en local. Las URLs de Meta expiran a
 * los pocos minutos, así que esto debe correr en cuanto llega el webhook, no
 * cuando alguien abra la conversación — de ahí que viva aparte de wa_send_media
 * y se llame directo desde whatsapp_webhook.php. Nunca lanza: si falla, el mensaje
 * igual se guarda (con media_id pero sin archivo local) y la bandeja lo muestra
 * como "no se pudo descargar" en vez de tronar la recepción del webhook.
 */
function wa_download_media(string $mediaId, ?string $suggestedFilename = null): ?array
{
    try {
        $meta = wa_fetch_media_meta($mediaId);
        [$code, $bytes] = wa_http('GET', $meta['url'], [wa_auth_header()], null, 60);
        if ($code < 200 || $code >= 300 || $bytes === '' || $bytes === false) {
            throw new RuntimeException('No se pudo descargar el archivo de Meta.');
        }
        $storedName = bin2hex(random_bytes(20));
        if (file_put_contents(wa_media_dir() . $storedName, $bytes) === false) {
            throw new RuntimeException('No se pudo guardar el archivo en el servidor.');
        }
        @chmod(wa_media_dir() . $storedName, 0644);
        return [
            'stored_name' => $storedName,
            'mime'        => $meta['mime_type'] ?? 'application/octet-stream',
            'size'        => (int)($meta['file_size'] ?? strlen($bytes)),
            'filename'    => $suggestedFilename,
        ];
    } catch (Throwable $e) {
        error_log('wa_download_media #' . $mediaId . ': ' . $e->getMessage());
        return null;
    }
}

/**
 * Envía un mensaje de adjunto ya subido a Meta (ver wa_upload_media) y archiva el
 * mensaje saliente con el archivo local, para mostrarlo en el chat sin depender de
 * la URL de Meta (que expira a los pocos minutos).
 */
function wa_send_media(
    string $waId,
    string $type,
    string $metaMediaId,
    ?string $caption,
    ?int $sentByUserId,
    int $conversationId,
    string $storedName,
    string $mime,
    int $size,
    ?string $filename
): array {
    $media = ['id' => $metaMediaId];
    // Audio y sticker no admiten caption en la API de Meta.
    if ($caption !== null && $caption !== '' && in_array($type, ['image', 'video', 'document'], true)) {
        $media['caption'] = $caption;
    }
    if ($type === 'document' && $filename) {
        $media['filename'] = $filename;
    }
    [$code, $resp] = wa_api_request('POST', '/messages', [
        'messaging_product' => 'whatsapp',
        'to'                => $waId,
        'type'              => $type,
        $type               => $media,
    ]);

    $ok = $code >= 200 && $code < 300;
    $waMessageId = $resp['messages'][0]['id'] ?? null;
    $error = $ok ? null : json_encode($resp, JSON_UNESCAPED_UNICODE);
    $now = date('Y-m-d H:i:s');

    db()->prepare(
        'INSERT INTO wa_messages
            (conversation_id, direction, wa_message_id, msg_type, body, media_id, media_mime, media_path, media_filename, media_size, status, error, sent_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $conversationId, 'out', $waMessageId, $type, ($caption !== '' ? $caption : null),
        $metaMediaId, $mime, $storedName, $filename, $size, $ok ? 'sent' : 'failed', $error, $sentByUserId, $now,
    ]);

    if ($ok) {
        db()->prepare('UPDATE wa_conversations SET last_message_at = ? WHERE id = ?')
            ->execute([$now, $conversationId]);
    }

    return ['ok' => $ok, 'wa_message_id' => $waMessageId, 'response' => $resp];
}

/** ¿Sigue abierta la ventana de 24h para responder con texto libre? */
function wa_within_session_window(array $conversation): bool
{
    if (empty($conversation['last_inbound_at'])) {
        return false;
    }
    $last = strtotime($conversation['last_inbound_at']);
    if ($last === false) {
        return false;
    }
    return (time() - $last) < 24 * 3600;
}

/** Busca un paciente activo por teléfono; solo enlaza si hay exactamente una coincidencia. */
function wa_find_patient_by_phone(string $phone): ?int
{
    $digits = preg_replace('/\D/', '', $phone);
    if ($digits === '' || strlen($digits) < 8) {
        return null;
    }
    $last10 = substr($digits, -10);
    $st = db()->prepare(
        "SELECT id FROM patients WHERE is_deleted = 0 AND (
            REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')','') LIKE ?
            OR REPLACE(REPLACE(REPLACE(REPLACE(mobile,' ',''),'-',''),'(',''),')','') LIKE ?
        )"
    );
    $like = '%' . $last10;
    $st->execute([$like, $like]);
    $rows = $st->fetchAll();
    return count($rows) === 1 ? (int)$rows[0]['id'] : null;
}

/**
 * ¿Está dentro del horario de atención? $schedule es el JSON guardado en
 * wa_auto_messages.schedule para el tipo 'away': {"days":{"mon":{"enabled":true,
 * "from":"09:00","to":"18:00"}, ...}}. Sin horario configurado = siempre "fuera"
 * (más seguro: si nadie configuró horas, se asume que el mensaje de ausencia
 * puede aplicar en cualquier momento en que esté activado).
 */
function wa_business_hours_open(?string $scheduleJson): bool
{
    if (!$scheduleJson) {
        return false;
    }
    $schedule = json_decode($scheduleJson, true);
    $days = $schedule['days'] ?? null;
    if (!is_array($days)) {
        return false;
    }
    $tz = new DateTimeZone(WA_TIMEZONE);
    $now = new DateTime('now', $tz);
    $dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    $today = $dayKeys[(int)$now->format('w')];
    $day = $days[$today] ?? null;
    if (!is_array($day) || empty($day['enabled'])) {
        return false;
    }
    $nowHm = $now->format('H:i');
    return $nowHm >= ($day['from'] ?? '00:00') && $nowHm <= ($day['to'] ?? '23:59');
}
