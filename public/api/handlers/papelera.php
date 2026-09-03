<?php
/**
 * Handler papelera (Admin Tools > Papelera): ver, restaurar o eliminar en
 * definitiva elementos archivados (soft-delete) de tareas, proyectos,
 * resultados y pizarrón. Restaurar y purgar tocan datos de cualquier
 * usuario, y hasta listarlos expone nombres de pacientes/tareas de otros:
 * se exige rol de administrador, no basta con tener el módulo habilitado
 * (mismo criterio que backups.php y la mitad admin de cobertura.php).
 */

require_once __DIR__ . '/../../includes/trash.php';

const TRASH_ENTITY_TYPES = ['task', 'project', 'result_delivery', 'board_item'];

function handle_papelera(string $action): void
{
    $me = current_user();
    if (!is_admin_role($me)) {
        json_error('Esta acción requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'list': {
            $type = (string)($_GET['type'] ?? '');
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = 50;
            $where = '1=1';
            $params = [];
            if (in_array($type, TRASH_ENTITY_TYPES, true)) {
                $where = 'entity_type = ?';
                $params[] = $type;
            }

            $st = db()->prepare("SELECT COUNT(*) c FROM trash_items WHERE $where");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $offset = ($page - 1) * $perPage;
            $st = db()->prepare(
                "SELECT id, entity_type, entity_id, summary, archived_by_name, archived_at, related_trash_id
                 FROM trash_items WHERE $where ORDER BY archived_at DESC, id DESC LIMIT $perPage OFFSET $offset"
            );
            $st->execute($params);
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['entity_id'] = (int)$r['entity_id'];
                $r['related_trash_id'] = $r['related_trash_id'] !== null ? (int)$r['related_trash_id'] : null;
            }
            unset($r);

            json_ok([
                'items'  => $rows,
                'total'  => $total,
                'page'   => $page,
                'pages'  => max(1, (int)ceil($total / $perPage)),
                'counts' => trash_counts_by_type(),
            ]);
        }

        case 'restore': {
            $id = (int)(request_body()['id'] ?? 0);
            $trashRow = find_trash_item($id);
            $pdo = db();
            $pdo->beginTransaction();
            try {
                trash_restore_row($trashRow);
                $pdo->prepare('DELETE FROM trash_items WHERE id = ?')->execute([$id]);
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                error_log('papelera restore: ' . $e->getMessage());
                json_error('No se pudo restaurar: ' . $e->getMessage(), 409);
            }
            log_activity('papelera', 'restore', 'Restauró ' . $trashRow['summary'], $trashRow['entity_type'], (int)$trashRow['entity_id']);
            json_ok();
        }

        case 'purge': {
            $id = (int)(request_body()['id'] ?? 0);
            $trashRow = find_trash_item($id);
            db()->prepare('DELETE FROM trash_items WHERE id = ?')->execute([$id]);
            log_activity('papelera', 'purge', 'Eliminó permanentemente ' . $trashRow['summary'], $trashRow['entity_type'], (int)$trashRow['entity_id']);
            json_ok();
        }
    }
}

function trash_counts_by_type(): array
{
    $rows = db()->query('SELECT entity_type, COUNT(*) c FROM trash_items GROUP BY entity_type')->fetchAll();
    $out = array_fill_keys(TRASH_ENTITY_TYPES, 0);
    foreach ($rows as $r) {
        $out[$r['entity_type']] = (int)$r['c'];
    }
    return $out;
}
