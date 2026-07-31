<?php
/**
 * Handler quotes: cotizaciones para pacientes (Apps > Cotizador).
 * La búsqueda de estudios y el guardado quedan bajo el permiso 'apps' con el
 * flag 'cotizador' (o rol admin); la administración del catálogo en sí vive en
 * el handler catalog, bajo su propio módulo de Admin Tools.
 */

function handle_quotes(string $action): void
{
    $me = current_user();
    $canQuote = is_admin_role($me) || user_flag('apps', 'cotizador');
    if (!$canQuote) {
        json_error('No tienes acceso al Cotizador', 403);
    }

    switch ($action) {
        /** Estudios activos del catálogo, para armar la cotización. */
        case 'search_studies': {
            $q = trim((string)($_GET['q'] ?? ''));
            $params = [];
            $where = 'is_active = 1';
            if ($q !== '') {
                $where .= ' AND name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            $st = db()->prepare("SELECT id, name, category, public_price FROM quote_studies WHERE $where ORDER BY name LIMIT 25");
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['public_price'] = (float)$it['public_price'];
            }
            unset($it);
            json_ok(['items' => $items]);
        }

        /** Pacientes registrados, para prellenar los datos del cliente (opcional). */
        case 'search_patients': {
            $q = trim((string)($_GET['q'] ?? ''));
            if (mb_strlen($q) < 2) {
                json_ok(['patients' => []]);
            }
            $fullName = sql_full_name('p');
            $like = '%' . $q . '%';
            $st = db()->prepare(
                "SELECT p.id, p.file_number, p.first_name, p.paternal_surname, p.maternal_surname, p.phone, p.mobile,
                        p.street, p.colonia, p.postal_code, p.city, p.state
                 FROM patients p
                 WHERE p.is_deleted = 0 AND ($fullName LIKE ? OR p.file_number LIKE ?)
                 ORDER BY p.paternal_surname LIMIT 15"
            );
            $st->execute([$like, $like]);
            json_ok(['patients' => $st->fetchAll()]);
        }

        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = min(100, max(1, (int)($_GET['per_page'] ?? 25)));
            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND (folio LIKE ? OR client_name LIKE ?)';
                $params[] = '%' . $q . '%';
                $params[] = '%' . $q . '%';
            }
            $pdo = db();
            $st = $pdo->prepare("SELECT COUNT(*) c FROM quotes WHERE $where");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $st = $pdo->prepare(
                "SELECT q.id, q.folio, q.client_name, q.quote_date, q.total, u.full_name AS created_by_name
                 FROM quotes q LEFT JOIN users u ON u.id = q.created_by
                 WHERE $where ORDER BY q.created_at DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage)
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['total'] = (float)$it['total'];
            }
            unset($it);
            json_ok(['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
        }

        case 'get': {
            $quote = find_quote((int)($_GET['id'] ?? 0));
            $quote['id'] = (int)$quote['id'];
            $quote['items'] = json_decode((string)$quote['items'], true) ?: [];
            $quote['subtotal'] = (float)$quote['subtotal'];
            $quote['discount_pct'] = (float)$quote['discount_pct'];
            $quote['discount_amount'] = (float)$quote['discount_amount'];
            $quote['total'] = (float)$quote['total'];
            json_ok(['quote' => $quote]);
        }

        case 'save': {
            $b = request_body();
            $items = is_array($b['items'] ?? null) ? $b['items'] : [];
            $lines = [];
            $subtotal = 0.0;
            foreach ($items as $it) {
                $name = trim((string)($it['name'] ?? ''));
                $unitPrice = max(0, (float)($it['unit_price'] ?? 0));
                $quantity = max(1, (float)($it['quantity'] ?? 1));
                if ($name === '') {
                    continue;
                }
                $lineTotal = round($unitPrice * $quantity, 2);
                $lines[] = [
                    'study_id'   => isset($it['study_id']) ? (int)$it['study_id'] : null,
                    'name'       => $name,
                    'unit_price' => $unitPrice,
                    'quantity'   => $quantity,
                    'line_total' => $lineTotal,
                ];
                $subtotal += $lineTotal;
            }
            if (!$lines) {
                json_error('Agrega al menos un estudio a la cotización', 422);
            }
            $subtotal = round($subtotal, 2);
            $discountPct = max(0, min(100, (float)($b['discount_pct'] ?? 0)));
            $discountAmount = round($subtotal * $discountPct / 100, 2);
            $total = round($subtotal - $discountAmount, 2);

            $clientName = trim((string)($b['client_name'] ?? '')) ?: 'Público en General';
            $clientPhone = trim((string)($b['client_phone'] ?? '')) ?: 'S/N';
            $clientAddress = trim((string)($b['client_address'] ?? '')) ?: 'S/D';
            $quoteDate = valid_quote_date($b['quote_date'] ?? '') ?? date('Y-m-d');
            $patientId = !empty($b['patient_id']) ? (int)$b['patient_id'] : null;
            $notes = trim((string)($b['notes'] ?? '')) ?: null;

            $pdo = db();
            $folio = generate_quote_folio($pdo);
            $pdo->prepare(
                'INSERT INTO quotes (folio, patient_id, client_name, client_phone, client_address, quote_date,
                                      items, subtotal, discount_pct, discount_amount, total, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $folio, $patientId, $clientName, $clientPhone, $clientAddress, $quoteDate,
                json_encode($lines, JSON_UNESCAPED_UNICODE), $subtotal, $discountPct, $discountAmount, $total,
                $notes, (int)$me['id'],
            ]);
            $id = (int)$pdo->lastInsertId();
            log_activity('apps', 'quote_create', "Creó cotización $folio · $clientName ($total)", 'quote', $id);
            json_ok(['id' => $id, 'folio' => $folio]);
        }

        case 'delete': {
            if (!is_admin_role($me)) {
                json_error('Solo un administrador puede eliminar cotizaciones', 403);
            }
            $b = request_body();
            $quote = find_quote((int)($b['id'] ?? 0));
            db()->prepare('DELETE FROM quotes WHERE id = ?')->execute([$quote['id']]);
            log_activity('apps', 'quote_delete', "Eliminó cotización {$quote['folio']}", 'quote', (int)$quote['id']);
            json_ok();
        }
    }
}

function find_quote(int $id): array
{
    $st = db()->prepare('SELECT * FROM quotes WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Cotización no encontrada', 404);
    }
    return $row;
}

function valid_quote_date($v): ?string
{
    $v = trim((string)$v);
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}

/**
 * Folio de cotización: ddmmaa-NN, con NN aleatorio sin repetirse el mismo día
 * (mismo criterio que generate_lab_folio, adaptado al formato del membretador
 * de cotizaciones ya usado por la clínica).
 */
function generate_quote_folio(PDO $pdo): string
{
    $prefix = date('dmy') . '-';
    $st = $pdo->prepare('SELECT folio FROM quotes WHERE folio LIKE ?');
    $st->execute([$prefix . '%']);
    $used = [];
    foreach ($st->fetchAll() as $row) {
        $used[(int)substr($row['folio'], strlen($prefix))] = true;
    }
    $available = array_diff(range(10, 99), array_keys($used));
    if ($available) {
        $n = $available[array_rand($available)];
    } else {
        $n = max(array_keys($used)) + 1;
    }
    return $prefix . $n;
}
