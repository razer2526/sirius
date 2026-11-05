<?php
/**
 * Imágenes y notas manuscritas de la descripción de una tarea (tabla task_assets, archivos en
 * uploads/tasks/, que .htaccess deniega: se sirven solo por task_asset.php).
 *
 * Una imagen se sube ANTES de guardar la tarea (en una tarea nueva todavía no existe su id), así que
 * nace sin tarea (task_id NULL) y solo la puede usar quien la subió. Al guardar la tarea, las que
 * aparecen en la descripción se enlazan a ella (task_assets_attach); las que no se usan se borran
 * pasado un día (task_assets_prune*), porque un guardado intermedio no debe llevarse una imagen
 * que apenas se subió.
 */

const TASK_ASSET_MAX_SIZE = 8 * 1024 * 1024;
const TASK_ASSETS_PER_TASK = 30;
const TASK_ASSET_DIR = __DIR__ . '/../uploads/tasks/';

/**
 * Imágenes que se pueden usar en la descripción de una tarea: las ya enlazadas a ella más las
 * recién subidas por este usuario que aún no tienen tarea. Nunca las de otra tarea ni de otra persona.
 *
 * @return int[]
 */
function task_assets_usable_ids(int $taskId, int $userId): array
{
    $st = db()->prepare(
        'SELECT id FROM task_assets WHERE (task_id IS NOT NULL AND task_id = ?) OR (task_id IS NULL AND created_by = ?)'
    );
    $st->execute([$taskId, $userId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Enlaza a la tarea las imágenes recién subidas que quedaron en su descripción. */
function task_assets_attach(int $taskId, array $usedIds, int $userId): void
{
    if (!$usedIds) {
        return;
    }
    $marks = implode(',', array_fill(0, count($usedIds), '?'));
    $st = db()->prepare("UPDATE task_assets SET task_id = ? WHERE task_id IS NULL AND created_by = ? AND id IN ($marks)");
    $st->execute(array_merge([$taskId, $userId], array_map('intval', $usedIds)));
}

/** Borra las imágenes de la tarea que ya no están en su descripción (solo las de más de un día). */
function task_assets_prune(int $taskId, array $usedIds): void
{
    $cutoff = date('Y-m-d H:i:s', time() - 86400);
    $st = db()->prepare('SELECT id, stored_name FROM task_assets WHERE task_id = ? AND created_at < ?');
    $st->execute([$taskId, $cutoff]);
    $used = array_flip(array_map('intval', $usedIds));
    foreach ($st->fetchAll() as $row) {
        if (!isset($used[(int)$row['id']])) {
            task_asset_remove($row);
        }
    }
}

/** Imágenes subidas que nunca llegaron a una tarea (se canceló el modal): se limpian pasado un día. */
function task_assets_prune_orphans(): void
{
    $cutoff = date('Y-m-d H:i:s', time() - 86400);
    $st = db()->prepare('SELECT id, stored_name FROM task_assets WHERE task_id IS NULL AND created_at < ?');
    $st->execute([$cutoff]);
    foreach ($st->fetchAll() as $row) {
        task_asset_remove($row);
    }
}

/** Borrado definitivo de una tarea: se van también sus archivos. (A la papelera NO: ahí se conservan para restaurar.) */
function task_assets_delete_for_task(int $taskId): void
{
    $st = db()->prepare('SELECT id, stored_name FROM task_assets WHERE task_id = ?');
    $st->execute([$taskId]);
    foreach ($st->fetchAll() as $row) {
        task_asset_remove($row);
    }
}

function task_asset_remove(array $row): void
{
    @unlink(TASK_ASSET_DIR . basename($row['stored_name']));
    db()->prepare('DELETE FROM task_assets WHERE id = ?')->execute([(int)$row['id']]);
}

/**
 * ¿Puede esta persona ver la tarea? Gestores, creador, asignados, y quien ve la tarea madre
 * (una subtarea se ve con su tarea). Mismo criterio que la lista de tasks/list.
 */
function task_user_can_view(array $task, array $me, bool $canManage): bool
{
    $meId = (int)$me['id'];
    if ($canManage) {
        return true;
    }
    $ids = [(int)$task['id']];
    if (!empty($task['parent_id'])) {
        $ids[] = (int)$task['parent_id'];
    }
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare(
        "SELECT 1 FROM tasks t WHERE t.id IN ($marks)
            AND (t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
         LIMIT 1"
    );
    $st->execute(array_merge($ids, [$meId, $meId]));
    return (bool)$st->fetch();
}
