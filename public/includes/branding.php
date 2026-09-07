<?php
/**
 * Personalización de marca: tres logotipos independientes (inicio de sesión,
 * sidebar y favicon/PWA) y catálogo de temas de color. Se guarda como JSON en
 * settings['branding']; las imágenes viven en uploads/branding/. El tema
 * elegido por cada usuario vive en users.theme (columna aparte, no aquí — es
 * por cuenta, no una config global).
 */

require_once __DIR__ . '/db.php';

const BRANDING_DIR = __DIR__ . '/../uploads/branding/';
const BRANDING_URL = 'uploads/branding/';

/** Cada logo se ve en un tamaño y contexto distinto (sidebar en miniatura,
 *  login más grande, favicon forzosamente cuadrado) — por eso son tres subidas
 *  independientes en vez de derivar todo de una sola imagen. */
const BRANDING_SLOTS = ['login', 'sidebar', 'favicon'];

/** Paleta cerrada: el tema es una elección de una lista, no un color libre —
 *  Tailwind no puede "ver" un valor elegido en tiempo real, así que el color
 *  real de cada uno vive en CSS plano (src/tailwind.css, reglas [data-theme]). */
const BRANDING_THEMES = ['indigo', 'slate', 'emerald', 'rose', 'amber', 'sky', 'pink', 'violet'];

function branding_defaults(): array
{
    return [
        'login_file'    => null, // logo de la pantalla de inicio de sesión, tal cual se subió
        'sidebar_file'  => null, // logo del sidebar, tal cual se subió
        'favicon_file'  => null, // imagen fuente del favicon (cuadrada), no se expone directo
        'icon_192_file' => null, // generado con GD a partir de favicon_file: favicon, apple-touch-icon, PWA
        'icon_512_file' => null,
    ];
}

/**
 * Compatibilidad con el formato anterior (un solo `logo_file` compartido para
 * sidebar y login): si ya existe pero aún no se migró a los slots nuevos, se
 * usa como valor inicial de ambos para no perder lo que el admin ya subió.
 */
function branding_merge(array $base, array $saved): array
{
    if (!empty($saved['logo_file']) && empty($saved['sidebar_file']) && empty($saved['login_file'])) {
        $base['sidebar_file'] = $saved['logo_file'];
        $base['login_file'] = $saved['logo_file'];
    }
    return array_merge($base, array_intersect_key($saved, $base));
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
                $cfg = branding_merge($cfg, $saved);
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
            $cfg = branding_merge($cfg, $saved);
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

/** URLs listas para <img>/<link>, o null cuando no hay logo personalizado.
 *  favicon_file no se expone: su vista previa es icon_192 (ya cuadrado). */
function branding_urls(bool $fresh = false): array
{
    $cfg = $fresh ? branding_fresh() : branding_config();
    $out = [];
    foreach ([
        'login_file'    => 'login',
        'sidebar_file'  => 'sidebar',
        'icon_192_file' => 'icon_192',
        'icon_512_file' => 'icon_512',
    ] as $key => $name) {
        $out[$name] = branding_path($cfg[$key]) ? BRANDING_URL . $cfg[$key] : null;
    }
    return $out;
}

/**
 * Genera un ícono cuadrado de $size px (fondo transparente, imagen fuente
 * ajustada y centrada sin recortarla — respeta el canal alfa del PNG en vez de
 * aplanarlo sobre blanco) a partir de una imagen ya subida. Devuelve el nombre
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
    // Sin blending al copiar: los píxeles (incluida su alfa) se copian tal
    // cual en vez de mezclarse con el fondo, así el recorte queda transparente
    // donde el PNG original lo era.
    imagealphablending($canvas, false);
    imagesavealpha($canvas, true);
    $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
    imagefill($canvas, 0, 0, $transparent);

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

/** Claves de settings['branding'] asociadas a un slot ('login'|'sidebar'|'favicon'). */
function branding_slot_keys(string $slot): array
{
    return $slot === 'favicon' ? ['favicon_file', 'icon_192_file', 'icon_512_file'] : [$slot . '_file'];
}

/** Borra del disco el/los archivo(s) de un slot antes de reemplazarlo o quitarlo. */
function branding_unlink_slot(array $cfg, string $slot): void
{
    foreach (branding_slot_keys($slot) as $key) {
        $path = branding_path($cfg[$key] ?? null);
        if ($path) {
            @unlink($path);
        }
    }
}
