<?php
/**
 * Handler catalog: catálogo de estudios para cotizar (Admin Tools > Catálogo de
 * Estudios). Aquí solo se administra el catálogo (list/save/delete/export/import);
 * la búsqueda de estudios para armar una cotización vive en el handler quotes,
 * bajo el módulo Apps, para que cualquier empleado pueda cotizar sin necesitar
 * el permiso de administración del catálogo.
 */

require_once __DIR__ . '/../../includes/import_parse.php';

function handle_catalog(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $category = trim((string)($_GET['category'] ?? ''));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $perPage = min(200, max(1, (int)($_GET['per_page'] ?? 50)));

            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            if ($category !== '') {
                $where .= ' AND category = ?';
                $params[] = $category;
            }

            $pdo = db();
            $st = $pdo->prepare("SELECT COUNT(*) c FROM quote_studies WHERE $where");
            $st->execute($params);
            $total = (int)$st->fetch()['c'];

            $st = $pdo->prepare(
                "SELECT * FROM quote_studies WHERE $where ORDER BY name LIMIT $perPage OFFSET " . (($page - 1) * $perPage)
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['public_price'] = (float)$it['public_price'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);

            $categories = $pdo->query(
                "SELECT DISTINCT category FROM quote_studies WHERE category IS NOT NULL AND category <> '' ORDER BY category"
            )->fetchAll(PDO::FETCH_COLUMN);

            json_ok([
                'items'      => $items,
                'total'      => $total,
                'page'       => $page,
                'per_page'   => $perPage,
                'categories' => $categories,
            ]);
        }

        case 'save': {
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre del estudio es obligatorio', 422);
            }
            $category = trim((string)($b['category'] ?? '')) ?: null;
            $commissionGroup = in_array($b['commission_group'] ?? '', ['molecular', 'clinico'], true) ? $b['commission_group'] : null;
            $price = max(0, (float)($b['public_price'] ?? 0));
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);

            $pdo = db();
            if ($id > 0) {
                find_quote_study($id);
                $pdo->prepare(
                    'UPDATE quote_studies SET name = ?, category = ?, commission_group = ?, public_price = ?, is_active = ? WHERE id = ?'
                )->execute([$name, $category, $commissionGroup, $price, $isActive, $id]);
                log_activity('catalogo_estudios', 'study_update', "Editó estudio \"$name\"", 'quote_study', $id);
            } else {
                $pdo->prepare(
                    'INSERT INTO quote_studies (name, category, commission_group, public_price, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$name, $category, $commissionGroup, $price, $isActive, (int)$me['id']]);
                $id = (int)$pdo->lastInsertId();
                log_activity('catalogo_estudios', 'study_create', "Creó estudio \"$name\"", 'quote_study', $id);
            }
            json_ok(['id' => $id]);
        }

        case 'delete': {
            $b = request_body();
            $study = find_quote_study((int)($b['id'] ?? 0));
            db()->prepare('DELETE FROM quote_studies WHERE id = ?')->execute([$study['id']]);
            log_activity('catalogo_estudios', 'study_delete', "Eliminó estudio \"{$study['name']}\"", 'quote_study', (int)$study['id']);
            json_ok();
        }

        /** Todo el catálogo, para exportar (el navegador arma el JSON/CSV). */
        case 'export_all': {
            $items = db()->query('SELECT id, name, category, commission_group, public_price, is_active FROM quote_studies ORDER BY name')->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['public_price'] = (float)$it['public_price'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);
            json_ok(['items' => $items]);
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

        /** Aplica la importación con el mapeo de columnas elegido por el admin. */
        case 'import_apply': {
            [, $rows] = import_parse_uploaded_file();
            $mapping = json_decode((string)($_POST['mapping'] ?? ''), true);
            if (!is_array($mapping) || empty($mapping['name'])) {
                json_error('Selecciona al menos la columna del nombre del estudio', 422);
            }
            $mode = ($_POST['mode'] ?? '') === 'reemplazar' ? 'reemplazar' : 'agregar';
            if ($mode === 'reemplazar' && ($_POST['confirm'] ?? '') !== 'REEMPLAZAR') {
                json_error('Escribe REEMPLAZAR para confirmar que se sustituirá todo el catálogo actual', 422);
            }

            $colName = $mapping['name'];
            $colCategory = $mapping['category'] ?? null;
            $colPrice = $mapping['public_price'] ?? null;

            $prepared = [];
            foreach ($rows as $row) {
                $name = trim((string)($row[$colName] ?? ''));
                if ($name === '') {
                    continue;
                }
                $category = $colCategory ? trim((string)($row[$colCategory] ?? '')) : '';
                $priceRaw = $colPrice ? (string)($row[$colPrice] ?? '') : '0';
                $price = (float)preg_replace('/[^0-9.\-]/', '', str_replace(',', '', $priceRaw));
                $prepared[] = ['name' => $name, 'category' => $category ?: null, 'public_price' => max(0, $price)];
            }
            if (!$prepared) {
                json_error('No se encontró ninguna fila con nombre de estudio', 422);
            }

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $inserted = 0;
                $updated = 0;
                if ($mode === 'reemplazar') {
                    $pdo->exec('DELETE FROM quote_studies');
                    $ins = $pdo->prepare(
                        'INSERT INTO quote_studies (name, category, public_price, is_active, created_by) VALUES (?, ?, ?, 1, ?)'
                    );
                    foreach ($prepared as $r) {
                        $ins->execute([$r['name'], $r['category'], $r['public_price'], (int)$me['id']]);
                        $inserted++;
                    }
                } else {
                    $find = $pdo->prepare('SELECT id FROM quote_studies WHERE LOWER(name) = LOWER(?)');
                    $ins = $pdo->prepare(
                        'INSERT INTO quote_studies (name, category, public_price, is_active, created_by) VALUES (?, ?, ?, 1, ?)'
                    );
                    $upd = $pdo->prepare('UPDATE quote_studies SET category = ?, public_price = ? WHERE id = ?');
                    foreach ($prepared as $r) {
                        $find->execute([$r['name']]);
                        $existing = $find->fetch();
                        if ($existing) {
                            $upd->execute([$r['category'], $r['public_price'], $existing['id']]);
                            $updated++;
                        } else {
                            $ins->execute([$r['name'], $r['category'], $r['public_price'], (int)$me['id']]);
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
                'catalogo_estudios',
                $mode === 'reemplazar' ? 'import_replace' : 'import_merge',
                "Importó catálogo ($mode): $inserted nuevo(s), $updated actualizado(s)"
            );
            json_ok(['inserted' => $inserted, 'updated' => $updated, 'total' => count($prepared)]);
        }
    }
}

function find_quote_study(int $id): array
{
    $st = db()->prepare('SELECT * FROM quote_studies WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Estudio no encontrado', 404);
    }
    return $row;
}

