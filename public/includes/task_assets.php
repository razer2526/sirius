<?php
/**
 * Imágenes y notas manuscritas de la descripción de una tarea o de un proyecto (tabla task_assets, archivos en
 * uploads/tasks/, que .htaccess deniega: se sirven solo por task_asset.php).
 *
 * Una imagen se sube ANTES de guardar la tarea o el proyecto (en uno nuevo todavía no existe su id), así que
 * nace sin dueño (task_id y project_id NULL) y solo la puede usar quien la subió. Al guardar, las que
 * aparecen en la descripción se enlazan (task_assets_attach / project_assets_attach); las que no se usan se
 * borran pasado un día (…_prune*), porque un guardado intermedio no debe llevarse una imagen que apenas se subió.
 */

const TASK_ASSET_MAX_SIZE = 8 * 1024 * 1024;
const TASK_ASSETS_PER_TASK = 30;
const TASK_ASSET_DIR = __DIR__ . '/../uploads/tasks/';

/** Condición SQL de «recién subida por este usuario y aún sin dueño». */
const TASK_ASSET_UNOWNED = 'task_id IS NULL AND project_id IS NULL AND created_by = ?';

/**
 * Imágenes que se pueden usar en la descripción de una tarea: las ya enlazadas a ella más las
 * recién subidas por este usuario que aún no tienen dueño. Nunca las de otra tarea ni de otra persona.
 *
 * @return int[]
 */
function task_assets_usable_ids(int $taskId, int $userId): array
{
    $st = db()->prepare('SELECT id FROM task_assets WHERE (task_id IS NOT NULL AND task_id = ?) OR (' . TASK_ASSET_UNOWNED . ')');
    $st->execute([$taskId, $userId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Lo mismo para la descripción de un proyecto. @return int[] */
function project_assets_usable_ids(int $projectId, int $userId): array
{
    $st = db()->prepare('SELECT id FROM task_assets WHERE (project_id IS NOT NULL AND project_id = ?) OR (' . TASK_ASSET_UNOWNED . ')');
    $st->execute([$projectId, $userId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Enlaza a la tarea las imágenes recién subidas que quedaron en su descripción. */
function task_assets_attach(int $taskId, array $usedIds, int $userId): void
{
    task_assets_set_owner('task_id', $taskId, $usedIds, $userId);
}

/** Enlaza al proyecto las imágenes recién subidas que quedaron en su descripción. */
function project_assets_attach(int $projectId, array $usedIds, int $userId): void
{
    task_assets_set_owner('project_id', $projectId, $usedIds, $userId);
}

/** $column es un literal que decide el código ('task_id' | 'project_id'), nunca el request. */
function task_assets_set_owner(string $column, int $ownerId, array $usedIds, int $userId): void
{
    if (!$usedIds) {
        return;
    }
    $marks = implode(',', array_fill(0, count($usedIds), '?'));
    $st = db()->prepare("UPDATE task_assets SET $column = ? WHERE " . TASK_ASSET_UNOWNED . " AND id IN ($marks)");
    $st->execute(array_merge([$ownerId, $userId], array_map('intval', $usedIds)));
}

/** Borra las imágenes de la tarea que ya no están en su descripción (solo las de más de un día). */
function task_assets_prune(int $taskId, array $usedIds): void
{
    task_assets_prune_owner('task_id', $taskId, $usedIds);
}

/** Borra las imágenes del proyecto que ya no están en su descripción (solo las de más de un día). */
function project_assets_prune(int $projectId, array $usedIds): void
{
    task_assets_prune_owner('project_id', $projectId, $usedIds);
}

function task_assets_prune_owner(string $column, int $ownerId, array $usedIds): void
{
    $cutoff = date('Y-m-d H:i:s', time() - 86400);
    $st = db()->prepare("SELECT id, stored_name FROM task_assets WHERE $column = ? AND created_at < ?");
    $st->execute([$ownerId, $cutoff]);
    $used = array_flip(array_map('intval', $usedIds));
    foreach ($st->fetchAll() as $row) {
        if (!isset($used[(int)$row['id']])) {
            task_asset_remove($row);
        }
    }
}

/** Imágenes subidas que nunca llegaron a una tarea ni a un proyecto (se canceló el modal): se limpian pasado un día. */
function task_assets_prune_orphans(): void
{
    $cutoff = date('Y-m-d H:i:s', time() - 86400);
    $st = db()->prepare('SELECT id, stored_name FROM task_assets WHERE task_id IS NULL AND project_id IS NULL AND created_at < ?');
    $st->execute([$cutoff]);
    foreach ($st->fetchAll() as $row) {
        task_asset_remove($row);
    }
}

/** Borrado definitivo de una tarea: se van también sus archivos. (A la papelera NO: ahí se conservan para restaurar.) */
function task_assets_delete_for_task(int $taskId): void
{
    task_assets_delete_owned('task_id', $taskId);
}

/** Borrado definitivo de un proyecto: se van también los archivos de su descripción. */
function project_assets_delete(int $projectId): void
{
    task_assets_delete_owned('project_id', $projectId);
}

function task_assets_delete_owned(string $column, int $ownerId): void
{
    $st = db()->prepare("SELECT id, stored_name FROM task_assets WHERE $column = ?");
    $st->execute([$ownerId]);
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

/**
 * ¿Puede esta persona ver el proyecto? Gestores, quien lo creó, sus asignados, o quien tiene alguna tarea
 * visible dentro de él (mismo criterio que la lista de tasks/list).
 */
function project_user_can_view(array $project, array $me, bool $canManage): bool
{
    $meId = (int)$me['id'];
    if ($canManage || (int)$project['created_by'] === $meId) {
        return true;
    }
    $st = db()->prepare('SELECT 1 FROM project_assignees WHERE project_id = ? AND user_id = ? LIMIT 1');
    $st->execute([(int)$project['id'], $meId]);
    if ($st->fetch()) {
        return true;
    }
    $st = db()->prepare(
        'SELECT 1 FROM tasks t WHERE t.project_id = ?
            AND (t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
         LIMIT 1'
    );
    $st->execute([(int)$project['id'], $meId, $meId]);
    return (bool)$st->fetch();
}
