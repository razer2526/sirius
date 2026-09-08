<?php
/**
 * Miniaturas de imágenes del gestor de Archivos: se generan una sola vez con
 * GD (mismo patrón que branding_make_icon()/letterhead_watermark_flat() —
 * caché en disco nombrado con un hash del origen) y se sirven cacheadas
 * después. Solo aplica a archivos cuyo mime empieza con "image/"; todo lo
 * demás (PDF, video, documentos…) sigue mostrando el ícono genérico por tipo.
 */

const FILE_THUMB_DIR = __DIR__ . '/../uploads/archivos/thumbs/';
const FILE_THUMB_MAX_DIM = 320;

/**
 * Ruta absoluta de la miniatura cacheada de $srcPath (la genera si hace
 * falta), o null si GD no está disponible o el formato no es soportado. El
 * nombre de caché incluye el mtime del origen: si el archivo cambiara de
 * contenido conservando su id (no pasa hoy en Archivos, pero por si acaso),
 * la miniatura se regenera sola en vez de servir una desactualizada.
 */
function file_thumbnail_path(string $srcPath, int $fileId): ?string
{
    if (!function_exists('imagecreatetruecolor')) {
        return null;
    }
    $mtime = @filemtime($srcPath);
    if ($mtime === false) {
        return null;
    }
    $cacheFile = FILE_THUMB_DIR . "thumb-{$fileId}-" . substr(md5($srcPath . $mtime), 0, 12) . '.png';
    if (is_file($cacheFile)) {
        return $cacheFile;
    }

    $info = @getimagesize($srcPath);
    if (!$info) {
        return null;
    }
    $src = match ($info[2]) {
        IMAGETYPE_PNG  => @imagecreatefrompng($srcPath),
        IMAGETYPE_JPEG => @imagecreatefromjpeg($srcPath),
        IMAGETYPE_GIF  => @imagecreatefromgif($srcPath),
        IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($srcPath) : null,
        default        => null,
    };
    if (!$src) {
        return null;
    }

    $srcW = imagesx($src);
    $srcH = imagesy($src);
    // Nunca agranda una imagen ya más chica que el máximo.
    $scale = min(1, FILE_THUMB_MAX_DIM / max($srcW, $srcH));
    $w = max(1, (int)round($srcW * $scale));
    $h = max(1, (int)round($srcH * $scale));

    $canvas = imagecreatetruecolor($w, $h);
    // Sin blending al copiar: preserva el canal alfa del PNG/GIF original en
    // vez de aplanarlo (mismo truco que branding_make_icon()).
    imagealphablending($canvas, false);
    imagesavealpha($canvas, true);
    $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
    imagefill($canvas, 0, 0, $transparent);
    imagecopyresampled($canvas, $src, 0, 0, 0, 0, $w, $h, $srcW, $srcH);

    if (!is_dir(FILE_THUMB_DIR)) {
        @mkdir(FILE_THUMB_DIR, 0775, true);
    }
    imagepng($canvas, $cacheFile);
    imagedestroy($src);
    imagedestroy($canvas);
    return is_file($cacheFile) ? $cacheFile : null;
}

/** Borra las miniaturas cacheadas de un archivo — se llama al purgarlo en definitiva desde Papelera. */
function file_thumbnail_purge(int $fileId): void
{
    foreach (glob(FILE_THUMB_DIR . "thumb-{$fileId}-*.png") ?: [] as $f) {
        @unlink($f);
    }
}
