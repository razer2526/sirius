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

const DASH_DEADLINE_SOON_DAYS = 7;   // ventana de "deadline próximo" en Alertas (más allá de mañana)
const DASH_NEW_CONTENT_DAYS = 3;     // ventana de "nuevo" para pizarrón/archivos públicos
const DASH_BIRTHDAY_DAYS = 7;        // ventana de "fechas importantes" (cumpleaños próximos)

function handle_dashboard(string $action): void
{
    if ($action === 'stats') {
        $me = current_user();
        json_ok([
            'kpis'     => dash_kpis(),
            'alerts'   => dash_alerts($me),
            'today'    => dash_agenda($me, date('Y-m-d')),
            'tomorrow' => dash_agenda($me, date('Y-m-d', strtotime('+1 day'))),
        ]);
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

/* ================= Alertas (sin fecha concreta) ================= */
function dash_alerts(array $me): array
{
    $pdo = db();
    $meId = (int)$me['id'];
    $out = [];

    if (user_can('inventario')) {
        $alerts = inventory_alerts();
        $out['inventory'] = [
            'low_stock' => $alerts['low_stock'],
            'expiring'  => $alerts['expiring'],
            'expired'   => $alerts['expired'],
        ];
    }

    if (user_can('tareas')) {
        // Tareas recurrentes (diaria/semanal) aún no completadas en el periodo actual
        $st = $pdo->prepare(
            "SELECT t.id, t.title, t.recurrence FROM tasks t
             WHERE t.assigned_to = ? AND t.recurrence IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM task_completions tc
                 WHERE tc.task_id = t.id
                   AND tc.period_key = CASE WHEN t.recurrence = 'semanal' THEN ? ELSE ? END
               )
             ORDER BY t.title"
        );
        $st->execute([$meId, date('o-\WW'), date('Y-m-d')]);
        $out['tasks_recurring'] = $st->fetchAll();

        // Deadlines próximos, más allá de mañana (hoy/mañana ya se ven en su propia sección)
        $from = date('Y-m-d', strtotime('+2 days'));
        $to   = date('Y-m-d', strtotime('+' . DASH_DEADLINE_SOON_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT id, title, due_date, priority FROM tasks
             WHERE assigned_to = ? AND status <> 'completada' AND due_date BETWEEN ? AND ?
             ORDER BY due_date"
        );
        $st->execute([$meId, $from, $to]);
        $out['tasks_deadline_soon'] = $st->fetchAll();
    }

    if (user_can('pizarron')) {
        $since = date('Y-m-d H:i:s', strtotime('-' . DASH_NEW_CONTENT_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT b.id, b.title, b.type, b.created_at, u.full_name AS author
             FROM board_items b LEFT JOIN users u ON u.id = b.created_by
             WHERE b.scope = 'public' AND b.created_at >= ? ORDER BY b.created_at DESC LIMIT 8"
        );
        $st->execute([$since]);
        $out['new_boards'] = $st->fetchAll();
    }

    if (user_can('archivos')) {
        $since = date('Y-m-d H:i:s', strtotime('-' . DASH_NEW_CONTENT_DAYS . ' days'));
        $st = $pdo->prepare(
            "SELECT f.id, f.name, f.created_at, u.full_name AS author
             FROM files f LEFT JOIN users u ON u.id = f.created_by
             WHERE f.scope = 'public' AND f.created_at >= ? ORDER BY f.created_at DESC LIMIT 8"
        );
        $st->execute([$since]);
        $out['new_files'] = $st->fetchAll();
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
        }
        unset($r);
        $out['documents_pending_review'] = $rows;
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
            "SELECT id, title, due_date, priority FROM tasks
             WHERE assigned_to = ? AND recurrence IS NULL AND status <> 'completada' AND due_date <= ?
             ORDER BY due_date"
        );
        $st->execute([$meId, $date]);
        $tasks = $st->fetchAll();

        // + recurrentes aún no completadas en su periodo actual (se repiten en hoy y mañana)
        $st = $pdo->prepare(
            "SELECT t.id, t.title, t.recurrence FROM tasks t
             WHERE t.assigned_to = ? AND t.recurrence IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM task_completions tc
                 WHERE tc.task_id = t.id
                   AND tc.period_key = CASE WHEN t.recurrence = 'semanal' THEN ? ELSE ? END
               )
             ORDER BY t.title"
        );
        $st->execute([$meId, date('o-\WW'), date('Y-m-d')]);
        $out['tasks'] = array_merge($tasks, $st->fetchAll());

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
