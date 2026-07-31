<?php
/**
 * Hoja de prueba del membrete: permite ver cómo quedan el encabezado, el pie,
 * la marca de agua y la firma antes de emitir documentos reales.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/pdf_document.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
if (!user_can('membretes')) {
    http_response_code(403);
    exit('No tienes permiso para configurar membretes.');
}

$demo = [
    'doc_type'      => 'filmarray_gi',
    'folio'         => date('ymd') . '-00',
    'patient_name'  => 'PACIENTE DE PRUEBA',
    'patient_data'  => [
        'nombre'           => 'Paciente de Prueba',
        'sexo'             => 'Femenino',
        'edad'             => '35 años',
        'fecha_nacimiento' => '01/01/1991',
        'direccion'        => 'Domicilio de prueba 123, Col. Ejemplo, Naucalpan, Edo. de México',
        'telefono'         => '5500000000',
        'email'            => 'prueba@ejemplo.com',
    ],
    'clinical_data' => [
        'toma_muestra'  => date('d/m/Y H:i'),
        'medico'        => 'Dr. Ejemplo',
        'observaciones' => 'Documento de prueba para verificar la posición del membrete.',
    ],
    'results'       => ['shigella' => true],
    'notes'         => 'Hoja de prueba: ningún dato de este documento es real.',
];

try {
    $pdf = render_document_pdf($demo);
} catch (Throwable $e) {
    http_response_code(500);
    exit('No se pudo generar la hoja de prueba: ' . $e->getMessage());
}

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="membrete-prueba.pdf"');
header('Cache-Control: private, no-store');
echo $pdf;
