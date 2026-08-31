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
 * Petición HTTP a la Graph API de Meta. $path es relativo al phone_number_id
 * configurado (ej. '/messages'); pasar $path = '' apunta al propio recurso del
 * número (útil para probar la conexión). Devuelve [código, cuerpo decodificado].
 */
function wa_api_request(string $method, string $path, ?array $body = null, int $timeout = 30): array
{
    $cfg = wa_config();
    if (!wa_is_connected()) {
        throw new RuntimeException('WhatsApp no está configurado: falta el token o el ID del número.');
    }
    $url = WA_GRAPH_ENDPOINT . '/' . $cfg['api_version'] . '/' . $cfg['phone_number_id'] . $path;
    $headers = ['Authorization: Bearer ' . $cfg['access_token']];
    $payload = $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE);
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
    }

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
        if ($payload !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
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
    } else {
        // Respaldo si cURL no está compilado en el servidor
        $ctx = stream_context_create(['http' => [
            'method'        => $method,
            'header'        => implode("\r\n", $headers),
            'content'       => $payload,
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
    }
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
