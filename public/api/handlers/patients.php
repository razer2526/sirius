<?php
/** Handler patients: expedientes. Requiere módulo 'expedientes'. */

function handle_patients(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = 20;
            $offset = ($page - 1) * $perPage;

            $where = 'p.is_deleted = 0';
            $params = [];
            if (!is_admin_role($me)) {
                // Solo pacientes con al menos un episodio "general" o asignado a mí
                $where .= ' AND EXISTS (
                    SELECT 1 FROM episodes ep WHERE ep.patient_id = p.id
                    AND (ep.assigned_user_id IS NULL OR ep.assigned_user_id = ?)
                )';
                $params[] = (int)$me['id'];
            }
            if ($q !== '') {
                $fullName = sql_full_name('p');
                $where .= " AND (p.file_number LIKE ? OR p.phone LIKE ? OR p.mobile LIKE ? OR $fullName LIKE ?)";
                $like = '%' . $q . '%';
                $params = array_merge($params, [$like, $like, $like, $like]);
            }

            $total = db()->prepare("SELECT COUNT(*) c FROM patients p WHERE $where");
            $total->execute($params);
            $total = (int)$total->fetch()['c'];

            $st = db()->prepare(
                "SELECT p.id, p.file_number, p.first_name, p.paternal_surname, p.maternal_surname,
                        p.birth_date, p.sex, p.phone, p.mobile, p.created_at
                 FROM patients p WHERE $where
                 ORDER BY p.paternal_surname, p.maternal_surname, p.first_name
                 LIMIT $perPage OFFSET $offset"
            );
            $st->execute($params);
            $patients = $st->fetchAll();

            // Servicios con episodios por paciente (para las etiquetas de la tarjeta)
            if ($patients) {
                $ids = array_column($patients, 'id');
                $marks = implode(',', array_fill(0, count($ids), '?'));
                $eps = db()->prepare(
                    "SELECT patient_id, service, COUNT(*) c FROM episodes
                     WHERE patient_id IN ($marks) GROUP BY patient_id, service"
                );
                $eps->execute($ids);
                $byPatient = [];
                foreach ($eps->fetchAll() as $row) {
                    $byPatient[$row['patient_id']][$row['service']] = (int)$row['c'];
                }
                foreach ($patients as &$p) {
                    $p['services'] = $byPatient[$p['id']] ?? new stdClass();
                }
            }

            json_ok([
                'patients' => $patients,
                'total'    => $total,
                'page'     => $page,
                'pages'    => max(1, (int)ceil($total / $perPage)),
            ]);
        }

        case 'get': {
            $id = (int)($_GET['id'] ?? 0);
            $patient = find_patient($id);

            $st = db()->prepare(
                'SELECT e.*, u.full_name AS assigned_user_name FROM episodes e
                 LEFT JOIN users u ON u.id = e.assigned_user_id
                 WHERE e.patient_id = ? ORDER BY e.admission_date DESC'
            );
            $st->execute([$id]);
            $allEpisodes = $st->fetchAll();
            $episodes = visible_episodes($allEpisodes, $me);
            if ($allEpisodes && !$episodes) {
                json_error('No tienes acceso a este expediente', 403);
            }

            $consultsByEpisode = [];
            $studiesByEpisode = [];
            if ($episodes) {
                $ids = array_column($episodes, 'id');
                $marks = implode(',', array_fill(0, count($ids), '?'));
                $st = db()->prepare(
                    "SELECT c.*, u.full_name AS created_by_name FROM consultations c
                     LEFT JOIN users u ON u.id = c.created_by
                     WHERE c.episode_id IN ($marks) ORDER BY c.consult_date DESC"
                );
                $st->execute($ids);
                foreach ($st->fetchAll() as $row) {
                    $row['params'] = $row['params'] ? json_decode($row['params'], true) : null;
                    $consultsByEpisode[$row['episode_id']][] = $row;
                }

                $st = db()->prepare(
                    "SELECT * FROM episode_studies WHERE episode_id IN ($marks) ORDER BY id"
                );
                $st->execute($ids);
                foreach ($st->fetchAll() as $row) {
                    $row['amount_charged'] = (float)$row['amount_charged'];
                    $studiesByEpisode[$row['episode_id']][] = $row;
                }
            }
            foreach ($episodes as &$e) {
                $e['service_data'] = $e['service_data'] ? json_decode($e['service_data'], true) : null;
                $e['consultations'] = $consultsByEpisode[$e['id']] ?? [];
                $e['studies'] = $studiesByEpisode[$e['id']] ?? [];
            }

            log_activity('expedientes', 'patient_view', 'Consultó expediente ' . $patient['file_number'], 'patient', $id);
            json_ok(['patient' => $patient, 'episodes' => $episodes]);
        }

        case 'update': {
            require_admin_role();
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $patient = find_patient($id);

            $editable = [
                'first_name', 'paternal_surname', 'maternal_surname', 'birth_date', 'sex', 'curp',
                'phone', 'mobile', 'email', 'street', 'colonia', 'postal_code', 'city', 'state',
                'marital_status', 'occupation', 'nationality', 'religion', 'blood_type',
                'guardian_name', 'guardian_phone', 'guardian_relationship',
                'emergency_contact_name', 'emergency_contact_phone',
                'allergies', 'chronic_conditions', 'family_history', 'current_medications', 'notes',
            ];
            $sets = [];
            $values = [];
            foreach ($editable as $f) {
                if (array_key_exists($f, $b)) {
                    $v = trim((string)$b[$f]);
                    $sets[] = "$f = ?";
                    $values[] = $v === '' ? null : $v;
                }
            }
            if (!$sets) {
                json_error('Nada que actualizar', 422);
            }
            if (isset($b['first_name']) && trim($b['first_name']) === '') {
                json_error('El nombre es obligatorio', 422);
            }
            if (isset($b['paternal_surname']) && trim($b['paternal_surname']) === '') {
                json_error('El apellido paterno es obligatorio', 422);
            }
            if (!empty($b['email']) && !filter_var($b['email'], FILTER_VALIDATE_EMAIL)) {
                json_error('Email no válido', 422);
            }
            $values[] = $id;
            db()->prepare('UPDATE patients SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($values);
            log_activity('expedientes', 'patient_update', 'Editó expediente ' . $patient['file_number'], 'patient', $id);
            json_ok();
        }

        case 'delete': {
            require_admin_role();
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $patient = find_patient($id);
            db()->prepare('UPDATE patients SET is_deleted = 1 WHERE id = ?')->execute([$id]);
            log_activity('expedientes', 'patient_delete', 'Eliminó expediente ' . $patient['file_number'], 'patient', $id);
            json_ok();
        }

        /** Documentos adjuntos al expediente (estudios previos, imagenología, historial viejo…). */
        case 'doc_list': {
            $id = (int)($_GET['patient_id'] ?? 0);
            $patient = find_patient($id);
            if (!patient_is_visible($patient, $me)) {
                json_error('No tienes acceso a este expediente', 403);
            }
            $st = db()->prepare(
                'SELECT d.*, u.full_name AS created_by_name FROM patient_documents d
                 LEFT JOIN users u ON u.id = d.created_by
                 WHERE d.patient_id = ? ORDER BY d.created_at DESC'
            );
            $st->execute([$id]);
            $docs = $st->fetchAll();
            foreach ($docs as &$d) {
                $d['id'] = (int)$d['id'];
                $d['size'] = (int)$d['size'];
            }
            json_ok(['documents' => $docs]);
        }

        case 'doc_delete': {
            require_admin_role();
            $b = request_body();
            $doc = find_patient_document((int)($b['id'] ?? 0));
            @unlink(__DIR__ . '/../../uploads/expedientes/' . basename($doc['stored_name']));
            db()->prepare('DELETE FROM patient_documents WHERE id = ?')->execute([$doc['id']]);
            log_activity('expedientes', 'patient_doc_delete', "Eliminó documento \"{$doc['name']}\" del expediente", 'patient_document', (int)$doc['id']);
            json_ok();
        }
    }
}

function find_patient_document(int $id): array
{
    $st = db()->prepare('SELECT * FROM patient_documents WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Documento no encontrado', 404);
    }
    return $row;
}

/**
 * Filtra episodios a los que el usuario tiene acceso: administradores ven todo;
 * el resto solo ve los "generales" (sin responsable asignado) o los suyos.
 */
function visible_episodes(array $episodes, array $me): array
{
    if (is_admin_role($me)) {
        return $episodes;
    }
    return array_values(array_filter($episodes, function ($e) use ($me) {
        return $e['assigned_user_id'] === null || (int)$e['assigned_user_id'] === (int)$me['id'];
    }));
}

function find_patient(int $id): array
{
    $st = db()->prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 0');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Paciente no encontrado', 404);
    }
    return $row;
}

/** Editar/eliminar expedientes exige rol administrador o developper (doble chequeo en servidor). */
function require_admin_role(): void
{
    if (!is_admin_role(current_user())) {
        json_error('Esta acción requiere rol de administrador', 403);
    }
}
