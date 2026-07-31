<?php
/**
 * Handler backups: información y restauración (Admin Tools > Backup).
 * La descarga del respaldo se hace por respaldo.php, para que el navegador
 * reciba un archivo y no una respuesta JSON.
 */

require_once __DIR__ . '/../../includes/backup.php';

function handle_backups(string $action): void
{
    // Respaldar y restaurar toca toda la base: se exige rol de administrador,
    // no basta con tener el módulo habilitado.
    if (!is_admin_role(current_user())) {
        json_error('Esta acción requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'info': {
            json_ok([
                'groups' => backup_counts(),
                'driver' => db_driver(),
                'date'   => date('Y-m-d H:i'),
            ]);
        }

        /** Analiza el archivo recibido sin aplicar nada, para mostrar qué contiene. */
        case 'inspect': {
            $backup = backup_uploaded_file();
            try {
                $summary = backup_validate($backup);
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            json_ok([
                'created_at' => $backup['created_at'] ?? null,
                'driver'     => $backup['driver'] ?? null,
                'groups'     => $backup['groups'] ?? [],
                'tables'     => $summary,
                'total'      => array_sum($summary),
            ]);
        }

        case 'restore': {
            $backup = backup_uploaded_file();
            $replace = !empty($_POST['replace']);
            // Confirmación explícita: el reemplazo borra los datos actuales
            if ($replace && ($_POST['confirm'] ?? '') !== 'REEMPLAZAR') {
                json_error('Escribe REEMPLAZAR para confirmar que se sustituirán los datos actuales', 422);
            }
            try {
                $restored = backup_restore($backup, $replace);
            } catch (Throwable $e) {
                error_log('backup_restore: ' . $e->getMessage());
                json_error('No se pudo restaurar: ' . $e->getMessage(), 500);
            }
            log_activity(
                'backup',
                $replace ? 'restore_replace' : 'restore_merge',
                'Restauró respaldo del ' . ($backup['created_at'] ?? '?') . ' · ' . array_sum($restored) . ' registros'
            );
            json_ok(['restored' => $restored, 'total' => array_sum($restored), 'replace' => $replace]);
        }
    }
}

/** Lee y decodifica el archivo de respaldo recibido. */
function backup_uploaded_file(): array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_error('No se recibió el archivo de respaldo', 422);
    }
    $file = $_FILES['file'];
    if ($file['size'] > 64 * 1024 * 1024) {
        json_error('El respaldo supera 64 MB', 422);
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        json_error('Subida no válida', 422);
    }
    $json = file_get_contents($file['tmp_name']);
    $data = json_decode($json, true);
    if (!is_array($data)) {
        json_error('El archivo no es un respaldo válido (JSON ilegible)', 422);
    }
    return $data;
}
