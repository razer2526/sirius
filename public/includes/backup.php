<?php
/**
 * Respaldo y restauración de la base de datos.
 *
 * El archivo es JSON, no SQL: así el mismo respaldo sirve en MySQL (producción)
 * y en SQLite (desarrollo), y no depende de mysqldump —que en hosting compartido
 * no suele estar disponible.
 */

require_once __DIR__ . '/db.php';

/**
 * Grupos de respaldo. El orden dentro de cada grupo respeta las dependencias:
 * al restaurar se insertan las tablas padre antes que las hijas.
 */
function backup_groups(): array
{
    return [
        'usuarios'   => ['label' => 'Usuarios y permisos', 'tables' => ['users', 'user_permissions']],
        'pacientes'  => ['label' => 'Pacientes y expedientes', 'tables' => ['patients', 'episodes', 'consultations']],
        'tareas'     => ['label' => 'Tareas y proyectos', 'tables' => ['projects', 'tasks', 'task_completions']],
        'documentos' => ['label' => 'Estudios y catálogo de laboratorio', 'tables' => ['documents', 'lab_tests', 'lab_reference_ranges']],
        'config'     => ['label' => 'Configuración (membretes, ajustes)', 'tables' => ['settings']],
        'bitacora'   => ['label' => 'Bitácora de actividad', 'tables' => ['activity_log']],
    ];
}

/** Orden global de restauración: las tablas referenciadas van primero. */
function backup_table_order(): array
{
    return [
        'users', 'user_permissions', 'settings',
        'patients', 'episodes', 'consultations',
        'projects', 'tasks', 'task_completions',
        'lab_tests', 'lab_reference_ranges', 'documents',
        'activity_log',
    ];
}

function backup_table_exists(string $table): bool
{
    try {
        db()->query("SELECT 1 FROM $table LIMIT 1");
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

/** Número de registros por grupo, para mostrarlo antes de exportar. */
function backup_counts(): array
{
    $out = [];
    foreach (backup_groups() as $key => $group) {
        $tables = [];
        $total = 0;
        foreach ($group['tables'] as $t) {
            if (!backup_table_exists($t)) {
                continue;
            }
            $n = (int)db()->query("SELECT COUNT(*) c FROM $t")->fetch()['c'];
            $tables[$t] = $n;
            $total += $n;
        }
        $out[$key] = ['label' => $group['label'], 'tables' => $tables, 'total' => $total];
    }
    return $out;
}

/**
 * Genera el respaldo de los grupos indicados.
 * Devuelve la estructura completa lista para codificar como JSON.
 */
function backup_create(array $groupKeys): array
{
    $groups = backup_groups();
    $data = [];
    $selected = [];

    foreach ($groupKeys as $key) {
        if (!isset($groups[$key])) {
            continue;
        }
        $selected[] = $key;
        foreach ($groups[$key]['tables'] as $table) {
            if (!backup_table_exists($table)) {
                continue;
            }
            $rows = db()->query("SELECT * FROM $table")->fetchAll(PDO::FETCH_ASSOC);
            $data[$table] = $rows;
        }
    }

    return [
        'sirius_backup' => 1,
        'created_at'    => date('Y-m-d H:i:s'),
        'driver'        => db_driver(),
        'groups'        => $selected,
        'tables'        => $data,
    ];
}

/** Valida la forma del archivo antes de tocar nada. */
function backup_validate(array $backup): array
{
    if (empty($backup['sirius_backup']) || !isset($backup['tables']) || !is_array($backup['tables'])) {
        throw new RuntimeException('El archivo no es un respaldo de Sirius.');
    }
    $summary = [];
    foreach ($backup['tables'] as $table => $rows) {
        if (!in_array($table, backup_table_order(), true)) {
            continue;   // se ignoran tablas desconocidas en vez de fallar
        }
        $summary[$table] = is_array($rows) ? count($rows) : 0;
    }
    if (!$summary) {
        throw new RuntimeException('El respaldo no contiene tablas reconocibles.');
    }
    return $summary;
}

/**
 * Restaura el respaldo. Con $replace se vacían las tablas incluidas antes de
 * insertar; sin él solo se agregan los registros que no existan por id.
 * Todo ocurre en una transacción: si algo falla, la base queda como estaba.
 */
function backup_restore(array $backup, bool $replace): array
{
    $summary = backup_validate($backup);
    $pdo = db();
    $isMysql = db_driver() === 'mysql';

    // Las claves foráneas se relajan mientras dura la carga
    if ($isMysql) {
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    } else {
        $pdo->exec('PRAGMA foreign_keys = OFF');
    }

    $restored = [];
    $pdo->beginTransaction();
    try {
        $tables = array_values(array_filter(backup_table_order(), fn($t) => isset($summary[$t])));

        if ($replace) {
            // Se vacían en orden inverso para no romper dependencias
            foreach (array_reverse($tables) as $table) {
                if (backup_table_exists($table)) {
                    $pdo->exec("DELETE FROM $table");
                }
            }
        }

        foreach ($tables as $table) {
            if (!backup_table_exists($table)) {
                continue;
            }
            $rows = $backup['tables'][$table];
            if (!$rows) {
                $restored[$table] = 0;
                continue;
            }
            // Solo se escriben las columnas que existen en esta instalación
            $existing = backup_columns_of($table);
            $count = 0;
            $stmt = null;
            $cols = null;

            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $row = array_intersect_key($row, array_flip($existing));
                if (!$row) {
                    continue;
                }
                if ($cols !== array_keys($row)) {
                    $cols = array_keys($row);
                    $marks = implode(',', array_fill(0, count($cols), '?'));
                    $verb = $replace ? 'INSERT' : ($isMysql ? 'INSERT IGNORE' : 'INSERT OR IGNORE');
                    $stmt = $pdo->prepare("$verb INTO $table (" . implode(',', $cols) . ") VALUES ($marks)");
                }
                $stmt->execute(array_values($row));
                $count++;
            }
            $restored[$table] = $count;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    } finally {
        if ($isMysql) {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        } else {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }
    }
    return $restored;
}

/** Columnas reales de una tabla en esta instalación. */
function backup_columns_of(string $table): array
{
    static $cache = [];
    if (isset($cache[$table])) {
        return $cache[$table];
    }
    $cols = [];
    if (db_driver() === 'mysql') {
        foreach (db()->query("SHOW COLUMNS FROM $table")->fetchAll() as $c) {
            $cols[] = $c['Field'];
        }
    } else {
        foreach (db()->query("PRAGMA table_info($table)")->fetchAll() as $c) {
            $cols[] = $c['name'];
        }
    }
    return $cache[$table] = $cols;
}
