<?php
/**
 * Envío de correo saliente (fichas de identificación, avisos).
 *
 * Se envía por SMTP autenticado con la cuenta del dominio, no con mail(): en
 * hosting compartido mail() cae en spam con frecuencia y su valor de retorno
 * solo indica que el mensaje se entregó al servidor local, no que haya llegado.
 *
 * Todo pasa por mail_send(), así que cambiar de proveedor (un servicio
 * transaccional, por ejemplo) es reemplazar esa función y nada más.
 */

require_once __DIR__ . '/db.php';

function mail_defaults(): array
{
    return [
        'enabled'     => false,
        'host'        => '',
        'port'        => 465,
        'secure'      => 'ssl',          // 'ssl' | 'tls' | ''
        'username'    => '',
        'password'    => '',
        'from_email'  => '',
        'from_name'   => 'Laboratorio Clínico Bosques Polanco',
        'reply_to'    => '',
        // Copia interna de todo lo que sale; el sistema anterior mandaba
        // siempre una copia a la cuenta de identificación
        'always_bcc'  => '',
    ];
}

function mail_config(bool $refresh = false): array
{
    static $cfg = null;
    if ($cfg !== null && !$refresh) {
        return $cfg;
    }
    $cfg = mail_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['mail']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
            }
        }
    } catch (Throwable $e) {
        error_log('mail_config: ' . $e->getMessage());
    }
    return $cfg;
}

function mail_save(array $values): array
{
    $cfg = mail_config();
    foreach (['host', 'username', 'from_email', 'from_name', 'reply_to', 'always_bcc'] as $k) {
        if (array_key_exists($k, $values)) {
            $cfg[$k] = mb_substr(trim((string)$values[$k]), 0, 190);
        }
    }
    // Vacío conserva la contraseña guardada, igual que la llave del asistente
    if (array_key_exists('password', $values) && trim((string)$values['password']) !== '') {
        $cfg['password'] = trim((string)$values['password']);
    }
    $cfg['enabled'] = !empty($values['enabled']);
    if (array_key_exists('port', $values)) {
        $port = (int)$values['port'];
        $cfg['port'] = ($port > 0 && $port < 65536) ? $port : 465;
    }
    if (array_key_exists('secure', $values)) {
        $cfg['secure'] = in_array($values['secure'], ['ssl', 'tls', ''], true) ? $values['secure'] : 'ssl';
    }
    if ($cfg['from_email'] === '' && $cfg['username'] !== '') {
        $cfg['from_email'] = $cfg['username'];
    }

    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['mail']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'mail']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['mail', $json]);
    }
    return mail_config(true);
}

function mail_is_ready(): bool
{
    $cfg = mail_config();
    return !empty($cfg['enabled']) && $cfg['host'] !== '' && $cfg['username'] !== '' && $cfg['from_email'] !== '';
}

/**
 * Envía un correo HTML con adjuntos opcionales.
 *
 * $to          lista de destinatarios (los vacíos o mal formados se descartan)
 * $attachments [['name' => 'ficha.pdf', 'data' => <binario>, 'type' => 'application/pdf'], …]
 *
 * Lanza RuntimeException si falla, para que quien llama decida qué hacer. En el
 * alta de una admisión, por ejemplo, el fallo se registra pero no aborta nada.
 */
function mail_send(array $to, string $subject, string $htmlBody, array $attachments = []): bool
{
    require_once __DIR__ . '/../vendor/phpmailer/Exception.php';
    require_once __DIR__ . '/../vendor/phpmailer/PHPMailer.php';
    require_once __DIR__ . '/../vendor/phpmailer/SMTP.php';

    $cfg = mail_config();
    if (!mail_is_ready()) {
        throw new RuntimeException('El correo saliente no está configurado. Actívalo en Admin Tools > API > Correo.');
    }

    $recipients = mail_valid_addresses($to);
    $bcc = mail_valid_addresses([$cfg['always_bcc']]);
    if (!$recipients && !$bcc) {
        throw new RuntimeException('No hay destinatarios válidos.');
    }

    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = $cfg['host'];
        $mail->Port       = (int)$cfg['port'];
        $mail->SMTPAuth   = true;
        $mail->Username   = $cfg['username'];
        $mail->Password   = $cfg['password'];
        $mail->SMTPSecure = $cfg['secure'] ?: false;
        $mail->CharSet    = 'UTF-8';
        $mail->Timeout    = 20;

        $ca = (string)(app_config()['ca_bundle'] ?? '');
        if ($ca !== '' && is_file($ca)) {
            $mail->SMTPOptions = ['ssl' => ['cafile' => $ca]];
        }

        $mail->setFrom($cfg['from_email'], $cfg['from_name']);
        if ($cfg['reply_to'] !== '') {
            $mail->addReplyTo($cfg['reply_to']);
        }
        foreach ($recipients as $addr) {
            $mail->addAddress($addr);
        }
        foreach ($bcc as $addr) {
            // Si no hay destinatario externo, la copia interna pasa a ser el destinatario
            $recipients ? $mail->addBCC($addr) : $mail->addAddress($addr);
        }

        foreach ($attachments as $a) {
            $mail->addStringAttachment(
                $a['data'] ?? '',
                $a['name'] ?? 'adjunto.pdf',
                PHPMailer\PHPMailer\PHPMailer::ENCODING_BASE64,
                $a['type'] ?? 'application/pdf'
            );
        }

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;
        $mail->AltBody = trim(html_entity_decode(strip_tags(preg_replace('#<br\s*/?>|</p>#i', "\n", $htmlBody)), ENT_QUOTES, 'UTF-8'));

        $mail->send();
        return true;
    } catch (Throwable $e) {
        // ErrorInfo trae el diálogo SMTP, mucho más útil que el mensaje de la excepción
        throw new RuntimeException($mail->ErrorInfo ?: $e->getMessage());
    }
}

/**
 * Genera la ficha de una admisión y se la manda al paciente.
 *
 * Nunca lanza: quien la llama es el alta de una admisión, y una falla de correo
 * (servidor caído, dirección mal escrita) jamás debe impedir registrar al paciente
 * que está enfrente. Devuelve el resultado para que la interfaz lo muestre, y deja
 * el detalle en la bitácora para poder reenviar después.
 *
 * $force ignora el interruptor de "envío activo" (se usa en el reenvío manual).
 */
function ficha_send_email(int $episodeId, bool $force = false): array
{
    require_once __DIR__ . '/pdf_document.php';
    require_once __DIR__ . '/log.php';

    $result = ['sent' => false, 'to' => '', 'error' => ''];
    try {
        if (!mail_is_ready()) {
            $result['error'] = $force
                ? 'El correo saliente no está configurado. Actívalo en Admin Tools > API > Correo.'
                : '';
            return $result;
        }

        $episode = ficha_load_episode($episodeId);
        if (!$episode) {
            $result['error'] = 'Admisión no encontrada';
            return $result;
        }
        $st = db()->prepare('SELECT * FROM patients WHERE id = ?');
        $st->execute([(int)$episode['patient_id']]);
        $patient = $st->fetch();
        if (!$patient) {
            $result['error'] = 'Paciente no encontrado';
            return $result;
        }

        $name = trim(($patient['first_name'] ?? '') . ' ' . ($patient['paternal_surname'] ?? '') . ' ' . ($patient['maternal_surname'] ?? ''));
        $pdf = render_ficha_pdf($episode, $patient, ficha_study_lines($episodeId), ficha_clinic_name());

        $to = mail_valid_addresses([$patient['email'] ?? '']);
        $result['to'] = implode(', ', $to);

        // Sin correo del paciente y sin copia interna no hay a quién mandarle: es una
        // situación normal (muchos pacientes mayores no tienen correo), no una falla
        if (!$to && !mail_valid_addresses([mail_config()['always_bcc']])) {
            $result['error'] = $force ? 'El paciente no tiene correo y no hay copia interna configurada.' : '';
            return $result;
        }

        mail_send(
            $to,
            'Ficha de identificación · ' . $name,
            ficha_email_body($name),
            [['name' => 'Ficha ID ' . ficha_slug($name) . '.pdf', 'data' => $pdf, 'type' => 'application/pdf']]
        );

        $result['sent'] = true;
        log_activity('admision', 'ficha_sent', 'Envió la ficha por correo'
            . ($result['to'] !== '' ? ' a ' . $result['to'] : ' (solo copia interna)'), 'episode', $episodeId);
    } catch (Throwable $e) {
        $result['error'] = $e->getMessage();
        error_log('ficha_send_email: ' . $e->getMessage());
        try {
            log_activity('admision', 'ficha_mail_failed', 'No se pudo enviar la ficha: ' . mb_substr($e->getMessage(), 0, 160), 'episode', $episodeId);
        } catch (Throwable $ignored) {
        }
    }
    return $result;
}

/** Cuerpo HTML del correo al paciente. */
function ficha_email_body(string $patientName): string
{
    $cfg = mail_config();
    $name = htmlspecialchars($patientName, ENT_QUOTES, 'UTF-8');
    $from = htmlspecialchars($cfg['from_name'], ENT_QUOTES, 'UTF-8');

    return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
        . '<p>Estimado(a) ' . ($name !== '' ? $name : 'paciente') . ':</p>'
        . '<p>Le hacemos llegar su ficha de identificación y el acuse del pago correspondiente a su estudio.</p>'
        . '<p>Sin más por el momento, seguimos a sus órdenes.</p>'
        . '<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">'
        . '<p style="font-size:13px;color:#6b7280">'
        . '<b>' . $from . '</b><br>'
        . '¿Tienes alguna duda? Contáctanos.<br>'
        . '<a href="tel:5547578535" style="color:#4f46e5;text-decoration:none">55 4757 8535</a> · '
        . '<a href="tel:5529997408" style="color:#4f46e5;text-decoration:none">55 2999 7408</a> · '
        . '<a href="tel:5553746320" style="color:#4f46e5;text-decoration:none">55 5374 6320</a>'
        . '</p></div>';
}

/** Descarta direcciones vacías o mal formadas en vez de hacer fallar el envío completo. */
function mail_valid_addresses(array $list): array
{
    $out = [];
    foreach ($list as $addr) {
        $addr = trim((string)$addr);
        if ($addr !== '' && filter_var($addr, FILTER_VALIDATE_EMAIL) && !in_array($addr, $out, true)) {
            $out[] = $addr;
        }
    }
    return $out;
}
