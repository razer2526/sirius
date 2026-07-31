<?php
/**
 * Config e integración con Google Calendar (cuenta única compartida).
 *
 * Una sola cuenta de Google (ej. la del equipo de recolección) se conecta una vez
 * por OAuth desde Admin Tools > API > Calendario. Sirius guarda el refresh_token y,
 * a partir de ahí, crea/edita/cancela eventos y sincroniza cambios hechos directo en
 * Google (vía cron con syncToken), sin que los invitados necesiten cuenta en Sirius.
 */

require_once __DIR__ . '/db.php';

const GCAL_AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GCAL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GCAL_API_ENDPOINT   = 'https://www.googleapis.com/calendar/v3';
const GCAL_SCOPE          = 'https://www.googleapis.com/auth/calendar';

function gcal_defaults(): array
{
    return [
        'client_id'     => '',
        'client_secret' => '',
        'calendar_id'   => 'primary',
        'refresh_token' => '',
        'access_token'  => '',
        'token_expires' => 0,     // epoch (segundos) de expiración del access_token
        'connected_email' => '',
        'sync_token'    => '',
    ];
}

function gcal_config(bool $refresh = false): array
{
    static $cfg = null;
    if ($cfg !== null && !$refresh) {
        return $cfg;
    }
    $cfg = gcal_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['google_calendar']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
            }
        }
    } catch (Throwable $e) {
        error_log('gcal_config: ' . $e->getMessage());
    }
    return $cfg;
}

function gcal_save(array $values): array
{
    $cfg = array_merge(gcal_config(), array_intersect_key($values, gcal_defaults()));
    $cfg['client_id'] = trim((string)$cfg['client_id']);
    $cfg['client_secret'] = trim((string)$cfg['client_secret']);
    $cfg['calendar_id'] = trim((string)$cfg['calendar_id']) ?: 'primary';
    $cfg['refresh_token'] = trim((string)$cfg['refresh_token']);
    $cfg['access_token'] = trim((string)$cfg['access_token']);
    $cfg['token_expires'] = (int)$cfg['token_expires'];
    $cfg['connected_email'] = trim((string)$cfg['connected_email']);
    $cfg['sync_token'] = trim((string)$cfg['sync_token']);

    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['google_calendar']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'google_calendar']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['google_calendar', $json]);
    }
    return gcal_config(true);
}

function gcal_is_connected(): bool
{
    $cfg = gcal_config();
    return $cfg['client_id'] !== '' && $cfg['client_secret'] !== '' && $cfg['refresh_token'] !== '';
}

function gcal_disconnect(): void
{
    $cfg = gcal_config();
    gcal_save([
        'refresh_token'   => '',
        'access_token'    => '',
        'token_expires'   => 0,
        'connected_email' => '',
        'sync_token'      => '',
        'client_id'       => $cfg['client_id'],
        'client_secret'   => $cfg['client_secret'],
        'calendar_id'     => $cfg['calendar_id'],
    ]);
}

/**
 * Ruta base de la app (donde vive index.php), sin importar si esta función se
 * invoca desde un script de la raíz (google_oauth.php) o desde api/index.php
 * (un nivel más adentro).
 */
function gcal_base_path(): string
{
    // OJO: dirname() en Windows devuelve '\' como separador; se evita por completo
    // y se trabaja el string a mano, ya que SCRIPT_NAME siempre usa '/' (es una ruta URL).
    $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
    $script = preg_replace('#/api/index\.php$#', '/index.php', $script);
    $pos = strrpos($script, '/');
    return $pos === false ? '' : substr($script, 0, $pos);
}

/** URI de redirección canónico: debe coincidir con el registrado en Google Cloud Console. */
function gcal_redirect_uri(): string
{
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return "$scheme://$host" . gcal_base_path() . '/google_oauth.php';
}

/** URL de autorización de Google para iniciar la conexión. */
function gcal_auth_url(string $state): string
{
    $cfg = gcal_config();
    $params = [
        'client_id'     => $cfg['client_id'],
        'redirect_uri'  => gcal_redirect_uri(),
        'response_type' => 'code',
        'scope'         => GCAL_SCOPE,
        'access_type'   => 'offline',
        'prompt'        => 'consent',
        'state'         => $state,
    ];
    return GCAL_AUTH_ENDPOINT . '?' . http_build_query($params);
}

/** Petición application/x-www-form-urlencoded al endpoint de tokens de Google. */
function gcal_token_request(array $params): array
{
    $body = http_build_query($params);
    $ch = curl_init(GCAL_TOKEN_ENDPOINT);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
    ]);
    $ca = (string)(app_config()['ca_bundle'] ?? '');
    if ($ca !== '' && is_file($ca)) {
        curl_setopt($ch, CURLOPT_CAINFO, $ca);
    }
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        throw new RuntimeException('No se pudo conectar con Google: ' . $err);
    }
    $data = json_decode($raw, true) ?: [];
    if ($code !== 200) {
        $detail = $data['error_description'] ?? $data['error'] ?? "código $code";
        throw new RuntimeException('Google rechazó la solicitud de token: ' . $detail);
    }
    return $data;
}

/** Intercambia el "code" del callback OAuth por tokens y guarda la conexión. */
function gcal_exchange_code(string $code): array
{
    $cfg = gcal_config();
    $data = gcal_token_request([
        'code'          => $code,
        'client_id'     => $cfg['client_id'],
        'client_secret' => $cfg['client_secret'],
        'redirect_uri'  => gcal_redirect_uri(),
        'grant_type'    => 'authorization_code',
    ]);
    if (empty($data['refresh_token'])) {
        throw new RuntimeException(
            'Google no devolvió un refresh_token. Si ya habías conectado esta cuenta antes, '
            . 'revócala en https://myaccount.google.com/permissions e intenta de nuevo.'
        );
    }
    gcal_save([
        'refresh_token' => $data['refresh_token'],
        'access_token'  => $data['access_token'] ?? '',
        'token_expires' => time() + (int)($data['expires_in'] ?? 3600) - 30,
    ]);

    // Identifica la cuenta conectada leyendo su calendario principal.
    try {
        $cal = gcal_api_request('GET', '/calendars/primary');
        if (!empty($cal['id'])) {
            gcal_save(['connected_email' => $cal['id']]);
        }
    } catch (Throwable $e) {
        error_log('gcal_exchange_code (calendars/primary): ' . $e->getMessage());
    }
    return gcal_config(true);
}

/** Devuelve un access_token vigente, refrescándolo con el refresh_token si hace falta. */
function gcal_ensure_access_token(): string
{
    $cfg = gcal_config();
    if ($cfg['refresh_token'] === '') {
        throw new RuntimeException('No hay una cuenta de Google Calendar conectada.');
    }
    if ($cfg['access_token'] !== '' && $cfg['token_expires'] > time()) {
        return $cfg['access_token'];
    }
    $data = gcal_token_request([
        'refresh_token' => $cfg['refresh_token'],
        'client_id'     => $cfg['client_id'],
        'client_secret' => $cfg['client_secret'],
        'grant_type'    => 'refresh_token',
    ]);
    $cfg = gcal_save([
        'access_token'  => $data['access_token'] ?? '',
        'token_expires' => time() + (int)($data['expires_in'] ?? 3600) - 30,
    ]);
    return $cfg['access_token'];
}

/**
 * Llamada genérica a la API de Google Calendar (autenticada con el access_token vigente).
 * $path es relativo a GCAL_API_ENDPOINT, ej. '/calendars/primary/events'.
 */
function gcal_api_request(string $method, string $path, ?array $payload = null, array $query = []): array
{
    $token = gcal_ensure_access_token();
    $url = GCAL_API_ENDPOINT . $path . ($query ? '?' . http_build_query($query) : '');
    $headers = ['Authorization: Bearer ' . $token];
    $body = $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $ca = (string)(app_config()['ca_bundle'] ?? '');
    if ($ca !== '' && is_file($ca)) {
        curl_setopt($ch, CURLOPT_CAINFO, $ca);
    }
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        throw new RuntimeException('No se pudo conectar con Google Calendar: ' . $err);
    }
    $data = $raw === '' ? [] : (json_decode($raw, true) ?? []);
    if ($code >= 300) {
        $detail = $data['error']['message'] ?? "código $code";
        throw new RuntimeException('Google Calendar rechazó la solicitud: ' . $detail);
    }
    return $data;
}
