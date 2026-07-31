<?php
/**
 * Handler activity: consulta de la bitácora (Admin Tools > Log).
 * Los registros los escribe log_activity() desde cada módulo; aquí solo se leen.
 */

function handle_activity(string $action): void
{
    switch ($action) {
        case 'list': {
            $q      = trim((string)($_GET['q'] ?? ''));
            $user   = trim((string)($_GET['user'] ?? ''));
            $module = trim((string)($_GET['module'] ?? ''));
            $from   = trim((string)($_GET['from'] ?? ''));
            $to     = trim((string)($_GET['to'] ?? ''));
            $page    = max(1, (int)($_GET['page'] ?? 1));
            $perPage = 50;

            $where = ['1=1'];
            $params = [];
            if ($q !== '') {
                $where[] = '(detail LIKE ? OR action LIKE ? OR username LIKE ?)';
                $like = '%' . $q . '%';
                array_push($params, $like, $like, $like);
            }
            if ($user !== '') {
                $where[] = 'username = ?';
                $params[] = $user;
            }
            if ($module !== '') {
                $where[] = 'module_key = ?';
                $params[] = $module;
            }
            if ($from !== '') {
                $where[] = 'created_at >= ?';
                $params[] = $from . ' 00:00:00';
            }
            if ($to !== '') {
                $where[] = 'created_at <= ?';
                $params[] = $to . ' 23:59:59';
            }
            $sql = implode(' AND ', $where);

            $st = db()->prepare("SELECT COUNT(*) c FROM activity_log WHERE $sql");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $offset = ($page - 1) * $perPage;
            $st = db()->prepare(
                "SELECT id, username, module_key, action, detail, entity_type, entity_id, ip, created_at
                 FROM activity_log WHERE $sql
                 ORDER BY id DESC LIMIT $perPage OFFSET $offset"
            );
            $st->execute($params);
            $rows = $st->fetchAll();

            json_ok([
                'entries' => $rows,
                'total'   => $total,
                'page'    => $page,
                'pages'   => max(1, (int)ceil($total / $perPage)),
                'users'   => array_column(db()->query(
                    'SELECT DISTINCT username FROM activity_log WHERE username IS NOT NULL ORDER BY username'
                )->fetchAll(), 'username'),
                'modules' => array_column(db()->query(
                    'SELECT DISTINCT module_key FROM activity_log ORDER BY module_key'
                )->fetchAll(), 'module_key'),
            ]);
        }

        /** Resumen para el encabezado del panel. */
        case 'summary': {
            $today = date('Y-m-d');
            $st = db()->prepare('SELECT COUNT(*) c FROM activity_log WHERE created_at >= ?');
            $st->execute([$today . ' 00:00:00']);
            $todayCount = (int)$st->fetch()['c'];

            $total = (int)db()->query('SELECT COUNT(*) c FROM activity_log')->fetch()['c'];
            $first = db()->query('SELECT MIN(created_at) m FROM activity_log')->fetch()['m'];

            json_ok(['total' => $total, 'today' => $todayCount, 'since' => $first]);
        }
    }
}
