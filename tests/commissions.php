<?php
/**
 * Emparejamiento del médico escrito a mano en Admisión con los de Vinculación
 * (includes/doctor_match.php). Se carga desde tests/run.php.
 */

require_once SIRIUS_PUBLIC . '/includes/doctor_match.php';

echo "\nMédico escrito en Admisión\n";
test('los nombres se comparan sin acentos, mayúsculas ni títulos', function () {
    eq(['rodolfo', 'ramirez', 'pilar'], doctor_name_tokens('DR. Rodolfo Ramírez del Pilar'));
    ok(doctor_names_match('Dr. Rodolfo Ramírez', 'Rodolfo Ramírez del Pilar'), 'un nombre más corto dentro del completo');
    ok(doctor_names_match('rodolfo ramirez del pilar', 'Dr. Rodolfo Ramírez del Pilar'), 'mismo nombre');
    ok(doctor_names_match('Rodolfo Ramírez del Pilar Gómez', 'Rodolfo Ramírez del Pilar'), 'el escrito trae más apellidos');
});
test('un nombre distinto o demasiado vago no coincide', function () {
    ok(!doctor_names_match('Rodolfo Pérez', 'Rodolfo Ramírez del Pilar'), 'otro apellido');
    ok(!doctor_names_match('Rodolfo', 'Rodolfo Ramírez del Pilar'), 'una sola palabra es muy vago');
    ok(!doctor_names_match('Dr.', 'Rodolfo Ramírez'), 'solo el título');
    ok(!doctor_names_match('', 'Rodolfo Ramírez'), 'vacío');
    ok(doctor_names_match('Rodolfo', 'Dr. Rodolfo'), 'una sola palabra idéntica sí');
});
test('doctor_resolve_typed solo liga si hay un único médico que coincide', function () {
    $dir = [1 => 'Rodolfo Ramírez del Pilar', 2 => 'Ana López Ruiz', 3 => 'Ana López Soto'];
    eq(1, doctor_resolve_typed('Dr. Rodolfo Ramírez', $dir));
    eq(null, doctor_resolve_typed('Dra. Ana López', $dir), 'ambiguo: dos médicas');
    eq(2, doctor_resolve_typed('Ana López Ruiz', $dir));
    eq(null, doctor_resolve_typed('Nadie Conocido', $dir));
});
