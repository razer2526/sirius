<?php
/**
 * Cron de sincronización entrante de Google Calendar → Sirius.
 * Configurar en cPanel > Cron Jobs cada 5-15 minutos, con cualquiera de estas dos formas:
 *
 *   1) Línea de comandos (recomendada, no necesita la clave):
 *      /usr/local/bin/php /home/usuario/public_html/cron_calendar_sync.php
 *
 *   2) URL (si el hosting solo permite invocar por HTTP, ej. wget/curl):
 *      https://tu-dominio.com/cron_calendar_sync.php?key=<cron_key de config.php>
 */

require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/calendar_sync.php';

header('Content-Type: text/plain; charset=utf-8');

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    $key = (string)($_GET['key'] ?? '');
    if (!hash_equals((string)app_config()['cron_key'], $key)) {
        http_response_code(403);
        exit("Clave no válida.\n");
    }
}

if (!gcal_is_connected()) {
    echo "Sin cuenta de Google Calendar conectada; nada que sincronizar.\n";
    exit;
}

try {
    $stats = gcal_sync_pull();
    printf(
        "Sincronización OK — importadas: %d, actualizadas: %d, canceladas: %d, sin cambios: %d\n",
        $stats['imported'],
        $stats['updated'],
        $stats['cancelled'],
        $stats['skipped']
    );
} catch (Throwable $e) {
    error_log('cron_calendar_sync: ' . $e->getMessage());
    http_response_code(500);
    echo 'Error de sincronización: ' . $e->getMessage() . "\n";
}
