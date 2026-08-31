<?php
/**
 * Handler medications: catálogo interno de medicamentos (Admin Tools > Bases de
 * datos > Medicamentos). Por ahora es solo una lista de nombres que se sube y se
 * vuelve a subir por CSV/JSON cuando la oficina la actualice — igual que ya
 * funciona el Catálogo de Estudios. Todavía no lo consume ningún formulario (el
 * campo de medicamentos del wizard sigue siendo texto libre); esta es la base de
 * datos para cuando se conecte.
 */

require_once __DIR__ . '/../../includes/import_parse.php';

function handle_medications(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = min(200, max(1, (int)($_GET['per_page'] ?? 50)));

            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND name LIKE ?';
                $params[] = '%' . $q . '%';
            }

            $pdo = db();
            $st = $pdo->prepare("SELECT COUNT(*) c FROM medications WHERE $where");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $st = $pdo->prepare(
                "SELECT * FROM medications WHERE $where ORDER BY name LIMIT $perPage OFFSET " . (($page - 1) * $perPage)
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);

            json_ok(['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
        }

        case 'save': {
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre del medicamento es obligatorio', 422);
            }
            $category = trim((string)($b['category'] ?? '')) ?: null;
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);

            $pdo = db();
            if ($id > 0) {
                find_medication($id);
                $pdo->prepare('UPDATE medications SET name = ?, category = ?, is_active = ? WHERE id = ?')
                    ->execute([$name, $category, $isActive, $id]);
                log_activity('bases_datos', 'medication_update', "Editó medicamento \"$name\"", 'medication', $id);
            } else {
                $pdo->prepare('INSERT INTO medications (name, category, is_active, created_by) VALUES (?, ?, ?, ?)')
                    ->execute([$name, $category, $isActive, (int)$me['id']]);
                $id = (int)$pdo->lastInsertId();
                log_activity('bases_datos', 'medication_create', "Creó medicamento \"$name\"", 'medication', $id);
            }
            json_ok(['id' => $id]);
        }

        case 'delete': {
            $b = request_body();
            $med = find_medication((int)($b['id'] ?? 0));
            db()->prepare('DELETE FROM medications WHERE id = ?')->execute([$med['id']]);
            log_activity('bases_datos', 'medication_delete', "Eliminó medicamento \"{$med['name']}\"", 'medication', (int)$med['id']);
            json_ok();
        }

        case 'delete_bulk': {
            $b = request_body();
            $ids = array_values(array_unique(array_filter(array_map('intval', (array)($b['ids'] ?? [])), fn($n) => $n > 0)));
            if (!$ids) {
                json_error('No se seleccionó ningún medicamento', 422);
            }
            $marks = implode(',', array_fill(0, count($ids), '?'));
            $st = db()->prepare("DELETE FROM medications WHERE id IN ($marks)");
            $st->execute($ids);
            $deleted = $st->rowCount();
            log_activity('bases_datos', 'medication_delete_bulk', "Eliminó $deleted medicamento(s)");
            json_ok(['deleted' => $deleted]);
        }

        case 'delete_all': {
            $b = request_body();
            if (trim((string)($b['confirm'] ?? '')) !== 'ELIMINAR') {
                json_error('Confirmación no válida', 422);
            }
            $pdo = db();
            $total = (int)$pdo->query('SELECT COUNT(*) c FROM medications')->fetch()['c'];
            $pdo->exec('DELETE FROM medications');
            log_activity('bases_datos', 'medication_delete_all', "Vació la lista de medicamentos ($total eliminado(s))");
            json_ok(['deleted' => $total]);
        }

        /** Sube el archivo (JSON o CSV) y devuelve las columnas detectadas + una muestra, sin tocar la BD. */
        case 'import_inspect': {
            [$columns, $rows] = import_parse_uploaded_file();
            json_ok([
                'columns' => $columns,
                'total'   => count($rows),
                'sample'  => array_slice($rows, 0, 5),
            ]);
        }

        /** Aplica la importación con el mapeo de columnas elegido. */
        case 'import_apply': {
            [, $rows] = import_parse_uploaded_file();
            $mapping = json_decode((string)($_POST['mapping'] ?? ''), true);
            if (!is_array($mapping) || empty($mapping['name'])) {
                json_error('Selecciona al menos la columna del nombre del medicamento', 422);
            }
            $mode = ($_POST['mode'] ?? '') === 'reemplazar' ? 'reemplazar' : 'agregar';
            if ($mode === 'reemplazar' && ($_POST['confirm'] ?? '') !== 'REEMPLAZAR') {
                json_error('Escribe REEMPLAZAR para confirmar que se sustituirá toda la lista actual', 422);
            }

            $colName = $mapping['name'];
            $colCategory = $mapping['category'] ?? null;

            $prepared = [];
            $seen = [];
            foreach ($rows as $row) {
                $name = trim((string)($row[$colName] ?? ''));
                if ($name === '' || isset($seen[mb_strtolower($name)])) {
                    continue;
                }
                $seen[mb_strtolower($name)] = true;
                $category = $colCategory ? trim((string)($row[$colCategory] ?? '')) : '';
                $prepared[] = ['name' => $name, 'category' => $category ?: null];
            }
            if (!$prepared) {
                json_error('No se encontró ninguna fila con nombre de medicamento', 422);
            }

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $inserted = 0;
                $updated = 0;
                if ($mode === 'reemplazar') {
                    $pdo->exec('DELETE FROM medications');
                    $ins = $pdo->prepare('INSERT INTO medications (name, category, is_active, created_by) VALUES (?, ?, 1, ?)');
                    foreach ($prepared as $r) {
                        $ins->execute([$r['name'], $r['category'], (int)$me['id']]);
                        $inserted++;
                    }
                } else {
                    $find = $pdo->prepare('SELECT id FROM medications WHERE LOWER(name) = LOWER(?)');
                    $ins = $pdo->prepare('INSERT INTO medications (name, category, is_active, created_by) VALUES (?, ?, 1, ?)');
                    $upd = $pdo->prepare('UPDATE medications SET category = ? WHERE id = ?');
                    foreach ($prepared as $r) {
                        $find->execute([$r['name']]);
                        $existing = $find->fetch();
                        if ($existing) {
                            $upd->execute([$r['category'], $existing['id']]);
                            $updated++;
                        } else {
                            $ins->execute([$r['name'], $r['category'], (int)$me['id']]);
                            $inserted++;
                        }
                    }
                }
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            log_activity(
                'bases_datos',
                $mode === 'reemplazar' ? 'medications_import_replace' : 'medications_import_merge',
                "Importó medicamentos ($mode): $inserted nuevo(s), $updated actualizado(s)"
            );
            json_ok(['inserted' => $inserted, 'updated' => $updated, 'total' => count($prepared)]);
        }
    }
}

function find_medication(int $id): array
{
    $st = db()->prepare('SELECT * FROM medications WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Medicamento no encontrado', 404);
    }
    return $row;
}
