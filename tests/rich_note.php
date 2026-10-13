<?php
/**
 * Pruebas de la descripción con formato de las tareas (negritas, cursivas, subrayado y casillas).
 * Se incluye desde tests/run.php.
 */

require_once SIRIUS_PUBLIC . '/includes/rich_note.php';

echo "\nDescripción de tareas con formato\n";

test('normalize: conserva negritas/cursivas/subrayado y casillas, y descarta todo lo demás', function () {
    $stored = rich_note_normalize(['v' => 2, 'blocks' => [
        ['t' => 'p', 'align' => 'center', 'runs' => [['s' => 'Hola ', 'b' => true, 'c' => '#ff0000', 'f' => 'caveat', 'z' => 64], ['s' => 'mundo', 'i' => true, 'u' => true]]],
        ['t' => 'todo', 'done' => true, 'runs' => [['s' => 'Comprar Windex']]],
        ['t' => 'img', 'asset' => 5],
        ['t' => 'script', 'runs' => [['s' => 'x']]],
        'no-es-un-bloque',
    ]]);
    $d = json_decode($stored, true);
    eq(2, count($d['blocks']), 'solo p y todo');
    eq(['s' => 'Hola ', 'b' => true], $d['blocks'][0]['runs'][0], 'sin color, tipografía ni tamaño');
    eq(['s' => 'mundo', 'i' => true, 'u' => true], $d['blocks'][0]['runs'][1]);
    eq(true, $d['blocks'][1]['done']);
    ok(!isset($d['blocks'][0]['align']), 'sin alineación');
});

test('normalize: texto plano, vacío, límites y párrafos vacíos al final', function () {
    eq('Una nota', rich_note_normalize("  Una nota \n"));
    eq(null, rich_note_normalize('   '));
    eq(null, rich_note_normalize(null));
    eq(null, rich_note_normalize(['blocks' => [['t' => 'p', 'runs' => []], ['t' => 'p', 'runs' => [['s' => '']]]]]), 'solo párrafos vacíos = sin descripción');
    $long = rich_note_normalize(['blocks' => [['t' => 'p', 'runs' => [['s' => str_repeat('a', 9000)]]]]]);
    eq(RICH_NOTE_MAX_CHARS, mb_strlen(json_decode($long, true)['blocks'][0]['runs'][0]['s']));
    $d = json_decode(rich_note_normalize(['blocks' => [['t' => 'p', 'runs' => [['s' => 'x']]], ['t' => 'p', 'runs' => []]]]), true);
    eq(1, count($d['blocks']), 'el párrafo vacío final se recorta');
    $with = json_decode(rich_note_normalize(['blocks' => [['t' => 'todo', 'runs' => [['s' => 'x']]]]], '2026-10-13'), true);
    eq('2026-10-13', $with['period']);
});

test('decode: lo anterior (texto plano) se lee como párrafos y lo nuevo como bloques', function () {
    $legacy = rich_note_decode("- Windex\n- Tubos Stuart\n\n- Cuentas Hilda");
    ok($legacy['legacy']);
    eq(4, count($legacy['blocks']));
    eq('- Windex', $legacy['blocks'][0]['runs'][0]['s']);
    eq([], $legacy['blocks'][2]['runs'], 'línea en blanco');
    eq([], rich_note_decode(null)['blocks']);
    $new = rich_note_decode(rich_note_normalize(['blocks' => [['t' => 'todo', 'done' => false, 'runs' => [['s' => 'a']]]]]));
    ok(!$new['legacy']);
    ok(rich_note_decode('{texto que empieza con llave pero no es JSON')['legacy'], 'una llave suelta no es el formato nuevo');
});

test('casillas: conteo, texto plano y reinicio por periodo en tareas frecuentes', function () {
    $blocks = [
        ['t' => 'p', 'runs' => [['s' => 'Lista']]],
        ['t' => 'todo', 'done' => true, 'runs' => [['s' => 'uno']]],
        ['t' => 'todo', 'done' => false, 'runs' => [['s' => 'dos']]],
    ];
    eq([2, 1], rich_note_todo_counts($blocks));
    eq("Lista\n☑ uno\n☐ dos", rich_note_plain($blocks));
    $dec = ['blocks' => $blocks, 'period' => '2026-10-12', 'legacy' => false];
    eq([2, 1], rich_note_todo_counts(rich_note_for_period($dec, '2026-10-12')['blocks']), 'mismo periodo: se conservan');
    eq([2, 0], rich_note_todo_counts(rich_note_for_period($dec, '2026-10-13')['blocks']), 'periodo nuevo: sin marcar');
    eq([2, 1], rich_note_todo_counts(rich_note_for_period($dec, null)['blocks']), 'tarea única: no se reinicia');
});
