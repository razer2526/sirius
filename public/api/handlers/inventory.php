<?php
/**
 * Handler inventory: catálogo de artículos, lotes con PEPS (primeras entradas,
 * primeras salidas) y alertas de stock bajo / caducidad.
 *
 * Cualquier usuario con acceso al módulo registra entradas y salidas (trabajo
 * diario del laboratorio); el flag "manage" gobierna el catálogo (crear/editar/
 * desactivar artículos) y las correcciones de lotes (ajuste, eliminar).
 */

const INVENTORY_EXPIRING_DAYS = 30;

function handle_inventory(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('inventario', 'manage');

    switch ($action) {
        case 'list': {
            $pdo = db();
            $st = $pdo->query(
                "SELECT i.*,
                        COALESCE(SUM(l.quantity_remaining), 0) AS stock,
                        MIN(CASE WHEN l.quantity_remaining > 0 THEN l.expiry_date END) AS next_expiry
                 FROM inventory_items i
                 LEFT JOIN inventory_lots l ON l.item_id = i.id
                 GROUP BY i.id
                 ORDER BY i.is_active DESC, i.name"
            );
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['stock'] = (float)$it['stock'];
                $it['min_stock'] = (float)$it['min_stock'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);

            $categories = $pdo->query(
                "SELECT DISTINCT category FROM inventory_items
                 WHERE category IS NOT NULL AND category <> '' ORDER BY category"
            )->fetchAll(PDO::FETCH_COLUMN);

            json_ok([
                'can_manage' => $canManage,
                'items'      => $items,
                'categories' => $categories,
                'alerts'     => inventory_alerts(),
            ]);
        }

        case 'item_get': {
            $id = (int)($_GET['id'] ?? 0);
            $item = find_inventory_item($id);
            $item['is_active'] = (bool)$item['is_active'];
            $item['min_stock'] = (float)$item['min_stock'];

            // Orden PEPS: el lote recibido primero es el primero en salir
            $st = db()->prepare('SELECT * FROM inventory_lots WHERE item_id = ? ORDER BY received_date ASC, id ASC');
            $st->execute([$id]);
            $lots = $st->fetchAll();
            foreach ($lots as &$l) {
                $l['id'] = (int)$l['id'];
                $l['quantity_received'] = (float)$l['quantity_received'];
                $l['quantity_remaining'] = (float)$l['quantity_remaining'];
            }
            unset($l);

            $st = db()->prepare(
                'SELECT m.*, u.full_name AS user_name, l.lot_code
                 FROM inventory_movements m
                 LEFT JOIN users u ON u.id = m.created_by
                 LEFT JOIN inventory_lots l ON l.id = m.lot_id
                 WHERE m.item_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 40'
            );
            $st->execute([$id]);
            $movements = $st->fetchAll();

            json_ok(['can_manage' => $canManage, 'item' => $item, 'lots' => $lots, 'movements' => $movements]);
        }

        case 'barcode_lookup': {
            $code = trim((string)($_GET['code'] ?? ''));
            if ($code === '') {
                json_error('Código vacío', 422);
            }
            $st = db()->prepare(
                "SELECT i.*, COALESCE(SUM(l.quantity_remaining), 0) AS stock
                 FROM inventory_items i LEFT JOIN inventory_lots l ON l.item_id = i.id
                 WHERE i.barcode = ? GROUP BY i.id"
            );
            $st->execute([$code]);
            $item = $st->fetch();
            if (!$item) {
                json_ok(['item' => null]);
            }
            $item['id'] = (int)$item['id'];
            $item['stock'] = (float)$item['stock'];
            $item['is_active'] = (bool)$item['is_active'];
            json_ok(['item' => $item]);
        }

        /* ---- Catálogo ---- */
        case 'item_save': {
            require_inventory_manager($canManage);
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre es obligatorio', 422);
            }
            $barcode = trim((string)($b['barcode'] ?? '')) ?: null;
            $category = trim((string)($b['category'] ?? '')) ?: null;
            $unit = trim((string)($b['unit'] ?? '')) ?: 'pieza';
            $minStock = max(0, (float)($b['min_stock'] ?? 0));
            $notes = trim((string)($b['notes'] ?? '')) ?: null;
            $id = (int)($b['id'] ?? 0);
            // Solo aplica al crear: siembra el primer lote junto con el artículo, en un solo paso.
            $initialQty = $id === 0 ? max(0, (float)($b['initial_qty'] ?? 0)) : 0;
            $initialExpiry = valid_inventory_date($b['expiry_date'] ?? '');

            $pdo = db();
            $pdo->beginTransaction();
            try {
                if ($id > 0) {
                    find_inventory_item($id);
                    $pdo->prepare(
                        'UPDATE inventory_items SET name = ?, barcode = ?, category = ?, unit = ?, min_stock = ?, notes = ? WHERE id = ?'
                    )->execute([$name, $barcode, $category, $unit, $minStock, $notes, $id]);
                    log_activity('inventario', 'item_update', "Editó artículo \"$name\"", 'inventory_item', $id);
                } else {
                    $pdo->prepare(
                        'INSERT INTO inventory_items (name, barcode, category, unit, min_stock, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
                    )->execute([$name, $barcode, $category, $unit, $minStock, $notes, (int)$me['id']]);
                    $id = (int)$pdo->lastInsertId();
                    log_activity('inventario', 'item_create', "Creó artículo \"$name\"", 'inventory_item', $id);

                    if ($initialQty > 0) {
                        $today = date('Y-m-d');
                        $pdo->prepare(
                            'INSERT INTO inventory_lots (item_id, quantity_received, quantity_remaining, expiry_date, received_date, notes, created_by)
                             VALUES (?, ?, ?, ?, ?, ?, ?)'
                        )->execute([$id, $initialQty, $initialQty, $initialExpiry, $today, 'Stock inicial al dar de alta el artículo', (int)$me['id']]);
                        $lotId = (int)$pdo->lastInsertId();
                        $pdo->prepare(
                            'INSERT INTO inventory_movements (item_id, lot_id, type, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                        )->execute([$id, $lotId, 'entrada', $initialQty, 'Stock inicial', (int)$me['id']]);
                    }
                }
                $pdo->commit();
            } catch (PDOException $e) {
                $pdo->rollBack();
                if (str_contains($e->getMessage(), 'barcode') || str_contains($e->getMessage(), 'uq_item_barcode')) {
                    json_error('Ese código de barras ya está asignado a otro artículo', 422);
                }
                throw $e;
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            json_ok(['id' => $id]);
        }

        case 'item_toggle_active': {
            require_inventory_manager($canManage);
            $b = request_body();
            $item = find_inventory_item((int)($b['id'] ?? 0));
            $newState = empty($item['is_active']) ? 1 : 0;
            db()->prepare('UPDATE inventory_items SET is_active = ? WHERE id = ?')->execute([$newState, $item['id']]);
            log_activity(
                'inventario',
                $newState ? 'item_activate' : 'item_deactivate',
                ($newState ? 'Reactivó' : 'Desactivó') . " \"{$item['name']}\"",
                'inventory_item',
                (int)$item['id']
            );
            json_ok(['is_active' => (bool)$newState]);
        }

        /* ---- Lotes: entrada, salida (PEPS), ajuste, eliminar ---- */
        case 'lot_add': {
            $b = request_body();
            $item = find_inventory_item((int)($b['item_id'] ?? 0));
            $quantity = (float)($b['quantity'] ?? 0);
            if ($quantity <= 0) {
                json_error('La cantidad debe ser mayor a cero', 422);
            }
            $received = valid_inventory_date($b['received_date'] ?? '') ?? date('Y-m-d');
            $expiry = valid_inventory_date($b['expiry_date'] ?? '');
            $lotCode = trim((string)($b['lot_code'] ?? '')) ?: null;
            $unitCost = isset($b['unit_cost']) && $b['unit_cost'] !== '' ? (float)$b['unit_cost'] : null;
            $supplier = trim((string)($b['supplier'] ?? '')) ?: null;
            $notes = trim((string)($b['notes'] ?? '')) ?: null;

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $pdo->prepare(
                    'INSERT INTO inventory_lots (item_id, lot_code, quantity_received, quantity_remaining, expiry_date, received_date, unit_cost, supplier, notes, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$item['id'], $lotCode, $quantity, $quantity, $expiry, $received, $unitCost, $supplier, $notes, (int)$me['id']]);
                $lotId = (int)$pdo->lastInsertId();
                $pdo->prepare(
                    'INSERT INTO inventory_movements (item_id, lot_id, type, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$item['id'], $lotId, 'entrada', $quantity, 'Entrada de mercancía', (int)$me['id']]);
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            log_activity('inventario', 'lot_add', "Entrada de $quantity {$item['unit']} de \"{$item['name']}\"", 'inventory_lot', $lotId);
            json_ok(['lot_id' => $lotId]);
        }

        case 'lot_consume': {
            $b = request_body();
            $item = find_inventory_item((int)($b['item_id'] ?? 0));
            $quantity = (float)($b['quantity'] ?? 0);
            if ($quantity <= 0) {
                json_error('La cantidad debe ser mayor a cero', 422);
            }
            $reason = trim((string)($b['reason'] ?? '')) ?: 'Salida';
            $consumed = inventory_consume($item, $quantity, $reason, $me);
            log_activity('inventario', 'lot_consume', "Salida de $quantity {$item['unit']} de \"{$item['name']}\" ($reason)", 'inventory_item', (int)$item['id']);
            json_ok(['consumed' => $consumed]);
        }

        /* ---- Escaneo continuo: un beep = un movimiento, sin confirmación ---- */
        case 'scan_consume': {
            $b = request_body();
            $item = resolve_scan_item($b);
            $quantity = max(0.01, (float)($b['quantity'] ?? 1));
            $reason = trim((string)($b['reason'] ?? '')) ?: 'Uso clínico';
            $consumed = inventory_consume($item, $quantity, $reason, $me);
            log_activity(
                'inventario', 'lot_consume',
                "Salida de $quantity {$item['unit']} de \"{$item['name']}\" ($reason) [escaneo]", 'inventory_item', (int)$item['id']
            );
            json_ok(['item' => inventory_item_brief($item), 'consumed' => $consumed]);
        }

        case 'scan_restock': {
            $b = request_body();
            $item = resolve_scan_item($b);
            $quantity = max(0.01, (float)($b['quantity'] ?? 1));
            $expiry = valid_inventory_date($b['expiry_date'] ?? '');
            $lotId = inventory_restock_scan($item, $quantity, $expiry, $me);
            log_activity(
                'inventario', 'lot_add',
                "Entrada de $quantity {$item['unit']} de \"{$item['name']}\" [escaneo]", 'inventory_lot', $lotId
            );
            json_ok(['item' => inventory_item_brief($item), 'lot_id' => $lotId]);
        }

        case 'lot_adjust': {
            require_inventory_manager($canManage);
            $b = request_body();
            $lot = find_inventory_lot((int)($b['lot_id'] ?? 0));
            $newQty = (float)($b['quantity_remaining'] ?? -1);
            if ($newQty < 0) {
                json_error('La cantidad no puede ser negativa', 422);
            }
            $reason = trim((string)($b['reason'] ?? '')) ?: 'Ajuste de inventario';
            $delta = round($newQty - (float)$lot['quantity_remaining'], 2);
            if (abs($delta) < 0.0001) {
                json_ok(['delta' => 0]);
            }

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE inventory_lots SET quantity_remaining = ? WHERE id = ?')->execute([$newQty, $lot['id']]);
                $pdo->prepare(
                    'INSERT INTO inventory_movements (item_id, lot_id, type, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$lot['item_id'], $lot['id'], 'ajuste', $delta, $reason, (int)$me['id']]);
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            log_activity('inventario', 'lot_adjust', "Ajustó lote #{$lot['id']} ($reason)", 'inventory_lot', (int)$lot['id']);
            json_ok(['delta' => $delta]);
        }

        case 'lot_delete': {
            require_inventory_manager($canManage);
            $b = request_body();
            $lot = find_inventory_lot((int)($b['id'] ?? 0));
            if ((float)$lot['quantity_received'] !== (float)$lot['quantity_remaining']) {
                json_error('Este lote ya tiene salidas registradas; ajústalo en vez de eliminarlo', 422);
            }
            $pdo = db();
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM inventory_movements WHERE lot_id = ?')->execute([$lot['id']]);
                $pdo->prepare('DELETE FROM inventory_lots WHERE id = ?')->execute([$lot['id']]);
                $pdo->commit();
            } catch (Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            log_activity('inventario', 'lot_delete', "Eliminó lote #{$lot['id']} (captura errónea)", 'inventory_lot', (int)$lot['id']);
            json_ok();
        }
    }
}

/** Resumen de alertas, reutilizable desde el Dashboard. */
function inventory_alerts(): array
{
    $pdo = db();
    $today = date('Y-m-d');
    $limit = date('Y-m-d', strtotime("+" . INVENTORY_EXPIRING_DAYS . ' days'));

    $lowStock = $pdo->query(
        "SELECT i.id, i.name, i.unit, i.min_stock, COALESCE(SUM(l.quantity_remaining), 0) AS stock
         FROM inventory_items i LEFT JOIN inventory_lots l ON l.item_id = i.id
         WHERE i.is_active = 1 AND i.min_stock > 0
         GROUP BY i.id
         HAVING stock < i.min_stock
         ORDER BY i.name"
    )->fetchAll();

    $st = $pdo->prepare(
        "SELECT l.id AS lot_id, l.lot_code, l.expiry_date, l.quantity_remaining, i.id AS item_id, i.name, i.unit
         FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
         WHERE i.is_active = 1 AND l.quantity_remaining > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date < ?
         ORDER BY l.expiry_date"
    );
    $st->execute([$today]);
    $expired = $st->fetchAll();

    $st = $pdo->prepare(
        "SELECT l.id AS lot_id, l.lot_code, l.expiry_date, l.quantity_remaining, i.id AS item_id, i.name, i.unit
         FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
         WHERE i.is_active = 1 AND l.quantity_remaining > 0 AND l.expiry_date BETWEEN ? AND ?
         ORDER BY l.expiry_date"
    );
    $st->execute([$today, $limit]);
    $expiring = $st->fetchAll();

    foreach ([&$lowStock, &$expired, &$expiring] as &$list) {
        foreach ($list as &$row) {
            foreach ($row as $k => $v) {
                if ($k === 'stock' || $k === 'quantity_remaining' || $k === 'min_stock') {
                    $row[$k] = (float)$v;
                } elseif ($k === 'id' || $k === 'item_id' || $k === 'lot_id') {
                    $row[$k] = (int)$v;
                }
            }
        }
    }
    unset($list, $row);

    return ['low_stock' => $lowStock, 'expiring' => $expiring, 'expired' => $expired];
}

function find_inventory_item(int $id): array
{
    $st = db()->prepare('SELECT * FROM inventory_items WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Artículo no encontrado', 404);
    }
    return $row;
}

/** Usado por el escaneo continuo: el código debe existir y estar activo. */
function find_inventory_item_by_barcode(string $code): array
{
    if ($code === '') {
        json_error('Código vacío', 422);
    }
    $st = db()->prepare('SELECT * FROM inventory_items WHERE barcode = ? AND is_active = 1');
    $st->execute([$code]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Ningún artículo activo tiene el código "' . $code . '"', 404);
    }
    return $row;
}

/**
 * Resuelve el artículo de un escaneo/búsqueda manual: por item_id (selección manual
 * de un artículo sin código de barras) o, si no viene, por código escaneado/tecleado.
 */
function resolve_scan_item(array $b): array
{
    $itemId = (int)($b['item_id'] ?? 0);
    if ($itemId > 0) {
        $item = find_inventory_item($itemId);
        if (empty($item['is_active'])) {
            json_error('Este artículo está inactivo', 422);
        }
        return $item;
    }
    return find_inventory_item_by_barcode(trim((string)($b['code'] ?? '')));
}

function inventory_item_brief(array $item): array
{
    return ['id' => (int)$item['id'], 'name' => $item['name'], 'unit' => $item['unit']];
}

/** Consume $quantity unidades PEPS (primero lo más antiguo). Devuelve el detalle de lotes tocados. */
function inventory_consume(array $item, float $quantity, string $reason, array $me): array
{
    $pdo = db();
    $st = $pdo->prepare(
        'SELECT * FROM inventory_lots WHERE item_id = ? AND quantity_remaining > 0 ORDER BY received_date ASC, id ASC'
    );
    $st->execute([$item['id']]);
    $lots = $st->fetchAll();
    $available = array_sum(array_map(fn($l) => (float)$l['quantity_remaining'], $lots));
    if ($quantity > $available + 0.0001) {
        json_error("Solo hay $available {$item['unit']} disponibles en existencia de \"{$item['name']}\"", 422);
    }

    $pdo->beginTransaction();
    try {
        $left = $quantity;
        $consumed = [];
        foreach ($lots as $lot) {
            if ($left <= 0.0001) {
                break;
            }
            $take = min((float)$lot['quantity_remaining'], $left);
            $newRemaining = round((float)$lot['quantity_remaining'] - $take, 2);
            $pdo->prepare('UPDATE inventory_lots SET quantity_remaining = ? WHERE id = ?')
                ->execute([$newRemaining, $lot['id']]);
            $pdo->prepare(
                'INSERT INTO inventory_movements (item_id, lot_id, type, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
            )->execute([$item['id'], $lot['id'], 'salida', $take, $reason, (int)$me['id']]);
            $consumed[] = ['lot_code' => $lot['lot_code'], 'quantity' => $take];
            $left = round($left - $take, 2);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $consumed;
}

/**
 * Entrada rápida por escaneo: acumula en el lote de HOY con la misma caducidad
 * (o ambas nulas) si ya existe uno, en vez de fragmentar en un lote por cada lectura.
 */
function inventory_restock_scan(array $item, float $quantity, ?string $expiry, array $me): int
{
    $pdo = db();
    $today = date('Y-m-d');
    if ($expiry === null) {
        $st = $pdo->prepare(
            'SELECT * FROM inventory_lots WHERE item_id = ? AND received_date = ? AND expiry_date IS NULL ORDER BY id DESC LIMIT 1'
        );
        $st->execute([$item['id'], $today]);
    } else {
        $st = $pdo->prepare(
            'SELECT * FROM inventory_lots WHERE item_id = ? AND received_date = ? AND expiry_date = ? ORDER BY id DESC LIMIT 1'
        );
        $st->execute([$item['id'], $today, $expiry]);
    }
    $lot = $st->fetch();

    $pdo->beginTransaction();
    try {
        if ($lot) {
            $newReceived = round((float)$lot['quantity_received'] + $quantity, 2);
            $newRemaining = round((float)$lot['quantity_remaining'] + $quantity, 2);
            $pdo->prepare('UPDATE inventory_lots SET quantity_received = ?, quantity_remaining = ? WHERE id = ?')
                ->execute([$newReceived, $newRemaining, $lot['id']]);
            $lotId = (int)$lot['id'];
        } else {
            $pdo->prepare(
                'INSERT INTO inventory_lots (item_id, quantity_received, quantity_remaining, expiry_date, received_date, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([$item['id'], $quantity, $quantity, $expiry, $today, 'Reabastecido por escaneo', (int)$me['id']]);
            $lotId = (int)$pdo->lastInsertId();
        }
        $pdo->prepare(
            'INSERT INTO inventory_movements (item_id, lot_id, type, quantity, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$item['id'], $lotId, 'entrada', $quantity, 'Entrada por escaneo', (int)$me['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $lotId;
}

function find_inventory_lot(int $id): array
{
    $st = db()->prepare('SELECT * FROM inventory_lots WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Lote no encontrado', 404);
    }
    return $row;
}

function require_inventory_manager(bool $canManage): void
{
    if (!$canManage) {
        json_error('Necesitas permiso de gestión de inventario', 403);
    }
}

function valid_inventory_date($v): ?string
{
    $v = trim((string)$v);
    if ($v === '') {
        return null;
    }
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}
