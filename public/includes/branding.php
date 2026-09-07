<?php
/**
 * Personalización de marca: logotipo (sidebar/login/favicon/PWA) y catálogo de
 * temas de color. El logo se guarda como JSON en settings['branding']; las
 * imágenes viven en uploads/branding/. El tema elegido por cada usuario vive en
 * users.theme (columna aparte, no aquí — es por cuenta, no una config global).
 */

require_once __DIR__ . '/db.php';

const BRANDING_DIR = __DIR__ . '/../uploads/branding/';
const BRANDING_URL = 'uploads/branding/';

/** Paleta cerrada: el tema es una elección de una lista, no un color libre —
 *  Tailwind no puede "ver" un valor elegido en tiempo real, así que el color
 *  real de cada uno vive en CSS plano (src/tailwind.css, reglas [data-theme]). */
const BRANDING_THEMES = ['indigo', 'slate', 'emerald', 'rose', 'amber', 'sky', 'pink', 'violet'];

function branding_defaults(): array
{
    return [
        'logo_file'     => null, // imagen tal cual la subió el admin (sidebar/login, respeta su proporción)
        'icon_192_file' => null, // generado con GD: cuadrado, fondo blanco (favicon, apple-touch-icon, PWA)
        'icon_512_file' => null,
    ];
}

function branding_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $cfg = branding_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['branding']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
            }
        }
    } catch (Throwable $e) {
        error_log('branding_config: ' . $e->getMessage());
    }
    return $cfg;
}

/** Relee de la base de datos sin la caché estática de branding_config() — para
 *  cuando el propio request necesita ver el valor recién guardado. */
function branding_fresh(): array
{
    $cfg = branding_defaults();
    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute(['branding']);
    $row = $st->fetch();
    if ($row && $row['svalue']) {
        $saved = json_decode($row['svalue'], true);
        if (is_array($saved)) {
            $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
        }
    }
    return $cfg;
}

function branding_save(array $values): void
{
    $cfg = array_merge(branding_config(), array_intersect_key($values, branding_defaults()));
    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['branding']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'branding']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['branding', $json]);
    }
}

/** Ruta absoluta de una imagen de marca, o null si ya no existe en disco. */
function branding_path(?string $file): ?string
{
    if (!$file) {
        return null;
    }
    $file = basename($file);
    $path = BRANDING_DIR . $file;
    return is_file($path) ? $path : null;
}

/** URLs listas para <img>/<link>, o null cuando no hay logo personalizado. */
function branding_urls(bool $fresh = false): array
{
    $cfg = $fresh ? branding_fresh() : branding_config();
    $out = [];
    foreach (['logo_file' => 'logo', 'icon_192_file' => 'icon_192', 'icon_512_file' => 'icon_512'] as $key => $name) {
        $out[$name] = branding_path($cfg[$key]) ? BRANDING_URL . $cfg[$key] : null;
    }
    return $out;
}

/**
 * Genera un ícono cuadrado de $size px (fondo blanco, imagen fuente ajustada y
 * centrada sin recortarla) a partir de una imagen ya subida. Devuelve el nombre
 * del archivo generado dentro de BRANDING_DIR, o null si GD no está disponible.
 */
function branding_make_icon(string $srcPath, int $size, string $prefix): ?string
{
    if (!function_exists('imagecreatetruecolor')) {
        return null;
    }
    $info = @getimagesize($srcPath);
    if (!$info) {
        return null;
    }
    $src = match ($info[2]) {
        IMAGETYPE_PNG  => @imagecreatefrompng($srcPath),
        IMAGETYPE_JPEG => @imagecreatefromjpeg($srcPath),
        IMAGETYPE_GIF  => @imagecreatefromgif($srcPath),
        default        => null,
    };
    if (!$src) {
        return null;
    }

    $srcW = imagesx($src);
    $srcH = imagesy($src);
    $canvas = imagecreatetruecolor($size, $size);
    imagefill($canvas, 0, 0, imagecolorallocate($canvas, 255, 255, 255));

    $scale = min($size / $srcW, $size / $srcH);
    $w = max(1, (int)round($srcW * $scale));
    $h = max(1, (int)round($srcH * $scale));
    $x = (int)(($size - $w) / 2);
    $y = (int)(($size - $h) / 2);
    imagecopyresampled($canvas, $src, $x, $y, 0, 0, $w, $h, $srcW, $srcH);

    $name = $prefix . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)) . '.png';
    imagepng($canvas, BRANDING_DIR . $name);
    imagedestroy($src);
    imagedestroy($canvas);
    return is_file(BRANDING_DIR . $name) ? $name : null;
}

/** Borra del disco los archivos de marca que ya no se van a usar. */
function branding_unlink_all(array $cfg): void
{
    foreach (['logo_file', 'icon_192_file', 'icon_512_file'] as $key) {
        $path = branding_path($cfg[$key] ?? null);
        if ($path) {
            @unlink($path);
        }
    }
}
