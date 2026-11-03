<?php
/**
 * Empareja el nombre de médico que Admisión captura a mano (p. ej. «Dr. Rodolfo
 * Ramírez») con los médicos con convenio de Vinculación. Hay dos orígenes de
 * captura: el formulario completo elige al médico de una lista (queda ligado por
 * `episodes.linked_doctor_id`), pero el asistido solo deja escribir el nombre
 * (`episodes.referring_doctor`). Sin este emparejamiento, Comisiones no vería
 * nunca las admisiones del asistido.
 *
 * Es deliberadamente conservador: si el nombre escrito encaja con dos médicos, o
 * con ninguno, no se liga. Nunca se adivina a quién se le paga una comisión.
 */

require_once __DIR__ . '/db.php';

/** Palabras que no identifican a nadie: títulos y partículas de apellido. */
const DOCTOR_NAME_NOISE = ['dr', 'dra', 'doc', 'doctor', 'doctora', 'med', 'medico', 'de', 'del', 'la', 'las', 'los', 'y'];

/** Palabras significativas del nombre, sin acentos ni mayúsculas ni títulos. */
function doctor_name_tokens(string $name): array
{
    $s = mb_strtolower(trim($name), 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    $tokens = array_filter(explode(' ', $s), fn($t) => $t !== '' && !in_array($t, DOCTOR_NAME_NOISE, true));
    return array_values(array_unique($tokens));
}

/**
 * ¿Son el mismo nombre? Con dos o más palabras basta que las de uno estén todas en el
 * otro («Rodolfo Ramírez» dentro de «Rodolfo Ramírez del Pilar»); con una sola palabra
 * («Rodolfo») es demasiado vago y se exige que sean idénticos.
 */
function doctor_names_match(string $a, string $b): bool
{
    $ta = doctor_name_tokens($a);
    $tb = doctor_name_tokens($b);
    if (!$ta || !$tb) {
        return false;
    }
    if (count($ta) < 2 || count($tb) < 2) {
        sort($ta);
        sort($tb);
        return $ta === $tb;
    }
    [$short, $long] = count($ta) <= count($tb) ? [$ta, $tb] : [$tb, $ta];
    return !array_diff($short, $long);
}

/** Médicos con convenio como [id => nombre]. */
function doctor_directory(): array
{
    $out = [];
    foreach (db()->query('SELECT id, name FROM vinculacion_doctors')->fetchAll() as $d) {
        $out[(int)$d['id']] = (string)$d['name'];
    }
    return $out;
}

/** Id del único médico con convenio que encaja con el nombre escrito; null si ninguno o varios. */
function doctor_resolve_typed(string $typed, ?array $directory = null): ?int
{
    $directory ??= doctor_directory();
    $hits = [];
    foreach ($directory as $id => $name) {
        if (doctor_names_match($typed, $name)) {
            $hits[] = $id;
        }
    }
    return count($hits) === 1 ? $hits[0] : null;
}

/**
 * Nombres escritos a mano en admisiones sin médico ligado que corresponden, sin
 * ambigüedad, a alguno de los médicos dados. Sirven para el filtro
 * `e.referring_doctor IN (...)` de las admisiones capturadas antes de que el
 * emparejamiento se hiciera al guardar.
 */
function doctor_typed_names_for(array $doctorIds): array
{
    $wanted = array_map('intval', $doctorIds);
    if (!$wanted) {
        return [];
    }
    $directory = doctor_directory();
    $typed = db()->query(
        "SELECT DISTINCT referring_doctor FROM episodes
         WHERE linked_doctor_id IS NULL AND referring_doctor IS NOT NULL AND referring_doctor <> ''"
    )->fetchAll(PDO::FETCH_COLUMN);
    $names = [];
    foreach ($typed as $t) {
        $id = doctor_resolve_typed((string)$t, $directory);
        if ($id !== null && in_array($id, $wanted, true)) {
            $names[] = (string)$t;
        }
    }
    return $names;
}
