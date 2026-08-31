<?php
/**
 * Handler tasks: proyectos, tareas, subtareas y tareas frecuentes.
 * Visibilidad: administradores y usuarios con flag "manage" ven y gestionan todo;
 * los demás ven solo tareas asignadas a ellos o creadas por ellos (personales).
 */

const TASK_PRIORITIES = ['baja', 'media', 'alta', 'urgente'];
const TASK_STATUSES = ['pendiente', 'en_progreso', 'completada'];
const TASK_RECURRENCES = ['diaria', 'semanal'];

function handle_tasks(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('tareas', 'manage');

    switch ($action) {
        case 'list': {
            $pdo = db();
            $meId = (int)$me['id'];
            if ($canManage) {
                $tasks = $pdo->query(
                    'SELECT t.*, c.full_name AS creator_name FROM tasks t
                     LEFT JOIN users c ON c.id = t.created_by
                     ORDER BY t.created_at DESC'
                )->fetchAll();
                $projects = $pdo->query('SELECT * FROM projects ORDER BY status, due_date IS NULL, due_date')->fetchAll();
                $users = $pdo->query(
                    "SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name"
                )->fetchAll();
            } else {
                // Visible: asignada a mí (por task_assignees), creada por mí, o subtarea de
                // una tarea que cumpla lo anterior.
                $st = $pdo->prepare(
                    'SELECT t.*, c.full_name AS creator_name FROM tasks t
                     LEFT JOIN users c ON c.id = t.created_by
                     WHERE t.created_by = ?
                        OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
                        OR t.parent_id IN (
                            SELECT id FROM tasks pt WHERE pt.created_by = ?
                               OR EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = pt.id AND ta2.user_id = ?)
                        )
                     ORDER BY t.created_at DESC'
                );
                $st->execute([$meId, $meId, $meId, $meId]);
                $tasks = $st->fetchAll();
                // Proyectos visibles: los que traen alguna tarea visible, o los asignados
                // directamente a mí (un proyecto puede no tener tareas todavía).
                $projectIds = array_values(array_unique(array_filter(array_column($tasks, 'project_id'))));
                $st = $pdo->prepare('SELECT project_id FROM project_assignees WHERE user_id = ?');
                $st->execute([$meId]);
                $projectIds = array_values(array_unique(array_merge($projectIds, array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)))));
                $projects = [];
                if ($projectIds) {
                    $marks = implode(',', array_fill(0, count($projectIds), '?'));
                    $st = $pdo->prepare("SELECT * FROM projects WHERE id IN ($marks) ORDER BY status, due_date IS NULL, due_date");
                    $st->execute($projectIds);
                    $projects = $st->fetchAll();
                }
                $users = [];
            }

            // Estado de completado del periodo actual para tareas frecuentes
            $recurringIds = array_column(array_filter($tasks, fn($t) => !empty($t['recurrence'])), 'id');
            $doneNow = [];
            if ($recurringIds) {
                $marks = implode(',', array_fill(0, count($recurringIds), '?'));
                $st = $pdo->prepare("SELECT task_id, period_key FROM task_completions WHERE task_id IN ($marks) AND period_key IN (?, ?)");
                $st->execute([...$recurringIds, period_key('diaria'), period_key('semanal')]);
                foreach ($st->fetchAll() as $row) {
                    $doneNow[$row['task_id']] = true;
                }
            }

            $taskIds = array_column($tasks, 'id');
            $assigneesByTask = fetch_assignees('task_assignees', 'task_id', $taskIds);
            $projectIdsForAssignees = array_column($projects, 'id');
            $assigneesByProject = fetch_assignees('project_assignees', 'project_id', $projectIdsForAssignees);

            foreach ($tasks as &$t) {
                $t['id'] = (int)$t['id'];
                $t['project_id'] = $t['project_id'] !== null ? (int)$t['project_id'] : null;
                $t['parent_id'] = $t['parent_id'] !== null ? (int)$t['parent_id'] : null;
                $t['created_by'] = $t['created_by'] !== null ? (int)$t['created_by'] : null;
                $t['done_now'] = !empty($t['recurrence']) ? isset($doneNow[$t['id']]) : null;
                $assignees = $assigneesByTask[$t['id']] ?? [];
                $t['assigned_to'] = array_column($assignees, 'id');
                $t['assigned_names'] = array_column($assignees, 'name');
            }
            unset($t);
            foreach ($projects as &$p) {
                $p['id'] = (int)$p['id'];
                $assignees = $assigneesByProject[$p['id']] ?? [];
                $p['assigned_to'] = array_column($assignees, 'id');
                $p['assigned_names'] = array_column($assignees, 'name');
            }
            unset($p);

            json_ok([
                'can_manage' => $canManage,
                'me'         => $meId,
                'tasks'      => $tasks,
                'projects'   => $projects,
                'users'      => $users,
            ]);
        }

        /* ---- Proyectos ---- */
        case 'project_save': {
            require_task_manager($canManage);
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre del proyecto es obligatorio', 422);
            }
            $desc = trim((string)($b['description'] ?? '')) ?: null;
            $due = valid_date($b['due_date'] ?? '');
            $status = in_array($b['status'] ?? '', ['activo', 'completado', 'archivado'], true) ? $b['status'] : 'activo';
            $id = (int)($b['id'] ?? 0);
            if ($id > 0) {
                db()->prepare('UPDATE projects SET name = ?, description = ?, due_date = ?, status = ? WHERE id = ?')
                    ->execute([$name, $desc, $due, $status, $id]);
                log_activity('tareas', 'project_update', "Editó proyecto \"$name\"", 'project', $id);
            } else {
                db()->prepare('INSERT INTO projects (name, description, due_date, status, created_by) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$name, $desc, $due, $status, (int)$me['id']]);
                $id = (int)db()->lastInsertId();
                log_activity('tareas', 'project_create', "Creó proyecto \"$name\"", 'project', $id);
            }
            if (array_key_exists('assigned_to', $b)) {
                sync_project_assignees($id, (array)$b['assigned_to']);
            }
            json_ok(['id' => $id]);
        }

        case 'project_delete': {
            require_task_manager($canManage);
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT name FROM projects WHERE id = ?');
            $st->execute([$id]);
            $p = $st->fetch();
            if (!$p) {
                json_error('Proyecto no encontrado', 404);
            }
            db()->prepare('DELETE FROM projects WHERE id = ?')->execute([$id]);
            log_activity('tareas', 'project_delete', "Eliminó proyecto \"{$p['name']}\" (y sus tareas)", 'project', $id);
            json_ok();
        }

        /* ---- Tareas ---- */
        case 'save': {
            $b = request_body();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') {
                json_error('El título es obligatorio', 422);
            }
            $id = (int)($b['id'] ?? 0);
            $assignedTo = (array)($b['assigned_to'] ?? []);
            if (!$canManage) {
                // Un usuario estandar solo crea/edita tareas personales asignadas a sí mismo
                $assignedTo = [(int)$me['id']];
            }
            $priority = in_array($b['priority'] ?? '', TASK_PRIORITIES, true) ? $b['priority'] : 'media';
            $recurrence = in_array($b['recurrence'] ?? '', TASK_RECURRENCES, true) ? $b['recurrence'] : null;
            $due = valid_date($b['due_date'] ?? '');
            $desc = trim((string)($b['description'] ?? '')) ?: null;
            $projectId = isset($b['project_id']) && $b['project_id'] !== '' ? (int)$b['project_id'] : null;
            $parentId = isset($b['parent_id']) && $b['parent_id'] !== '' ? (int)$b['parent_id'] : null;

            if ($projectId !== null) {
                $st = db()->prepare('SELECT id FROM projects WHERE id = ?');
                $st->execute([$projectId]);
                if (!$st->fetch()) {
                    json_error('Proyecto no encontrado', 404);
                }
            }
            if ($parentId !== null) {
                $parent = find_task($parentId);
                if ($parent['parent_id']) {
                    json_error('Solo se permite un nivel de subtareas', 422);
                }
                $projectId = $parent['project_id']; // la subtarea hereda el proyecto
            }

            if ($id > 0) {
                $task = find_task($id);
                if (!$canManage && (int)$task['created_by'] !== (int)$me['id']) {
                    json_error('Solo puedes editar tus propias tareas', 403);
                }
                db()->prepare(
                    'UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, recurrence = ?, project_id = ?, parent_id = ? WHERE id = ?'
                )->execute([$title, $desc, $priority, $due, $recurrence, $projectId, $parentId, $id]);
                log_activity('tareas', 'task_update', "Editó tarea \"$title\"", 'task', $id);
            } else {
                db()->prepare(
                    'INSERT INTO tasks (project_id, parent_id, title, description, priority, due_date, recurrence, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$projectId, $parentId, $title, $desc, $priority, $due, $recurrence, (int)$me['id']]);
                $id = (int)db()->lastInsertId();
                log_activity('tareas', 'task_create', "Creó tarea \"$title\"", 'task', $id);
            }
            sync_task_assignees($id, $assignedTo);
            json_ok(['id' => $id]);
        }

        case 'set_status': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $status = (string)($b['status'] ?? '');
            if (!in_array($status, TASK_STATUSES, true)) {
                json_error('Estado no válido', 422);
            }
            $task = find_task($id);
            require_task_access($task, $me, $canManage);
            db()->prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
                ->execute([$status, $status === 'completada' ? date('Y-m-d H:i:s') : null, $id]);
            log_activity('tareas', 'task_status', "\"{$task['title']}\" → $status", 'task', $id);
            json_ok();
        }

        case 'toggle_recurring': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $task = find_task($id);
            if (empty($task['recurrence'])) {
                json_error('La tarea no es frecuente', 422);
            }
            require_task_access($task, $me, $canManage);
            $key = period_key($task['recurrence']);
            $pdo = db();
            $st = $pdo->prepare('SELECT id FROM task_completions WHERE task_id = ? AND period_key = ?');
            $st->execute([$id, $key]);
            $row = $st->fetch();
            if ($row) {
                $pdo->prepare('DELETE FROM task_completions WHERE id = ?')->execute([$row['id']]);
                $done = false;
            } else {
                $pdo->prepare('INSERT INTO task_completions (task_id, period_key, completed_by) VALUES (?, ?, ?)')
                    ->execute([$id, $key, (int)$me['id']]);
                $done = true;
                log_activity('tareas', 'task_recurring_done', "Completó \"{$task['title']}\" ($key)", 'task', $id);
            }
            json_ok(['done' => $done]);
        }

        case 'delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $task = find_task($id);
            if (!$canManage && (int)$task['created_by'] !== (int)$me['id']) {
                json_error('Solo puedes eliminar tus propias tareas', 403);
            }
            db()->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
            log_activity('tareas', 'task_delete', "Eliminó tarea \"{$task['title']}\"", 'task', $id);
            json_ok();
        }

        /* ---- Resultados por entregar (pizarra de entregas: paciente, fechas, checklist de estudios) ---- */
        case 'results_list': {
            $rows = db()->query(
                'SELECT r.*, u.full_name AS creator_name FROM result_deliveries r
                 LEFT JOIN users u ON u.id = r.created_by
                 ORDER BY r.due_date IS NULL, r.due_date, r.created_at DESC'
            )->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['needs_invoice'] = (bool)$r['needs_invoice'];
                $r['studies'] = $r['studies'] ? json_decode($r['studies'], true) : [];
                $r['created_by'] = $r['created_by'] !== null ? (int)$r['created_by'] : null;
            }
            unset($r);
            json_ok(['can_manage' => $canManage, 'me' => (int)$me['id'], 'items' => $rows]);
        }

        /** Estudios del catálogo, para autocompletar el checklist (mismo criterio que quotes/search_studies:
         *  cualquiera con acceso a este módulo puede buscar, sin necesitar el permiso de administrar el catálogo). */
        case 'search_studies': {
            $q = trim((string)($_GET['q'] ?? ''));
            $params = [];
            $where = 'is_active = 1';
            if ($q !== '') {
                $where .= ' AND name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            $st = db()->prepare("SELECT id, name FROM quote_studies WHERE $where ORDER BY name LIMIT 20");
            $st->execute($params);
            json_ok(['items' => $st->fetchAll()]);
        }

        /** Pacientes registrados, para autocompletar el nombre. Sin resultado no pasa nada: el
         *  registro se guarda con el texto tal cual, no depende de que exista un expediente. */
        case 'search_patients': {
            $q = trim((string)($_GET['q'] ?? ''));
            if (mb_strlen($q) < 2) {
                json_ok(['items' => []]);
            }
            $fullName = sql_full_name('p');
            $like = '%' . $q . '%';
            $st = db()->prepare(
                "SELECT p.id, p.file_number, $fullName AS name FROM patients p
                 WHERE p.is_deleted = 0 AND ($fullName LIKE ? OR p.file_number LIKE ?)
                 ORDER BY p.paternal_surname LIMIT 15"
            );
            $st->execute([$like, $like]);
            json_ok(['items' => $st->fetchAll()]);
        }

        case 'results_save': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $item = null;
            if ($id > 0) {
                $item = find_result_delivery($id);
                if (!$canManage && (int)$item['created_by'] !== (int)$me['id']) {
                    // Cualquiera con acceso a Tareas puede marcar el checklist, pero editar
                    // los datos del registro (paciente, fechas, factura) queda para quien lo
                    // creó o un gestor — mismo criterio que editar una tarea ajena.
                    $onlyStudies = !array_diff(array_keys($b), ['id', 'studies']);
                    if (!$onlyStudies) {
                        json_error('Solo puedes editar los datos de un registro que creaste tú', 403);
                    }
                }
            }

            $fields = [];
            if (array_key_exists('patient_name', $b)) {
                $name = trim((string)$b['patient_name']);
                if ($name === '') {
                    json_error('El nombre del paciente es obligatorio', 422);
                }
                $fields['patient_name'] = mb_substr($name, 0, 200);
            } elseif (!$item) {
                json_error('El nombre del paciente es obligatorio', 422);
            }
            if (array_key_exists('sample_date', $b)) {
                $fields['sample_date'] = valid_date($b['sample_date']);
            }
            if (array_key_exists('due_date', $b)) {
                $fields['due_date'] = valid_date($b['due_date']);
            }
            if (array_key_exists('needs_invoice', $b)) {
                $fields['needs_invoice'] = !empty($b['needs_invoice']) ? 1 : 0;
            }
            if (array_key_exists('observations', $b)) {
                $obs = trim((string)$b['observations']);
                $fields['observations'] = $obs !== '' ? mb_substr($obs, 0, 500) : null;
            }
            if (array_key_exists('studies', $b)) {
                $items = [];
                foreach ((array)$b['studies'] as $s) {
                    $text = trim((string)($s['text'] ?? ''));
                    if ($text === '') {
                        continue;
                    }
                    $items[] = ['text' => mb_substr($text, 0, 200), 'done' => !empty($s['done'])];
                }
                $fields['studies'] = json_encode($items, JSON_UNESCAPED_UNICODE);
            }

            if ($item) {
                if ($fields) {
                    $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($fields)));
                    db()->prepare("UPDATE result_deliveries SET $sets WHERE id = ?")->execute([...array_values($fields), $id]);
                }
                json_ok(['id' => $id]);
            }

            $fields += ['sample_date' => null, 'due_date' => null, 'needs_invoice' => 0, 'studies' => '[]', 'observations' => null];
            db()->prepare(
                'INSERT INTO result_deliveries (patient_name, sample_date, due_date, studies, needs_invoice, observations, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $fields['patient_name'], $fields['sample_date'], $fields['due_date'],
                $fields['studies'], $fields['needs_invoice'], $fields['observations'], (int)$me['id'],
            ]);
            $id = (int)db()->lastInsertId();
            log_activity('tareas', 'result_delivery_create', "Registró resultados pendientes de \"{$fields['patient_name']}\"", 'result_delivery', $id);
            json_ok(['id' => $id]);
        }

        case 'results_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $item = find_result_delivery($id);
            if (!$canManage && (int)$item['created_by'] !== (int)$me['id']) {
                json_error('Solo puedes eliminar los registros que creaste tú', 403);
            }
            db()->prepare('DELETE FROM result_deliveries WHERE id = ?')->execute([$id]);
            log_activity('tareas', 'result_delivery_delete', "Eliminó el registro de \"{$item['patient_name']}\"", 'result_delivery', $id);
            json_ok();
        }
    }
}

function find_task(int $id): array
{
    $st = db()->prepare('SELECT * FROM tasks WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Tarea no encontrada', 404);
    }
    return $row;
}

function find_result_delivery(int $id): array
{
    $st = db()->prepare('SELECT * FROM result_deliveries WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Registro no encontrado', 404);
    }
    return $row;
}

function require_task_manager(bool $canManage): void
{
    if (!$canManage) {
        json_error('Necesitas permiso de gestión de tareas', 403);
    }
}

/** Alguno de los asignados, el creador o un gestor pueden operar la tarea. */
function require_task_access(array $task, array $me, bool $canManage): void
{
    $meId = (int)$me['id'];
    if ($canManage || (int)$task['created_by'] === $meId) {
        return;
    }
    $st = db()->prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1');
    $st->execute([(int)$task['id'], $meId]);
    if (!$st->fetch()) {
        json_error('No tienes acceso a esta tarea', 403);
    }
}

/** Asignados de varias tareas o proyectos a la vez, agrupados por id del dueño.
 *  $table/$fkCol son literales fijos que decide el código, nunca el request. */
function fetch_assignees(string $table, string $fkCol, array $ids): array
{
    if (!$ids) {
        return [];
    }
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare(
        "SELECT a.$fkCol AS owner_id, u.id, u.full_name AS name
         FROM $table a JOIN users u ON u.id = a.user_id
         WHERE a.$fkCol IN ($marks) ORDER BY u.full_name"
    );
    $st->execute($ids);
    $out = [];
    foreach ($st->fetchAll() as $row) {
        $out[(int)$row['owner_id']][] = ['id' => (int)$row['id'], 'name' => $row['name']];
    }
    return $out;
}

/** Reemplaza por completo la lista de asignados de una tarea. */
function sync_task_assignees(int $taskId, array $userIds): void
{
    $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds), fn($n) => $n > 0)));
    $pdo = db();
    $pdo->prepare('DELETE FROM task_assignees WHERE task_id = ?')->execute([$taskId]);
    if ($userIds) {
        $ins = $pdo->prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
        foreach ($userIds as $uid) {
            $ins->execute([$taskId, $uid]);
        }
    }
}

/** Reemplaza por completo la lista de asignados de un proyecto. */
function sync_project_assignees(int $projectId, array $userIds): void
{
    $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds), fn($n) => $n > 0)));
    $pdo = db();
    $pdo->prepare('DELETE FROM project_assignees WHERE project_id = ?')->execute([$projectId]);
    if ($userIds) {
        $ins = $pdo->prepare('INSERT INTO project_assignees (project_id, user_id) VALUES (?, ?)');
        foreach ($userIds as $uid) {
            $ins->execute([$projectId, $uid]);
        }
    }
}

/** Llave del periodo actual: diaria = fecha, semanal = año-semana ISO. */
function period_key(string $recurrence): string
{
    return $recurrence === 'semanal' ? date('o-\WW') : date('Y-m-d');
}

function valid_date($v): ?string
{
    $v = trim((string)$v);
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}
