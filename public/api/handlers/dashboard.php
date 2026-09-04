<?php
/**
 * Handler dashboard: compilado de lo más importante de cada módulo.
 * kpis = franja compacta de estadísticas generales.
 * alerts = cosas que ameritan atención pero sin fecha concreta (inventario, tareas
 *   recurrentes pendientes, deadlines próximos más allá de mañana, contenido nuevo
 *   compartido, cumpleaños próximos).
 * today / tomorrow = agenda accionable del día: citas, tareas y laboratorio pendiente
 *   de entregar, cada quien filtrado por lo que puede ver (mismo criterio de
 *   responsable asignado que ya rige Expedientes/Admisión/Calendario).
 */

require_once __DIR__ . '/inventory.php';
require_once __DIR__ . '/../../includes/task_recurrence.php';

const DASH_DEADLINE_SOON_DAYS = 7;   // ventana de "deadline próximo" en Alertas (más allá de mañana)
const DASH_NEW_CONTENT_DAYS = 3;     // ventana de "nuevo" para pizarrón/archivos públicos
const DASH_BIRTHDAY_DAYS = 7;        // ventana de "fechas importantes" (cumpleaños próximos)

function handle_dashboard(string $action): void
{
    $me = current_user();
    switch ($action) {
        case 'stats':
            json_ok([
                'kpis'     => dash_kpis(),
                'alerts'   => dash_alerts($me),
                'today'    => dash_agenda($me, date('Y-m-d')),
                'tomorrow' => dash_agenda($me, date('Y-m-d', strtotime('+1 day'))),
            ]);

        case 'dismiss_alert': {
            $key = trim((string)(request_body()['alert_key'] ?? ''));
            if ($key === '') {
                json_error('alert_key requerido', 422);
            }
            $verb = db_driver() === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
            db()->prepare("$verb INTO dismissed_alerts (user_id, alert_key) VALUES (?, ?)")
                ->execute([(int)$me['id'], mb_substr($key, 0, 150)]);
            json_ok();
        }
    }
}

/* ================= KPIs ================= */
function dash_kpis(): array
{
    $pdo = db();
    $todayStart = date('Y-m-d 00:00:00');
    $todayEnd   = date('Y-m-d 23:59:59');

    $patients = (int)$pdo->query('SELECT COUNT(*) c FROM patients WHERE is_deleted = 0')->fetch()['c'];

    $st = $pdo->prepare('SELECT COUNT(*) c FROM episodes WHERE admission_date BETWEEN ? AND ?');
    $st->execute([$todayStart, $todayEnd]);
    $admissionsToday = (int)$st->fetch()['c'];

    $st = $pdo->prepare('SELECT COUNT(*) c FROM consultations WHERE consult_date BETWEEN ? AND ?');
    $st->execute([$todayStart, $todayEnd]);
    $consultsToday = (int)$st->fetch()['c'];

    return [
        'patients_total'   => $patients,
        'admissions_today' => $admissionsToday,
        'consults_today'   => $consultsToday,
    ];
}

/**
 * Claves usadas para "descartar" una alerta (tabla dismissed_alerts): cuando la
 * condición que la generó cambia de verdad (nuevo periodo de una recurrente, nuevo
 * mensaje de WhatsApp, el cumpleaños del año siguiente), la clave cambia con ella,
 * así un descarte viejo no tapa una alerta que en los hechos es nueva.
 */
function dash_dismissed_keys(int $userId): array
{
    $st = db()->prepare('SELECT alert_key FROM dismissed_alerts WHERE user_id = ?');
    $st->execute([$userId]);
    return array_fill_keys($st->fetchAll(PDO::FETCH_COLUMN), true);
}

function dash_strip_dismissed(array $items, array $dismissed): array
{
    return array_values(array_filter($items, fn($i) => !isset($dismissed[$i['alert_key']])));
}

/* ================= Alertas (sin fecha concreta) ================= */
function dash_alerts(array $me): array
{
    $pdo = db();
    $meId = (int)$me['id'];
    $out = [];

    if (user_can('inventario')) {
        $alerts = inventory_alerts();
        foreach ($alerts['low_stock'] as &$r) { $r['alert_key'] = "inventory:low_stock:{$r['id']}"; }
        unset($r);
        foreach ($alerts['expired'] as &$r) { $r['alert_key'] = "inventory:expired:{$r['lot_id']}"; }
        unset($r);
        foreach ($alerts['expiring'] as &$r) { $r['alert_key'] = "inventory:expiring:{$r['lot_id']}"; }
        unset($r);
        $out['inventory'] = [
            'low_stock' => $alerts['low_stock'],
            'expiring'  => $alerts['expiring'],
            'expired'   => $alerts['expired'],
        ];
    }

    if (user_can('tareas')) {
        // Tareas recurrentes (diaria/semanal) aún no completadas en el periodo actual,
        // cada una con su propio día de corte (ver pending_recurring_tasks()). El
        // periodo entra en la clave: al empezar uno nuevo, la alerta "reaparece" aunque
        // se haya descartado la del periodo anterior.
        $recurring = pending_recurring_tasks($pdo, $meId);
        foreach ($recurring as &$r) {
            $wd = $r['weekday'] !== null ? (int)$r['weekday'] : null;
            $r['alert_key'] = "tasks:recurring:{$r['id']}:" . period_key($r['recurrence'], $wd);
        }
        unset($r);
        $out['tasks_recurring'] = $recurring;

        // Deadlines próximos, más allá de mañana (hoy/mañana ya se ven en su propia sección)
        $from = date('Y-m-d', strtotime('+2 days'));
        $to   = date('Y-m-d', strtotime('+' . DASH_DEADLINE_SOON_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT id, title, due_date, priority FROM tasks t
             WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
               AND status <> 'completada' AND due_date BETWEEN ? AND ?
             ORDER BY due_date"
        );
        $st->execute([$meId, $from, $to]);
        $deadlineSoon = $st->fetchAll();
        foreach ($deadlineSoon as &$r) { $r['alert_key'] = "tasks:deadline:{$r['id']}"; }
        unset($r);
        $out['tasks_deadline_soon'] = $deadlineSoon;
    }

    if (user_can('pizarron')) {
        $since = date('Y-m-d H:i:s', strtotime('-' . DASH_NEW_CONTENT_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT b.id, b.title, b.type, b.created_at, u.full_name AS author
             FROM board_items b LEFT JOIN users u ON u.id = b.created_by
             WHERE b.scope = 'public' AND b.created_at >= ? ORDER BY b.created_at DESC LIMIT 8"
        );
        $st->execute([$since]);
        $newBoards = $st->fetchAll();
        foreach ($newBoards as &$r) { $r['alert_key'] = "pizarron:board:{$r['id']}"; }
        unset($r);
        $out['new_boards'] = $newBoards;
    }

    if (user_can('archivos')) {
        $since = date('Y-m-d H:i:s', strtotime('-' . DASH_NEW_CONTENT_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT f.id, f.name, f.created_at, u.full_name AS author
             FROM files f LEFT JOIN users u ON u.id = f.created_by
             WHERE f.scope = 'public' AND f.created_at >= ? ORDER BY f.created_at DESC LIMIT 8"
        );
        $st->execute([$since]);
        $newFiles = $st->fetchAll();
        foreach ($newFiles as &$r) { $r['alert_key'] = "archivos:file:{$r['id']}"; }
        unset($r);
        $out['new_files'] = $newFiles;
    }

    if (user_can('expedientes')) {
        $out['birthdays'] = dash_upcoming_birthdays($me);
    }

    if (user_can('whatsapp')) {
        $out['whatsapp'] = dash_whatsapp_unread($me);
    }

    // Estudios membretados en borrador: sin esto, encontrarlos significa leer el
    // estado renglón por renglón en cada categoría del Membretador.
    if (user_can('apps') && (is_admin_role($me) || user_flag('apps', 'review'))) {
        require_once __DIR__ . '/../../includes/doc_templates.php';
        $st = $pdo->query(
            "SELECT id, patient_name, doc_type, created_at FROM documents
             WHERE status = 'borrador' ORDER BY created_at LIMIT 8"
        );
        $rows = $st->fetchAll();
        $templates = doc_templates();
        foreach ($rows as &$r) {
            $r['type_label'] = $templates[$r['doc_type']]['short'] ?? $r['doc_type'];
            $r['alert_key'] = "apps:document:{$r['id']}";
        }
        unset($r);
        $out['documents_pending_review'] = $rows;
    }

    $dismissed = dash_dismissed_keys($meId);
    if (isset($out['inventory'])) {
        $out['inventory']['low_stock'] = dash_strip_dismissed($out['inventory']['low_stock'], $dismissed);
        $out['inventory']['expiring'] = dash_strip_dismissed($out['inventory']['expiring'], $dismissed);
        $out['inventory']['expired'] = dash_strip_dismissed($out['inventory']['expired'], $dismissed);
    }
    foreach (['tasks_recurring', 'tasks_deadline_soon', 'new_boards', 'new_files', 'birthdays', 'documents_pending_review'] as $key) {
        if (isset($out[$key])) {
            $out[$key] = dash_strip_dismissed($out[$key], $dismissed);
        }
    }
    if (isset($out['whatsapp'])) {
        $out['whatsapp']['conversations'] = dash_strip_dismissed($out['whatsapp']['conversations'], $dismissed);
    }

    return $out;
}

/**
 * Conversaciones de WhatsApp con mensajes sin leer. Visibilidad igual al propio
 * módulo (handle_whatsapp en whatsapp.php): quien administra ve todo, el resto
 * solo lo general/asignado a sí mismo. Se reimplementa aquí en vez de reusar ese
 * handler porque cada handler de la API se carga por separado.
 */
function dash_whatsapp_unread(array $me): array
{
    $pdo = db();
    $canManage = is_admin_role($me) || user_flag('whatsapp', 'manage');
    $where = 'c.is_archived = 0 AND c.unread_count > 0';
    $params = [];
    if (!$canManage) {
        $where .= ' AND (c.assigned_user_id IS NULL OR c.assigned_user_id = ?)';
        $params[] = (int)$me['id'];
    }
    $st = $pdo->prepare(
        "SELECT c.id, c.wa_id, c.contact_name, c.unread_count, c.last_message_at
         FROM wa_conversations c WHERE $where ORDER BY c.last_message_at DESC"
    );
    $st->execute($params);
    $rows = $st->fetchAll();
    // last_message_at entra en la clave de descarte: un mensaje nuevo cambia la
    // clave, así que la conversación reaparece aunque ya se hubiera descartado.
    foreach ($rows as &$r) {
        $r['alert_key'] = "whatsapp:conversation:{$r['id']}:{$r['last_message_at']}";
    }
    unset($r);
    return [
        'total'         => (int)array_sum(array_column($rows, 'unread_count')),
        'conversations' => array_slice($rows, 0, 8),
    ];
}

/**
 * Cumpleaños de pacientes en los próximos días (fechas importantes). Se calcula en
 * PHP y no en SQL: comparar solo mes/día de una fecha es engorroso y distinto entre
 * MySQL y SQLite, y el volumen de pacientes de una sola clínica es pequeño.
 */
function dash_upcoming_birthdays(array $me): array
{
    $sql = "SELECT p.id, p.file_number, p.first_name, p.paternal_surname, p.maternal_surname, p.birth_date
            FROM patients p WHERE p.is_deleted = 0 AND p.birth_date IS NOT NULL";
    $params = [];
    if (!is_admin_role($me)) {
        $sql .= ' AND EXISTS (
            SELECT 1 FROM episodes ep WHERE ep.patient_id = p.id
            AND (ep.assigned_user_id IS NULL OR ep.assigned_user_id = ?)
        )';
        $params[] = (int)$me['id'];
    }
    $st = db()->prepare($sql);
    $st->execute($params);

    $today = new DateTime('today');
    $out = [];
    foreach ($st->fetchAll() as $p) {
        $b = @DateTime::createFromFormat('Y-m-d', substr((string)$p['birth_date'], 0, 10));
        if (!$b) {
            continue;
        }
        $next = new DateTime($today->format('Y') . '-' . $b->format('m-d'));
        if ($next < $today) {
            $next->modify('+1 year');
        }
        $days = (int)$today->diff($next)->days;
        if ($days <= DASH_BIRTHDAY_DAYS) {
            $p['days_until'] = $days;
            $p['turns'] = (int)$next->format('Y') - (int)$b->format('Y');
            // El año de $next entra en la clave: el cumpleaños del año siguiente
            // reaparece aunque el de este año ya se haya descartado.
            $p['alert_key'] = "expedientes:birthday:{$p['id']}:{$next->format('Y')}";
            $out[] = $p;
        }
    }
    usort($out, fn($a, $b) => $a['days_until'] <=> $b['days_until']);
    return $out;
}

/* ================= Agenda de un día (hoy / mañana) ================= */
function dash_agenda(array $me, string $date): array
{
    $pdo = db();
    $meId = (int)$me['id'];
    $out = [];

    if (user_can('calendario')) {
        $sql = "SELECT a.id, a.title, a.service, a.location, a.start_at, a.end_at, u.full_name AS assigned_name
                FROM appointments a LEFT JOIN users u ON u.id = a.assigned_user_id
                WHERE a.status <> 'cancelada' AND a.start_at <= ? AND a.end_at >= ?";
        $params = ["$date 23:59:59", "$date 00:00:00"];
        if (!is_admin_role($me) && !user_flag('calendario', 'manage')) {
            $sql .= ' AND (a.assigned_user_id IS NULL OR a.assigned_user_id = ?)';
            $params[] = $meId;
        }
        $sql .= ' ORDER BY a.start_at';
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $out['appointments'] = $st->fetchAll();
    }

    if (user_can('tareas')) {
        // Por fecha límite: vencidas o para este día exactamente (no completadas)
        $st = $pdo->prepare(
            "SELECT id, title, due_date, priority FROM tasks t
             WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
               AND recurrence IS NULL AND status <> 'completada' AND due_date <= ?
             ORDER BY due_date"
        );
        $st->execute([$meId, $date]);
        $tasks = $st->fetchAll();

        // + recurrentes aún no completadas en su periodo actual (se repiten en hoy y
        // mañana), cada una con su propio día de corte (ver pending_recurring_tasks()).
        $out['tasks'] = array_merge($tasks, pending_recurring_tasks($pdo, $meId));

        // Resultados que deben salir este día, sin contar los ya completados (checklist
        // marcado por completo): la pestaña Resultados de Tareas es la fuente.
        $st = $pdo->prepare(
            'SELECT id, patient_name, sample_date, due_date, studies, needs_invoice
             FROM result_deliveries WHERE due_date = ?'
        );
        $st->execute([$date]);
        $pending = [];
        foreach ($st->fetchAll() as $r) {
            $items = $r['studies'] ? json_decode($r['studies'], true) : [];
            $allDone = $items && !array_filter($items, fn($it) => empty($it['done']));
            if ($allDone) {
                continue;
            }
            $r['studies'] = $items;
            $r['needs_invoice'] = (bool)$r['needs_invoice'];
            $pending[] = $r;
        }
        $out['result_deliveries'] = $pending;
    }

    if (user_can('expedientes')) {
        $sql = "SELECT e.id, e.service_folio, e.expected_delivery_date, p.id AS patient_id, p.file_number,
                       p.first_name, p.paternal_surname, p.maternal_surname, u.full_name AS assigned_name
                FROM episodes e
                JOIN patients p ON p.id = e.patient_id
                LEFT JOIN users u ON u.id = e.assigned_user_id
                WHERE e.service = 'laboratorio' AND e.expected_delivery_date = ?
                  AND e.results_delivered_at IS NULL AND p.is_deleted = 0";
        $params = [$date];
        if (!is_admin_role($me)) {
            $sql .= ' AND (e.assigned_user_id IS NULL OR e.assigned_user_id = ?)';
            $params[] = $meId;
        }
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $out['lab_pending'] = $st->fetchAll();
    }

    return $out;
}
