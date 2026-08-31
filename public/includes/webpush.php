<?php
/**
 * Web Push sin librería externa: solo lo que hace falta para autenticar con VAPID
 * (RFC 8292) y entregar un push VACÍO (sin cuerpo cifrado). El evento 'push' del
 * service worker despierta al navegador y de ahí pide el contenido real a
 * push/pending con la sesión ya activa — así se evita implementar el cifrado
 * aes128gcm del payload (RFC 8291), que es la parte más propensa a errores de
 * cualquier implementación casera de Web Push, sin perder nada: la notificación
 * que ve la persona sí trae título y cuerpo reales, solo que se piden aparte.
 *
 * Las llaves VAPID (un par de llaves EC en la curva P-256) se generan una sola
 * vez y se guardan en settings, igual que la llave de la IA.
 */

require_once __DIR__ . '/db.php';

function webpush_vapid_keys(): array
{
    static $keys = null;
    if ($keys !== null) {
        return $keys;
    }
    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute(['vapid']);
    $row = $st->fetch();
    $saved = $row && $row['svalue'] ? json_decode($row['svalue'], true) : null;
    if (is_array($saved) && !empty($saved['private_pem']) && !empty($saved['public_key'])) {
        $keys = $saved;
        return $keys;
    }

    $keys = webpush_generate_vapid_keys();
    $exists = db()->prepare('SELECT 1 FROM settings WHERE skey = ?');
    $exists->execute(['vapid']);
    if ($exists->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([json_encode($keys), 'vapid']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['vapid', json_encode($keys)]);
    }
    return $keys;
}

/** Par de llaves EC P-256. La pública se manda al navegador en formato "raw" sin
 *  comprimir (0x04 + X + Y, 65 bytes) codificado en base64url, que es lo que
 *  pushManager.subscribe() espera en applicationServerKey. */
function webpush_generate_vapid_keys(): array
{
    $res = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if ($res === false) {
        throw new RuntimeException('No se pudo generar el par de llaves VAPID (OpenSSL sin soporte de curvas EC).');
    }
    openssl_pkey_export($res, $privatePem);
    $details = openssl_pkey_get_details($res);
    $x = webpush_fixed32((string)$details['ec']['x']);
    $y = webpush_fixed32((string)$details['ec']['y']);
    return [
        'private_pem' => $privatePem,
        'public_key'  => webpush_base64url_encode("\x04" . $x . $y),
    ];
}

/** Envía un push vacío (sin payload) autenticado con VAPID. Devuelve el código
 *  HTTP del servicio de push (200-201/202 = entregado o encolado; 404/410 =
 *  suscripción muerta, hay que borrarla). */
function webpush_send(string $endpoint, string $subject): int
{
    $keys = webpush_vapid_keys();
    $parsed = parse_url($endpoint);
    if (!$parsed || empty($parsed['host'])) {
        return 0;
    }
    $audience = $parsed['scheme'] . '://' . $parsed['host'] . (isset($parsed['port']) ? ':' . $parsed['port'] : '');
    $jwt = webpush_vapid_jwt($audience, $subject, $keys['private_pem']);

    $headers = [
        'Authorization: vapid t=' . $jwt . ', k=' . $keys['public_key'],
        'TTL: 86400',
        'Content-Length: 0',
    ];

    if (function_exists('curl_init')) {
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => '',
        ]);
        $ca = (string)(app_config()['ca_bundle'] ?? '');
        if ($ca !== '' && is_file($ca)) {
            curl_setopt($ch, CURLOPT_CAINFO, $ca);
        }
        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $code;
    }

    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => implode("\r\n", $headers),
        'content' => '',
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    @file_get_contents($endpoint, false, $ctx);
    foreach (($http_response_header ?? []) as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) {
            return (int)$m[1];
        }
    }
    return 0;
}

/** JWT ES256 firmado con la llave privada VAPID. */
function webpush_vapid_jwt(string $audience, string $subject, string $privatePem): string
{
    $header = webpush_base64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256'], JSON_UNESCAPED_SLASHES));
    $claims = webpush_base64url_encode(json_encode(
        ['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $subject],
        JSON_UNESCAPED_SLASHES
    ));
    $signingInput = "$header.$claims";

    $key = openssl_pkey_get_private($privatePem);
    if ($key === false || !openssl_sign($signingInput, $der, $key, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('No se pudo firmar el JWT de VAPID.');
    }
    $signature = webpush_base64url_encode(webpush_der_to_jose_signature($der));
    return "$signingInput.$signature";
}

/**
 * openssl_sign() con una llave EC produce la firma en DER (ASN.1). El estándar
 * JOSE que exige un JWT ES256 (RFC 7518) es distinto: R y S concatenados, cada
 * uno de 32 bytes fijos ("raw"). Sin esta conversión, todo push se firma con un
 * JWT que ningún navegador acepta, y falla en silencio.
 *
 * Válido específicamente para P-256: la firma DER siempre cabe en longitud
 * corta de ASN.1 (un byte), así que no hace falta un parser genérico.
 */
function webpush_der_to_jose_signature(string $der): string
{
    $pos = 0;
    if (ord($der[$pos++]) !== 0x30) {
        throw new RuntimeException('Firma DER inválida (secuencia).');
    }
    $seqLen = ord($der[$pos++]);
    if ($seqLen & 0x80) {
        throw new RuntimeException('Firma DER con longitud extendida inesperada.');
    }
    if (ord($der[$pos++]) !== 0x02) {
        throw new RuntimeException('Firma DER inválida (r).');
    }
    $rLen = ord($der[$pos++]);
    $r = substr($der, $pos, $rLen);
    $pos += $rLen;
    if (ord($der[$pos++]) !== 0x02) {
        throw new RuntimeException('Firma DER inválida (s).');
    }
    $sLen = ord($der[$pos++]);
    $s = substr($der, $pos, $sLen);

    return webpush_fixed32($r) . webpush_fixed32($s);
}

/** Quita el 0x00 de signo de ASN.1 si lo trae, y rellena a 32 bytes por la izquierda. */
function webpush_fixed32(string $bin): string
{
    $bin = ltrim($bin, "\x00");
    if (strlen($bin) > 32) {
        $bin = substr($bin, -32);
    }
    return str_pad($bin, 32, "\x00", STR_PAD_LEFT);
}

function webpush_base64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/** Identifica al remitente ante el servicio de push (RFC 8292 exige "sub"): el
 *  origen de la petición actual, o el dominio de producción si se llama desde
 *  un cron (sin $_SERVER['HTTP_HOST']). */
function webpush_subject(): string
{
    if (!empty($_SERVER['HTTP_HOST'])) {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        return $scheme . '://' . $_SERVER['HTTP_HOST'];
    }
    return 'https://sirius-bpm.com';
}

/**
 * Punto de entrada para el resto de la app: registra la notificación (para que
 * push/pending la entregue) y despierta cada dispositivo suscrito de ese usuario
 * con un push vacío. Las suscripciones que el navegador ya dio de baja
 * (404/410) se limpian solas.
 */
function webpush_notify(int $userId, string $title, string $body, ?string $url = null): void
{
    $pdo = db();
    $pdo->prepare('INSERT INTO notifications (user_id, title, body, url) VALUES (?, ?, ?, ?)')
        ->execute([$userId, mb_substr($title, 0, 200), mb_substr($body, 0, 500), $url]);

    $st = $pdo->prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?');
    $st->execute([$userId]);
    $subject = webpush_subject();
    foreach ($st->fetchAll() as $sub) {
        try {
            $code = webpush_send($sub['endpoint'], $subject);
        } catch (Throwable $e) {
            error_log('webpush_notify: ' . $e->getMessage());
            continue;
        }
        if (in_array($code, [404, 410], true)) {
            $pdo->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([$sub['id']]);
        }
    }
}

/**
 * Como webpush_notify() pero para avisos sin un solo destinatario natural (ej.
 * "nueva nota en el pizarrón público"): notifica a todos los usuarios con acceso
 * al módulo (mismo criterio que user_can() — administradores, o con fila explícita
 * en user_permissions), menos a quien disparó la acción.
 */
function notify_module_users(string $moduleKey, string $title, string $body, ?string $url, ?int $excludeUserId = null): void
{
    $st = db()->prepare(
        "SELECT id FROM users WHERE is_active = 1 AND (
            role IN ('administrador','developper')
            OR id IN (SELECT user_id FROM user_permissions WHERE module_key = ?)
        )"
    );
    $st->execute([$moduleKey]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        $uid = (int)$uid;
        if ($uid === $excludeUserId) {
            continue;
        }
        try {
            webpush_notify($uid, $title, $body, $url);
        } catch (Throwable $e) {
            error_log('notify_module_users: ' . $e->getMessage());
        }
    }
}
