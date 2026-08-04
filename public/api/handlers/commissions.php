<?php
/**
 * Handler commissions: comisiones por convenio médico/concierge (Apps > Comisiones).
 * Se calculan sobre los estudios de laboratorio capturados en Admisión
 * (tabla episode_studies) ligados a un médico de Vinculación, para un periodo
 * dado. La comisión del médico depende de la tasa global de su grupo de
 * comisión (Biología Molecular / Análisis Clínicos); la del concierge es
 * independiente, sobre el mismo monto, según su propio % (Vinculación).
 */

require_once __DIR__ . '/vinculacion.php';

function handle_commissions(string $action): void
{
    $me = current_user();
    $canUse = is_admin_role($me) || user_flag('apps', 'comisiones');
    if (!$canUse) {
        json_error('No tienes acceso a Comisiones', 403);
    }

    switch ($action) {
        /** Médicos y concierge disponibles para el selector. */
        case 'parties': {
            $doctors = db()->query(
                "SELECT d.id, d.name, d.concierge_id, c.name AS concierge_name
                 FROM vinculacion_doctors d LEFT JOIN vinculacion_concierge c ON c.id = d.concierge_id
                 ORDER BY d.name"
            )->fetchAll();
            $concierge = db()->query('SELECT id, name FROM vinculacion_concierge ORDER BY name')->fetchAll();
            json_ok(['doctors' => $doctors, 'concierge' => $concierge]);
        }

        /** Líneas de comisión (incluidas o no) para un médico/concierge en un rango de fechas. */
        case 'preview': {
            [$partyType, $partyId, $from, $to, $rate] = commissions_resolve_params($_GET);
            $lines = commissions_query_lines($partyType, $partyId, $from, $to, $rate);
            json_ok(['lines' => $lines, 'total' => commissions_sum($lines)]);
        }

        /** Incluye o excluye manualmente una línea de la cuenta (no borra el dato clínico). */
        case 'toggle_line': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT id, commission_included FROM episode_studies WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Línea no encontrada', 404);
            }
            $newValue = $row['commission_included'] ? 0 : 1;
            db()->prepare('UPDATE episode_studies SET commission_included = ? WHERE id = ?')->execute([$newValue, $id]);
            json_ok(['commission_included' => (bool)$newValue]);
        }

        /** Genera y guarda el estado de cuenta con folio (snapshot inmutable). */
        case 'save': {
            $b = request_body();
            [$partyType, $partyId, $from, $to, $rate] = commissions_resolve_params($b);
            $lines = array_values(array_filter(
                commissions_query_lines($partyType, $partyId, $from, $to, $rate),
                fn($l) => $l['commission_included']
            ));
            if (!$lines) {
                json_error('No hay líneas incluidas en este periodo para generar el estado de cuenta', 422);
            }
            $partyName = $partyType === 'doctor' ? commissions_doctor_name($partyId) : commissions_concierge_name($partyId);
            $total = commissions_sum($lines);

            $pdo = db();
            $folio = commissions_generate_folio($pdo);
            $pdo->prepare(
                'INSERT INTO commission_statements (folio, party_type, party_id, period_start, period_end, lines, total_commission, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $folio, $partyType, $partyId, $from, $to,
                json_encode(['party_name' => $partyName, 'items' => $lines], JSON_UNESCAPED_UNICODE),
                $total, (int)$me['id'],
            ]);
            $id = (int)$pdo->lastInsertId();
            log_activity('apps', 'commission_statement_create', "Generó estado de cuenta de comisiones \"$folio\" ($partyName)", 'commission_statement', $id);
            json_ok(['id' => $id, 'folio' => $folio]);
        }

        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = min(100, max(1, (int)($_GET['per_page'] ?? 25)));
            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND folio LIKE ?';
                $params[] = '%' . $q . '%';
            }
            $pdo = db();
            $st = $pdo->prepare("SELECT COUNT(*) c FROM commission_statements WHERE $where");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $st = $pdo->prepare(
                "SELECT * FROM commission_statements WHERE $where ORDER BY created_at DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage)
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $decoded = json_decode($it['lines'], true);
                $it['party_name'] = $decoded['party_name'] ?? '';
                unset($it['lines']);
                $it['total_commission'] = (float)$it['total_commission'];
            }
            unset($it);
            json_ok(['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
        }

        case 'get': {
            $id = (int)($_GET['id'] ?? 0);
            $statement = commissions_find_statement($id);
            $statement['lines'] = json_decode($statement['lines'], true);
            $statement['total_commission'] = (float)$statement['total_commission'];
            json_ok(['statement' => $statement]);
        }
    }
}

function commissions_find_statement(int $id): array
{
    $st = db()->prepare('SELECT * FROM commission_statements WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Estado de cuenta no encontrado', 404);
    }
    return $row;
}

/** Valida y normaliza los parámetros comunes de preview/save. Devuelve [partyType, partyId, from, to, rate]. */
function commissions_resolve_params(array $b): array
{
    $partyType = ($b['party_type'] ?? '') === 'concierge' ? 'concierge' : 'doctor';
    $partyId = (int)($b['party_id'] ?? 0);
    if ($partyId <= 0) {
        json_error('Selecciona un médico o concierge', 422);
    }
    $from = commissions_valid_date($b['period_start'] ?? '');
    $to = commissions_valid_date($b['period_end'] ?? '');
    if (!$from || !$to || $from > $to) {
        json_error('Rango de fechas no válido', 422);
    }

    if ($partyType === 'doctor') {
        $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
        $st->execute([$partyId]);
        if (!$st->fetch()) {
            json_error('Médico no encontrado', 404);
        }
        $rate = vinculacion_commission_rates();
    } else {
        $st = db()->prepare('SELECT id, commission_pct FROM vinculacion_concierge WHERE id = ?');
        $st->execute([$partyId]);
        $row = $st->fetch();
        if (!$row) {
            json_error('Concierge no encontrado', 404);
        }
        $rate = ['concierge' => (float)$row['commission_pct']];
    }

    return [$partyType, $partyId, $from, $to, $rate];
}

/** Estudios comisionables (con grupo asignado) de un médico o de los médicos de un concierge, en el rango dado. */
function commissions_query_lines(string $partyType, int $partyId, string $from, string $to, array $rate): array
{
    $fullName = sql_full_name('p');
    if ($partyType === 'doctor') {
        $doctorFilter = 'e.linked_doctor_id = ?';
        $params = [$partyId];
    } else {
        $doctorFilter = 'e.linked_doctor_id IN (SELECT id FROM vinculacion_doctors WHERE concierge_id = ?)';
        $params = [$partyId];
    }

    $st = db()->prepare(
        "SELECT es.id, es.study_name, es.commission_group, es.amount_charged, es.commission_included,
                e.id AS episode_id, e.service_folio, e.admission_date, e.linked_doctor_id,
                $fullName AS patient_name, p.file_number
         FROM episode_studies es
         JOIN episodes e ON e.id = es.episode_id
         JOIN patients p ON p.id = e.patient_id
         WHERE $doctorFilter
           AND es.commission_group IS NOT NULL
           AND DATE(e.admission_date) BETWEEN ? AND ?
         ORDER BY e.admission_date"
    );
    $st->execute(array_merge($params, [$from, $to]));
    $rows = $st->fetchAll();

    $pct = $partyType === 'doctor'
        ? null // se resuelve por línea según su commission_group
        : (float)$rate['concierge'];

    foreach ($rows as &$r) {
        $amount = (float)$r['amount_charged'];
        $linePct = $partyType === 'doctor' ? (float)($rate[$r['commission_group']] ?? 0) : $pct;
        $r['amount_charged'] = $amount;
        $r['commission_pct'] = $linePct;
        $r['commission_amount'] = round($amount * $linePct / 100, 2);
        $r['commission_included'] = (bool)$r['commission_included'];
    }
    unset($r);

    return $rows;
}

function commissions_sum(array $lines): float
{
    $total = 0.0;
    foreach ($lines as $l) {
        if ($l['commission_included']) {
            $total += $l['commission_amount'];
        }
    }
    return round($total, 2);
}

function commissions_doctor_name(int $id): string
{
    $st = db()->prepare('SELECT name FROM vinculacion_doctors WHERE id = ?');
    $st->execute([$id]);
    return (string)($st->fetch()['name'] ?? '');
}

function commissions_concierge_name(int $id): string
{
    $st = db()->prepare('SELECT name FROM vinculacion_concierge WHERE id = ?');
    $st->execute([$id]);
    return (string)($st->fetch()['name'] ?? '');
}

function commissions_valid_date($v): ?string
{
    $v = trim((string)$v);
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}

/** Folio ddmmaa-NN, mismo patrón que las cotizaciones. */
function commissions_generate_folio(PDO $pdo): string
{
    $prefix = date('dmy') . '-';
    $st = $pdo->prepare('SELECT folio FROM commission_statements WHERE folio LIKE ?');
    $st->execute([$prefix . '%']);
    $used = [];
    foreach ($st->fetchAll() as $row) {
        $used[(int)substr($row['folio'], strlen($prefix))] = true;
    }
    $available = array_diff(range(10, 99), array_keys($used));
    $n = $available ? $available[array_rand($available)] : max(array_merge(array_keys($used), [9])) + 1;
    return $prefix . $n;
}
