<?php
/**
 * Catálogo de servicios clínicos.
 * La definición de formularios vive en assets/js/services_catalog.json
 * (única fuente de verdad para el frontend y este whitelist del servidor).
 */

const SERVICE_LABELS = [
    'laboratorio'  => 'Laboratorio',
    'control_peso' => 'Control de peso',
    'fisioterapia' => 'Fisioterapia',
    'podologia'    => 'Podología',
];

function services_catalog(): array
{
    static $catalog = null;
    if ($catalog === null) {
        $json = file_get_contents(__DIR__ . '/../assets/js/services_catalog.json');
        $catalog = json_decode($json, true) ?: [];
    }
    return $catalog;
}

/** Secciones de un servicio para una etapa ('admission' | 'session'). */
function service_sections(string $service, string $stage): array
{
    return services_catalog()[$service][$stage] ?? [];
}

/**
 * Whitelist de llaves permitidas en service_data/params de un servicio.
 * Los campos checkdetail aceptan también su llave "<k>_det".
 */
function service_allowed_keys(string $service, string $stage): array
{
    $keys = [];
    foreach (service_sections($service, $stage) as $section) {
        foreach ($section['fields'] as $f) {
            $keys[] = $f['k'];
            if ($f['t'] === 'checkdetail') {
                $keys[] = $f['k'] . '_det';
            }
        }
    }
    return $keys;
}

/**
 * Filtra y valida los datos capturados contra el catálogo.
 * Devuelve solo llaves permitidas con valor no vacío; valida la firma.
 */
function service_filter_data(string $service, string $stage, $data): array
{
    if (!is_array($data)) {
        return [];
    }
    $out = [];
    foreach (service_allowed_keys($service, $stage) as $key) {
        if (!isset($data[$key]) || $data[$key] === '' || $data[$key] === false || $data[$key] === null) {
            continue;
        }
        $v = $data[$key];
        if ($key === 'firma') {
            if (!is_string($v) || !preg_match('#^data:image/png;base64,[A-Za-z0-9+/=]+$#', $v)) {
                json_error('Firma no válida', 422);
            }
            if (strlen($v) > 300000) {
                json_error('La firma es demasiado grande', 422);
            }
        } elseif (is_string($v)) {
            $v = trim($v);
            if ($v === '') {
                continue;
            }
            if (mb_strlen($v) > 2000) {
                $v = mb_substr($v, 0, 2000);
            }
        } elseif (!is_bool($v) && !is_numeric($v)) {
            continue; // no se aceptan arreglos/objetos anidados
        }
        $out[$key] = $v;
    }
    return $out;
}
