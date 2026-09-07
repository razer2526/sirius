<?php
/**
 * Handler branding: logotipos de la app (solo administrador, uno por slot:
 * login/sidebar/favicon) y tema de color por usuario (cualquiera).
 * Configuración es un módulo universal — sin permiso de módulo que filtre por
 * rol — así que el chequeo de administrador para los logos vive aquí adentro,
 * no en el ruteo (mismo patrón que handle_calendar()).
 */

require_once __DIR__ . '/../../includes/branding.php';

const BRANDING_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const BRANDING_ALLOWED_TYPES = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif'];

function handle_branding(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'get': {
            json_ok([
                'urls'   => branding_urls(),
                'theme'  => $me['theme'] ?? null,
                'themes' => BRANDING_THEMES,
            ]);
        }

        case 'upload_logo': {
            branding_require_admin($me);
            $slot = (string)($_POST['slot'] ?? '');
            if (!in_array($slot, BRANDING_SLOTS, true)) {
                json_error('Elemento de personalización no válido', 422);
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió la imagen', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > BRANDING_MAX_UPLOAD_BYTES) {
                json_error('La imagen supera 4 MB', 422);
            }
            $info = @getimagesize($file['tmp_name']);
            if (!$info || !isset(BRANDING_ALLOWED_TYPES[$info[2]])) {
                json_error('Solo se aceptan imágenes PNG, JPG o GIF', 422);
            }
            if ($slot === 'favicon' && $info[0] !== $info[1]) {
                json_error('El favicon debe ser una imagen cuadrada (mismo ancho y alto)', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            if (!is_dir(BRANDING_DIR)) {
                @mkdir(BRANDING_DIR, 0775, true);
            }

            $ext = BRANDING_ALLOWED_TYPES[$info[2]];
            $name = $slot . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)) . '.' . $ext;
            $dest = BRANDING_DIR . $name;
            if (!move_uploaded_file($file['tmp_name'], $dest)) {
                json_error('No se pudo guardar la imagen', 500);
            }
            @chmod($dest, 0644);

            branding_unlink_slot(branding_config(), $slot);

            if ($slot === 'favicon') {
                // El favicon necesita tamaños cuadrados fijos para la pestaña, el
                // apple-touch-icon y el manifest de PWA — se generan aquí una sola
                // vez a partir de la imagen recién subida.
                $icon192 = branding_make_icon($dest, 192, 'icon-192');
                $icon512 = branding_make_icon($dest, 512, 'icon-512');
                branding_save(['favicon_file' => $name, 'icon_192_file' => $icon192, 'icon_512_file' => $icon512]);
            } else {
                branding_save([$slot . '_file' => $name]);
            }

            log_activity('api', 'branding_upload_logo', 'Actualizó el logotipo de ' . branding_slot_label($slot));
            json_ok(['urls' => branding_urls(true)]);
        }

        case 'remove_logo': {
            branding_require_admin($me);
            $slot = (string)(request_body()['slot'] ?? '');
            if (!in_array($slot, BRANDING_SLOTS, true)) {
                json_error('Elemento de personalización no válido', 422);
            }
            branding_unlink_slot(branding_config(), $slot);
            branding_save($slot === 'favicon'
                ? ['favicon_file' => null, 'icon_192_file' => null, 'icon_512_file' => null]
                : [$slot . '_file' => null]);
            log_activity('api', 'branding_remove_logo', 'Quitó el logotipo de ' . branding_slot_label($slot));
            json_ok(['urls' => branding_urls(true)]);
        }

        case 'save_theme': {
            $theme = trim((string)(request_body()['theme'] ?? ''));
            if ($theme !== '' && !in_array($theme, BRANDING_THEMES, true)) {
                json_error('Tema no válido', 422);
            }
            db()->prepare('UPDATE users SET theme = ? WHERE id = ?')->execute([$theme ?: null, (int)$me['id']]);
            log_activity('api', 'branding_save_theme', 'Cambió su tema a "' . ($theme ?: 'índigo') . '"');
            json_ok(['theme' => $theme ?: null]);
        }
    }
}

function branding_slot_label(string $slot): string
{
    return match ($slot) {
        'login'   => 'la pantalla de inicio de sesión',
        'sidebar' => 'el sidebar',
        'favicon' => 'el favicon',
        default   => $slot,
    };
}

function branding_require_admin(?array $user): void
{
    if (!is_admin_role($user)) {
        json_error('Esta acción requiere rol de administrador', 403);
    }
}
