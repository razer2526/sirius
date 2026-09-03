<?php
/**
 * Papelera: archivar (soft-delete) y restaurar filas de tasks/projects/
 * result_deliveries/board_items borradas por un usuario estándar.
 */

require_once __DIR__ . '/db.php';

const TRASH_TASK_COLUMNS = ['id', 'project_id', 'parent_id', 'title', 'description', 'assigned_to',
    'priority', 'due_date', 'recurrence', 'status', 'completed_at', 'created_by', 'created_at', 'updated_at'];
const TRASH_PROJECT_COLUMNS = ['id', 'name', 'description', 'due_date', 'status', 'created_by', 'created_at', 'updated_at'];
const TRASH_RESULT_COLUMNS = ['id', 'patient_name', 'sample_date', 'due_date', 'studies',
    'needs_invoice', 'invoice_sent', 'observations', 'created_by', 'created_at'];
const TRASH_BOARD_COLUMNS = ['id', 'scope', 'owner_id', 'type', 'title', 'content', 'color',
    'pos_x', 'pos_y', 'width', 'height', 'z_index', 'created_by', 'created_at', 'updated_at'];

/** Historial de cumplimiento de una tarea recurrente, para que no se pierda al archivar/restaurar. */
function task_completions_for(int $taskId): array
{
    $st = db()->prepare('SELECT period_key, completed_by, completed_at FROM task_completions WHERE task_id = ?');
    $st->execute([$taskId]);
    return $st->fetchAll();
}

/** Inserta una fila en trash_items y regresa su id. */
function trash_archive(
    string $entityType,
    int $entityId,
    array $row,
    ?array $assignees,
    ?array $completions,
    string $summary,
    array $me,
    ?int $relatedTrashId = null
): int {
    $snapshot = ['row' => $row];
    if ($assignees !== null) {
        $snapshot['assignees'] = $assignees;
    }
    if ($completions !== null) {
        $snapshot['completions'] = $completions;
    }
    $st = db()->prepare(
        'INSERT INTO trash_items (entity_type, entity_id, summary, snapshot, related_trash_id, archived_by, archived_by_name, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $st->execute([
        $entityType, $entityId, mb_substr($summary, 0, 250), json_encode($snapshot, JSON_UNESCAPED_UNICODE),
        $relatedTrashId, $me['id'] ?? null, $me['full_name'] ?? null, date('Y-m-d H:i:s'),
    ]);
    return (int)db()->lastInsertId();
}

function find_trash_item(int $id): array
{
    $st = db()->prepare('SELECT * FROM trash_items WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Elemento no encontrado en la papelera', 404);
    }
    return $row;
}

/** INSERT explícito columna por columna, preservando el id original (ver riesgo de colisión en el plan). */
function trash_insert_exact(PDO $pdo, string $table, array $columns, array $row): void
{
    $marks = implode(',', array_fill(0, count($columns), '?'));
    $cols = implode(',', $columns);
    $values = array_map(fn($c) => $row[$c] ?? null, $columns);
    $pdo->prepare("INSERT INTO $table ($cols) VALUES ($marks)")->execute($values);
}

/** Restaura una fila de trash_items a su tabla original. Debe llamarse dentro de una transacción. */
function trash_restore_row(array $trashRow): void
{
    $snapshot = json_decode((string)$trashRow['snapshot'], true) ?: [];
    $row = $snapshot['row'] ?? [];
    $pdo = db();

    switch ($trashRow['entity_type']) {
        case 'task':
            trash_restore_task($pdo, $row, $snapshot['assignees'] ?? [], $snapshot['completions'] ?? []);
            break;
        case 'project':
            trash_restore_project($pdo, $row, $snapshot['assignees'] ?? [], (int)$trashRow['id']);
            break;
        case 'result_delivery':
            trash_insert_exact($pdo, 'result_deliveries', TRASH_RESULT_COLUMNS, $row);
            break;
        case 'board_item':
            trash_insert_exact($pdo, 'board_items', TRASH_BOARD_COLUMNS, $row);
            break;
        default:
            throw new RuntimeException('Tipo de elemento desconocido: ' . $trashRow['entity_type']);
    }
}

function trash_restore_task(PDO $pdo, array $row, array $assignees, array $completions): void
{
    // Si el proyecto de la tarea ya no existe en vivo (sigue en la papelera, o fue
    // purgado), se restaura sin proyecto en vez de bloquear la restauración.
    if (!empty($row['project_id'])) {
        $st = $pdo->prepare('SELECT 1 FROM projects WHERE id = ?');
        $st->execute([$row['project_id']]);
        if (!$st->fetch()) {
            $row['project_id'] = null;
        }
    }
    trash_insert_exact($pdo, 'tasks', TRASH_TASK_COLUMNS, $row);
    foreach ($assignees as $uid) {
        $pdo->prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)')->execute([$row['id'], $uid]);
    }
    foreach ($completions as $c) {
        $pdo->prepare('INSERT INTO task_completions (task_id, period_key, completed_by, completed_at) VALUES (?, ?, ?, ?)')
            ->execute([$row['id'], $c['period_key'], $c['completed_by'], $c['completed_at']]);
    }
}

function trash_restore_project(PDO $pdo, array $row, array $assignees, int $trashId): void
{
    trash_insert_exact($pdo, 'projects', TRASH_PROJECT_COLUMNS, $row);
    foreach ($assignees as $uid) {
        $pdo->prepare('INSERT INTO project_assignees (project_id, user_id) VALUES (?, ?)')->execute([$row['id'], $uid]);
    }
    // Cascada: restaura y limpia las tareas que se archivaron junto con este proyecto.
    $st = $pdo->prepare("SELECT * FROM trash_items WHERE related_trash_id = ? AND entity_type = 'task'");
    $st->execute([$trashId]);
    foreach ($st->fetchAll() as $childTrash) {
        trash_restore_row($childTrash);
        $pdo->prepare('DELETE FROM trash_items WHERE id = ?')->execute([$childTrash['id']]);
    }
}
