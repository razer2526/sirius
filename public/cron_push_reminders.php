<?php
/**
 * Recordatorio push diario: para cada usuario activo, cuenta lo que le vence hoy
 * (tareas, citas) y los resultados por entregar (compartido), y le manda un solo
 * push resumen si hay algo. Pensado para correr una vez al día, temprano.
 *
 * Configurar en cPanel > Cron Jobs, con cualquiera de estas dos formas:
 *
 *   1) Línea de comandos (recomendada, no necesita la clave):
 *      /usr/local/bin/php /home/usuario/public_html/cron_push_reminders.php
 *
 *   2) URL (si el hosting solo permite invocar por HTTP, ej. wget/curl):
 *      https://tu-dominio.com/cron_push_reminders.php?key=<cron_key de config.php>
 */

require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/permissions.php';
require_once __DIR__ . '/includes/webpush.php';

header('Content-Type: text/plain; charset=utf-8');

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    $key = (string)($_GET['key'] ?? '');
    if (!hash_equals((string)app_config()['cron_key'], $key)) {
        http_response_code(403);
        exit("Clave no válida.\n");
    }
}

$pdo = db();
$today = date('Y-m-d');
$weekKey = date('o-\WW');

// Resultados por entregar (compartidos, no por persona): un solo conteo para
// todo el equipo con acceso a Tareas, igual criterio que dash_agenda().
$resultsDueToday = 0;
$st = $pdo->prepare('SELECT studies FROM result_deliveries WHERE due_date = ?');
$st->execute([$today]);
foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $studiesJson) {
    $items = $studiesJson ? json_decode($studiesJson, true) : [];
    $allDone = $items && !array_filter($items, fn($it) => empty($it['done']));
    if (!$allDone) {
        $resultsDueToday++;
    }
}

$users = $pdo->query("SELECT id, role FROM users WHERE is_active = 1")->fetchAll();
$sent = 0;
foreach ($users as $user) {
    $userId = (int)$user['id'];
    $parts = [];

    if (user_can_for($user, 'tareas')) {
        $st = $pdo->prepare(
            "SELECT COUNT(*) c FROM tasks t
             WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
               AND recurrence IS NULL AND status <> 'completada' AND due_date <= ?"
        );
        $st->execute([$userId, $today]);
        $taskCount = (int)$st->fetch()['c'];

        $st = $pdo->prepare(
            "SELECT COUNT(*) c FROM tasks t
             WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
               AND t.recurrence IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM task_completions tc
                 WHERE tc.task_id = t.id
                   AND tc.period_key = CASE WHEN t.recurrence = 'semanal' THEN ? ELSE ? END
               )"
        );
        $st->execute([$userId, $weekKey, $today]);
        $taskCount += (int)$st->fetch()['c'];

        if ($taskCount > 0) {
            $parts[] = $taskCount . ' tarea' . ($taskCount === 1 ? '' : 's');
        }
        if ($resultsDueToday > 0) {
            $parts[] = $resultsDueToday . ' resultado' . ($resultsDueToday === 1 ? '' : 's') . ' por entregar';
        }
    }

    if (user_can_for($user, 'calendario')) {
        $sql = "SELECT COUNT(*) c FROM appointments a
                WHERE a.status <> 'cancelada' AND a.start_at <= ? AND a.end_at >= ?";
        $params = ["$today 23:59:59", "$today 00:00:00"];
        if (!is_admin_role($user) && !user_flag_for($user, 'calendario', 'manage')) {
            $sql .= ' AND (a.assigned_user_id IS NULL OR a.assigned_user_id = ?)';
            $params[] = $userId;
        }
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $apptCount = (int)$st->fetch()['c'];
        if ($apptCount > 0) {
            $parts[] = $apptCount . ' cita' . ($apptCount === 1 ? '' : 's');
        }
    }

    if (!$parts) {
        continue;
    }
    webpush_notify($userId, 'Lo de hoy en Sirius', 'Tienes ' . implode(', ', $parts) . '.', '#/dashboard');
    $sent++;
}

echo "Recordatorios enviados: $sent de " . count($users) . " usuario(s) activo(s).\n";
