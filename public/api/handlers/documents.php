<?php
/**
 * Handler documents: estudios membretados (FilmArray GI y futuros paneles).
 * Los documentos son públicos para quien tenga el módulo; se registra quién los creó
 * y quién los revisó. La generación del PDF vive en documento.php.
 */

require_once __DIR__ . '/../../includes/doc_templates.php';
require_once __DIR__ . '/../../includes/pdf_text.php';

function handle_documents(string $action): void
{
    $me = current_user();
    $canReview = is_admin_role($me) || user_flag('apps', 'review');
    $canDelete = is_admin_role($me) || user_flag('apps', 'delete');

    switch ($action) {
        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $type = trim((string)($_GET['type'] ?? ''));
            $params = [];
            $where = '1=1';
            if ($type !== '') {
                $where .= ' AND d.doc_type = ?';
                $params[] = $type;
            }
            if ($q !== '') {
                $where .= ' AND (d.patient_name LIKE ? OR d.folio LIKE ?)';
                $params[] = '%' . $q . '%';
                $params[] = '%' . $q . '%';
            }
            $st = db()->prepare(
                "SELECT d.id, d.doc_type, d.folio, d.patient_id, d.patient_name, d.status,
                        d.created_at, d.reviewed_at, u.full_name AS created_by_name, r.full_name AS reviewed_by_name
                 FROM documents d
                 LEFT JOIN users u ON u.id = d.created_by
                 LEFT JOIN users r ON r.id = d.reviewed_by
                 WHERE $where
                 ORDER BY d.created_at DESC
                 LIMIT 200"
            );
            $st->execute($params);
            $docs = $st->fetchAll();
            $templates = doc_templates();
            foreach ($docs as &$d) {
                $d['id'] = (int)$d['id'];
                $d['type_label'] = $templates[$d['doc_type']]['short'] ?? $d['doc_type'];
            }
            json_ok([
                'documents'  => $docs,
                'can_review' => $canReview,
                'can_delete' => $canDelete,
            ]);
        }

        case 'get': {
            $doc = find_document((int)($_GET['id'] ?? 0));
            $doc['patient_data']  = $doc['patient_data'] ? json_decode($doc['patient_data'], true) : [];
            $doc['clinical_data'] = $doc['clinical_data'] ? json_decode($doc['clinical_data'], true) : [];
            $doc['results']       = $doc['results'] ? json_decode($doc['results'], true) : [];
            $doc['id'] = (int)$doc['id'];
            json_ok(['document' => $doc, 'can_review' => $canReview, 'can_delete' => $canDelete]);
        }

        /** Pacientes con episodio de laboratorio, para el selector del formulario. */
        case 'lab_patients': {
            $q = trim((string)($_GET['q'] ?? ''));
            $fullName = sql_full_name('p');
            $params = [];
            $where = "p.is_deleted = 0 AND e.service = 'laboratorio'";
            if ($q !== '') {
                $where .= " AND ($fullName LIKE ? OR p.file_number LIKE ? OR e.service_folio LIKE ?)";
                $like = '%' . $q . '%';
                $params = [$like, $like, $like];
            }
            $st = db()->prepare(
                "SELECT e.id AS episode_id, e.service_folio, e.admission_date, e.reason, e.referring_doctor,
                        e.service_data, p.id AS patient_id, p.file_number, p.first_name, p.paternal_surname,
                        p.maternal_surname, p.birth_date, p.sex, p.phone, p.mobile, p.email, p.curp,
                        p.street, p.colonia, p.postal_code, p.city, p.state
                 FROM episodes e JOIN patients p ON p.id = e.patient_id
                 WHERE $where
                 ORDER BY e.admission_date DESC LIMIT 25"
            );
            $st->execute($params);
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['service_data'] = $r['service_data'] ? json_decode($r['service_data'], true) : [];
            }
            json_ok(['episodes' => $rows]);
        }

        /** Sube una ficha de identificación en PDF y devuelve los campos reconocidos. */
        case 'parse_ficha': {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió el archivo', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > 10 * 1024 * 1024) {
                json_error('El archivo supera 10 MB', 422);
            }
            if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'pdf') {
                json_error('Solo se aceptan archivos PDF', 422);
            }
            $tmp = $file['tmp_name'];
            if (!is_uploaded_file($tmp) || file_get_contents($tmp, false, null, 0, 4) !== '%PDF') {
                json_error('El archivo no es un PDF válido', 422);
            }
            $text = pdf_extract_text($tmp);
            $fields = parse_ficha_identificacion($text);
            @unlink($tmp);
            log_activity('apps', 'ficha_parse', 'Leyó ficha PDF: ' . ($fields['nombre'] ?? 'sin nombre'));
            json_ok(['fields' => $fields, 'found' => count($fields)]);
        }

        case 'save': {
            $b = request_body();
            $type = (string)($b['doc_type'] ?? '');
            if (!doc_template($type)) {
                json_error('Tipo de documento no válido', 422);
            }
            $patient = doc_filter_map(DOC_PATIENT_FIELDS, $b['patient_data'] ?? []);
            if (empty($patient['nombre'])) {
                json_error('El nombre del paciente es obligatorio', 422);
            }
            $clinical = doc_filter_map(DOC_CLINICAL_FIELDS, $b['clinical_data'] ?? [], 1000);
            $tpl = doc_template($type);
            $results  = ($tpl['kind'] ?? '') === 'lab'
                ? lab_filter_studies($b['results'] ?? [])
                : doc_filter_results($type, $b['results'] ?? []);
            $notes    = mb_substr(trim((string)($b['notes'] ?? '')), 0, 2000);
            $folio    = mb_substr(trim((string)($b['folio'] ?? '')), 0, 30);
            $patientId = !empty($b['patient_id']) ? (int)$b['patient_id'] : null;
            $id = (int)($b['id'] ?? 0);

            $values = [
                $folio ?: null,
                $patientId,
                $patient['nombre'],
                json_encode($patient, JSON_UNESCAPED_UNICODE),
                json_encode($clinical, JSON_UNESCAPED_UNICODE),
                json_encode($results, JSON_UNESCAPED_UNICODE),
                $notes ?: null,
            ];

            if ($id > 0) {
                $doc = find_document($id);
                if ($doc['status'] === 'revisado' && !$canReview) {
                    json_error('El estudio ya fue revisado; solo quien revisa puede modificarlo', 403);
                }
                $st = db()->prepare(
                    'UPDATE documents SET folio = ?, patient_id = ?, patient_name = ?, patient_data = ?,
                            clinical_data = ?, results = ?, notes = ?, updated_at = ? WHERE id = ?'
                );
                $st->execute([...$values, date('Y-m-d H:i:s'), $id]);
                log_activity('apps', 'document_update', "Editó estudio #$id · {$patient['nombre']}", 'document', $id);
            } else {
                $st = db()->prepare(
                    'INSERT INTO documents (doc_type, folio, patient_id, patient_name, patient_data,
                                            clinical_data, results, notes, status, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $st->execute([$type, ...$values, 'borrador', (int)$me['id']]);
                $id = (int)db()->lastInsertId();
                log_activity('apps', 'document_create', "Creó estudio #$id · {$patient['nombre']}", 'document', $id);
            }
            json_ok(['id' => $id]);
        }

        /** Marca el estudio como revisado y archiva una copia del PDF. */
        case 'review': {
            if (!$canReview) {
                json_error('No tienes permiso para revisar estudios', 403);
            }
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $doc = find_document($id);

            require_once __DIR__ . '/../../includes/pdf_document.php';
            $pdfName = 'doc-' . $id . '-' . date('Ymd-His') . '.pdf';
            $path = __DIR__ . '/../../uploads/documentos/' . $pdfName;
            try {
                render_document_pdf($doc, $path);
            } catch (Throwable $e) {
                error_log('PDF: ' . $e->getMessage());
                json_error('No se pudo generar el PDF: ' . $e->getMessage(), 500);
            }

            db()->prepare('UPDATE documents SET status = ?, reviewed_by = ?, reviewed_at = ?, pdf_file = ? WHERE id = ?')
                ->execute(['revisado', (int)$me['id'], date('Y-m-d H:i:s'), $pdfName, $id]);
            log_activity('apps', 'document_review', "Revisó y liberó estudio #$id · {$doc['patient_name']}", 'document', $id);
            json_ok(['pdf' => $pdfName]);
        }

        case 'delete': {
            if (!$canDelete) {
                json_error('No tienes permiso para eliminar estudios', 403);
            }
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $doc = find_document($id);
            if (!empty($doc['pdf_file'])) {
                @unlink(__DIR__ . '/../../uploads/documentos/' . basename($doc['pdf_file']));
            }
            db()->prepare('DELETE FROM documents WHERE id = ?')->execute([$id]);
            log_activity('apps', 'document_delete', "Eliminó estudio #$id · {$doc['patient_name']}", 'document', $id);
            json_ok();
        }
    }
}

function find_document(int $id): array
{
    $st = db()->prepare('SELECT * FROM documents WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Estudio no encontrado', 404);
    }
    return $row;
}
