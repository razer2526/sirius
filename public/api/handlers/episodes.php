<?php
/** Handler episodes: admisiones. Requiere módulo 'admision'. */

require_once __DIR__ . '/../../includes/services.php';

function handle_episodes(string $action): void
{
    switch ($action) {
        case 'create': {
            $b = request_body();
            $service = (string)($b['service'] ?? '');
            if (!isset(SERVICE_LABELS[$service])) {
                json_error('Servicio no válido', 422);
            }

            $pdo = db();
            $me = current_user();
            $patientId = (int)($b['patient_id'] ?? 0);
            $p = $b['patient'] ?? [];

            // Validación de datos del paciente (solo si es paciente nuevo)
            if ($patientId === 0) {
                $first = trim($p['first_name'] ?? '');
                $pat   = trim($p['paternal_surname'] ?? '');
                if ($first === '' || $pat === '') {
                    json_error('Nombre y apellido paterno son obligatorios', 422);
                }
                if (!empty($p['email']) && !filter_var($p['email'], FILTER_VALIDATE_EMAIL)) {
                    json_error('Email no válido', 422);
                }
                // Advertencia de posible duplicado (mismo nombre completo + fecha de nacimiento)
                if (empty($b['ignore_duplicate'])) {
                    $st = $pdo->prepare(
                        'SELECT id, file_number, first_name, paternal_surname, maternal_surname, birth_date
                         FROM patients
                         WHERE is_deleted = 0 AND LOWER(first_name) = LOWER(?) AND LOWER(paternal_surname) = LOWER(?)
                           AND (birth_date = ? OR (birth_date IS NULL AND ? = \'\'))'
                    );
                    $bd = trim($p['birth_date'] ?? '');
                    $st->execute([$first, $pat, $bd, $bd]);
                    $dup = $st->fetch();
                    if ($dup) {
                        json_ok(['duplicate' => $dup]);
                    }
                }
            }

            // Whitelist de campos específicos del servicio (catálogo de fichas)
            $serviceData = service_filter_data($service, 'admission', $b['service_data'] ?? []);

            // Fecha de entrega estimada (solo Laboratorio): default admisión + 2 días, editable.
            $expectedDelivery = null;
            if ($service === 'laboratorio') {
                $expectedDelivery = valid_episode_date($b['expected_delivery_date'] ?? '')
                    ?? date('Y-m-d', strtotime('+2 days'));
            }

            // Responsable asignado: controla quién ve este episodio (null = general, todos lo ven)
            $assignedUserId = isset($b['assigned_user_id']) && $b['assigned_user_id'] !== '' ? (int)$b['assigned_user_id'] : null;
            if ($assignedUserId !== null) {
                $st = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
                $st->execute([$assignedUserId]);
                if (!$st->fetch()) {
                    json_error('El responsable asignado no es válido', 422);
                }
            }

            $pdo->beginTransaction();
            try {
                if ($patientId === 0) {
                    $patientId = insert_patient($p, (int)$me['id']);
                    $isNewPatient = true;
                } else {
                    $st = $pdo->prepare('SELECT id FROM patients WHERE id = ? AND is_deleted = 0');
                    $st->execute([$patientId]);
                    if (!$st->fetch()) {
                        json_error('Paciente no encontrado', 404);
                    }
                    $isNewPatient = false;
                }

                // Laboratorio lleva además folio de orden aammdd-NN (NN aleatorio 11-40 sin repetir en el día)
                $serviceFolio = null;
                if ($service === 'laboratorio') {
                    $serviceFolio = generate_lab_folio($pdo);
                }

                $st = $pdo->prepare(
                    'INSERT INTO episodes (patient_id, service, service_folio, admission_date, reason, referring_doctor, assigned_user_id, service_data, status, expected_delivery_date, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $st->execute([
                    $patientId,
                    $service,
                    $serviceFolio,
                    date('Y-m-d H:i:s'),
                    trim($b['reason'] ?? '') ?: null,
                    trim($b['referring_doctor'] ?? '') ?: null,
                    $assignedUserId,
                    $serviceData ? json_encode($serviceData, JSON_UNESCAPED_UNICODE) : null,
                    'activo',
                    $expectedDelivery,
                    (int)$me['id'],
                ]);
                $episodeId = (int)$pdo->lastInsertId();
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }

            $st = $pdo->prepare('SELECT file_number FROM patients WHERE id = ?');
            $st->execute([$patientId]);
            $fileNumber = $st->fetch()['file_number'];

            log_activity(
                'admision',
                'episode_create',
                'Admisión ' . SERVICE_LABELS[$service] . " · folio $fileNumber"
                    . ($serviceFolio ? " · orden $serviceFolio" : ''),
                'episode',
                $episodeId
            );
            json_ok([
                'episode_id'    => $episodeId,
                'patient_id'    => $patientId,
                'file_number'   => $fileNumber,
                'service_folio' => $serviceFolio,
                'new_patient'   => $isNewPatient,
            ]);
        }

        /** Edita la fecha de entrega estimada y/o marca (o desmarca) la entrega de resultados. */
        case 'set_delivery': {
            $b = request_body();
            $me = current_user();
            $episodeId = (int)($b['episode_id'] ?? 0);
            $st = db()->prepare('SELECT * FROM episodes WHERE id = ?');
            $st->execute([$episodeId]);
            $episode = $st->fetch();
            if (!$episode) {
                json_error('Episodio no encontrado', 404);
            }
            if ($episode['service'] !== 'laboratorio') {
                json_error('Esta acción solo aplica a episodios de Laboratorio', 422);
            }
            if (!is_admin_role($me)) {
                $assigned = $episode['assigned_user_id'];
                if ($assigned !== null && (int)$assigned !== (int)$me['id']) {
                    json_error('No tienes acceso a este expediente', 403);
                }
            }

            $sets = [];
            $params = [];
            if (array_key_exists('expected_delivery_date', $b)) {
                $date = valid_episode_date($b['expected_delivery_date']);
                if ($b['expected_delivery_date'] !== '' && !$date) {
                    json_error('Fecha de entrega no válida', 422);
                }
                $sets[] = 'expected_delivery_date = ?';
                $params[] = $date;
            }
            if (array_key_exists('delivered', $b)) {
                $sets[] = 'results_delivered_at = ?';
                $params[] = !empty($b['delivered']) ? date('Y-m-d H:i:s') : null;
            }
            if (!$sets) {
                json_error('Nada que actualizar', 422);
            }
            $params[] = $episodeId;
            db()->prepare('UPDATE episodes SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);

            log_activity(
                'admision',
                'episode_delivery',
                !empty($b['delivered']) ? 'Marcó resultados como entregados' : 'Actualizó fecha de entrega',
                'episode',
                $episodeId
            );
            json_ok();
        }

        case 'assignable_users': {
            // Lista para el desplegable "Responsable asignado" del formulario de admisión
            $rows = db()->query(
                "SELECT id, full_name FROM users WHERE assignable = 1 AND is_active = 1 ORDER BY full_name"
            )->fetchAll();
            json_ok(['users' => $rows]);
        }

        case 'search_patient': {
            // Búsqueda ligera para reutilizar paciente existente durante la admisión
            $q = trim((string)($_GET['q'] ?? ''));
            if (mb_strlen($q) < 2) {
                json_ok(['patients' => []]);
            }
            $like = '%' . $q . '%';
            $fullName = sql_full_name();
            $st = db()->prepare(
                "SELECT id, file_number, first_name, paternal_surname, maternal_surname, birth_date, sex, phone, mobile
                 FROM patients
                 WHERE is_deleted = 0 AND (
                    file_number LIKE ? OR phone LIKE ? OR mobile LIKE ? OR $fullName LIKE ?
                 )
                 ORDER BY paternal_surname, first_name LIMIT 10"
            );
            $st->execute([$like, $like, $like, $like]);
            json_ok(['patients' => $st->fetchAll()]);
        }
    }
}

function valid_episode_date($v): ?string
{
    $v = trim((string)$v);
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}

/** Inserta un paciente nuevo generando folio BP-YYYY-#### de forma segura. */
function insert_patient(array $p, int $createdBy): int
{
    $pdo = db();
    $year = date('Y');
    $prefix = "BP-$year-";

    $sql = 'SELECT file_number FROM patients WHERE file_number LIKE ? ORDER BY file_number DESC LIMIT 1';
    if (db_driver() === 'mysql') {
        $sql .= ' FOR UPDATE';
    }
    $st = $pdo->prepare($sql);
    $st->execute([$prefix . '%']);
    $last = $st->fetch();
    $next = $last ? ((int)substr($last['file_number'], strlen($prefix))) + 1 : 1;
    $fileNumber = $prefix . str_pad((string)$next, 4, '0', STR_PAD_LEFT);

    $fields = [
        'first_name', 'paternal_surname', 'maternal_surname', 'birth_date', 'sex', 'curp',
        'phone', 'mobile', 'email', 'street', 'colonia', 'postal_code', 'city', 'state',
        'marital_status', 'occupation', 'nationality', 'religion', 'blood_type',
        'guardian_name', 'guardian_phone', 'guardian_relationship',
        'emergency_contact_name', 'emergency_contact_phone',
        'allergies', 'chronic_conditions', 'family_history', 'current_medications', 'notes',
    ];
    $values = [$fileNumber];
    foreach ($fields as $f) {
        $v = isset($p[$f]) ? trim((string)$p[$f]) : '';
        $values[] = $v === '' ? null : $v;
    }
    $values[] = $createdBy;

    $cols = 'file_number, ' . implode(', ', $fields) . ', created_by';
    $marks = implode(', ', array_fill(0, count($fields) + 2, '?'));
    $pdo->prepare("INSERT INTO patients ($cols) VALUES ($marks)")->execute($values);
    return (int)$pdo->lastInsertId();
}

/**
 * Folio de orden de laboratorio: aammdd-NN con NN aleatorio entre 11 y 40,
 * sin repetirse el mismo día. Si los 30 números se agotan, continúa en 41, 42...
 */
function generate_lab_folio(PDO $pdo): string
{
    $prefix = date('ymd') . '-';
    $st = $pdo->prepare('SELECT service_folio FROM episodes WHERE service_folio LIKE ?');
    $st->execute([$prefix . '%']);
    $used = [];
    foreach ($st->fetchAll() as $row) {
        $used[(int)substr($row['service_folio'], strlen($prefix))] = true;
    }
    $available = array_diff(range(11, 40), array_keys($used));
    if ($available) {
        $n = $available[array_rand($available)];
    } else {
        $n = max(array_keys($used)) + 1;
    }
    return $prefix . $n;
}
