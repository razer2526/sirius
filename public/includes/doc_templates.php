<?php
/**
 * Plantillas de documentos membretados.
 * La definición vive en assets/js/doc_templates.json (única fuente para JS y PHP):
 * 'categories' agrupa los estudios para los grids del Membretador y
 * 'templates' define los paneles y analitos de cada uno.
 */

function doc_catalog(): array
{
    static $cat = null;
    if ($cat === null) {
        $json = @file_get_contents(__DIR__ . '/../assets/js/doc_templates.json');
        $cat = $json ? (json_decode($json, true) ?: []) : [];
    }
    return $cat;
}

function doc_templates(): array
{
    return doc_catalog()['templates'] ?? [];
}

function doc_categories(): array
{
    return doc_catalog()['categories'] ?? [];
}

function doc_template(string $type): ?array
{
    $tpl = doc_templates()[$type] ?? null;
    // Los estudios aún no configurados no pueden emitir documentos
    return ($tpl && empty($tpl['coming_soon'])) ? $tpl : null;
}

/** Llaves válidas de resultados para una plantilla (todos los analitos de sus paneles). */
function doc_result_keys(string $type): array
{
    $tpl = doc_template($type);
    if (!$tpl) {
        return [];
    }
    $keys = [];
    foreach ($tpl['panels'] as $panel) {
        foreach ($panel['analytes'] as $a) {
            $keys[] = $a['k'];
        }
    }
    return $keys;
}

/** Filtra los resultados recibidos: solo analitos conocidos, valor booleano (positivo). */
function doc_filter_results(string $type, $results): array
{
    if (!is_array($results)) {
        return [];
    }
    $out = [];
    foreach (doc_result_keys($type) as $k) {
        $out[$k] = !empty($results[$k]);
    }
    return $out;
}

/** Campos del paciente que guarda el documento (snapshot editable, independiente del expediente). */
const DOC_PATIENT_FIELDS = [
    'nombre', 'sexo', 'edad', 'fecha_nacimiento', 'tipo_id', 'numero_id',
    'direccion', 'telefono', 'email',
];

/** Campos clínicos del encabezado del reporte. */
const DOC_CLINICAL_FIELDS = [
    'area', 'fecha_reporte', 'toma_muestra', 'container_temp', 'tipo_muestra',
    'kit', 'estudio', 'medico', 'observaciones',
];

/**
 * Valida los resultados de una orden de análisis clínicos.
 * A diferencia de los paneles moleculares, aquí las determinaciones son libres
 * (vienen del laboratorio de referencia), así que se limita forma y longitud.
 */
function lab_filter_studies($studies): array
{
    if (!is_array($studies)) {
        return [];
    }
    $out = [];
    foreach (array_slice($studies, 0, 40) as $study) {
        if (!is_array($study)) {
            continue;
        }
        $items = [];
        foreach (array_slice($study['items'] ?? [], 0, 120) as $it) {
            $name = trim((string)($it['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $items[] = [
                'name'       => mb_substr($name, 0, 150),
                'value'      => mb_substr(trim((string)($it['value'] ?? '')), 0, 80),
                'unit'       => mb_substr(trim((string)($it['unit'] ?? '')), 0, 40),
                'technique'  => mb_substr(trim((string)($it['technique'] ?? '')), 0, 80),
                'reference'  => mb_substr(trim((string)($it['reference'] ?? '')), 0, 300),
                'flag'       => in_array($it['flag'] ?? null, ['alto', 'bajo', 'revisar'], true) ? $it['flag'] : null,
            ];
        }
        if (!$items) {
            continue;
        }
        $out[] = [
            'name'  => mb_substr(trim((string)($study['name'] ?? 'Estudio')), 0, 150),
            'items' => $items,
        ];
    }
    return $out;
}

function doc_filter_map(array $allowed, $data, int $maxLen = 300): array
{
    if (!is_array($data)) {
        return [];
    }
    $out = [];
    foreach ($allowed as $k) {
        if (!isset($data[$k])) {
            continue;
        }
        $v = trim((string)$data[$k]);
        if ($v === '') {
            continue;
        }
        $out[$k] = mb_substr($v, 0, $maxLen);
    }
    return $out;
}
