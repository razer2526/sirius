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

            // Con plantillas seleccionadas, el PDF solo aporta resultado y unidad: los
            // valores de referencia salen del catálogo. Sin ellas se conserva el camino
            // anterior (interpretar el texto del laboratorio), para no romper nada.
            $studyIds = lab_study_ids($_POST['study_ids'] ?? null);
            if ($studyIds) {
                $studies = lab_match_studies($studyIds, $read['studies'], $sex, $age);
            } else {
                $studies = [];
                foreach ($read['studies'] as $study) {
                    $items = [];
                    foreach ($study['items'] as $it) {
                        $items[] = lab_prepare_item($it, $sex, $age);
                    }
                    $studies[] = ['name' => $study['name'], 'items' => $items];
                }
            }

            log_activity('apps', 'lab_parse', 'Leyó orden de laboratorio: ' . ($read['patient']['nombre'] ?? 'sin nombre'));
            json_ok([
                'patient' => $read['patient'],
                'studies' => $studies,
                'source_name' => basename($file['name']),
            ]);
        }

        /** Plantillas activas, para elegir qué se va a membretar antes de capturar. */
        case 'studies': {
            $st = db()->query(
                'SELECT s.id, s.name, (SELECT COUNT(*) FROM lab_study_items i WHERE i.study_id = s.id) AS item_count
                 FROM lab_studies s WHERE s.is_active = 1 ORDER BY s.name'
            );
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['item_count'] = (int)$it['item_count'];
            }
            unset($it);
            json_ok(['studies' => $items]);
        }

        /** Determinaciones de las plantillas elegidas, para sembrar el formulario vacío. */
        case 'seed': {
            $studyIds = lab_study_ids($_GET['study_ids'] ?? null);
            if (!$studyIds) {
                json_error('Selecciona al menos un estudio', 422);
            }
            $sex = trim((string)($_GET['sex'] ?? '')) ?: null;
            $age = ($_GET['age'] ?? '') !== '' ? (float)$_GET['age'] : null;
            json_ok(['studies' => lab_match_studies($studyIds, [], $sex, $age)]);
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
 * Ids de plantilla del request. Llegan como arreglo desde el FormData de la subida
 * y como lista separada por comas desde apiGet, que no serializa arreglos.
 */
function lab_study_ids($raw): array
{
    if ($raw === null || $raw === '') {
        return [];
    }
    $parts = is_array($raw) ? $raw : explode(',', (string)$raw);
    $ids = [];
    foreach ($parts as $p) {
        $n = (int)trim((string)$p);
        if ($n > 0 && !in_array($n, $ids, true)) {
            $ids[] = $n;
        }
    }
    return $ids;
}

/**
 * Empareja lo leído del PDF contra las determinaciones que las plantillas esperan.
 *
 * Es la diferencia de fondo con el camino anterior: en vez de descubrir qué trae el
 * PDF, se busca una lista conocida. Así una referencia nunca depende de cómo quedó
 * maquetado el reporte de ese día, y lo que falta se ve en lugar de salir vacío.
 *
 * Devuelve un estudio por plantilla, más uno final con lo que el PDF trajo fuera de
 * plantilla ("extra"), que se muestra para que el usuario decida y nunca se descarta.
 */
function lab_match_studies(array $studyIds, array $readStudies, ?string $sex, ?float $age): array
{
    $expected = lab_study_tests($studyIds);
    if (!$expected) {
        return [];
    }

    // Índice de lo leído por nombre sin espacios: el PDF pega palabras ("NEUTROFILOSTOTALES")
    $readItems = [];
    foreach ($readStudies as $study) {
        foreach ($study['items'] as $it) {
            $readItems[] = $it;
        }
    }

    $usedRead = [];
    $studies = [];
    $currentStudy = null;
    $currentName = null;

    foreach ($expected as $test) {
        if ($currentName !== $test['study_name']) {
            if ($currentStudy) {
                $studies[] = $currentStudy;
            }
            $currentName = $test['study_name'];
            $currentStudy = ['name' => $currentName, 'items' => []];
        }

        $hit = lab_find_read_item($test, $readItems, $usedRead);
        $ranges = lab_filter_by_unit($test['ranges'], (string)$test['unit']);
        $applicable = lab_applicable_ranges($ranges, $sex, $age);
        $value = $hit === null ? '' : $hit['value'];

        $currentStudy['items'][] = [
            'name'          => (string)$test['name'],
            'value'         => $value,
            // La unidad la fija el catálogo: la del PDF viene pegada al número y varía
            'unit'          => (string)($test['unit'] ?? ''),
            'technique'     => (string)($test['technique'] ?? ''),
            'origin'        => $hit === null ? 'faltante' : 'plantilla',
            'ranges'        => $ranges,
            'applicable'    => array_map('lab_range_label', $applicable),
            'flag'          => $value === '' ? null : lab_out_of_range($value, $applicable),
            'raw_reference' => '',
            'conditions'    => lab_conditions_of($ranges),
            'dropped'       => false,
        ];
    }
    if ($currentStudy) {
        $studies[] = $currentStudy;
    }

    // Lo que el PDF trajo y ninguna plantilla esperaba
    $extras = [];
    foreach ($readItems as $i => $it) {
        if (isset($usedRead[$i]) || trim((string)$it['name']) === '') {
            continue;
        }
        $extra = lab_prepare_item($it, $sex, $age);
        $extra['origin'] = 'extra';
        $extra['dropped'] = false;
        $extras[] = $extra;
    }
    if ($extras) {
        $studies[] = ['name' => 'Otras determinaciones del PDF', 'items' => $extras, 'is_extra' => true];
    }

    return $studies;
}

/**
 * Busca en lo leído la determinación que espera la plantilla.
 * Además de la coincidencia directa contempla el caso en que el PDF fusionó dos
 * determinaciones en un renglón ("CALCIO EN SUERO PROTEINASTOTALES SERICAS"):
 * ahí el nombre esperado aparece como prefijo o sufijo del leído.
 */
function lab_find_read_item(array $test, array $readItems, array &$usedRead): ?array
{
    $names = [lab_slug_tight((string)$test['name'])];
    foreach (preg_split('/\r?\n/', (string)($test['aliases'] ?? '')) as $alias) {
        if (trim($alias) !== '') {
            $names[] = lab_slug_tight($alias);
        }
    }
    $names = array_values(array_filter($names, fn($n) => $n !== ''));
    if (!$names) {
        return null;
    }
    $unit = lab_slug((string)($test['unit'] ?? ''));

    // Primero la coincidencia exacta; la unidad desempata entre variantes del mismo
    // analito (linfocitos en % y en absolutos tienen intervalos distintos)
    $partial = null;
    foreach ($readItems as $i => $it) {
        if (($usedRead[$i] ?? null) === true) {
            continue;
        }
        $readName = lab_slug_tight((string)$it['name']);
        if ($readName === '') {
            continue;
        }
        if (in_array($readName, $names, true)) {
            if ($unit === '' || lab_slug((string)$it['unit']) === $unit) {
                $usedRead[$i] = true;
                return $it;
            }
            $partial = $partial ?? $i;
            continue;
        }
        // Renglón fusionado: el nombre esperado es prefijo o sufijo del leído. Cada
        // mitad se entrega una sola vez, así que las dos determinaciones que el PDF
        // pegó en un renglón recuperan cada una su propio resultado.
        foreach ($names as $n) {
            if (mb_strlen($n) < 6 || (!str_starts_with($readName, $n) && !str_ends_with($readName, $n))) {
                continue;
            }
            $wantFirst = str_starts_with($readName, $n);
            $half = $wantFirst ? 'first' : 'second';
            $taken = is_array($usedRead[$i] ?? null) ? $usedRead[$i] : [];
            if (!empty($taken[$half])) {
                continue;
            }
            $split = lab_split_merged($it, $wantFirst);
            if ($split !== null) {
                $taken[$half] = true;
                $usedRead[$i] = $taken;
                return $split;
            }
        }
    }
    if ($partial !== null) {
        $usedRead[$partial] = true;
        return $readItems[$partial];
    }
    return null;
}

/**
 * De un renglón que fusionó dos determinaciones extrae el valor que corresponde.
 * El PDF deja los dos resultados en la misma celda ("8.70 mg/dL 7.50g/dl"); si no
 * se distinguen dos números no se inventa nada y la determinación queda faltante.
 */
function lab_split_merged(array $it, bool $wantFirst): ?array
{
    // El segundo resultado queda dentro de la unidad, porque rapha_split_value() ya
    // separó el primer número: "8.70" + unidad "mg/dL 7.50g/dl"
    $raw = trim((string)$it['value'] . ' ' . (string)$it['unit']);
    if (preg_match_all('/-?\d[\d,]*\.?\d*/u', $raw, $m) && count($m[0]) >= 2) {
        $it['value'] = str_replace(',', '', $m[0][$wantFirst ? 0 : 1]);
        $it['unit'] = '';
        return $it;
    }
    return null;
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
