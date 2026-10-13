<?php
/**
 * Pruebas del correo de la ficha (asunto, mensaje y firma personalizables).
 * Se incluye desde tests/run.php (comparte su base SQLite temporal).
 */

require_once SIRIUS_PUBLIC . '/includes/mailer.php';

echo "\nCorreo de la ficha\n";

test('sin personalizar, el correo conserva el texto original', function () {
    mail_save(['ficha_subject' => '', 'ficha_message' => '', 'ficha_signature' => '']);
    $m = ficha_email_render(['paciente' => 'María Pérez', 'folio' => '261009-01', 'clinica' => 'Clínica X']);
    eq('Ficha de identificación · María Pérez', $m['subject']);
    ok(str_contains($m['html'], 'Estimado(a) María Pérez:'));
    ok(str_contains($m['html'], 'seguimos a sus órdenes'));
    ok(str_contains($m['html'], '<b>Laboratorio Clínico Bosques Polanco</b>'), 'primera línea de la firma en negrita');
    ok(str_contains($m['html'], 'href="tel:5547578535"'), 'los teléfonos de la firma son enlaces');
});

test('asunto, mensaje y firma personalizados se guardan y reemplazan las variables', function () {
    mail_save([
        'ficha_subject'   => 'Orden {folio} de {paciente} · {clinica}',
        'ficha_message'   => "Hola {paciente}:\n\nAdjuntamos tu ficha.\nGracias.",
        'ficha_signature' => "Equipo de {clinica}\nescríbenos a citas@ejemplo.mx o al 55 1111 2222",
    ]);
    $m = ficha_email_render(['paciente' => 'Ana Ruiz', 'folio' => '261009-07', 'clinica' => 'Bosques']);
    eq('Orden 261009-07 de Ana Ruiz · Bosques', $m['subject']);
    ok(str_contains($m['html'], '<p>Hola Ana Ruiz:</p>'), 'párrafos por línea en blanco');
    ok(str_contains($m['html'], 'Adjuntamos tu ficha.<br>Gracias.'), 'salto simple como <br>');
    ok(str_contains($m['html'], '<b>Equipo de Bosques</b>'));
    ok(str_contains($m['html'], 'href="mailto:citas@ejemplo.mx"'));
    ok(str_contains($m['html'], 'href="tel:5511112222"'));
    ok(!str_contains($m['html'], 'seguimos a sus órdenes'), 'ya no queda el texto original');
});

test('el contenido se escapa: ni el mensaje ni el nombre del paciente pueden inyectar HTML', function () {
    mail_save(['ficha_message' => "<script>alert(1)</script> {paciente}", 'ficha_signature' => '<img src=x onerror=alert(1)>']);
    $m = ficha_email_render(['paciente' => '<b>Eve</b>', 'folio' => '', 'clinica' => '']);
    ok(!str_contains($m['html'], '<script'), 'sin <script>');
    ok(!str_contains($m['html'], '<img'), 'sin <img>');
    ok(!str_contains($m['html'], '<b>Eve</b>'), 'el nombre va escapado');
    ok(str_contains($m['html'], '&lt;script&gt;'));
});

test('el asunto no admite saltos de línea (inyección de cabeceras)', function () {
    mail_save(['ficha_subject' => "Hola\r\nBcc: espia@ejemplo.mx"]);
    $m = ficha_email_render(['paciente' => 'Ana']);
    ok(!preg_match('/[\r\n]/', $m['subject']), 'el asunto debe quedar en una sola línea');
    $m = ficha_email_render(['paciente' => "Ana\r\nBcc: x@y.mx"], ['ficha_subject' => '{paciente}', 'ficha_message' => 'x', 'ficha_signature' => 'y']);
    ok(!preg_match('/[\r\n]/', $m['subject']), 'ni por el nombre del paciente');
});

test('un texto vacío vuelve al original, un paciente sin nombre se llama «paciente» y se respetan los límites', function () {
    mail_save(['ficha_subject' => '   ', 'ficha_message' => str_repeat('a', 5000), 'ficha_signature' => '']);
    $cfg = mail_config(true);
    eq(3000, mb_strlen($cfg['ficha_message']), 'mensaje recortado a 3000');
    $m = ficha_email_render(['paciente' => '']);
    eq('Ficha de identificación · paciente', $m['subject']);
    mail_save(['ficha_message' => '']);
    $m = ficha_email_render(['paciente' => '']);
    ok(str_contains($m['html'], 'Estimado(a) paciente:'));
});

test('la vista previa usa los textos recibidos sin guardarlos', function () {
    mail_save(['ficha_subject' => '', 'ficha_message' => '', 'ficha_signature' => '']);
    $m = ficha_email_render(['paciente' => 'Ana'], ['ficha_subject' => 'Borrador {paciente}', 'ficha_message' => 'Texto nuevo', 'ficha_signature' => 'Firma']);
    eq('Borrador Ana', $m['subject']);
    ok(str_contains($m['html'], 'Texto nuevo'));
    eq('', mail_config(true)['ficha_subject'], 'no se guardó nada');
});
