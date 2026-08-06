<?php
/**
 * Lector de los reportes del laboratorio de referencia (RAPHA).
 *
 * Trabaja con los fragmentos posicionados del PDF: reconstruye las tres columnas
 * de la tabla (determinación · valor obtenido · valores normales) y devuelve una
 * estructura lista para el panel de validación. No inventa nada: lo que no se
 * reconoce queda vacío para que el usuario lo capture.
 */

require_once __DIR__ . '/pdf_text.php';

/** Lee un PDF de RAPHA y devuelve paciente + estudios con sus determinaciones. */
function rapha_read(string $path): array
{
    $items = pdf_extract_items($path);
    if (!$items) {
        return ['patient' => [], 'studies' => [], 'source' => 'vacío'];
    }

    $pages = [];
    foreach ($items as $it) {
        $pages[$it['page']][] = $it;
    }

    $patient = [];
    $studies = [];
    foreach ($pages as $list) {
        $page = rapha_read_page($list);
        if (!$patient && $page['patient']) {
            $patient = $page['patient'];
        }
        if ($page['study']['name'] === '' && !$page['study']['items']) {
            continue;
        }
        // Un estudio largo se reparte en varias páginas: se reúne en uno solo
        $last = count($studies) - 1;
        if ($last >= 0 && rapha_same_study($studies[$last]['name'], $page['study']['name'])) {
            $studies[$last]['items'] = array_merge($studies[$last]['items'], $page['study']['items']);
            continue;
        }
        $studies[] = $page['study'];
    }
    return ['patient' => $patient, 'studies' => $studies, 'source' => 'rapha'];
}

/**
 * Procesa una página. Las coordenadas sirven para saber a qué columna pertenece
 * cada fragmento, pero el emparejamiento se hace por orden de emisión: estos
 * reportes escriben siempre valor → determinación → referencia → técnica.
 */
function rapha_read_page(array $items): array
{
    $flat = rapha_flatten($items);
    $patient = rapha_patient($flat);
    $study = ['name' => rapha_study_name($items), 'items' => []];

    // Límites de columna, tomados de los encabezados de la tabla
    $colName = $colValue = $colRef = null;
    foreach ($items as $it) {
        $t = rapha_norm($it['text']);
        if ($colName === null && str_starts_with($t, 'DETERMINACION')) {
            $colName = $it['x'];
        } elseif ($colValue === null && str_starts_with($t, 'VALOR OBTENIDO')) {
            $colValue = $it['x'];
        } elseif ($colRef === null && str_starts_with($t, 'VALORES NORMALES')) {
            $colRef = $it['x'];
        }
    }
    if ($colName === null || $colValue === null) {
        return ['patient' => $patient, 'study' => $study];
    }
    $colRef = $colRef ?? ($colValue * 1.7);
    $valueFrom = ($colName + $colValue) / 2;
    $refFrom   = ($colValue + $colRef) / 2;

    // Todo lo que sigue al aviso legal es texto fijo de RAPHA
    $stop = PHP_INT_MAX;
    foreach ($items as $i => $it) {
        if (mb_stripos($it['text'], 'Aviso Importante') !== false) {
            $stop = $i;
            break;
        }
    }

    $rows = [];
    $current = null;
    $seenHeader = false;
    $lastValueY = null;   // el PDF parte las palabras en varios fragmentos con la misma Y
    $lastRefY = null;
    $pendingRef = '';     // algunos estudios imprimen la referencia antes del resultado
    $last = ['name' => null, 'value' => null, 'tech' => null];

    // Dos trozos en la misma X son partes de una palabra; si la X cambió, hubo un espacio
    $glue = static function (?array $prev, array $it): string {
        return ($prev && abs($prev['x'] - $it['x']) <= 2 && abs($prev['y'] - $it['y']) <= 3) ? '' : ' ';
    };
    $flush = static function () use (&$current, &$rows): void {
        if ($current && trim($current['name']) !== '' && !rapha_is_noise($current['name'])) {
            $rows[] = $current;
        }
        $current = null;
    };

    foreach ($items as $i => $it) {
        if ($i >= $stop) {
            break;
        }
        $text = trim($it['text']);
        if ($text === '') {
            continue;
        }
        $norm = rapha_norm(mb_strtoupper($text, 'UTF-8'));
        if (str_starts_with($norm, 'VALORES NORMALES')) {
            $seenHeader = true;   // a partir de aquí empieza la tabla
            continue;
        }
        if (!$seenHeader || str_starts_with($norm, 'DETERMINACION') || str_starts_with($norm, 'VALOR OBTENIDO')) {
            continue;
        }

        $x = $it['x'];
        if ($x >= $refFrom) {
            // Columna de valores normales; los trozos del mismo renglón van juntos
            $sep = ($lastRefY !== null && abs($it['y'] - $lastRefY) <= 12) ? '' : "\n";
            if ($current) {
                $current['reference'] .= ($current['reference'] === '' ? '' : $sep) . $text;
            } else {
                $pendingRef .= ($pendingRef === '' ? '' : $sep) . $text;
            }
            $lastRefY = $it['y'];
            continue;
        }
        if ($x >= $valueFrom) {
            // Mismo renglón: es la continuación del valor, no una determinación nueva
            if ($current && $lastValueY !== null && abs($it['y'] - $lastValueY) <= 12) {
                $current['value'] .= $glue($last['value'], $it) . $text;
                $last['value'] = $it;
                continue;
            }
            $flush();
            $current = ['name' => '', 'value' => $text, 'technique' => '', 'reference' => $pendingRef];
            $pendingRef = '';
            $lastValueY = $it['y'];
            $last = ['name' => null, 'value' => $it, 'tech' => null];
            continue;
        }
        // Columna izquierda: nombre de la determinación o su técnica
        if (mb_stripos($text, 'TECNICA') !== false || ($current && $current['name'] !== '' && $x > $colName * 1.25)) {
            if ($current) {
                $current['technique'] .= $glue($last['tech'], $it) . $text;
                $last['tech'] = $it;
            }
            continue;
        }
        if ($current) {
            $current['name'] .= $glue($last['name'], $it) . $text;
            $last['name'] = $it;
        }
    }
    $flush();

    foreach ($rows as $r) {
        $value = rapha_split_value($r['value']);
        $study['items'][] = [
            'name'      => rapha_clean_name($r['name']),
            'value'     => $value['value'],
            'unit'      => $value['unit'],
            'abnormal'  => $value['abnormal'],
            'technique' => rapha_clean_technique($r['technique']),
            'reference' => rapha_clean_reference($r['reference']),
        ];
    }
    return ['patient' => $patient, 'study' => $study];
}

/**
 * Separa el resultado de su unidad y detecta la marca de fuera de rango.
 * El PDF parte los números ("11 .60%", "4.96Cels/ uL"), así que se recomponen.
 */
function rapha_split_value(string $raw): array
{
    $abnormal = str_contains($raw, '*');
    $v = trim(str_replace('*', '', $raw));
    $v = preg_replace('/\s*\/\s*/u', '/', $v);        // "Cels/ uL" → "Cels/uL"
    $v = preg_replace('/(\d)\s+([.,])/u', '$1$2', $v); // "11 .60"   → "11.60"
    $v = preg_replace('/([.,])\s+(\d)/u', '$1$2', $v);
    $v = trim(preg_replace('/\s+/u', ' ', $v));

    if (preg_match('/^(-?[\d.,]+)\s*(.*)$/u', $v, $m) && $m[1] !== '') {
        return ['value' => rtrim($m[1], '.,'), 'unit' => trim($m[2]), 'abnormal' => $abnormal];
    }
    return ['value' => $v, 'unit' => '', 'abnormal' => $abnormal];
}

/** Limpia el bloque de valores normales: quita bibliografía y notas al pie. */
function rapha_clean_reference(string $text): string
{
    $text = preg_replace('/\s*\n\s*/u', "\n", trim($text));
    // Se descarta lo que no es rango: bibliografía, notas y la firma del laboratorio
    $text = preg_split(
        '/\n?\s*(REFERENCIAS?|BIBLIOGRAFIA|INTERPRETACION|PARA LA DETERMINACION|RESPONSABLE'
        . '|Q[FB]B\.?|CED\.?\s*PROF|FECHA DE ACTUALIZACION|VALORES ACTUALIZADOS)\b/iu',
        $text
    )[0];
    // Une los trozos partidos: una línea que no termina en dato sigue en la siguiente
    $lines = array_values(array_filter(array_map('trim', explode("\n", $text)), fn($l) => $l !== ''));
    return trim(implode("\n", $lines));
}

/** Une los fragmentos que comparten renglón (tolerancia en Y). */
function rapha_merge_lines(array $items, float $tolerance = 12): array
{
    usort($items, fn($a, $b) => [$b['y'], $a['x']] <=> [$a['y'], $b['x']]);
    $out = [];
    foreach ($items as $it) {
        $last = count($out) - 1;
        if ($last >= 0 && abs($out[$last]['y'] - $it['y']) <= $tolerance) {
            $out[$last]['text'] .= $it['text'];
            continue;
        }
        $out[] = $it;
    }
    foreach ($out as &$o) {
        $o['text'] = trim(preg_replace('/\s+/u', ' ', $o['text']));
    }
    return array_values(array_filter($out, fn($o) => $o['text'] !== ''));
}

/** Fragmento más cercano en vertical dentro de una tolerancia. */
function rapha_nearest(array $items, float $y, float $tolerance = 200): string
{
    $best = null;
    $bestDist = INF;
    foreach ($items as $it) {
        $d = abs($it['y'] - $y);
        if ($d < $bestDist && $d <= $tolerance) {
            $bestDist = $d;
            $best = $it;
        }
    }
    return $best ? trim(preg_replace('/\s+/u', ' ', $best['text'])) : '';
}

/** Bloque de referencia: todo lo de la tercera columna entre dos determinaciones. */
function rapha_block(array $refs, float $fromY, float $toY): string
{
    $lines = [];
    foreach ($refs as $it) {
        // Se admite un margen arriba: la referencia suele empezar unos puntos antes
        if ($it['y'] <= $fromY + 60 && $it['y'] > $toY + 40) {
            $lines[] = $it;
        }
    }
    $lines = rapha_merge_lines($lines, 8);
    $text = trim(implode("\n", array_column($lines, 'text')));
    // Las referencias bibliográficas y notas largas de RAPHA no se conservan
    $text = preg_split('/\n\s*(REFERENCIA|BIBLIOGRAFIA|REFERENCIAS)\b/iu', $text)[0];
    return trim($text);
}

/**
 * Limpia el nombre de la determinación. Algunas traen pegada una nota al pie con el
 * valor del propio paciente ("… (HB-A1C) * IFCC 29.4"), que cambia en cada reporte:
 * si se deja, el mismo analito parece uno distinto en cada PDF y nunca empata con
 * el catálogo.
 */
function rapha_clean_name(string $name): string
{
    $n = rapha_norm($name);
    $n = preg_replace('/\*\s*IFCC\s*[\d.,]+\s*$/iu', '', $n);
    return rapha_norm(rtrim($n, ' *'));
}

function rapha_clean_technique(string $t): string
{
    $t = preg_replace('/^\s*TECNICA\s*:?/iu', '', $t);
    return trim(preg_replace('/\s+/u', ' ', $t));
}

/**
 * Nombre del estudio: es lo primero que emite la página (la barra de título),
 * antes de la etiqueta "Fecha Reporte".
 */
function rapha_study_name(array $items): string
{
    $title = '';
    foreach ($items as $it) {
        $t = $it['text'];
        if (mb_stripos($t, 'Fecha Reporte') !== false) {
            $title .= preg_split('/Fecha\s+Reporte/iu', $t)[0];
            break;
        }
        $title .= $t;
        if (mb_strlen($title) > 120) {
            break;
        }
    }
    return rapha_norm($title);
}

/**
 * Texto plano de la página. Los fragmentos que comparten posición son trozos de
 * una misma palabra y se unen sin separador; el resto con un espacio.
 */
function rapha_flatten(array $items): string
{
    $out = '';
    $prev = null;
    foreach ($items as $it) {
        $same = $prev && abs($prev['y'] - $it['y']) <= 2 && abs($prev['x'] - $it['x']) <= 2;
        $out .= ($same || $out === '' ? '' : ' ') . $it['text'];
        $prev = $it;
    }
    return trim(preg_replace('/\s+/u', ' ', $out));
}

function rapha_patient(string $flat): array
{
    $out = [];
    if (preg_match('/Paciente\s*\(\s*([\w-]+)\s*\)\s*(.+?)(?:Edad|Sexo|Fecha|Dr\(a\))/iu', $flat, $m)) {
        $out['folio'] = trim($m[1]);
        $out['nombre'] = rapha_title_case(trim($m[2]));
    }
    if (preg_match('/Edad:\s*(\d+)/iu', $flat, $m)) {
        $out['edad'] = $m[1] . ' años';
        $out['edad_num'] = (int)$m[1];
    }
    if (preg_match('/Sexo:\s*(FEMENINO|MASCULINO)/iu', $flat, $m)) {
        $out['sexo'] = mb_convert_case(mb_strtolower($m[1]), MB_CASE_TITLE, 'UTF-8');
    }
    if (preg_match('/Fecha\s+Reporte:\s*([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/iu', $flat, $m)) {
        $out['fecha_reporte'] = rapha_iso_date($m[1]);
    }
    if (preg_match('/Dr\(a\):\s*(.+?)(?:Page|DETERMINACION|$)/iu', $flat, $m)) {
        $medico = trim($m[1]);
        if ($medico !== '' && mb_stripos($medico, 'A QUIEN CORRESPONDA') === false) {
            $out['medico'] = rapha_title_case($medico);
        }
    }
    return $out;
}

function rapha_iso_date(string $dmy): string
{
    $p = explode('/', $dmy);
    return count($p) === 3
        ? sprintf('%04d-%02d-%02d', (int)$p[2], (int)$p[1], (int)$p[0])
        : $dmy;
}

/** "CORONEL CORTES JESSICA" → "Coronel Cortes Jessica" */
function rapha_title_case(string $s): string
{
    return mb_convert_case(mb_strtolower(trim($s)), MB_CASE_TITLE, 'UTF-8');
}

function rapha_norm(string $s): string
{
    return trim(preg_replace('/\s+/u', ' ', $s));
}

/** ¿Dos páginas pertenecen al mismo estudio? (se compara sin espacios ni acentos) */
function rapha_same_study(string $a, string $b): bool
{
    $clean = static fn(string $s) => preg_replace(
        '/[^a-z0-9]/',
        '',
        strtr(mb_strtolower($s, 'UTF-8'), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n'])
    );
    $ca = $clean($a);
    $cb = $clean($b);
    return $ca !== '' && $ca === $cb;
}

/** Descarta encabezados y textos que no son determinaciones. */
function rapha_is_noise(string $name): bool
{
    $n = rapha_norm(mb_strtoupper($name, 'UTF-8'));
    if (mb_strlen($n) < 2 || mb_strlen($n) > 70) {
        return true;
    }
    foreach ([
        'DETERMINACION', 'VALOR OBTENIDO', 'VALORES NORMALES', 'PAGE ', 'FECHA REPORTE',
        'PACIENTE', 'EDAD:', 'SEXO:', 'DR(A)', 'ESPECIALIDADES MEDICAS', 'OBSERVACIONES',
        'INTERPRETACION', 'IMPORTANTE', 'BIBLIOGRAFIA', 'REFERENCIA', 'TECNICA',
    ] as $bad) {
        if (str_contains($n, $bad)) {
            return true;
        }
    }
    // Las notas al pie empiezan con asterisco o numeración
    return (bool)preg_match('/^(\*|\d+\.\s)/u', $n);
}
