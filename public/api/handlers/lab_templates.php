<?php
/**
 * Handler lab_templates: plantillas de estudios de laboratorio
 * (Admin Tools > Plantillas de Estudios).
 *
 * Una plantilla agrupa y ordena determinaciones ya catalogadas en lab_tests.
 * Los valores de referencia viven solo en lab_reference_ranges: la plantilla
 * apunta a ellos, nunca los copia, para que un mismo analito no termine con
 * dos intervalos distintos según el reporte donde se capturó.
 */

require_once __DIR__ . '/../../includes/lab_catalog.php';
require_once __DIR__ . '/../../includes/rapha_reader.php';

function handle_lab_templates(string $action): void
{
    $me = current_user();
    if (!is_admin_role($me)) {
        json_error('Las plantillas de estudios requieren rol de administrador', 403);
    }

    switch ($action) {
        /* ---------- Plantillas ---------- */

        case 'studies_list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND s.name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            $st = db()->prepare(
                "SELECT s.*, (SELECT COUNT(*) FROM lab_study_items i WHERE i.study_id = s.id) AS item_count
                 FROM lab_studies s WHERE $where ORDER BY s.name LIMIT 300"
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['item_count'] = (int)$it['item_count'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);
            json_ok(['items' => $items, 'total' => count($items)]);
        }

        case 'studies_get': {
            $study = lab_study_get((int)($_GET['id'] ?? 0));
            if (!$study) {
                json_error('Plantilla no encontrada', 404);
            }
            $study['id'] = (int)$study['id'];
            $study['is_active'] = (bool)$study['is_active'];
            json_ok(['study' => $study]);
        }

        case 'studies_save': {
            $b = request_body();
            try {
                $id = lab_study_save($b, $b['test_ids'] ?? [], (int)$me['id']);
            } catch (InvalidArgumentException $e) {
                json_error($e->getMessage(), 422);
            }
            log_activity('plantillas_estudios', 'study_save', 'Guardó la plantilla "' . trim((string)$b['name']) . '"', 'lab_study', $id);
            json_ok(['id' => $id]);
        }

        case 'studies_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT name FROM lab_studies WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Plantilla no encontrada', 404);
            }
            db()->prepare('DELETE FROM lab_studies WHERE id = ?')->execute([$id]);
            log_activity('plantillas_estudios', 'study_delete', 'Eliminó la plantilla "' . $row['name'] . '"');
            json_ok(['deleted' => true]);
        }

        /* ---------- Determinaciones del catálogo ---------- */

        case 'tests_search': {
            $q = trim((string)($_GET['q'] ?? ''));
            $sql = 'SELECT * FROM lab_tests';
            $params = [];
            if ($q !== '') {
                $sql .= ' WHERE name LIKE ? OR aliases LIKE ?';
                $params = ['%' . $q . '%', '%' . $q . '%'];
            }
            $sql .= ' ORDER BY name LIMIT 100';
            $st = db()->prepare($sql);
            $st->execute($params);
            $tests = $st->fetchAll();
            foreach ($tests as &$t) {
                $t['id'] = (int)$t['id'];
                $t['ranges'] = lab_ranges_of((int)$t['id']);
            }
            unset($t);
            json_ok(['tests' => $tests]);
        }

        /** Alta o edición de una determinación con sus rangos (aquí se corrigen los mal capturados). */
        case 'test_save': {
            $b = request_body();
            try {
                $id = lab_save_test($b, $b['ranges'] ?? [], (int)$me['id']);
            } catch (InvalidArgumentException $e) {
                json_error($e->getMessage(), 422);
            }
            $st = db()->prepare('SELECT * FROM lab_tests WHERE id = ?');
            $st->execute([$id]);
            $test = $st->fetch();
            $test['id'] = (int)$test['id'];
            $test['ranges'] = lab_ranges_of($id);
            log_activity('plantillas_estudios', 'test_save', 'Guardó la determinación "' . $test['name'] . '"', 'lab_test', $id);
            json_ok(['test' => $test]);
        }

        case 'test_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT name FROM lab_tests WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Determinación no encontrada', 404);
            }
            // Borrarla la quita también de las plantillas que la usaban (FK en cascada):
            // se avisa cuántas para que no sea una sorpresa
            $st = db()->prepare('SELECT COUNT(*) c FROM lab_study_items WHERE test_id = ?');
            $st->execute([$id]);
            $used = (int)$st->fetch()['c'];
            db()->prepare('DELETE FROM lab_tests WHERE id = ?')->execute([$id]);
            log_activity('plantillas_estudios', 'test_delete', 'Eliminó la determinación "' . $row['name'] . '"');
            json_ok(['deleted' => true, 'removed_from_studies' => $used]);
        }

        /**
         * Propone determinaciones y rangos a partir de un PDF del laboratorio de
         * referencia. Es solo un acelerador de captura: nada se guarda hasta que el
         * usuario revisa y confirma, que es justo lo que evita que la interpretación
         * automática del PDF entre al catálogo sin supervisión.
         */
        case 'propose_from_pdf': {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió el archivo', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > 12 * 1024 * 1024) {
                json_error('El archivo supera 12 MB', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])
                || file_get_contents($file['tmp_name'], false, null, 0, 4) !== '%PDF') {
                json_error('El archivo no es un PDF válido', 422);
            }

            $read = rapha_read($file['tmp_name']);
            @unlink($file['tmp_name']);
            if (!$read['studies']) {
                json_error('No se reconoció ningún estudio en el PDF.', 422);
            }

            $studies = [];
            foreach ($read['studies'] as $study) {
                $items = [];
                foreach ($study['items'] as $it) {
                    $known = lab_find_test($it['name'], $it['unit']);
                    $items[] = [
                        'name'          => $known ? (string)$known['name'] : $it['name'],
                        'unit'          => $it['unit'] !== '' ? $it['unit'] : (string)($known['unit'] ?? ''),
                        'technique'     => $it['technique'] !== '' ? $it['technique'] : (string)($known['technique'] ?? ''),
                        'test_id'       => $known ? (int)$known['id'] : null,
                        'ranges'        => $known ? $known['ranges'] : lab_parse_reference($it['reference']),
                        'raw_reference' => $it['reference'],
                    ];
                }
                $studies[] = ['name' => $study['name'], 'items' => $items];
            }
            json_ok(['studies' => $studies]);
        }
    }
}
