<?php
/**
 * Catálogo de determinaciones de laboratorio y sus valores de referencia.
 *
 * El catálogo se construye con el uso: la primera vez que aparece una determinación
 * se capturan sus rangos (con ayuda del texto que manda el laboratorio de referencia)
 * y a partir de ahí se reutilizan, en vez de reinterpretar el PDF cada vez.
 */

require_once __DIR__ . '/db.php';

/** Clave estable para comparar nombres: sin acentos, sin signos, en minúsculas. */
function lab_slug(string $name): string
{
    $s = mb_strtolower(trim($name), 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    $s = preg_replace('/[^a-z0-9]+/u', ' ', $s);
    return trim(preg_replace('/\s+/', ' ', $s));
}

/** Versión sin espacios: el PDF a veces pega palabras ("NEUTROFILOSTOTALES"). */
function lab_slug_tight(string $name): string
{
    return str_replace(' ', '', lab_slug($name));
}

/**
 * Clave del catálogo. Incluye la unidad porque una misma determinación puede
 * informarse de dos formas con rangos distintos —linfocitos en % y en absolutos—
 * y confundirlas haría comparar un resultado contra el intervalo equivocado.
 */
function lab_slug_key(string $name, string $unit = ''): string
{
    $s = lab_slug($name);
    $u = lab_slug($unit);
    return $u === '' ? $s : $s . ' @ ' . $u;
}

/**
 * Busca una determinación por nombre, por alias o —cuando el PDF pegó las
 * palabras— comparando sin espacios. Al encontrarla se usa el nombre del
 * catálogo, que es el que el usuario ya validó.
 */
function lab_find_test(string $name, string $unit = ''): ?array
{
    if (lab_slug($name) === '') {
        return null;
    }
    // Primero la coincidencia exacta nombre + unidad
    $st = db()->prepare('SELECT * FROM lab_tests WHERE slug = ?');
    $st->execute([lab_slug_key($name, $unit)]);
    $row = $st->fetch();

    if (!$row) {
        $tight = lab_slug_tight($name);
        $u = lab_slug($unit);
        $all = db()->query('SELECT * FROM lab_tests')->fetchAll();
        $fallback = null;
        foreach ($all as $candidate) {
            $sameName = lab_slug_tight((string)$candidate['name']) === $tight;
            if (!$sameName) {
                foreach (preg_split('/\r?\n/', (string)($candidate['aliases'] ?? '')) as $alias) {
                    if ($alias !== '' && lab_slug_tight($alias) === $tight) {
                        $sameName = true;
                        break;
                    }
                }
            }
            if (!$sameName) {
                continue;
            }
            // Con el nombre pegado por el PDF, la unidad desempata entre variantes
            if ($u !== '' && lab_slug((string)$candidate['unit']) === $u) {
                $row = $candidate;
                break;
            }
            if ($fallback === null && ($u === '' || lab_slug((string)$candidate['unit']) === '')) {
                $fallback = $candidate;
            }
        }
        $row = $row ?: $fallback;
    }
    if (!$row) {
        return null;
    }
    $row['ranges'] = lab_ranges_of((int)$row['id']);
    return $row;
}

function lab_ranges_of(int $testId): array
{
    $st = db()->prepare('SELECT * FROM lab_reference_ranges WHERE test_id = ? ORDER BY sort_order, id');
    $st->execute([$testId]);
    return $st->fetchAll();
}

/**
 * Crea o actualiza una determinación con sus rangos.
 * $ranges es una lista de arreglos con sex, age_min, age_max, condition_label,
 * min_value, max_value, text_value y unit.
 */
function lab_save_test(array $data, array $ranges, ?int $userId = null): int
{
    $name = trim((string)($data['name'] ?? ''));
    if ($name === '') {
        throw new InvalidArgumentException('La determinación necesita nombre');
    }
    $slug = lab_slug_key($name, (string)($data['unit'] ?? ''));
    $pdo = db();

    $st = $pdo->prepare('SELECT id, aliases FROM lab_tests WHERE slug = ?');
    $st->execute([$slug]);
    $existing = $st->fetch();

    if ($existing) {
        $id = (int)$existing['id'];
        $pdo->prepare('UPDATE lab_tests SET name = ?, unit = ?, technique = ?, notes = ?, aliases = ? WHERE id = ?')
            ->execute([
                $name,
                trim((string)($data['unit'] ?? '')) ?: null,
                trim((string)($data['technique'] ?? '')) ?: null,
                trim((string)($data['notes'] ?? '')) ?: null,
                trim((string)($data['aliases'] ?? $existing['aliases'] ?? '')) ?: null,
                $id,
            ]);
    } else {
        $pdo->prepare('INSERT INTO lab_tests (name, slug, aliases, unit, technique, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([
                $name,
                $slug,
                trim((string)($data['aliases'] ?? '')) ?: null,
                trim((string)($data['unit'] ?? '')) ?: null,
                trim((string)($data['technique'] ?? '')) ?: null,
                trim((string)($data['notes'] ?? '')) ?: null,
                $userId,
            ]);
        $id = (int)$pdo->lastInsertId();
    }

    // Los rangos se reemplazan por completo: son la versión validada por el usuario
    $pdo->prepare('DELETE FROM lab_reference_ranges WHERE test_id = ?')->execute([$id]);
    $ins = $pdo->prepare(
        'INSERT INTO lab_reference_ranges (test_id, sex, age_min, age_max, condition_label, min_value, max_value, text_value, unit, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $order = 0;
    foreach ($ranges as $r) {
        $sex = in_array($r['sex'] ?? 'A', ['A', 'F', 'M'], true) ? $r['sex'] : 'A';
        $ins->execute([
            $id,
            $sex,
            lab_num($r['age_min'] ?? null),
            lab_num($r['age_max'] ?? null),
            trim((string)($r['condition_label'] ?? '')) ?: null,
            lab_num($r['min_value'] ?? null),
            lab_num($r['max_value'] ?? null),
            trim((string)($r['text_value'] ?? '')) ?: null,
            trim((string)($r['unit'] ?? '')) ?: null,
            $order++,
        ]);
    }
    return $id;
}

/* ---------- Plantillas de estudio ---------- */

/**
 * Crea o actualiza una plantilla con su lista ordenada de determinaciones.
 * La plantilla solo apunta a lab_tests: los rangos siguen viviendo en
 * lab_reference_ranges, para no tener dos versiones del mismo intervalo.
 */
function lab_study_save(array $data, array $testIds, ?int $userId = null): int
{
    $name = trim((string)($data['name'] ?? ''));
    if ($name === '') {
        throw new InvalidArgumentException('La plantilla necesita nombre');
    }
    $slug = lab_slug($name);
    $pdo = db();

    $id = (int)($data['id'] ?? 0);
    if ($id <= 0) {
        $st = $pdo->prepare('SELECT id FROM lab_studies WHERE slug = ?');
        $st->execute([$slug]);
        $id = (int)($st->fetch()['id'] ?? 0);
    }

    $active = array_key_exists('is_active', $data) ? (int)!empty($data['is_active']) : 1;
    $aliases = trim((string)($data['aliases'] ?? '')) ?: null;

    if ($id > 0) {
        $pdo->prepare('UPDATE lab_studies SET name = ?, slug = ?, aliases = ?, is_active = ? WHERE id = ?')
            ->execute([$name, $slug, $aliases, $active, $id]);
    } else {
        $pdo->prepare('INSERT INTO lab_studies (name, slug, aliases, is_active, created_by) VALUES (?, ?, ?, ?, ?)')
            ->execute([$name, $slug, $aliases, $active, $userId]);
        $id = (int)$pdo->lastInsertId();
    }

    // La lista se reemplaza completa: es la versión que el usuario acaba de validar
    $pdo->prepare('DELETE FROM lab_study_items WHERE study_id = ?')->execute([$id]);
    $ins = $pdo->prepare('INSERT INTO lab_study_items (study_id, test_id, sort_order) VALUES (?, ?, ?)');
    $order = 0;
    $seen = [];
    foreach ($testIds as $testId) {
        $testId = (int)$testId;
        // La tabla tiene índice único (study_id, test_id): repetir uno abortaría el guardado
        if ($testId <= 0 || isset($seen[$testId])) {
            continue;
        }
        $seen[$testId] = true;
        $ins->execute([$id, $testId, $order++]);
    }
    return $id;
}

/** Plantilla con sus determinaciones ordenadas, cada una con sus rangos. */
function lab_study_get(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM lab_studies WHERE id = ?');
    $st->execute([$id]);
    $study = $st->fetch();
    if (!$study) {
        return null;
    }
    $study['items'] = lab_study_tests([$id]);
    return $study;
}

/**
 * Determinaciones esperadas de una o varias plantillas, en orden y con sus rangos.
 * Es la lista contra la que se empareja lo leído del PDF.
 */
function lab_study_tests(array $studyIds): array
{
    $ids = array_values(array_filter(array_map('intval', $studyIds), fn($n) => $n > 0));
    if (!$ids) {
        return [];
    }
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare(
        "SELECT t.*, i.study_id, i.sort_order, s.name AS study_name
         FROM lab_study_items i
         JOIN lab_tests t ON t.id = i.test_id
         JOIN lab_studies s ON s.id = i.study_id
         WHERE i.study_id IN ($in)
         ORDER BY i.study_id, i.sort_order, i.id"
    );
    $st->execute($ids);
    $rows = $st->fetchAll();
    // El orden de los estudios lo fija quien llama, no el id: se reordena aquí
    $byStudy = [];
    foreach ($rows as $r) {
        $r['ranges'] = lab_ranges_of((int)$r['id']);
        $byStudy[(int)$r['study_id']][] = $r;
    }
    $out = [];
    foreach ($ids as $sid) {
        foreach ($byStudy[$sid] ?? [] as $r) {
            $out[] = $r;
        }
    }
    return $out;
}

function lab_num($v): ?float
{
    if ($v === null || $v === '' || !is_numeric(str_replace(',', '', (string)$v))) {
        return null;
    }
    return (float)str_replace(',', '', (string)$v);
}

/**
 * Elige los rangos que aplican a un paciente.
 * Los rangos con condición (fase del ciclo, embarazo…) no se filtran solos:
 * se devuelven todos salvo que el usuario indique cuál considerar.
 */
function lab_applicable_ranges(array $ranges, ?string $sex, ?float $age, ?string $condition = null): array
{
    $sexKey = $sex ? mb_strtoupper(mb_substr($sex, 0, 1), 'UTF-8') : null;
    $sexKey = in_array($sexKey, ['F', 'M'], true) ? $sexKey : null;

    $withCondition = array_filter($ranges, fn($r) => trim((string)($r['condition_label'] ?? '')) !== '');
    $plain = array_filter($ranges, fn($r) => trim((string)($r['condition_label'] ?? '')) === '');

    $match = [];
    foreach ($plain as $r) {
        if ($sexKey && $r['sex'] !== 'A' && $r['sex'] !== $sexKey) {
            continue;
        }
        if ($age !== null) {
            if ($r['age_min'] !== null && $age < (float)$r['age_min']) {
                continue;
            }
            if ($r['age_max'] !== null && $age > (float)$r['age_max']) {
                continue;
            }
        }
        $match[] = $r;
    }

    if ($condition !== null && $condition !== '') {
        foreach ($withCondition as $r) {
            if (lab_slug((string)$r['condition_label']) === lab_slug($condition)) {
                $match[] = $r;
            }
        }
    } elseif ($withCondition && !$match) {
        // Sin condición indicada se muestran todas las variantes: es lo correcto
        $match = array_values($withCondition);
    }

    return $match ?: array_values($plain);
}

/**
 * Descarta rangos expresados en otra unidad que la del resultado.
 * El laboratorio suele incluir la equivalencia en unidades del sistema
 * internacional (mg/dL y mmol/L a la vez), que no debe mezclarse.
 */
function lab_filter_by_unit(array $ranges, string $unit): array
{
    $u = lab_slug($unit);
    if ($u === '') {
        return $ranges;
    }
    $withUnit = array_filter($ranges, fn($r) => lab_slug((string)($r['unit'] ?? '')) !== '');
    if (count($withUnit) < 2) {
        return $ranges;
    }
    $same = array_values(array_filter($ranges, function ($r) use ($u) {
        $ru = lab_slug((string)($r['unit'] ?? ''));
        return $ru === '' || $ru === $u;
    }));
    // Solo se aplica si queda algo: más vale mostrar de más que dejar sin referencia
    return $same ?: $ranges;
}

/** Texto corto de un rango, para imprimir junto al resultado. */
function lab_range_label(array $r): string
{
    $min = $r['min_value'];
    $max = $r['max_value'];
    if (trim((string)($r['text_value'] ?? '')) !== '') {
        $label = trim((string)$r['text_value']);
    } elseif ($min !== null && $max !== null) {
        $label = lab_fmt($min) . ' - ' . lab_fmt($max);
    } elseif ($min !== null) {
        $label = 'Mayor a ' . lab_fmt($min);
    } elseif ($max !== null) {
        $label = 'Menor a ' . lab_fmt($max);
    } else {
        $label = '';
    }
    $prefix = trim((string)($r['condition_label'] ?? ''));
    return $prefix !== '' ? $prefix . ': ' . $label : $label;
}

function lab_fmt($n): string
{
    $f = (float)$n;
    $s = rtrim(rtrim(number_format($f, 4, '.', ','), '0'), '.');
    return $s === '' ? '0' : $s;
}

/** ¿El resultado queda fuera del rango? Devuelve 'bajo', 'alto' o null. */
function lab_out_of_range($value, array $ranges): ?string
{
    $num = lab_num($value);
    if ($num === null || !$ranges) {
        return null;
    }
    $anyNumeric = false;
    foreach ($ranges as $r) {
        if ($r['min_value'] === null && $r['max_value'] === null) {
            continue;
        }
        $anyNumeric = true;
        $okMin = $r['min_value'] === null || $num >= (float)$r['min_value'];
        $okMax = $r['max_value'] === null || $num <= (float)$r['max_value'];
        if ($okMin && $okMax) {
            return null;   // cae dentro de alguno de los rangos aplicables
        }
    }
    if (!$anyNumeric) {
        return null;
    }
    // Fuera de todos: se compara contra el primero para saber la dirección
    foreach ($ranges as $r) {
        if ($r['min_value'] !== null && $num < (float)$r['min_value']) {
            return 'bajo';
        }
        if ($r['max_value'] !== null && $num > (float)$r['max_value']) {
            return 'alto';
        }
    }
    return null;
}

/**
 * Interpreta el bloque "VALORES NORMALES" del laboratorio de referencia y
 * propone rangos estructurados. Es una ayuda para la captura: lo que no se
 * reconoce se deja como texto para que el usuario lo corrija.
 */
function lab_parse_reference(string $text): array
{
    $out = [];
    $lines = preg_split('/\r?\n/', $text);
    $carrySex = 'A';

    foreach ($lines as $line) {
        $line = trim(preg_replace('/\s+/u', ' ', $line));
        if ($line === '' || mb_strlen($line) > 160) {
            continue;
        }
        // Los intervalos vienen en mayúsculas; una línea en prosa es una nota o una
        // cita bibliográfica ("…Reviews, 2018, 39(1):3-16") y no debe leerse como rango.
        // Las unidades sí van en minúsculas (mg/dL, umol/L, ug/dL): si se cuentan, una
        // línea legítima como "MUJERES: 0.60-1.10 mg/dL (53.0-97.2 umol/L)" pasa el 40%
        // y se descarta, que es de donde venían buena parte de las referencias vacías.
        $letters = preg_replace('/[^\p{L}]/u', '', preg_replace('/\b[a-zA-Z]{1,5}\/[a-zA-Z]+\b/u', '', $line));
        if ($letters !== '' && preg_match_all('/\p{Ll}/u', $letters) / mb_strlen($letters) > 0.4) {
            continue;
        }
        $upper = mb_strtoupper($line, 'UTF-8');

        // Sexo de la línea. Un encabezado suelto ("FEMENINO:") aplica a las que siguen;
        // si la línea trae su propio rango ("VARONES … 1.5 A 11.8"), solo aplica a ella.
        $sex = $carrySex;
        $sexInLine = null;
        if (preg_match('/\b(MUJER(ES)?|FEMENINO|FEMENINAS?)\b/u', $upper)) {
            $sexInLine = 'F';
        } elseif (preg_match('/\b(HOMBRES?|VARONES?|MASCULINO)\b/u', $upper)) {
            $sexInLine = 'M';
        } elseif (preg_match('/\bAMBOS\b/u', $upper)) {
            $sexInLine = 'A';
        }
        $hasNumbers = (bool)preg_match('/\d/', $line);
        if ($sexInLine !== null) {
            $sex = $sexInLine;
            if (!$hasNumbers) {
                $carrySex = $sexInLine;   // encabezado de sección
            }
        }

        // Edad: "0-15 AÑOS", "> 16 AÑOS", "MAYOR DE 6 AÑOS"
        $ageMin = $ageMax = null;
        if (preg_match('/(\d+)\s*[-aA]\s*(\d+)\s*A[ÑN]OS/u', $upper, $m)) {
            $ageMin = (float)$m[1];
            $ageMax = (float)$m[2];
        } elseif (preg_match('/(?:>|MAYOR(?:\s+DE)?)\s*(\d+)\s*A[ÑN]OS/u', $upper, $m)) {
            $ageMin = (float)$m[1];
        } elseif (preg_match('/(?:<|MENOR(?:\s+DE)?)\s*(\d+)\s*A[ÑN]OS/u', $upper, $m)) {
            $ageMax = (float)$m[1];
        }

        // Categorías con nombre: "DEFICIENCIA MENOR 10.0", "SUFICIENTE 30.0 A 100.0"
        // El laboratorio separa la etiqueta con puntos suspensivos, a veces con
        // espacios intercalados ("FASE CICLO MEDIO.... ...... 7.5A20.0")
        $condition = null;
        if (preg_match('/^([A-ZÁÉÍÓÚÑ ]{4,30}?)[\s:.]*(MENOR|MAYOR|\d)/u', $upper, $m)) {
            $word = trim($m[1]);
            // Ni el sexo ni "MAYOR DE 16 AÑOS" son condiciones fisiológicas
            $isQualifier = preg_match(
                '/^(AMBOS|MUJER(ES)?|HOMBRES?|VARONES?|FEMENINO|MASCULINO|MAYOR(\s+DE)?|MENOR(\s+DE)?|DE|A)$/u',
                $word
            );
            if (!$isQualifier && !str_contains($word, 'AÑOS')) {
                $condition = mb_convert_case(mb_strtolower($word, 'UTF-8'), MB_CASE_TITLE, 'UTF-8');
            }
        }

        // Números: el rango va después de los dos puntos si los hay
        $tail = $line;
        if (($pos = mb_strrpos($line, ':')) !== false) {
            $tail = mb_substr($line, $pos + 1);
        }
        $min = $max = null;
        $textValue = null;
        if (preg_match('/(-?[\d,]+\.?\d*)\s*(?:-|A|a)\s*(-?[\d,]+\.?\d*)/u', $tail, $m)) {
            $min = lab_num($m[1]);
            $max = lab_num($m[2]);
        } elseif (preg_match('/(?:MENOR(?:\s+A|\s+DE)?)\s*(-?[\d,]+\.?\d*)/iu', $tail, $m)) {
            $max = lab_num($m[1]);
        } elseif (preg_match('/(?:MAYOR(?:\s+A|\s+DE)?)\s*(-?[\d,]+\.?\d*)/iu', $tail, $m)) {
            $min = lab_num($m[1]);
        } elseif (preg_match('/^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ\- ]{3,40})\s*$/u', $tail, $m)) {
            $textValue = trim($m[1]);   // referencias cualitativas: "NEGATIVO", "CAFE-MARRON"
        }

        if ($min === null && $max === null && $textValue === null) {
            continue;
        }
        // Unidad: lo que sigue al último número (se usa # como delimitador por las barras)
        $unit = '';
        if (preg_match('#[\d.]\s*([A-Za-z%µ/][A-Za-z0-9%µ/.^-]*)\s*$#u', $tail, $m)) {
            $unit = trim($m[1], ' .');
        }

        $out[] = [
            'sex'             => $sex,
            'age_min'         => $ageMin,
            'age_max'         => $ageMax,
            'condition_label' => $condition,
            'min_value'       => $min,
            'max_value'       => $max,
            'text_value'      => $textValue,
            'unit'            => $unit,
        ];
    }
    return $out;
}
