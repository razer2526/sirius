<?php
/** Cálculo del periodo de una tarea recurrente (diaria/semanal) — compartido entre
 *  tasks.php, dashboard.php y cron_push_reminders.php, todos handlers/scripts
 *  independientes que no comparten scope entre sí. */

require_once __DIR__ . '/db.php';

/**
 * 'diaria' → Y-m-d. 'semanal' con $weekday (0=domingo…6=sábado, igual que Date.getDay()
 * de JS): la fecha de inicio del ciclo de 7 días que contiene a hoy, anclado a ese día
 * de la semana — cada tarea tiene su propia "semana" según su propio día de corte.
 * 'semanal' sin $weekday (tareas creadas antes de este campo): compatibilidad con el
 * formato anterior (semana ISO compartida).
 */
function period_key(string $recurrence, ?int $weekday = null): string
{
    if ($recurrence !== 'semanal') {
        return date('Y-m-d');
    }
    if ($weekday === null) {
        return date('o-\WW');
    }
    $todayWd = (int)date('w');
    $diff = ($todayWd - $weekday + 7) % 7;
    return date('Y-m-d', strtotime("-{$diff} days"));
}

/**
 * Tareas recurrentes asignadas a $userId aún no completadas en su periodo actual —
 * cada una evaluada con su propio día de corte, no una clave global compartida.
 */
function pending_recurring_tasks(PDO $pdo, int $userId): array
{
    $st = $pdo->prepare(
        "SELECT t.id, t.title, t.recurrence, t.weekday FROM tasks t
         WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
           AND t.recurrence IS NOT NULL
         ORDER BY t.title"
    );
    $st->execute([$userId]);
    $recurring = $st->fetchAll();
    if (!$recurring) {
        return [];
    }
    $ids = array_column($recurring, 'id');
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT task_id, period_key FROM task_completions WHERE task_id IN ($marks)");
    $st->execute($ids);
    $completed = [];
    foreach ($st->fetchAll() as $row) {
        $completed[$row['task_id']][$row['period_key']] = true;
    }
    return array_values(array_filter($recurring, function ($t) use ($completed) {
        $wd = $t['weekday'] !== null ? (int)$t['weekday'] : null;
        return !isset($completed[$t['id']][period_key($t['recurrence'], $wd)]);
    }));
}
