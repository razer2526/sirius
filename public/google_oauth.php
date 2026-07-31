<?php
/**
 * Callback OAuth de Google Calendar. Google redirige aquí tanto al iniciar la
 * conexión (sin parámetros, lo abre el botón "Conectar cuenta") como al volver
 * con ?code=...&state=... una vez que el administrador autoriza el acceso.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/log.php';
require_once __DIR__ . '/includes/google_calendar.php';

session_boot();
$me = current_user();
if (!$me || !is_admin_role($me)) {
    http_response_code(403);
    exit('Acceso denegado. Inicia sesión como administrador y vuelve a intentarlo.');
}

function gcal_redirect_back(string $status, string $msg = ''): void
{
    $qs = http_build_query(array_filter(['gcal' => $status, 'msg' => $msg]));
    header('Location: index.php?' . $qs . '#/api/calendario');
    exit;
}

if (isset($_GET['error'])) {
    gcal_redirect_back('error', 'Autorización cancelada en Google.');
}

if (isset($_GET['code'])) {
    if (empty($_SESSION['gcal_oauth_state']) || ($_GET['state'] ?? '') !== $_SESSION['gcal_oauth_state']) {
        gcal_redirect_back('error', 'La solicitud expiró o no es válida. Intenta de nuevo.');
    }
    unset($_SESSION['gcal_oauth_state']);
    try {
        gcal_exchange_code((string)$_GET['code']);
        log_activity('api', 'gcal_connect', 'Conectó la cuenta de Google Calendar');
        gcal_redirect_back('ok');
    } catch (Throwable $e) {
        error_log('google_oauth.php: ' . $e->getMessage());
        gcal_redirect_back('error', $e->getMessage());
    }
}

// Sin "code" ni "error": es el arranque del flujo desde el botón "Conectar cuenta".
$cfg = gcal_config();
if ($cfg['client_id'] === '' || $cfg['client_secret'] === '') {
    gcal_redirect_back('error', 'Captura y guarda el ID y el secreto de cliente antes de conectar.');
}
$state = bin2hex(random_bytes(16));
$_SESSION['gcal_oauth_state'] = $state;
header('Location: ' . gcal_auth_url($state));
exit;
