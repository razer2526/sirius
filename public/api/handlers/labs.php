<?php
/**
 * Handler labs: órdenes de análisis clínicos.
 * Lee el PDF del laboratorio de referencia, lo cruza con el catálogo y devuelve
 * la estructura para el panel de validación. El catálogo se alimenta desde ahí.
 */

require_once __DIR__ . '/../../includes/rapha_reader.php';
require_once __DIR__ . '/../../includes/lab_catalog.php';

function handle_labs(string $action): void
{
    $me = current_user();

    switch ($action) {
        /** Sube el PDF del laboratorio y devuelve lo reconocido, ya cruzado con el catálogo. */
        case 'parse': {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió el archivo', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > 12 * 1024 * 1024) {
                json_error('El archivo supera 12 MB', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])
                || file_get_contents($file['tmp_name'], false, null, 0, 4) !== '%PDF') {
                json_error('El archivo no es un PDF válido', 422);
            }

            $read = rapha_read($file['tmp_name']);
            @unlink($file['tmp_name']);
            if (!$read['studies']) {
                json_error('No se reconoció ningún estudio en el PDF. Revisa que sea un reporte del laboratorio de referencia.', 422);
            }

            $sex = $read['patient']['sexo'] ?? null;
            $age = isset($read['patient']['edad_num']) ? (float)$read['patient']['edad_num'] : null;

            $studies = [];
            foreach ($read['studies'] as $study) {
                $items = [];
                foreach ($study['items'] as $it) {
                    $items[] = lab_prepare_item($it, $sex, $age);
                }
                $studies[] = ['name' => $study['name'], 'items' => $items];
            }

            log_activity('apps', 'lab_parse', 'Leyó orden de laboratorio: ' . ($read['patient']['nombre'] ?? 'sin nombre'));
            json_ok([
                'patient' => $read['patient'],
                'studies' => $studies,
                'source_name' => basename($file['name']),
            ]);
        }

        /** Guarda (o actualiza) determinaciones en el catálogo con los rangos validados. */
        case 'catalog_save': {
            $b = request_body();
            $saved = 0;
            foreach (($b['tests'] ?? []) as $t) {
                $name = trim((string)($t['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                lab_save_test(
                    [
                        'name'      => $name,
                        'unit'      => $t['unit'] ?? '',
                        'technique' => $t['technique'] ?? '',
                    ],
                    $t['ranges'] ?? [],
                    (int)$me['id']
                );
                $saved++;
            }
            log_activity('apps', 'lab_catalog_save', "Guardó $saved determinación(es) en el catálogo");
            json_ok(['saved' => $saved]);
        }

        /** Catálogo actual, para consulta desde el panel. */
        case 'catalog_list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $sql = 'SELECT id, name, unit, technique, times_used FROM lab_tests';
            $params = [];
            if ($q !== '') {
                $sql .= ' WHERE name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            $sql .= ' ORDER BY name LIMIT 300';
            $st = db()->prepare($sql);
            $st->execute($params);
            $tests = $st->fetchAll();
            foreach ($tests as &$t) {
                $t['ranges'] = lab_ranges_of((int)$t['id']);
            }
            json_ok(['tests' => $tests, 'total' => count($tests)]);
        }
    }
}

/**
 * Combina lo leído del PDF con el catálogo: si la determinación ya está registrada
 * se usan sus rangos validados; si no, se proponen a partir del texto del laboratorio.
 */
function lab_prepare_item(array $it, ?string $sex, ?float $age): array
{
    $known = lab_find_test($it['name'], $it['unit']);
    $name = $it['name'];
    if ($known) {
        // El catálogo tiene el nombre ya validado (el PDF a veces pega las palabras)
        $name = (string)$known['name'];
        $ranges = array_map(static fn($r) => [
            'sex'             => $r['sex'],
            'age_min'         => $r['age_min'],
            'age_max'         => $r['age_max'],
            'condition_label' => $r['condition_label'],
            'min_value'       => $r['min_value'],
            'max_value'       => $r['max_value'],
            'text_value'      => $r['text_value'],
            'unit'            => $r['unit'],
        ], $known['ranges']);
        $origin = 'catalogo';
        $unit = $it['unit'] !== '' ? $it['unit'] : (string)$known['unit'];
        $technique = $it['technique'] !== '' ? $it['technique'] : (string)$known['technique'];
    } else {
        $ranges = lab_parse_reference($it['reference']);
        $origin = $ranges ? 'detectado' : 'sin_rango';
        $unit = $it['unit'];
        $technique = $it['technique'];
    }

    $ranges = lab_filter_by_unit($ranges, $unit);
    $applicable = lab_applicable_ranges($ranges, $sex, $age);
    return [
        'name'         => $name,
        'value'        => $it['value'],
        'unit'         => $unit,
        'technique'    => $technique,
        'origin'       => $origin,
        'ranges'       => $ranges,
        'applicable'   => array_map('lab_range_label', $applicable),
        'flag'         => lab_out_of_range($it['value'], $applicable) ?? ($it['abnormal'] ? 'revisar' : null),
        'raw_reference' => $it['reference'],
        'conditions'   => lab_conditions_of($ranges),
    ];
}

/** Condiciones disponibles (fase del ciclo, embarazo…) para que el usuario elija. */
function lab_conditions_of(array $ranges): array
{
    $out = [];
    foreach ($ranges as $r) {
        $c = trim((string)($r['condition_label'] ?? ''));
        if ($c !== '' && !in_array($c, $out, true)) {
            $out[] = $c;
        }
    }
    return $out;
}
