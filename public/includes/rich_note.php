<?php
/**
 * Descripción de una tarea con formato: texto con negritas, cursivas, subrayado, alineación, viñetas,
 * renglones de pendiente (casilla) e imágenes (incluidas las notas manuscritas, que son imágenes).
 * Mismo formato de bloques que las notas del Pizarrón (ver assets/js/board_note_editor.js):
 *
 *   { "v": 2, "blocks": [ { "t": "p",    "align": "center", "runs": [ { "s": "texto", "b": true } ] },
 *                         { "t": "li",   "runs": [ ... ] },                      ← viñeta
 *                         { "t": "todo", "done": false, "runs": [ ... ] },       ← casilla
 *                         { "t": "img",  "asset": 12 } ],                        ← task_assets.id
 *     "period": "2026-10-13" }          ← solo en tareas frecuentes: periodo al que corresponden las casillas
 *
 * Se guarda como JSON de datos, nunca como HTML: el cliente dibuja nodos con textContent / escapa, y aquí
 * se descarta todo lo que no sea esta forma (colores, tipografías, tamaños, scripts…). Una imagen solo se
 * acepta si su id está en la lista de las que el llamador sabe que son de esta tarea.
 *
 * Compatibilidad: las descripciones anteriores son texto plano. rich_note_decode() las reconoce
 * (legacy = true) y las convierte en párrafos; al guardarlas de nuevo ya quedan en el formato nuevo.
 */

const RICH_NOTE_MAX_BLOCKS = 200;
const RICH_NOTE_MAX_RUNS = 400;
const RICH_NOTE_MAX_CHARS = 5000;
const RICH_NOTE_MAX_IMAGES = 20;
const RICH_NOTE_ALIGNS = ['left', 'center', 'right', 'justify'];
const RICH_NOTE_TEXT_TYPES = ['p', 'li', 'todo'];

/**
 * Valida lo que manda el cliente y devuelve lo que se guarda en tasks.description (o null si queda vacío).
 * Acepta un arreglo {blocks:[…]} (editor) o un texto plano (clientes anteriores).
 *
 * @param string|array|null $input
 * @param string|null       $period    periodo actual de una tarea frecuente (las casillas valen para ese periodo)
 * @param int[]             $assetIds  imágenes que el llamador sabe que se pueden usar en esta tarea
 */
function rich_note_normalize($input, ?string $period = null, array $assetIds = []): ?string
{
    if (!is_array($input)) {
        $text = trim((string)$input);
        return $text === '' ? null : mb_substr($text, 0, RICH_NOTE_MAX_CHARS);
    }

    $blocks = [];
    $chars = 0;
    $images = 0;
    $allowed = array_map('intval', $assetIds);
    foreach (array_slice((array)($input['blocks'] ?? []), 0, RICH_NOTE_MAX_BLOCKS) as $b) {
        if (!is_array($b)) {
            continue;
        }
        $type = $b['t'] ?? 'p';
        if ($type === 'img') {
            $assetId = (int)($b['asset'] ?? 0);
            if ($assetId > 0 && $images < RICH_NOTE_MAX_IMAGES && in_array($assetId, $allowed, true)) {
                $blocks[] = ['t' => 'img', 'asset' => $assetId];
                $images++;
            }
            continue;
        }
        if (!in_array($type, RICH_NOTE_TEXT_TYPES, true)) {
            continue;   // scripts, lo que sea: aquí solo caben texto, viñetas, casillas e imágenes
        }
        $runs = [];
        foreach (array_slice((array)($b['runs'] ?? []), 0, RICH_NOTE_MAX_RUNS) as $r) {
            if (!is_array($r) || $chars >= RICH_NOTE_MAX_CHARS) {
                continue;
            }
            $s = (string)($r['s'] ?? '');
            if ($s === '') {
                continue;
            }
            $s = mb_substr($s, 0, RICH_NOTE_MAX_CHARS - $chars);
            $chars += mb_strlen($s);
            $run = ['s' => $s];
            foreach (['b', 'i', 'u'] as $flag) {
                if (!empty($r[$flag])) {
                    $run[$flag] = true;
                }
            }
            $runs[] = $run;
        }
        $block = ['t' => $type, 'runs' => $runs];
        if (in_array($b['align'] ?? '', RICH_NOTE_ALIGNS, true) && $b['align'] !== 'left') {
            $block['align'] = $b['align'];
        }
        if ($type === 'todo') {
            $block['done'] = !empty($b['done']);
        }
        $blocks[] = $block;
    }

    // Párrafos vacíos al final no aportan nada
    while ($blocks && end($blocks)['t'] === 'p' && !end($blocks)['runs']) {
        array_pop($blocks);
    }
    if (!$blocks) {
        return null;
    }
    $out = ['v' => 2, 'blocks' => $blocks];
    if ($period !== null) {
        $out['period'] = $period;
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}

/**
 * Lee lo guardado en tasks.description.
 * @return array{blocks:array, period:?string, legacy:bool}
 */
function rich_note_decode(?string $stored): array
{
    $stored = (string)$stored;
    if ($stored !== '' && $stored[0] === '{') {
        $data = json_decode($stored, true);
        if (is_array($data) && isset($data['blocks']) && is_array($data['blocks'])) {
            return ['blocks' => array_values($data['blocks']), 'period' => isset($data['period']) ? (string)$data['period'] : null, 'legacy' => false];
        }
    }
    $blocks = [];
    foreach (preg_split('/\R/u', $stored) as $line) {
        $blocks[] = ['t' => 'p', 'runs' => $line === '' ? [] : [['s' => $line]]];
    }
    if ($stored === '') {
        $blocks = [];
    }
    return ['blocks' => $blocks, 'period' => null, 'legacy' => true];
}

/**
 * En una tarea frecuente las casillas valen para UN periodo: si lo guardado es de otro, el periodo
 * nuevo empieza con todas sin marcar (así se reinicia sola cada día o cada semana, sin cron).
 */
function rich_note_for_period(array $decoded, ?string $currentPeriod): array
{
    if ($currentPeriod !== null && ($decoded['period'] ?? null) !== $currentPeriod) {
        foreach ($decoded['blocks'] as &$b) {
            if (($b['t'] ?? '') === 'todo') {
                $b['done'] = false;
            }
        }
        unset($b);
    }
    return $decoded;
}

/** @return array{0:int,1:int} [casillas, marcadas] */
function rich_note_todo_counts(array $blocks): array
{
    $total = 0;
    $done = 0;
    foreach ($blocks as $b) {
        if (($b['t'] ?? '') === 'todo') {
            $total++;
            if (!empty($b['done'])) {
                $done++;
            }
        }
    }
    return [$total, $done];
}

/** Texto plano legible (☐/☑ para las casillas): lo ven los clientes que aún no conocen el formato nuevo. */
function rich_note_plain(array $blocks): string
{
    $lines = [];
    foreach ($blocks as $b) {
        $kind = $b['t'] ?? 'p';
        if ($kind === 'img') {
            $lines[] = '[imagen]';
            continue;
        }
        $text = implode('', array_map(static fn($r) => (string)($r['s'] ?? ''), (array)($b['runs'] ?? [])));
        $prefix = $kind === 'todo' ? (!empty($b['done']) ? '☑ ' : '☐ ') : ($kind === 'li' ? '• ' : '');
        $lines[] = $prefix . $text;
    }
    return implode("\n", $lines);
}

/** Ids de las imágenes que usa una lista de bloques. @return int[] */
function rich_note_asset_ids(array $blocks): array
{
    $ids = [];
    foreach ($blocks as $b) {
        if (is_array($b) && ($b['t'] ?? '') === 'img' && (int)($b['asset'] ?? 0) > 0) {
            $ids[(int)$b['asset']] = true;
        }
    }
    return array_keys($ids);
}

/** Guarda el estado de las casillas (JSON) de una tarea. */
function rich_note_store(array $blocks, ?string $period): string
{
    $out = ['v' => 2, 'blocks' => array_values($blocks)];
    if ($period !== null) {
        $out['period'] = $period;
    }
    return json_encode($out, JSON_UNESCAPED_UNICODE);
}
