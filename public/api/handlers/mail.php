<?php
/**
 * Handler mail: configuración del correo saliente (Admin Tools > API > Correo).
 * La contraseña nunca se devuelve al navegador: solo se indica si existe.
 */

require_once __DIR__ . '/../../includes/mailer.php';
require_once __DIR__ . '/../../includes/pdf_document.php';   // ficha_clinic_name()

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
            $body = request_body();
            if (trim((string)($body['always_bcc'] ?? '')) !== '') {
                $extra = array_map('trim', explode(',', (string)$body['always_bcc']));
                if (count($extra) > MAIL_EXTRA_BCC_LIMIT) {
                    json_error('Máximo ' . MAIL_EXTRA_BCC_LIMIT . ' correos adicionales, separados por coma', 422);
                }
                foreach ($extra as $addr) {
                    if ($addr !== '' && !filter_var($addr, FILTER_VALIDATE_EMAIL)) {
                        json_error('Correo inválido: ' . $addr, 422);
                    }
                }
            }
            $cfg = mail_save($body);
            log_activity('api', 'mail_config', 'Actualizó la configuración de correo'
                . ($cfg['enabled'] ? ' (activo)' : ' (inactivo)'));
            json_ok(['config' => mail_public_config()]);
        }

        /**
         * Vista previa del correo de la ficha con los textos que se están escribiendo (aún sin guardar)
         * y datos de ejemplo. El HTML lo arma el servidor —es el mismo que se envía— y sale ya escapado.
         */
        case 'preview': {
            $b = request_body();
            json_ok(['mail' => ficha_email_preview_render($b)]);
        }

        /** Envía un correo real: es la única forma de saber que la cuenta funciona. */
        case 'test': {
            $b = request_body();
            $to = trim((string)($b['to'] ?? ''));
            if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
                json_error('Escribe un correo válido para la prueba', 422);
            }
            try {
                if (!empty($b['ficha'])) {
                    // Prueba del mensaje de la ficha (con los textos guardados y datos de ejemplo, sin adjunto)
                    $m = ficha_email_render(ficha_email_sample());
                    mail_send([$to], '[Prueba] ' . $m['subject'], $m['html']);
                } else {
                    mail_send(
                        [$to],
                        'Prueba de correo · Sirius',
                        '<p>Si estás leyendo esto, el correo saliente de Sirius quedó bien configurado.</p>'
                        . '<p style="color:#6b7280;font-size:13px">Mensaje de prueba enviado desde Admin Tools &gt; API &gt; Correo.</p>'
                    );
                }
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            log_activity('api', 'mail_test', "Envió correo de prueba a $to" . (!empty($b['ficha']) ? ' (mensaje de la ficha)' : ''));
            json_ok(['sent' => true, 'to' => $to]);
        }
    }
}

/** Datos de ejemplo para la vista previa y la prueba del mensaje de la ficha. */
function ficha_email_sample(): array
{
    return ['paciente' => 'María Pérez López', 'folio' => '261009-01', 'clinica' => ficha_clinic_name()];
}

/** Vista previa con los textos recibidos (sin guardarlos): mismos límites y reglas que mail_save(). */
function ficha_email_preview_render(array $b): array
{
    $texts = ficha_email_defaults();
    foreach (['ficha_subject' => 200, 'ficha_message' => 3000, 'ficha_signature' => 1000] as $k => $max) {
        $v = str_replace(["\r\n", "\r"], "\n", trim((string)($b[$k] ?? '')));
        if ($v !== '') {
            $texts[$k] = mb_substr($v, 0, $max);
        }
    }
    return ficha_email_render(ficha_email_sample(), $texts);
}

/** Configuración sin exponer la contraseña. */
function mail_public_config(): array
{
    $cfg = mail_config();
    // La interfaz muestra lo que de verdad se envía: lo guardado o el texto original.
    $cfg = array_merge($cfg, ficha_email_texts());
    $cfg['ficha_defaults'] = ficha_email_defaults();
    $cfg['ficha_vars'] = FICHA_EMAIL_VARS;
    $pass = (string)$cfg['password'];
    $cfg['password'] = '';
    $cfg['has_password'] = $pass !== '';
    return $cfg;
}
