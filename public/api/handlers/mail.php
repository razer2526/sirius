<?php
/**
 * Handler mail: configuración del correo saliente (Admin Tools > API > Correo).
 * La contraseña nunca se devuelve al navegador: solo se indica si existe.
 */

require_once __DIR__ . '/../../includes/mailer.php';

function handle_mail(string $action): void
{
    if (!is_admin_role(current_user())) {
        json_error('Esta configuración requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'get': {
            json_ok(['config' => mail_public_config()]);
        }

        case 'save': {
            $cfg = mail_save(request_body());
            log_activity('api', 'mail_config', 'Actualizó la configuración de correo'
                . ($cfg['enabled'] ? ' (activo)' : ' (inactivo)'));
            json_ok(['config' => mail_public_config()]);
        }

        /** Envía un correo real: es la única forma de saber que la cuenta funciona. */
        case 'test': {
            $b = request_body();
            $to = trim((string)($b['to'] ?? ''));
            if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
                json_error('Escribe un correo válido para la prueba', 422);
            }
            try {
                mail_send(
                    [$to],
                    'Prueba de correo · Sirius',
                    '<p>Si estás leyendo esto, el correo saliente de Sirius quedó bien configurado.</p>'
                    . '<p style="color:#6b7280;font-size:13px">Mensaje de prueba enviado desde Admin Tools &gt; API &gt; Correo.</p>'
                );
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            log_activity('api', 'mail_test', "Envió correo de prueba a $to");
            json_ok(['sent' => true, 'to' => $to]);
        }
    }
}

/** Configuración sin exponer la contraseña. */
function mail_public_config(): array
{
    $cfg = mail_config();
    $pass = (string)$cfg['password'];
    $cfg['password'] = '';
    $cfg['has_password'] = $pass !== '';
    return $cfg;
}
