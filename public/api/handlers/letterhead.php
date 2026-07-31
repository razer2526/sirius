<?php
/**
 * Handler letterhead: configuración de membretes (Admin Tools > Membretes).
 * Imágenes de encabezado, pie y marca de agua, geometría del PDF y una firma por área.
 */

require_once __DIR__ . '/../../includes/letterhead.php';

const LH_SLOTS = ['header', 'footer', 'watermark'];

function handle_letterhead(string $action): void
{
    switch ($action) {
        case 'get': {
            json_ok(letterhead_payload());
        }

        case 'save': {
            $b = request_body();
            letterhead_save($b);
            letterhead_clear_cache();
            log_activity('membretes', 'letterhead_save', 'Actualizó la configuración de membretes');
            json_ok(letterhead_payload(true));
        }

        case 'upload': {
            $slot = (string)($_POST['slot'] ?? '');
            $area = (string)($_POST['area'] ?? '');
            $isSignature = $slot === 'signature';
            if ($isSignature) {
                if (!isset(LETTERHEAD_AREAS[$area])) {
                    json_error('Área de firma no válida', 422);
                }
            } elseif (!in_array($slot, LH_SLOTS, true)) {
                json_error('Elemento de membrete no válido', 422);
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió la imagen', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > 6 * 1024 * 1024) {
                json_error('La imagen supera 6 MB', 422);
            }
            $info = @getimagesize($file['tmp_name']);
            $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif'];
            if (!$info || !isset($allowed[$info[2]])) {
                json_error('Solo se aceptan imágenes PNG, JPG o GIF', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }

            if (!is_dir(LETTERHEAD_DIR)) {
                @mkdir(LETTERHEAD_DIR, 0775, true);
            }
            $prefix = $isSignature ? 'firma-' . $area : $slot;
            $name = $prefix . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)) . '.' . $allowed[$info[2]];
            $dest = LETTERHEAD_DIR . $name;
            if (!move_uploaded_file($file['tmp_name'], $dest)) {
                json_error('No se pudo guardar la imagen', 500);
            }
            @chmod($dest, 0644);

            // Sustituye a la anterior
            $cfg = letterhead_config();
            $previous = letterhead_path($isSignature ? ($cfg['signatures'][$area]['file'] ?? null) : $cfg[$slot . '_file']);
            if ($previous) {
                @unlink($previous);
            }
            letterhead_save($isSignature
                ? ['signatures' => [$area => ['file' => $name]]]
                : [$slot . '_file' => $name]);
            letterhead_clear_cache();
            log_activity('membretes', 'letterhead_upload', 'Subió imagen de ' . ($isSignature ? "firma ($area)" : $slot));
            json_ok(letterhead_payload(true) + ['url' => LETTERHEAD_URL . $name]);
        }

        case 'remove': {
            $b = request_body();
            $slot = (string)($b['slot'] ?? '');
            $area = (string)($b['area'] ?? '');
            $isSignature = $slot === 'signature';
            if ($isSignature ? !isset(LETTERHEAD_AREAS[$area]) : !in_array($slot, LH_SLOTS, true)) {
                json_error('Elemento de membrete no válido', 422);
            }
            $cfg = letterhead_config();
            $previous = letterhead_path($isSignature ? ($cfg['signatures'][$area]['file'] ?? null) : $cfg[$slot . '_file']);
            if ($previous) {
                @unlink($previous);
            }
            letterhead_save($isSignature
                ? ['signatures' => [$area => ['file' => null]]]
                : [$slot . '_file' => null]);
            letterhead_clear_cache();
            log_activity('membretes', 'letterhead_remove', 'Quitó la imagen de ' . ($isSignature ? "firma ($area)" : $slot));
            json_ok(letterhead_payload(true));
        }
    }
}

/** Configuración + URLs de las imágenes, para pintar la pantalla de Membretes. */
function letterhead_payload(bool $fresh = false): array
{
    $cfg = $fresh ? letterhead_fresh() : letterhead_config();
    $urls = [];
    foreach (LH_SLOTS as $slot) {
        $file = $cfg[$slot . '_file'];
        $urls[$slot] = letterhead_path($file) ? LETTERHEAD_URL . $file : null;
    }
    $signatures = [];
    foreach (LETTERHEAD_AREAS as $area => $label) {
        $sig = $cfg['signatures'][$area] ?? [];
        $signatures[$area] = [
            'label'   => $label,
            'name'    => $sig['name'] ?? '',
            'license' => $sig['license'] ?? '',
            'role'    => $sig['role'] ?? '',
            'url'     => letterhead_path($sig['file'] ?? null) ? LETTERHEAD_URL . $sig['file'] : null,
        ];
    }
    return ['config' => $cfg, 'urls' => $urls, 'signatures' => $signatures];
}

/** Relee la configuración sin la caché estática de letterhead_config(). */
function letterhead_fresh(): array
{
    $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
    $st->execute(['letterhead']);
    $row = $st->fetch();
    $saved = ($row && $row['svalue']) ? (json_decode($row['svalue'], true) ?: []) : [];
    return letterhead_merge(letterhead_defaults(), $saved);
}
