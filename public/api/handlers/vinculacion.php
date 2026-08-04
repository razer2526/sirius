<?php
/**
 * Handler vinculacion: catálogo de médicos con convenio y concierge/representantes
 * (Admin Tools > Vinculación), más las tasas globales de comisión (Biología
 * Molecular / Análisis Clínicos). El picker de médicos en Admisión y el cálculo
 * de comisiones en Apps > Comisiones leen de estas mismas tablas.
 */

function handle_vinculacion(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'doctors_list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $onlyActive = !empty($_GET['only_active']);

            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND d.name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            if ($onlyActive) {
                $where .= ' AND d.is_active = 1';
            }

            $st = db()->prepare(
                "SELECT d.*, c.name AS concierge_name FROM vinculacion_doctors d
                 LEFT JOIN vinculacion_concierge c ON c.id = d.concierge_id
                 WHERE $where ORDER BY d.name"
            );
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['concierge_id'] = $it['concierge_id'] !== null ? (int)$it['concierge_id'] : null;
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);
            json_ok(['items' => $items]);
        }

        case 'doctors_save': {
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre del médico es obligatorio', 422);
            }
            $phone = trim((string)($b['phone'] ?? '')) ?: null;
            $email = trim((string)($b['email'] ?? '')) ?: null;
            $conciergeId = !empty($b['concierge_id']) ? (int)$b['concierge_id'] : null;
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);

            if ($conciergeId !== null) {
                find_vinculacion_concierge($conciergeId);
            }

            $pdo = db();
            if ($id > 0) {
                find_vinculacion_doctor($id);
                $pdo->prepare(
                    'UPDATE vinculacion_doctors SET name = ?, phone = ?, email = ?, concierge_id = ?, is_active = ? WHERE id = ?'
                )->execute([$name, $phone, $email, $conciergeId, $isActive, $id]);
                log_activity('vinculacion', 'doctor_update', "Editó médico \"$name\"", 'vinculacion_doctor', $id);
            } else {
                $pdo->prepare(
                    'INSERT INTO vinculacion_doctors (name, phone, email, concierge_id, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$name, $phone, $email, $conciergeId, $isActive, (int)$me['id']]);
                $id = (int)$pdo->lastInsertId();
                log_activity('vinculacion', 'doctor_create', "Creó médico \"$name\"", 'vinculacion_doctor', $id);
            }
            json_ok(['id' => $id]);
        }

        case 'doctors_delete': {
            $b = request_body();
            $doctor = find_vinculacion_doctor((int)($b['id'] ?? 0));
            db()->prepare('DELETE FROM vinculacion_doctors WHERE id = ?')->execute([$doctor['id']]);
            log_activity('vinculacion', 'doctor_delete', "Eliminó médico \"{$doctor['name']}\"", 'vinculacion_doctor', (int)$doctor['id']);
            json_ok();
        }

        case 'concierge_list': {
            $q = trim((string)($_GET['q'] ?? ''));
            $onlyActive = !empty($_GET['only_active']);

            $where = '1=1';
            $params = [];
            if ($q !== '') {
                $where .= ' AND name LIKE ?';
                $params[] = '%' . $q . '%';
            }
            if ($onlyActive) {
                $where .= ' AND is_active = 1';
            }

            $st = db()->prepare("SELECT * FROM vinculacion_concierge WHERE $where ORDER BY name");
            $st->execute($params);
            $items = $st->fetchAll();
            foreach ($items as &$it) {
                $it['id'] = (int)$it['id'];
                $it['commission_pct'] = (float)$it['commission_pct'];
                $it['is_active'] = (bool)$it['is_active'];
            }
            unset($it);
            json_ok(['items' => $items]);
        }

        case 'concierge_save': {
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre del concierge es obligatorio', 422);
            }
            $phone = trim((string)($b['phone'] ?? '')) ?: null;
            $email = trim((string)($b['email'] ?? '')) ?: null;
            $pct = max(0, min(100, (float)($b['commission_pct'] ?? 10)));
            $isActive = !empty($b['is_active']) ? 1 : 0;
            $id = (int)($b['id'] ?? 0);

            $pdo = db();
            if ($id > 0) {
                find_vinculacion_concierge($id);
                $pdo->prepare(
                    'UPDATE vinculacion_concierge SET name = ?, phone = ?, email = ?, commission_pct = ?, is_active = ? WHERE id = ?'
                )->execute([$name, $phone, $email, $pct, $isActive, $id]);
                log_activity('vinculacion', 'concierge_update', "Editó concierge \"$name\"", 'vinculacion_concierge', $id);
            } else {
                $pdo->prepare(
                    'INSERT INTO vinculacion_concierge (name, phone, email, commission_pct, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$name, $phone, $email, $pct, $isActive, (int)$me['id']]);
                $id = (int)$pdo->lastInsertId();
                log_activity('vinculacion', 'concierge_create', "Creó concierge \"$name\"", 'vinculacion_concierge', $id);
            }
            json_ok(['id' => $id]);
        }

        case 'concierge_delete': {
            $b = request_body();
            $concierge = find_vinculacion_concierge((int)($b['id'] ?? 0));
            db()->prepare('DELETE FROM vinculacion_concierge WHERE id = ?')->execute([$concierge['id']]);
            log_activity('vinculacion', 'concierge_delete', "Eliminó concierge \"{$concierge['name']}\"", 'vinculacion_concierge', (int)$concierge['id']);
            json_ok();
        }

        case 'settings_get': {
            json_ok(['rates' => vinculacion_commission_rates()]);
        }

        case 'settings_save': {
            $b = request_body();
            $molecular = max(0, min(100, (float)($b['commission_rate_molecular'] ?? 15)));
            $clinico = max(0, min(100, (float)($b['commission_rate_clinico'] ?? 10)));

            $pdo = db();
            $upd = $pdo->prepare('UPDATE settings SET svalue = ? WHERE skey = ?');
            $upd->execute([(string)$molecular, 'commission_rate_molecular']);
            $upd->execute([(string)$clinico, 'commission_rate_clinico']);
            log_activity('vinculacion', 'rates_update', "Actualizó tasas de comisión (Molecular {$molecular}%, Clínicos {$clinico}%)");
            json_ok(['rates' => ['molecular' => $molecular, 'clinico' => $clinico]]);
        }
    }
}

function find_vinculacion_doctor(int $id): array
{
    $st = db()->prepare('SELECT * FROM vinculacion_doctors WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Médico no encontrado', 404);
    }
    return $row;
}

function find_vinculacion_concierge(int $id): array
{
    $st = db()->prepare('SELECT * FROM vinculacion_concierge WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Concierge no encontrado', 404);
    }
    return $row;
}

/** Tasas globales de comisión del médico por grupo, con default si settings aún no las trae. */
function vinculacion_commission_rates(): array
{
    $st = db()->prepare("SELECT skey, svalue FROM settings WHERE skey IN ('commission_rate_molecular','commission_rate_clinico')");
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    return [
        'molecular' => isset($rows['commission_rate_molecular']) ? (float)$rows['commission_rate_molecular'] : 15.0,
        'clinico'   => isset($rows['commission_rate_clinico']) ? (float)$rows['commission_rate_clinico'] : 10.0,
    ];
}
