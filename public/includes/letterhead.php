<?php
/**
 * Configuración de membretes (header, footer, marca de agua y firma del responsable).
 * Se guarda como JSON en settings['letterhead']; las imágenes viven en uploads/membretes/.
 */

require_once __DIR__ . '/db.php';

const LETTERHEAD_DIR = __DIR__ . '/../uploads/membretes/';
const LETTERHEAD_URL = 'uploads/membretes/';

/**
 * Áreas que firman documentos. Cada plantilla de estudio declara la suya
 * ("signature_area"); si no lo hace, se usa 'default'.
 * Agregar un área nueva = una línea aquí.
 */
const LETTERHEAD_AREAS = [
    'default'           => 'General / Biología Molecular',
    'analisis_clinicos' => 'Análisis Clínicos',
];

function letterhead_signature_defaults(): array
{
    $out = [];
    foreach (array_keys(LETTERHEAD_AREAS) as $area) {
        $out[$area] = ['file' => null, 'name' => '', 'license' => '', 'role' => 'Responsable Sanitario'];
    }
    return $out;
}

function letterhead_defaults(): array
{
    return [
        // Imágenes (nombre de archivo dentro de uploads/membretes/)
        'header_file'       => null,
        'footer_file'       => null,
        'watermark_file'    => null,
        // Geometría en milímetros (hoja carta: 215.9 x 279.4 mm)
        'margin_left'       => 15,
        'margin_right'      => 15,
        'header_top'        => 8,
        'header_height'     => 26,
        'footer_height'     => 24,
        'footer_bottom'     => 6,
        'watermark_width'   => 120,
        'watermark_opacity' => 10,
        'signature_width'   => 45,
        // Una firma por área: quien valida análisis clínicos no es quien valida biología molecular
        'signatures'        => letterhead_signature_defaults(),
        // Extras
        'show_page_numbers' => true,
    ];
}

/** Datos de la firma de un área, con respaldo en la general. */
function letterhead_signature(string $area = 'default'): array
{
    $cfg = letterhead_config();
    $sig = $cfg['signatures'][$area] ?? [];
    if (empty($sig['name']) && empty($sig['file']) && $area !== 'default') {
        $sig = $cfg['signatures']['default'] ?? [];
    }
    return $sig + ['file' => null, 'name' => '', 'license' => '', 'role' => ''];
}

function letterhead_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $cfg = letterhead_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['letterhead']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = letterhead_merge($cfg, $saved);
            }
        }
    } catch (Throwable $e) {
        error_log('letterhead_config: ' . $e->getMessage());
    }
    return $cfg;
}

/**
 * Mezcla la configuración guardada sobre los valores por omisión.
 * Las firmas se mezclan área por área y se admite el formato anterior
 * (una sola firma en signature_file / signer_name / signer_license / signer_role).
 */
function letterhead_merge(array $base, array $saved): array
{
    $signatures = $base['signatures'];

    // Formato anterior: se convierte en la firma general
    if (!empty($saved['signature_file']) || !empty($saved['signer_name'])) {
        $signatures['default'] = [
            'file'    => $saved['signature_file'] ?? null,
            'name'    => $saved['signer_name'] ?? '',
            'license' => $saved['signer_license'] ?? '',
            'role'    => $saved['signer_role'] ?? 'Responsable Sanitario',
        ];
    }
    if (!empty($saved['signatures']) && is_array($saved['signatures'])) {
        foreach ($saved['signatures'] as $area => $sig) {
            if (!isset($signatures[$area]) || !is_array($sig)) {
                continue;
            }
            $signatures[$area] = array_merge($signatures[$area], array_intersect_key($sig, $signatures[$area]));
        }
    }

    $cfg = array_merge($base, array_intersect_key($saved, $base));
    $cfg['signatures'] = $signatures;
    return $cfg;
}

function letterhead_save(array $values): void
{
    $cfg = letterhead_merge(letterhead_config(), $values);

    // Normalización numérica con rangos sensatos
    $ranges = [
        'margin_left' => [0, 50], 'margin_right' => [0, 50],
        'header_top' => [0, 60], 'header_height' => [0, 90],
        'footer_height' => [0, 90], 'footer_bottom' => [0, 60],
        'watermark_width' => [10, 200], 'watermark_opacity' => [0, 100],
        'signature_width' => [10, 100],
    ];
    foreach ($ranges as $key => [$min, $max]) {
        $cfg[$key] = max($min, min($max, (float)$cfg[$key]));
    }
    foreach ($cfg['signatures'] as $area => $sig) {
        foreach (['name', 'license', 'role'] as $field) {
            $cfg['signatures'][$area][$field] = mb_substr(trim((string)($sig[$field] ?? '')), 0, 120);
        }
    }
    $cfg['show_page_numbers'] = !empty($cfg['show_page_numbers']);

    // Los campos sueltos del formato anterior ya viven dentro de signatures
    unset($cfg['signature_file'], $cfg['signer_name'], $cfg['signer_license'], $cfg['signer_role']);

    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['letterhead']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'letterhead']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['letterhead', $json]);
    }
}

/** Ruta absoluta de una imagen del membrete, o null si no existe. */
function letterhead_path(?string $file): ?string
{
    if (!$file) {
        return null;
    }
    $file = basename($file);
    $path = LETTERHEAD_DIR . $file;
    return is_file($path) ? $path : null;
}

/**
 * Versión de la marca de agua aplanada sobre blanco según la opacidad configurada
 * (FPDF no soporta transparencia; el PDF tiene fondo blanco, así que se simula).
 * Devuelve la ruta del PNG cacheado o null.
 */
function letterhead_watermark_flat(array $cfg): ?string
{
    $src = letterhead_path($cfg['watermark_file']);
    if (!$src || !function_exists('imagecreatetruecolor')) {
        return null;
    }
    $opacity = (int)round($cfg['watermark_opacity']);
    if ($opacity <= 0) {
        return null;
    }
    $cacheDir = LETTERHEAD_DIR . 'cache/';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0775, true);
    }
    $cache = $cacheDir . 'wm-' . $opacity . '-' . substr(md5($src . filemtime($src)), 0, 10) . '.png';
    if (is_file($cache)) {
        return $cache;
    }

    $info = @getimagesize($src);
    if (!$info) {
        return null;
    }
    $img = match ($info[2]) {
        IMAGETYPE_PNG  => @imagecreatefrompng($src),
        IMAGETYPE_JPEG => @imagecreatefromjpeg($src),
        IMAGETYPE_GIF  => @imagecreatefromgif($src),
        default        => null,
    };
    if (!$img) {
        return null;
    }
    $w = imagesx($img);
    $h = imagesy($img);

    // 1) La marca sobre fondo blanco (resuelve su canal alfa)
    $onWhite = imagecreatetruecolor($w, $h);
    imagefill($onWhite, 0, 0, imagecolorallocate($onWhite, 255, 255, 255));
    imagecopy($onWhite, $img, 0, 0, 0, 0, $w, $h);

    // 2) Mezclar con blanco al porcentaje deseado
    $flat = imagecreatetruecolor($w, $h);
    imagefill($flat, 0, 0, imagecolorallocate($flat, 255, 255, 255));
    imagecopymerge($flat, $onWhite, 0, 0, 0, 0, $w, $h, $opacity);

    imagepng($flat, $cache);
    imagedestroy($img);
    imagedestroy($onWhite);
    imagedestroy($flat);
    return is_file($cache) ? $cache : null;
}

/** Borra las marcas de agua cacheadas (al cambiar imagen u opacidad). */
function letterhead_clear_cache(): void
{
    foreach (glob(LETTERHEAD_DIR . 'cache/wm-*.png') ?: [] as $f) {
        @unlink($f);
    }
}
