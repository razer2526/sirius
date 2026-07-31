<?php
/**
 * Extracción de texto de PDF en PHP puro (sin Composer ni binarios).
 *
 * Muchos generadores incrustan las fuentes como subconjunto y codifican el texto
 * con códigos propios (el laboratorio de referencia lo hace). Cuando el PDF incluye
 * su tabla /ToUnicode —que es lo habitual— el texto se reconstruye de forma exacta.
 * Si no la trae, se recurre a heurísticas y el resultado es aproximado.
 */

/** Texto plano de un PDF. Devuelve '' si no se pudo extraer. */
function pdf_extract_text(string $path, int $maxBytes = 12000000): string
{
    return pdf_extract_pages($path, $maxBytes) === []
        ? ''
        : trim(pdf_normalize_spacing(implode("\n", pdf_extract_pages($path, $maxBytes))));
}

/**
 * Texto por bloque de contenido (habitualmente una página por elemento).
 * Los reportes de laboratorio traen un estudio por página, así que conviene
 * conservar esa separación en vez de aplanar todo el documento.
 */
function pdf_extract_pages(string $path, int $maxBytes = 12000000): array
{
    static $cache = [];
    $key = $path . '|' . @filemtime($path);
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    if (!is_file($path) || filesize($path) > $maxBytes) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false || strncmp($raw, '%PDF', 4) !== 0) {
        return [];
    }

    $fonts = pdf_font_maps($raw);
    $pages = [];
    foreach (pdf_streams($raw) as $decoded) {
        if (strpos($decoded, 'Tj') === false && strpos($decoded, 'TJ') === false) {
            continue;
        }
        $text = pdf_repair_known_glyphs(pdf_text_from_content($decoded, $fonts));
        if (trim($text) !== '') {
            $pages[] = $text;
        }
    }
    return $cache[$key] = $pages;
}

/**
 * Corrige glifos que el PDF de origen declara mal en su propia tabla ToUnicode.
 * El laboratorio de referencia emite la "Ñ" con el código del símbolo de yen, de
 * modo que "AÑOS" llega como "A¥OS"; solo se repara entre letras, para no tocar
 * un símbolo de moneda legítimo.
 */
function pdf_repair_known_glyphs(string $text): string
{
    return preg_replace('/(?<=\p{L})¥(?=\p{L})/u', 'Ñ', $text);
}

/**
 * Fragmentos de texto con su posición en la página: [['page'=>0,'x'=>..,'y'=>..,'text'=>'..'], …]
 * El texto plano mezcla las columnas de una tabla; con las coordenadas se pueden
 * reconstruir filas y columnas, que es como se leen los reportes de laboratorio.
 */
function pdf_extract_items(string $path, int $maxBytes = 12000000): array
{
    static $cache = [];
    $key = $path . '|' . @filemtime($path);
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    if (!is_file($path) || filesize($path) > $maxBytes) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false || strncmp($raw, '%PDF', 4) !== 0) {
        return [];
    }
    $fonts = pdf_font_maps($raw);

    $items = [];
    $page = 0;
    foreach (pdf_streams($raw) as $content) {
        if (strpos($content, 'Tj') === false && strpos($content, 'TJ') === false) {
            continue;
        }
        $found = pdf_items_from_content($content, $fonts, $page);
        if ($found) {
            $items = array_merge($items, $found);
            $page++;
        }
    }
    return $cache[$key] = $items;
}

/** Interpreta el estado de texto de un content stream para situar cada fragmento. */
function pdf_items_from_content(string $content, array $fonts, int $page): array
{
    $items = [];
    $cmap = null;
    $x = $y = 0.0;          // posición actual
    $lineX = $lineY = 0.0;  // inicio de la línea actual
    $leading = 0.0;

    $pattern = '#BT|ET|'
        . '/[A-Za-z0-9_.\-]+\s+[\d.]+\s+Tf|'
        . '(?:[-\d.]+\s+){5}[-\d.]+\s+Tm|'
        . '(?:[-\d.]+\s+)[-\d.]+\s+T[dD]|'
        . '[-\d.]+\s+TL|T\*|'
        . '\((?:\\\\.|[^\\\\()])*\)\s*(?:Tj|\')|'
        . '\[(?:[^\[\]\\\\]|\\\\.)*\]\s*TJ|'
        . '<[0-9A-Fa-f\s]+>\s*Tj#s';
    if (!preg_match_all($pattern, $content, $matches)) {
        return [];
    }

    $decode = static function (string $bytes) use (&$cmap): string {
        return $cmap ? pdf_apply_cmap($bytes, $cmap) : pdf_decode_string_bytes($bytes);
    };
    $push = static function (string $text) use (&$items, &$x, &$y, $page): void {
        if (trim($text) !== '') {
            $items[] = ['page' => $page, 'x' => round($x, 1), 'y' => round($y, 1), 'text' => $text];
        }
    };

    foreach ($matches[0] as $m) {
        $m = trim($m);

        if ($m === 'BT') {
            $x = $y = $lineX = $lineY = 0.0;
            continue;
        }
        if ($m === 'ET') {
            continue;
        }
        if ($m[0] === '/') {
            $name = substr($m, 1, strcspn($m, " \t\r\n", 1));
            $cmap = $fonts[$name] ?? null;
            continue;
        }
        if (substr($m, -2) === 'Tm') {
            $n = preg_split('/\s+/', trim(substr($m, 0, -2)));
            $lineX = $x = (float)($n[4] ?? 0);
            $lineY = $y = (float)($n[5] ?? 0);
            continue;
        }
        if (substr($m, -2) === 'Td' || substr($m, -2) === 'TD') {
            $n = preg_split('/\s+/', trim(substr($m, 0, -2)));
            $lineX = $x = $lineX + (float)($n[0] ?? 0);
            $lineY = $y = $lineY + (float)($n[1] ?? 0);
            if (substr($m, -2) === 'TD') {
                $leading = -(float)($n[1] ?? 0);
            }
            continue;
        }
        if (substr($m, -2) === 'TL') {
            $leading = (float)trim(substr($m, 0, -2));
            continue;
        }
        if ($m === 'T*') {
            $x = $lineX;
            $y = $lineY = $lineY - $leading;
            continue;
        }
        if ($m[0] === '[') {
            $text = '';
            if (preg_match_all('/\((?:\\\\.|[^\\\\()])*\)|-?\d+(?:\.\d+)?/', $m, $parts)) {
                foreach ($parts[0] as $p) {
                    if ($p !== '' && $p[0] === '(') {
                        $text .= $decode(pdf_unescape_string(substr($p, 1, -1)));
                    } elseif ((float)$p <= -100) {
                        $text .= ' ';
                    }
                }
            }
            $push($text);
            continue;
        }
        if ($m[0] === '<') {
            $hex = preg_replace('/[^0-9A-Fa-f]/', '', $m);
            $bin = @hex2bin(strlen($hex) % 2 ? substr($hex, 0, -1) : $hex);
            if ($bin !== false) {
                $push($decode($bin));
            }
            continue;
        }
        if ($m[0] === '(') {
            $close = strrpos($m, ')');
            $text = $decode(pdf_unescape_string(substr($m, 1, $close - 1)));
            if (substr(rtrim($m), -1) === "'") {   // el operador ' baja una línea antes de escribir
                $x = $lineX;
                $y = $lineY = $lineY - $leading;
            }
            $push($text);
        }
    }

    foreach ($items as &$it) {
        $it['text'] = pdf_repair_known_glyphs($it['text']);
    }
    return $items;
}

/** Devuelve todos los streams del PDF ya descomprimidos. */
function pdf_streams(string $raw): array
{
    $out = [];
    $offset = 0;
    while (($start = strpos($raw, 'stream', $offset)) !== false) {
        $end = strpos($raw, 'endstream', $start);
        if ($end === false) {
            break;
        }
        // El contenido comienza tras el EOL que sigue a "stream"
        $dataStart = $start + 6;
        if (substr($raw, $dataStart, 2) === "\r\n") {
            $dataStart += 2;
        } elseif ($raw[$dataStart] === "\n" || $raw[$dataStart] === "\r") {
            $dataStart += 1;
        }
        $chunk = substr($raw, $dataStart, $end - $dataStart);
        $offset = $end + 9;

        $decoded = @gzuncompress($chunk);
        if ($decoded === false) {
            $decoded = @gzinflate($chunk);
        }
        if ($decoded === false) {
            $decoded = $chunk; // puede venir sin comprimir
        }
        if ($decoded !== '') {
            $out[] = $decoded;
        }
    }
    return $out;
}

/**
 * Mapas de descifrado por nombre de recurso de fuente: ['F1' => ['codes' => [...], 'bytes' => 1], …]
 * Se cruzan los diccionarios /Font de los recursos con los objetos que tienen /ToUnicode.
 */
function pdf_font_maps(string $raw): array
{
    // 1) Objetos del documento: número => contenido del diccionario
    $objects = [];
    if (preg_match_all('/(\d+)\s+0\s+obj\b/', $raw, $m, PREG_OFFSET_CAPTURE)) {
        foreach ($m[1] as $i => $hit) {
            $num = (int)$hit[0];
            $from = $m[0][$i][1] + strlen($m[0][$i][0]);
            $endObj = strpos($raw, 'endobj', $from);
            $stream = strpos($raw, 'stream', $from);
            $to = ($stream !== false && ($endObj === false || $stream < $endObj)) ? $stream : $endObj;
            $objects[$num] = ['dict' => substr($raw, $from, ($to === false ? 400 : $to - $from)), 'start' => $from];
        }
    }

    // 2) Objetos de fuente que declaran /ToUnicode
    $toUnicodeOf = [];
    foreach ($objects as $num => $obj) {
        if (strpos($obj['dict'], '/Font') !== false && preg_match('#/ToUnicode\s+(\d+)\s+0\s+R#', $obj['dict'], $mm)) {
            $toUnicodeOf[$num] = (int)$mm[1];
        }
    }

    // 3) CMap de cada objeto /ToUnicode
    $cmapCache = [];
    $maps = [];
    foreach ($toUnicodeOf as $fontNum => $cmapNum) {
        if (!isset($objects[$cmapNum])) {
            continue;
        }
        if (!isset($cmapCache[$cmapNum])) {
            $cmapCache[$cmapNum] = pdf_parse_cmap(pdf_stream_at($raw, $objects[$cmapNum]['start']));
        }
        if ($cmapCache[$cmapNum]) {
            $maps[$fontNum] = $cmapCache[$cmapNum];
        }
    }

    // 4) Nombre del recurso (/F1) => objeto de fuente
    $byResource = [];
    if (preg_match_all('#/Font\s*<<(.+?)>>#s', $raw, $res)) {
        foreach ($res[1] as $block) {
            if (preg_match_all('#/([A-Za-z0-9_.\-]+)\s+(\d+)\s+0\s+R#', $block, $pairs, PREG_SET_ORDER)) {
                foreach ($pairs as $p) {
                    if (isset($maps[(int)$p[2]])) {
                        $byResource[$p[1]] = $maps[(int)$p[2]];
                    }
                }
            }
        }
    }
    return $byResource;
}

/** Contenido descomprimido del stream que sigue a la posición dada. */
function pdf_stream_at(string $raw, int $from): string
{
    $start = strpos($raw, 'stream', $from);
    if ($start === false) {
        return '';
    }
    $end = strpos($raw, 'endstream', $start);
    if ($end === false) {
        return '';
    }
    $dataStart = $start + 6;
    if (substr($raw, $dataStart, 2) === "\r\n") {
        $dataStart += 2;
    } elseif ($raw[$dataStart] === "\n" || $raw[$dataStart] === "\r") {
        $dataStart += 1;
    }
    $chunk = substr($raw, $dataStart, $end - $dataStart);
    $decoded = @gzuncompress($chunk);
    if ($decoded === false) {
        $decoded = @gzinflate($chunk);
    }
    return $decoded === false ? $chunk : $decoded;
}

/**
 * Interpreta un CMap /ToUnicode: bloques bfchar (código → carácter) y
 * bfrange (rango de códigos → carácter inicial o lista).
 */
function pdf_parse_cmap(string $cmap): ?array
{
    if ($cmap === '' || (strpos($cmap, 'beginbfchar') === false && strpos($cmap, 'beginbfrange') === false)) {
        return null;
    }
    $codes = [];
    $bytes = 1;

    if (preg_match('/begincodespacerange\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/', $cmap, $m)) {
        $bytes = max(1, (int)ceil(strlen($m[1]) / 2));
    }

    if (preg_match_all('/beginbfchar(.*?)endbfchar/s', $cmap, $blocks)) {
        foreach ($blocks[1] as $block) {
            if (preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/', $block, $pairs, PREG_SET_ORDER)) {
                foreach ($pairs as $p) {
                    $codes[hexdec($p[1])] = pdf_utf16_to_utf8($p[2]);
                }
            }
        }
    }

    if (preg_match_all('/beginbfrange(.*?)endbfrange/s', $cmap, $blocks)) {
        foreach ($blocks[1] as $block) {
            // <lo> <hi> <destino>
            if (preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/', $block, $ranges, PREG_SET_ORDER)) {
                foreach ($ranges as $r) {
                    $lo = hexdec($r[1]);
                    $hi = hexdec($r[2]);
                    $dst = hexdec($r[3]);
                    for ($c = $lo; $c <= $hi && $c - $lo < 65535; $c++) {
                        $codes[$c] = pdf_code_to_utf8($dst + ($c - $lo));
                    }
                }
            }
            // <lo> <hi> [<a> <b> <c>]
            if (preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]/s', $block, $lists, PREG_SET_ORDER)) {
                foreach ($lists as $l) {
                    $lo = hexdec($l[1]);
                    preg_match_all('/<([0-9A-Fa-f]+)>/', $l[3], $items);
                    foreach ($items[1] as $i => $hex) {
                        $codes[$lo + $i] = pdf_utf16_to_utf8($hex);
                    }
                }
            }
        }
    }
    return $codes ? ['codes' => $codes, 'bytes' => $bytes] : null;
}

function pdf_utf16_to_utf8(string $hex): string
{
    if (strlen($hex) % 4 !== 0) {
        $hex = str_pad($hex, (int)(ceil(strlen($hex) / 4) * 4), '0', STR_PAD_LEFT);
    }
    $bin = @hex2bin($hex);
    if ($bin === false) {
        return '';
    }
    $out = @mb_convert_encoding($bin, 'UTF-8', 'UTF-16BE');
    return $out === false ? '' : $out;
}

function pdf_code_to_utf8(int $code): string
{
    if ($code <= 0) {
        return '';
    }
    // Ojo: no usar ?: aquí — la cadena "0" es falsy en PHP y se perderían los ceros
    $ch = mb_chr($code, 'UTF-8');
    return $ch === false ? '' : $ch;
}

/** Traduce una cadena con el CMap de la fuente activa. */
function pdf_apply_cmap(string $bytes, array $map): string
{
    $len = max(1, (int)$map['bytes']);
    $codes = $map['codes'];
    $out = '';
    for ($i = 0; $i < strlen($bytes); $i += $len) {
        $code = 0;
        for ($j = 0; $j < $len; $j++) {
            $code = ($code << 8) | ord($bytes[$i + $j] ?? "\0");
        }
        $out .= $codes[$code] ?? '';
    }
    return $out;
}

/**
 * Algunos generadores emiten cada glifo con su propio ajuste de kerning, lo que
 * produce "F o l i o :" en vez de "Folio:". Si el texto trae una proporción de
 * espacios imposible para lenguaje natural, se colapsan los espacios sueltos.
 */
function pdf_normalize_spacing(string $text): string
{
    $len = mb_strlen($text);
    if ($len < 20) {
        return $text;
    }
    $spaces = mb_substr_count($text, ' ');
    if ($spaces / $len < 0.4) {
        return $text;
    }
    // Quita los espacios simples entre dos caracteres visibles; los espacios
    // reales sobreviven porque vienen en grupos de dos o más.
    $text = preg_replace('/(?<=\S) (?=\S)/u', '', $text);
    return preg_replace('/ {2,}/u', ' ', $text);
}

/**
 * Extrae el texto de un content stream ya descomprimido.
 * $fonts trae los CMaps por recurso; se sigue el operador Tf para saber cuál aplicar.
 */
function pdf_text_from_content(string $content, array $fonts = []): string
{
    $out = '';
    $cmap = null;   // CMap de la fuente activa
    // Operadores relevantes: /Fn size Tf | (str) Tj | [(a) n (b)] TJ | ' | Td/TD/T*
    $pattern = '#/[A-Za-z0-9_.\-]+\s+[\d.]+\s+Tf|\((?:\\\\.|[^\\\\()])*\)\s*(?:Tj|\')|\[(?:[^\[\]\\\\]|\\\\.)*\]\s*TJ|<[0-9A-Fa-f\s]+>\s*Tj|T\*|(?:[-\d.]+\s+){2}T[dD]|TL#s';
    if (!preg_match_all($pattern, $content, $matches)) {
        return '';
    }
    $decode = static function (string $bytes) use (&$cmap): string {
        return $cmap ? pdf_apply_cmap($bytes, $cmap) : pdf_decode_string_bytes($bytes);
    };

    foreach ($matches[0] as $m) {
        $m = trim($m);
        if ($m[0] === '/') {
            // Cambio de fuente: a partir de aquí se descifra con su tabla
            $name = substr($m, 1, strcspn($m, " \t\r\n", 1));
            $cmap = $fonts[$name] ?? null;
            continue;
        }
        if ($m === 'T*' || preg_match('/T[dD]$/', $m)) {
            $out .= "\n";
            continue;
        }
        if ($m[0] === '[') {
            // Arreglo TJ: concatenar las cadenas; los kerning muy grandes son espacios
            if (preg_match_all('/\((?:\\\\.|[^\\\\()])*\)|-?\d+(?:\.\d+)?/', $m, $parts)) {
                foreach ($parts[0] as $p) {
                    if ($p !== '' && $p[0] === '(') {
                        $out .= $decode(pdf_unescape_string(substr($p, 1, -1)));
                    } elseif ((float)$p <= -100) {
                        $out .= ' ';
                    }
                }
            }
            continue;
        }
        if ($m[0] === '<') {
            $hex = preg_replace('/[^0-9A-Fa-f]/', '', $m);
            $bin = @hex2bin(strlen($hex) % 2 ? substr($hex, 0, -1) : $hex);
            if ($bin !== false) {
                $out .= $decode($bin);
            }
            continue;
        }
        $close = strrpos($m, ')');
        $out .= $decode(pdf_unescape_string(substr($m, 1, $close - 1)));
    }

    return $out;
}

/**
 * Las cadenas de un PDF vienen en UTF-16BE (con o sin BOM) cuando la fuente usa
 * CID/Identity-H, o en WinAnsi (CP1252) con las fuentes estándar.
 */
function pdf_decode_string_bytes(string $out): string
{
    if ($out === '') {
        return '';
    }
    if (str_starts_with($out, "\xFE\xFF")) {
        $out = substr($out, 2);
        return mb_convert_encoding(pdf_even_length($out), 'UTF-8', 'UTF-16BE');
    }
    // Texto latino en UTF-16BE: la mitad de los bytes son NUL
    if (substr_count($out, "\x00") > strlen($out) * 0.2) {
        return mb_convert_encoding(pdf_even_length($out), 'UTF-8', 'UTF-16BE');
    }
    if (!mb_check_encoding($out, 'UTF-8')) {
        return mb_convert_encoding($out, 'UTF-8', 'CP1252');
    }
    return $out;
}

function pdf_even_length(string $s): string
{
    return strlen($s) % 2 === 0 ? $s : substr($s, 0, -1);
}

function pdf_unescape_string(string $s): string
{
    $map = ['\\n' => "\n", '\\r' => "\r", '\\t' => "\t", '\\b' => "\b", '\\f' => "\f",
            '\\(' => '(', '\\)' => ')', '\\\\' => '\\'];
    $s = strtr($s, $map);
    // Escapes octales \ddd
    return preg_replace_callback('/\\\\([0-7]{1,3})/', fn($m) => chr(octdec($m[1])), $s);
}

/**
 * Interpreta una ficha de identificación: devuelve los campos reconocidos.
 * Toma el valor de cada etiqueta hasta donde empieza la siguiente etiqueta conocida.
 */
function parse_ficha_identificacion(string $text): array
{
    // etiqueta en el PDF => llave de salida
    $labels = [
        'Folio'                    => 'folio',
        'Fecha y hora'             => 'fecha_hora',
        'Paciente'                 => 'nombre',
        'Fecha de nacimiento'      => 'fecha_nacimiento',
        'Edad'                     => 'edad',
        'Sexo'                     => 'sexo',
        'Grupo sanguineo'          => 'grupo_sanguineo',
        'Grupo sanguíneo'          => 'grupo_sanguineo',
        'Teléfono'                 => 'telefono',
        'Telefono'                 => 'telefono',
        'Correo electrónico'       => 'email',
        'Correo electronico'       => 'email',
        'Tipo de Identificación'   => 'tipo_id',
        'Número de Identificación' => 'numero_id',
        'Dirección'                => 'direccion',
        'Direccion'                => 'direccion',
        'Fumador'                  => 'fumador',
        'Anticoagulantes'          => 'anticoagulantes',
        'Legrado'                  => 'legrado',
        'Anticonceptivos'          => 'anticonceptivos',
        'FUR'                      => 'fur',
        'Médico'                   => 'medico',
        'Medico'                   => 'medico',
        'Síntomas'                 => 'sintomas',
        'Sintomas'                 => 'sintomas',
        'Medicamentos'             => 'medicamentos',
        'Estudios'                 => 'estudios',
        'Metodo de pago'           => 'pago_metodo',
        'Método de pago'           => 'pago_metodo',
        'Monto'                    => 'pago_monto',
    ];
    // Normalizar ligaduras tipográficas y espacios (el texto trae saltos por posicionamiento)
    $text = strtr($text, ['ﬁ' => 'fi', 'ﬂ' => 'fl', 'ﬀ' => 'ff', 'ﬃ' => 'ffi', 'ﬄ' => 'ffl', "\u{00A0}" => ' ']);
    $flat = preg_replace('/\s+/u', ' ', str_replace(["\r", "\n"], ' ', $text));
    if (trim($flat) === '') {
        return [];
    }

    // Posición de cada etiqueta seguida de ':'
    $hits = [];
    foreach ($labels as $label => $key) {
        $pos = 0;
        while (($p = mb_stripos($flat, $label . ':', $pos)) !== false) {
            $hits[] = ['pos' => $p, 'len' => mb_strlen($label) + 1, 'key' => $key];
            $pos = $p + 1;
        }
    }
    if (!$hits) {
        return [];
    }
    // Ante etiquetas solapadas en la misma posición gana la más larga (la más específica)
    usort($hits, fn($a, $b) => [$a['pos'], -$a['len']] <=> [$b['pos'], -$b['len']]);
    $unique = [];
    foreach ($hits as $hit) {
        $prev = end($unique);
        if ($prev && $hit['pos'] < $prev['pos'] + $prev['len']) {
            continue;
        }
        $unique[] = $hit;
    }
    $hits = $unique;

    $out = [];
    foreach ($hits as $i => $hit) {
        $start = $hit['pos'] + $hit['len'];
        $end = $hits[$i + 1]['pos'] ?? mb_strlen($flat);
        $value = trim(mb_substr($flat, $start, max(0, $end - $start)));
        // Limpiar títulos de sección que quedan pegados al final del valor
        $value = trim(preg_replace('/\s*(Historia Clínica|Firma del cliente|FICHA DE IDENTIFICACIÓN.*)$/iu', '', $value));
        $value = trim($value, " \t,;-");
        if ($value !== '' && !isset($out[$hit['key']])) {
            $out[$hit['key']] = mb_substr($value, 0, 300);
        }
    }
    return $out;
}
