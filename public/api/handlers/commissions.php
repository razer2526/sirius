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
require_once __DIR__ . '/../../includes/ai.php';
require_once __DIR__ . '/../../includes/assistant_tools.php';

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
                // `lines` va entre comillas invertidas por ser palabra reservada en MySQL
                'INSERT INTO commission_statements (folio, party_type, party_id, period_start, period_end, `lines`, total_commission, created_by)
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

        /**
         * Extrae en preview (sin guardar) los renglones de una imagen pegada con
         * la lista informal de pacientes de un médico, y los cruza contra lo ya
         * capturado en Sirius para calcular la comisión. Solo médicos: la imagen
         * es una lista propia de un médico, no aplica a concierge.
         */
        case 'extract': {
            $b = request_body();
            $partyId = (int)($b['party_id'] ?? 0);
            $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
            $st->execute([$partyId]);
            if (!$st->fetch()) {
                json_error('Médico no encontrado', 404);
            }
            $image = is_array($b['image'] ?? null) ? $b['image'] : [];
            $mime = (string)($image['mime'] ?? '');
            $data = (string)($image['data'] ?? '');
            if (!in_array($mime, ['image/png', 'image/jpeg'], true) || $data === '') {
                json_error('Pega una imagen PNG o JPEG con la lista de pacientes', 422);
            }

            try {
                $extracted = commissions_extract_rows_from_image(['mime' => $mime, 'data' => $data]);
                $rows = commissions_match_rows($partyId, $extracted);
            } catch (Throwable $e) {
                error_log('commissions/extract: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }
            json_ok(['rows' => $rows]);
        }

        /**
         * Guarda el estado de cuenta a partir de los renglones YA REVISADOS por el
         * usuario en pantalla (incluir/excluir, coincidencia confirmada). Nunca
         * confía en montos que mande el cliente: por cada fila vuelve a resolver
         * los episode_studies contra la base y recalcula el monto/comisión ahí,
         * igual de estricto que toggle_line con datos financieros.
         */
        case 'extract_save': {
            $b = request_body();
            $partyId = (int)($b['party_id'] ?? 0);
            $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
            $st->execute([$partyId]);
            if (!$st->fetch()) {
                json_error('Médico no encontrado', 404);
            }
            $rows = is_array($b['rows'] ?? null) ? $b['rows'] : [];
            $included = array_values(array_filter($rows, fn($r) => !empty($r['commission_included'])));
            if (!$included) {
                json_error('No hay líneas incluidas para generar el estado de cuenta', 422);
            }

            $rate = vinculacion_commission_rates();
            $fullName = sql_full_name('p');
            $items = [];
            $dates = [];
            foreach ($included as $r) {
                $ids = array_values(array_unique(array_map('intval', (array)($r['episode_study_ids'] ?? []))));
                if (!$ids) {
                    continue; // fila sin coincidencia confirmada no puede llevar comisión
                }
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $st2 = db()->prepare(
                    "SELECT es.id, es.study_name, es.commission_group, es.amount_charged, e.admission_date,
                            $fullName AS patient_name
                     FROM episode_studies es
                     JOIN episodes e ON e.id = es.episode_id
                     JOIN patients p ON p.id = e.patient_id
                     WHERE e.linked_doctor_id = ? AND es.commission_group IS NOT NULL AND es.id IN ($placeholders)"
                );
                $st2->execute(array_merge([$partyId], $ids));
                $studyRows = $st2->fetchAll();
                if (!$studyRows) {
                    continue;
                }
                $amount = 0.0;
                $commission = 0.0;
                $studyNames = [];
                foreach ($studyRows as $sr) {
                    $amt = (float)$sr['amount_charged'];
                    $pct = (float)($rate[$sr['commission_group']] ?? 0);
                    $amount += $amt;
                    $commission += round($amt * $pct / 100, 2);
                    $studyNames[] = $sr['study_name'];
                    $dates[] = (string)$sr['admission_date'];
                }
                $items[] = [
                    'patient_name_raw'     => (string)($r['patient_name_raw'] ?? ''),
                    'patient_name_matched' => $studyRows[0]['patient_name'],
                    'service_type'         => in_array($r['service_type'] ?? null, ['normal', 'urgencia'], true) ? $r['service_type'] : null,
                    'date_label'           => (string)($r['date_label'] ?? ''),
                    'studies'              => implode(', ', $studyNames),
                    'amount_charged'       => round($amount, 2),
                    'commission_amount'    => round($commission, 2),
                    'commission_pct'       => $amount > 0 ? round($commission / $amount * 100, 1) : 0,
                    'matched'              => true,
                ];
            }
            if (!$items) {
                json_error('Ninguna de las líneas incluidas tiene coincidencia válida en Sirius', 422);
            }

            $total = round((float)array_sum(array_column($items, 'commission_amount')), 2);
            $partyName = commissions_doctor_name($partyId);
            sort($dates);
            $from = $dates ? substr((string)$dates[0], 0, 10) : date('Y-m-d');
            $to = $dates ? substr((string)end($dates), 0, 10) : date('Y-m-d');

            $pdo = db();
            $folio = commissions_generate_folio($pdo);
            $pdo->prepare(
                'INSERT INTO commission_statements (folio, party_type, party_id, period_start, period_end, `lines`, total_commission, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $folio, 'doctor', $partyId, $from, $to,
                json_encode(['source' => 'image', 'party_name' => $partyName, 'items' => $items], JSON_UNESCAPED_UNICODE),
                $total, (int)$me['id'],
            ]);
            $id = (int)$pdo->lastInsertId();
            log_activity('apps', 'commission_statement_create', "Generó estado de cuenta de comisiones \"$folio\" ($partyName, desde imagen)", 'commission_statement', $id);
            json_ok(['id' => $id, 'folio' => $folio]);
        }

        /** Busca estudios del catálogo por nombre, para el buscador dinámico de "Nuevo registro". */
        case 'studies_search': {
            $q = trim((string)($_GET['q'] ?? ''));
            if ($q === '') {
                json_ok(['items' => []]);
            }
            $st = db()->prepare('SELECT id, name, public_price FROM quote_studies WHERE is_active = 1 AND name LIKE ? ORDER BY name LIMIT 20');
            $st->execute(['%' . $q . '%']);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['public_price'] = (float)$it['public_price'];
            }
            unset($it);
            json_ok(['items' => $items]);
        }

        /** Registros manuales (pendientes y facturados) de un médico, más recientes primero. */
        case 'entries_list': {
            $doctorId = (int)($_GET['doctor_id'] ?? 0);
            $st = db()->prepare(
                'SELECT ce.id, ce.patient_name, ce.entry_date, ce.studies, ce.total_amount, ce.total_commission,
                        ce.statement_id, cs.folio
                 FROM commission_entries ce LEFT JOIN commission_statements cs ON cs.id = ce.statement_id
                 WHERE ce.doctor_id = ? ORDER BY ce.entry_date DESC, ce.id DESC'
            );
            $st->execute([$doctorId]);
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['studies'] = json_decode((string)$r['studies'], true) ?: [];
                $r['total_amount'] = (float)$r['total_amount'];
                $r['total_commission'] = (float)$r['total_commission'];
                $r['statement_id'] = $r['statement_id'] !== null ? (int)$r['statement_id'] : null;
            }
            unset($r);
            json_ok(['entries' => $rows]);
        }

        /** Crea o edita (si no está facturado todavía) un registro manual de paciente referido. */
        case 'entry_save': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $doctorId = (int)($b['doctor_id'] ?? 0);
            $patientName = trim((string)($b['patient_name'] ?? ''));
            $entryDate = commissions_valid_date($b['entry_date'] ?? '');
            $studiesIn = is_array($b['studies'] ?? null) ? $b['studies'] : [];

            if ($patientName === '') {
                json_error('Escribe el nombre del paciente', 422);
            }
            if (!$entryDate) {
                json_error('Fecha no válida', 422);
            }
            $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
            $st->execute([$doctorId]);
            if (!$st->fetch()) {
                json_error('Médico no encontrado', 404);
            }

            $studies = [];
            $totalAmount = 0.0;
            $totalCommission = 0.0;
            foreach ($studiesIn as $s) {
                $name = trim((string)($s['name'] ?? ''));
                $amount = (float)($s['amount_charged'] ?? 0);
                if ($name === '' || $amount < 0) {
                    continue;
                }
                $calc = commissions_calc_study($name, $amount);
                $studies[] = [
                    'name' => $name,
                    'amount_charged' => round($amount, 2),
                    'is_filmarray' => $calc['is_filmarray'],
                    'commission_amount' => $calc['commission_amount'],
                ];
                $totalAmount += $amount;
                $totalCommission += $calc['commission_amount'];
            }
            if (!$studies) {
                json_error('Agrega al menos un estudio', 422);
            }

            $pdo = db();
            $studiesJson = json_encode($studies, JSON_UNESCAPED_UNICODE);
            if ($id > 0) {
                $st = $pdo->prepare('SELECT statement_id FROM commission_entries WHERE id = ?');
                $st->execute([$id]);
                $row = $st->fetch();
                if (!$row) {
                    json_error('Registro no encontrado', 404);
                }
                if ($row['statement_id'] !== null) {
                    json_error('Ya está facturado; bórralo del estado de cuenta primero', 422);
                }
                $pdo->prepare(
                    'UPDATE commission_entries SET doctor_id = ?, patient_name = ?, entry_date = ?, studies = ?, total_amount = ?, total_commission = ? WHERE id = ?'
                )->execute([$doctorId, $patientName, $entryDate, $studiesJson, round($totalAmount, 2), round($totalCommission, 2), $id]);
                log_activity('apps', 'commission_entry_update', "Editó el registro de \"$patientName\"", 'commission_entry', $id);
            } else {
                $pdo->prepare(
                    'INSERT INTO commission_entries (doctor_id, patient_name, entry_date, studies, total_amount, total_commission, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
                )->execute([$doctorId, $patientName, $entryDate, $studiesJson, round($totalAmount, 2), round($totalCommission, 2), (int)$me['id']]);
                $id = (int)$pdo->lastInsertId();
                log_activity('apps', 'commission_entry_create', "Registró a \"$patientName\"", 'commission_entry', $id);
            }
            json_ok(['id' => $id]);
        }

        /** Borra un registro manual — solo si todavía no se facturó. */
        case 'entry_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT statement_id FROM commission_entries WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Registro no encontrado', 404);
            }
            if ($row['statement_id'] !== null) {
                json_error('Ya está facturado; bórralo del estado de cuenta primero', 422);
            }
            db()->prepare('DELETE FROM commission_entries WHERE id = ?')->execute([$id]);
            log_activity('apps', 'commission_entry_delete', 'Eliminó un registro de comisión', 'commission_entry', $id);
            json_ok(['deleted' => true]);
        }

        /** Vista previa (sin guardar) de los registros manuales pendientes de un médico en un rango de fechas. */
        case 'manual_preview': {
            $doctorId = (int)($_GET['doctor_id'] ?? 0);
            $from = commissions_valid_date($_GET['period_start'] ?? '');
            $to = commissions_valid_date($_GET['period_end'] ?? '');
            if (!$from || !$to || $from > $to) {
                json_error('Rango de fechas no válido', 422);
            }
            $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
            $st->execute([$doctorId]);
            if (!$st->fetch()) {
                json_error('Médico no encontrado', 404);
            }
            $lines = commissions_manual_lines($doctorId, $from, $to);
            json_ok(['lines' => $lines, 'total' => commissions_sum($lines)]);
        }

        /** Genera el estado de cuenta a partir de los registros manuales elegidos (uno por paciente, aplanados por estudio en el PDF). */
        case 'manual_save': {
            $b = request_body();
            $doctorId = (int)($b['doctor_id'] ?? 0);
            $entryIds = array_values(array_unique(array_map('intval', (array)($b['entry_ids'] ?? []))));
            if (!$entryIds) {
                json_error('No hay registros incluidos para generar el estado de cuenta', 422);
            }
            $st = db()->prepare('SELECT id FROM vinculacion_doctors WHERE id = ?');
            $st->execute([$doctorId]);
            if (!$st->fetch()) {
                json_error('Médico no encontrado', 404);
            }

            $placeholders = implode(',', array_fill(0, count($entryIds), '?'));
            $st2 = db()->prepare(
                "SELECT id, patient_name, entry_date, studies FROM commission_entries
                 WHERE doctor_id = ? AND statement_id IS NULL AND id IN ($placeholders)"
            );
            $st2->execute(array_merge([$doctorId], $entryIds));
            $entries = $st2->fetchAll();
            if (!$entries) {
                json_error('Los registros elegidos ya no están disponibles (puede que ya se hayan facturado)', 422);
            }

            $items = [];
            foreach ($entries as $e) {
                $studies = json_decode((string)$e['studies'], true) ?: [];
                foreach ($studies as $s) {
                    $amount = (float)($s['amount_charged'] ?? 0);
                    $commission = (float)($s['commission_amount'] ?? 0);
                    $items[] = [
                        'patient_name'      => $e['patient_name'],
                        'study_name'        => (string)($s['name'] ?? ''),
                        'amount_charged'    => $amount,
                        'commission_pct'    => $amount > 0 ? round($commission / $amount * 100, 1) : 0,
                        'commission_amount' => $commission,
                    ];
                }
            }
            if (!$items) {
                json_error('Los registros elegidos no tienen estudios', 422);
            }

            $total = round((float)array_sum(array_column($items, 'commission_amount')), 2);
            $partyName = commissions_doctor_name($doctorId);
            $dates = array_column($entries, 'entry_date');
            sort($dates);
            $from = $dates ? (string)$dates[0] : date('Y-m-d');
            $to = $dates ? (string)end($dates) : date('Y-m-d');

            $pdo = db();
            $folio = commissions_generate_folio($pdo);
            $pdo->prepare(
                'INSERT INTO commission_statements (folio, party_type, party_id, period_start, period_end, `lines`, total_commission, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $folio, 'doctor', $doctorId, $from, $to,
                json_encode(['source' => 'manual', 'party_name' => $partyName, 'items' => $items], JSON_UNESCAPED_UNICODE),
                $total, (int)$me['id'],
            ]);
            $id = (int)$pdo->lastInsertId();

            $includedIds = array_column($entries, 'id');
            $placeholders2 = implode(',', array_fill(0, count($includedIds), '?'));
            $pdo->prepare("UPDATE commission_entries SET statement_id = ? WHERE id IN ($placeholders2)")
                ->execute(array_merge([$id], $includedIds));

            log_activity('apps', 'commission_statement_create', "Generó estado de cuenta de comisiones \"$folio\" ($partyName, registro manual)", 'commission_statement', $id);
            json_ok(['id' => $id, 'folio' => $folio]);
        }

        /** Borra un estado de cuenta. Si venía de registros manuales, los libera de vuelta a pendientes. */
        case 'statement_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $statement = commissions_find_statement($id);
            db()->prepare('UPDATE commission_entries SET statement_id = NULL WHERE statement_id = ?')->execute([$id]);
            db()->prepare('DELETE FROM commission_statements WHERE id = ?')->execute([$id]);
            log_activity('apps', 'commission_statement_delete', "Eliminó el estado de cuenta \"{$statement['folio']}\"", 'commission_statement', $id);
            json_ok(['deleted' => true]);
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

/**
 * Regla de comisión para registros manuales: FilmArray (biología molecular) es
 * un monto fijo; cualquier otro estudio (análisis clínicos, o biología
 * molecular que no sea FilmArray) es 10% del monto cobrado. Se clasifica por
 * nombre del estudio, no por `commission_group` del catálogo — ese campo casi
 * no está poblado en `quote_studies` y no tiene ningún estudio FilmArray dado
 * de alta.
 */
function commissions_calc_study(string $studyName, float $amountCharged): array
{
    $isFilmArray = stripos($studyName, 'filmarray') !== false || stripos($studyName, 'film array') !== false;
    $commission = $isFilmArray ? 750.00 : round($amountCharged * 0.10, 2);
    return ['is_filmarray' => $isFilmArray, 'commission_amount' => $commission];
}

/** Registros manuales pendientes (sin facturar) de un médico en un rango de fechas, uno por línea (no por estudio). */
function commissions_manual_lines(int $doctorId, string $from, string $to): array
{
    $st = db()->prepare(
        'SELECT id, patient_name, entry_date, studies, total_amount, total_commission
         FROM commission_entries
         WHERE doctor_id = ? AND statement_id IS NULL AND entry_date BETWEEN ? AND ?
         ORDER BY entry_date'
    );
    $st->execute([$doctorId, $from, $to]);
    $lines = [];
    foreach ($st->fetchAll() as $r) {
        $studies = json_decode((string)$r['studies'], true) ?: [];
        $amount = (float)$r['total_amount'];
        $commission = (float)$r['total_commission'];
        $lines[] = [
            'id'                  => (int)$r['id'],
            'patient_name'        => $r['patient_name'],
            'study_name'          => implode(', ', array_column($studies, 'name')),
            'entry_date'          => $r['entry_date'],
            'amount_charged'      => $amount,
            'commission_pct'      => $amount > 0 ? round($commission / $amount * 100, 1) : 0,
            'commission_amount'   => $commission,
            'commission_included' => true,
        ];
    }
    return $lines;
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

/**
 * Manda la imagen pegada (captura de la lista informal de un médico) al asistente
 * de IA configurado (el que esté activo en Admin Tools > API) y pide de vuelta
 * solo un JSON con los renglones ya separados. El formato de origen es ambiguo
 * a propósito (nombre - 1 o 2 estudios - tipo de servicio opcional - fecha, sin
 * delimitador fijo) — por eso se usa el modelo en vez de un regex.
 */
function commissions_extract_rows_from_image(array $image): array
{
    if (strpos((string)ini_get('disable_functions'), 'set_time_limit') === false) {
        @set_time_limit(120);
    }

    $prompt = <<<TXT
Esta imagen es una captura de una lista informal (tipo WhatsApp) de pacientes que un
médico refirió a un laboratorio clínico. Cada renglón (con viñeta) tiene este
formato, sin delimitador fijo entre sus partes:

Nombre del paciente - Estudio 1 [- Estudio 2] - [Servicio normal|Servicio de urgencia] - fecha (dd/mm/aa)

Reglas para separar cada renglón:
- Siempre termina en una fecha dd/mm/aa.
- El segmento "Servicio normal" o "Servicio de urgencia" (a veces en negritas, a
  veces ausente por completo) NO es un estudio: es el tipo de servicio.
- Antes de eso puede haber 1 o 2 estudios de laboratorio, separados por " - ".
- Lo primero del renglón es siempre el nombre completo del paciente.
- Puede haber encabezados de sección como "PACIENTES MES DE JULIO": ignóralos,
  no son pacientes.

Devuelve SOLO un JSON (sin texto alrededor, sin bloque de markdown) con un arreglo
de objetos, uno por paciente, exactamente con esta forma:
[{"name": "...", "studies": ["...", "..."], "service_type": "normal"|"urgencia"|null, "date": "dd/mm/aa"}]
TXT;

    $text = ai_generate(
        [['role' => 'user', 'text' => $prompt]],
        'Extraes datos estructurados de imágenes con precisión. Respondes únicamente JSON válido, sin explicaciones ni markdown.',
        null,
        3000,
        [],
        $image
    );

    $clean = trim(preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim((string)$text)));
    $data = json_decode($clean, true);
    if (!is_array($data)) {
        throw new RuntimeException('No se pudo interpretar la imagen. Intenta con una captura más clara o recorta solo la lista de pacientes.');
    }

    $rows = [];
    foreach ($data as $r) {
        if (!is_array($r) || trim((string)($r['name'] ?? '')) === '') {
            continue;
        }
        $rows[] = [
            'name'         => trim((string)$r['name']),
            'studies'      => array_values(array_filter(array_map('strval', (array)($r['studies'] ?? [])))),
            'service_type' => in_array($r['service_type'] ?? null, ['normal', 'urgencia'], true) ? $r['service_type'] : null,
            'date'         => trim((string)($r['date'] ?? '')),
        ];
    }
    if (!$rows) {
        throw new RuntimeException('La imagen no arrojó ningún paciente reconocible.');
    }
    return $rows;
}

/** Estudios comisionables del médico, para cruzar contra los renglones de la imagen. Sin filtro de fecha: la imagen puede traer varios meses. */
function commissions_doctor_studies_for_matching(int $doctorId): array
{
    $fullName = sql_full_name('p');
    $st = db()->prepare(
        "SELECT es.id, es.study_name, es.commission_group, es.amount_charged,
                e.admission_date, $fullName AS patient_name
         FROM episode_studies es
         JOIN episodes e ON e.id = es.episode_id
         JOIN patients p ON p.id = e.patient_id
         WHERE e.linked_doctor_id = ? AND es.commission_group IS NOT NULL
         ORDER BY e.admission_date DESC
         LIMIT 500"
    );
    $st->execute([$doctorId]);
    return $st->fetchAll();
}

/**
 * Cruza cada renglón extraído de la imagen (nombre suelto) contra los estudios
 * comisionables ya capturados en Sirius para ese médico, normalizando con
 * assistant_fold() (acentos/mayúsculas, igual que el asistente). Nunca elige
 * solo entre varios candidatos: si hay ambigüedad la fila queda sin resolver
 * con sus candidatos a la vista, para que el usuario decida — nunca se adivina
 * un monto de comisión.
 */
/** Suma monto/comisión/estudios de un grupo de episode_studies de un mismo paciente. Se usa tanto para la coincidencia elegida como para cada candidato (así la revisión en pantalla ya muestra montos reales, aunque el guardado los vuelve a calcular server-side). */
function commissions_aggregate_studies(array $studies, array $rate): array
{
    $amount = 0.0;
    $commission = 0.0;
    $studyNames = [];
    $episodeStudyIds = [];
    foreach ($studies as $s) {
        $amt = (float)$s['amount_charged'];
        $pct = (float)($rate[$s['commission_group']] ?? 0);
        $amount += $amt;
        $commission += round($amt * $pct / 100, 2);
        $studyNames[] = $s['study_name'];
        $episodeStudyIds[] = (int)$s['id'];
    }
    return [
        'patient_name'      => $studies ? $studies[0]['patient_name'] : null,
        'studies'           => $studyNames,
        'episode_study_ids' => $episodeStudyIds,
        'amount_charged'    => round($amount, 2),
        'commission_amount' => round($commission, 2),
        'commission_pct'    => $amount > 0 ? round($commission / $amount * 100, 1) : 0,
    ];
}

function commissions_match_rows(int $doctorId, array $rows): array
{
    $studies = commissions_doctor_studies_for_matching($doctorId);
    $rate = vinculacion_commission_rates();

    $byPatient = [];
    foreach ($studies as $s) {
        $byPatient[assistant_fold($s['patient_name'])][] = $s;
    }
    $foldedNames = array_keys($byPatient);

    $out = [];
    foreach ($rows as $row) {
        $rawName = (string)$row['name'];
        $folded = assistant_fold($rawName);
        $tokens = array_values(array_filter(explode(' ', $folded)));

        $matchedKey = $byPatient[$folded] ?? null ? $folded : null;
        $candidateKeys = [];
        if ($matchedKey === null) {
            foreach ($foldedNames as $pn) {
                $pnTokens = array_values(array_filter(explode(' ', $pn)));
                [$short, $long] = count($tokens) <= count($pnTokens) ? [$tokens, $pnTokens] : [$pnTokens, $tokens];
                if ($short && !array_diff($short, $long)) {
                    $candidateKeys[] = $pn;
                }
            }
            if (count($candidateKeys) === 1) {
                $matchedKey = $candidateKeys[0];
                $candidateKeys = [];
            }
        }

        $agg = commissions_aggregate_studies($matchedKey !== null ? $byPatient[$matchedKey] : [], $rate);

        $out[] = [
            'patient_name_raw'     => $rawName,
            'patient_name_matched' => $agg['patient_name'],
            'studies_raw'          => $row['studies'],
            'studies_matched'      => $agg['studies'],
            'service_type'         => $row['service_type'],
            'date_label'           => $row['date'],
            'amount_charged'       => $agg['amount_charged'],
            'commission_amount'    => $agg['commission_amount'],
            'commission_pct'       => $agg['commission_pct'],
            'matched'              => $matchedKey !== null,
            'commission_included'  => $matchedKey !== null,
            'episode_study_ids'    => $agg['episode_study_ids'],
            'candidates'           => array_map(
                fn($pn) => commissions_aggregate_studies($byPatient[$pn], $rate) + ['name' => $byPatient[$pn][0]['patient_name']],
                $candidateKeys
            ),
        ];
    }
    return $out;
}
