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

/** Copia interna que siempre debe llegar, sin importar la configuración — así
 *  lo pidió el negocio, y así lo hacía el sistema anterior (id.bosquespolanco.com). */
const MAIL_FIXED_BCC = 'id@bosquespolanco.com';

/** Máximo de correos adicionales (además del fijo) en 'always_bcc'. */
const MAIL_EXTRA_BCC_LIMIT = 2;

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
        // Correos adicionales que reciben copia de toda ficha enviada, además
        // del fijo (MAIL_FIXED_BCC) — separados por coma, ver mail_bcc_addresses().
        'always_bcc'  => '',
        // Texto del correo de la ficha. Vacío = el texto original (ver ficha_email_defaults()).
        'ficha_subject'   => '',
        'ficha_message'   => '',
        'ficha_signature' => '',
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
    // Texto del correo de la ficha: asunto de una línea (sin saltos: serían inyección de cabeceras),
    // mensaje y firma de varias. Vacío = volver al texto original.
    if (array_key_exists('ficha_subject', $values)) {
        $cfg['ficha_subject'] = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)$values['ficha_subject'])), 0, 200);
    }
    foreach (['ficha_message' => 3000, 'ficha_signature' => 1000] as $k => $max) {
        if (array_key_exists($k, $values)) {
            $text = str_replace(["\r\n", "\r"], "\n", (string)$values[$k]);
            $cfg[$k] = mb_substr(trim($text), 0, $max);
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
    $bcc = mail_bcc_addresses();
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

        $mailText = ficha_email_render([
            'paciente' => $name,
            'folio'    => (string)($episode['service_folio'] ?? ''),
            'clinica'  => ficha_clinic_name(),
        ]);
        mail_send(
            $to,
            $mailText['subject'],
            $mailText['html'],
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

/** Variables que se pueden usar en el asunto, el mensaje y la firma del correo de la ficha. */
const FICHA_EMAIL_VARS = [
    '{paciente}' => 'Nombre completo del paciente',
    '{folio}'    => 'Folio de la orden',
    '{clinica}'  => 'Nombre de la clínica',
];

/** Texto original del correo de la ficha (lo que se envía si no se personaliza). */
function ficha_email_defaults(): array
{
    return [
        'ficha_subject'   => 'Ficha de identificación · {paciente}',
        'ficha_message'   => "Estimado(a) {paciente}:\n\n"
            . "Le hacemos llegar su ficha de identificación y el acuse del pago correspondiente a su estudio.\n\n"
            . 'Sin más por el momento, seguimos a sus órdenes.',
        'ficha_signature' => "Laboratorio Clínico Bosques Polanco\n"
            . "¿Tienes alguna duda? Contáctanos.\n"
            . '55 4757 8535 · 55 2999 7408 · 55 5374 6320',
    ];
}

/** Textos vigentes: lo guardado, o el original si está vacío. */
function ficha_email_texts(): array
{
    $cfg = mail_config();
    $out = [];
    foreach (ficha_email_defaults() as $k => $default) {
        $out[$k] = trim((string)($cfg[$k] ?? '')) !== '' ? (string)$cfg[$k] : $default;
    }
    return $out;
}

/** Sustituye {paciente}, {folio} y {clinica} (texto plano, sin escapar). */
function ficha_email_fill(string $text, array $vars): string
{
    $map = [];
    foreach (array_keys(FICHA_EMAIL_VARS) as $token) {
        $key = trim($token, '{}');
        $map[$token] = trim((string)($vars[$key] ?? ''));
    }
    if ($map['{paciente}'] === '') {
        $map['{paciente}'] = 'paciente';
    }
    return strtr($text, $map);
}

/** Texto plano → HTML seguro: escapa, párrafos por línea en blanco, saltos simples como <br>. */
function ficha_email_paragraphs(string $text): string
{
    $out = [];
    foreach (preg_split('/\n{2,}/', trim($text)) as $para) {
        $para = trim($para);
        if ($para !== '') {
            $out[] = '<p>' . str_replace("\n", '<br>', htmlspecialchars($para, ENT_QUOTES, 'UTF-8')) . '</p>';
        }
    }
    return implode('', $out);
}

/** Firma: la primera línea en negrita; teléfonos (55 1234 5678) y correos se vuelven enlaces. */
function ficha_email_signature_html(string $text): string
{
    $lines = preg_split('/\n/', trim($text));
    $html = [];
    foreach ($lines as $i => $line) {
        $line = htmlspecialchars(trim($line), ENT_QUOTES, 'UTF-8');
        $link = 'style="color:#4f46e5;text-decoration:none"';
        $line = preg_replace_callback('/(?<!\d)(\d{2}) (\d{4}) (\d{4})(?!\d)/', static function ($m) use ($link) {
            return '<a href="tel:' . $m[1] . $m[2] . $m[3] . '" ' . $link . '>' . $m[0] . '</a>';
        }, $line);
        $line = preg_replace('/(?<![\w.@">])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/', '<a href="mailto:$1" ' . $link . '>$1</a>', $line);
        $html[] = $i === 0 ? '<b>' . $line . '</b>' : $line;
    }
    return implode('<br>', $html);
}

/**
 * Asunto y cuerpo HTML del correo de la ficha, con los textos personalizados (o los originales).
 * @param array{paciente?:string, folio?:string, clinica?:string} $vars
 * @return array{subject:string, html:string}
 */
function ficha_email_render(array $vars, ?array $texts = null): array
{
    $t = $texts ?? ficha_email_texts();
    // El asunto es una cabecera: nada de saltos de línea.
    $subject = trim(preg_replace('/\s+/u', ' ', ficha_email_fill($t['ficha_subject'], $vars)));
    $message = ficha_email_paragraphs(ficha_email_fill($t['ficha_message'], $vars));
    $signature = ficha_email_signature_html(ficha_email_fill($t['ficha_signature'], $vars));

    $html = '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
        . $message
        . '<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">'
        . '<p style="font-size:13px;color:#6b7280">' . $signature . '</p></div>';
    return ['subject' => $subject !== '' ? $subject : 'Ficha de identificación', 'html' => $html];
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

/** Divide una lista de correos separados por coma (tal como se captura en
 *  Admin Tools > API > Correo) y descarta los inválidos. */
function mail_split_addresses(string $raw): array
{
    return mail_valid_addresses(explode(',', $raw));
}

/** Copia interna completa de toda ficha enviada: el fijo (MAIL_FIXED_BCC) más
 *  los correos adicionales configurados en 'always_bcc'. */
function mail_bcc_addresses(): array
{
    $extra = mail_split_addresses((string)mail_config()['always_bcc']);
    return mail_valid_addresses(array_merge([MAIL_FIXED_BCC], $extra));
}
