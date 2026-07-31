<?php
/**
 * Handler calendar: config de la conexión con Google Calendar (Admin Tools > API).
 * El secreto de cliente nunca se devuelve completo al navegador.
 */

require_once __DIR__ . '/../../includes/google_calendar.php';

function handle_calendar(string $action): void
{
    if (!is_admin_role(current_user())) {
        json_error('Esta configuración requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'get': {
            json_ok(['config' => gcal_public_config()]);
        }

        case 'save': {
            $b = request_body();
            // Si no se escribe un secreto nuevo, se conserva el guardado
            if (!array_key_exists('client_secret', $b) || trim((string)$b['client_secret']) === '') {
                unset($b['client_secret']);
            }
            gcal_save($b);
            log_activity('api', 'gcal_config', 'Actualizó la configuración de Google Calendar');
            json_ok(['config' => gcal_public_config()]);
        }

        case 'disconnect': {
            gcal_disconnect();
            log_activity('api', 'gcal_disconnect', 'Desconectó la cuenta de Google Calendar');
            json_ok(['config' => gcal_public_config()]);
        }
    }
}

/** Configuración sin exponer el secreto de cliente. */
function gcal_public_config(): array
{
    $cfg = gcal_config();
    $secret = (string)$cfg['client_secret'];
    return [
        'client_id'       => $cfg['client_id'],
        'has_secret'      => $secret !== '',
        'calendar_id'     => $cfg['calendar_id'],
        'connected'       => gcal_is_connected(),
        'connected_email' => $cfg['connected_email'],
        'redirect_uri'    => gcal_redirect_uri(),
    ];
}
