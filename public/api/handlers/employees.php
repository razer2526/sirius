<?php
/**
 * Handler employees (Admin Tools > Empleados): ficha de cada usuario de Sirius — datos personales,
 * correo institucional, fecha de inicio, jornada, días de vacaciones y registro de vacaciones
 * tomadas — y qué datos de esa ficha ve el propio empleado en Perfil.
 *
 * "Admin Tools" solo agrupa el módulo en el menú: un usuario estándar con el permiso lo vería.
 * Esta ficha trae datos personales de todo el personal, así que se exige rol de administrador
 * en el handler (mismo criterio que papelera.php y backups.php).
 */

require_once __DIR__ . '/../../includes/employees.php';

function handle_employees(string $action): void
{
    $me = current_user();
    if (!is_admin_role($me)) {
        json_error('Esta acción requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'users_list': {
            $rows = db()->query(
                'SELECT u.id, u.username, u.full_name, u.role, u.is_active,
                        CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS has_profile
                 FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
                 ORDER BY u.is_active DESC, u.full_name'
            )->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['is_active'] = (bool)$r['is_active'];
                $r['has_profile'] = (bool)$r['has_profile'];
            }
            unset($r);
            json_ok(['users' => $rows]);
        }

        case 'get': {
            $user = employee_find_user((int)($_GET['user_id'] ?? 0));
            json_ok(employee_view($user, false));
        }

        case 'save': {
            $b = request_body();
            $user = employee_find_user((int)($b['user_id'] ?? 0));
            $userId = (int)$user['id'];

            $fullName = trim((string)($b['full_name'] ?? ''));
            if ($fullName === '' || mb_strlen($fullName) > 120) {
                json_error('El nombre completo es obligatorio (máximo 120 caracteres)', 422);
            }
            $personalEmail = employee_optional_email($b['contact_email_personal'] ?? null, 'El correo personal');
            $institutionalEmail = employee_optional_email($b['institutional_email'] ?? null, 'El correo institucional');
            $phone = employee_optional_text($b['contact_phone'] ?? null, 30, 'El teléfono');
            $address = employee_optional_text($b['contact_address'] ?? null, 255, 'El domicilio');
            $emergencyName = employee_optional_text($b['emergency_name'] ?? null, 120, 'El contacto de emergencia');
            $emergencyPhone = employee_optional_text($b['emergency_phone'] ?? null, 30, 'El teléfono de emergencia');

            $startRaw = trim((string)($b['start_date'] ?? ''));
            $startDate = null;
            if ($startRaw !== '') {
                if (!employee_parse_date($startRaw)) {
                    json_error('La fecha de inicio no es válida', 422);
                }
                $startDate = $startRaw;
            }

            $entitled = $b['vacation_days_entitled'] ?? 0;
            if ($entitled === '' || $entitled === null) {
                $entitled = 0;
            }
            if (!is_numeric($entitled) || $entitled < 0 || $entitled > 366) {
                json_error('Los días de vacaciones deben ser un número entre 0 y 366', 422);
            }
            $entitled = round((float)$entitled, 1);

            try {
                $schedule = employee_normalize_schedule($b['work_schedule'] ?? null);
            } catch (InvalidArgumentException $e) {
                json_error($e->getMessage(), 422);
            }
            $visible = employee_normalize_visible($b['visible_fields'] ?? []);

            $now = db_driver() === 'mysql' ? 'NOW()' : "datetime('now','localtime')";
            $params = [
                $phone, $personalEmail, $address, $emergencyName, $emergencyPhone, $institutionalEmail,
                $startDate, $entitled,
                json_encode($schedule, JSON_UNESCAPED_UNICODE), json_encode($visible),
                (int)$me['id'],
            ];
            if (employee_find_profile($userId)) {
                db()->prepare(
                    "UPDATE employee_profiles SET contact_phone = ?, contact_email_personal = ?, contact_address = ?,
                            emergency_name = ?, emergency_phone = ?, institutional_email = ?, start_date = ?,
                            vacation_days_entitled = ?, work_schedule = ?, visible_fields = ?, updated_by = ?,
                            updated_at = $now WHERE user_id = ?"
                )->execute(array_merge($params, [$userId]));
            } else {
                db()->prepare(
                    'INSERT INTO employee_profiles (contact_phone, contact_email_personal, contact_address,
                            emergency_name, emergency_phone, institutional_email, start_date,
                            vacation_days_entitled, work_schedule, visible_fields, updated_by, user_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute(array_merge($params, [$userId]));
            }
            if ($fullName !== $user['full_name']) {
                db()->prepare('UPDATE users SET full_name = ? WHERE id = ?')->execute([$fullName, $userId]);
                $user['full_name'] = $fullName;
            }
            log_activity('empleados', 'employee_save', "Actualizó la ficha de \"{$user['username']}\"", 'user', $userId);
            json_ok(employee_view($user, false));
        }

        case 'vacation_preview': {
            $user = employee_find_user((int)($_GET['user_id'] ?? 0));
            [$from, $to] = employee_vacation_range($_GET['date_from'] ?? null, $_GET['date_to'] ?? null);
            $profile = employee_find_profile((int)$user['id']);
            $schedule = employee_decode_schedule($profile['work_schedule'] ?? null);
            json_ok(employee_count_days($from, $to, $schedule));
        }

        case 'vacation_save': {
            $b = request_body();
            $user = employee_find_user((int)($b['user_id'] ?? 0));
            $userId = (int)$user['id'];
            $id = (int)($b['id'] ?? 0);
            [$from, $to] = employee_vacation_range($b['date_from'] ?? null, $b['date_to'] ?? null);

            if ($id > 0) {
                $st = db()->prepare('SELECT id FROM employee_vacations WHERE id = ? AND user_id = ?');
                $st->execute([$id, $userId]);
                if (!$st->fetch()) {
                    json_error('Registro de vacaciones no encontrado', 404);
                }
            }

            // Sin traslape: si no, los mismos días se descontarían dos veces.
            $st = db()->prepare(
                'SELECT date_from, date_to FROM employee_vacations
                 WHERE user_id = ? AND id <> ? AND date_from <= ? AND date_to >= ? LIMIT 1'
            );
            $st->execute([$userId, $id, $to->format('Y-m-d'), $from->format('Y-m-d')]);
            if ($clash = $st->fetch()) {
                json_error('Esas fechas se traslapan con vacaciones ya registradas ('
                    . (new DateTimeImmutable($clash['date_from']))->format('d/m/Y') . ' al '
                    . (new DateTimeImmutable($clash['date_to']))->format('d/m/Y') . ')', 422);
            }

            $days = $b['days'] ?? null;
            if ($days === null || $days === '') {
                $profile = employee_find_profile($userId);
                $days = employee_count_days($from, $to, employee_decode_schedule($profile['work_schedule'] ?? null))['days'];
                if ($days <= 0) {
                    json_error('Ese rango no incluye ningún día laborable de su jornada. Si aun así deben descontarse días, captúralos a mano.', 422);
                }
            }
            if (!is_numeric($days) || $days <= 0 || $days > EMPLOYEE_MAX_RANGE_DAYS) {
                json_error('Los días de vacaciones deben ser mayores a 0', 422);
            }
            $days = round((float)$days, 1);
            $notes = employee_optional_text($b['notes'] ?? null, 500, 'Las observaciones');

            if ($id > 0) {
                db()->prepare('UPDATE employee_vacations SET date_from = ?, date_to = ?, days = ?, notes = ? WHERE id = ?')
                    ->execute([$from->format('Y-m-d'), $to->format('Y-m-d'), $days, $notes, $id]);
                $verb = 'vacation_update';
                $text = 'Editó vacaciones de';
            } else {
                db()->prepare(
                    'INSERT INTO employee_vacations (user_id, date_from, date_to, days, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([$userId, $from->format('Y-m-d'), $to->format('Y-m-d'), $days, $notes, (int)$me['id']]);
                $id = (int)db()->lastInsertId();
                $verb = 'vacation_add';
                $text = 'Registró vacaciones de';
            }
            log_activity('empleados', $verb,
                "$text \"{$user['username']}\": " . $from->format('d/m/Y') . ' al ' . $to->format('d/m/Y') . " ($days día(s))",
                'user', $userId);
            json_ok(['id' => $id] + employee_view($user, false));
        }

        case 'vacation_delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT * FROM employee_vacations WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Registro de vacaciones no encontrado', 404);
            }
            $user = employee_find_user((int)$row['user_id']);
            db()->prepare('DELETE FROM employee_vacations WHERE id = ?')->execute([$id]);
            log_activity('empleados', 'vacation_delete',
                "Eliminó vacaciones de \"{$user['username']}\": "
                . (new DateTimeImmutable($row['date_from']))->format('d/m/Y') . ' al '
                . (new DateTimeImmutable($row['date_to']))->format('d/m/Y'),
                'user', (int)$user['id']);
            json_ok(employee_view($user, false));
        }
    }
}

function employee_find_user(int $id): array
{
    $st = db()->prepare('SELECT id, username, full_name, is_active FROM users WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Usuario no encontrado', 404);
    }
    return $row;
}

/** Texto opcional con tope de largo; vacío → null. */
function employee_optional_text($value, int $max, string $label): ?string
{
    $v = trim((string)($value ?? ''));
    if ($v === '') {
        return null;
    }
    if (mb_strlen($v) > $max) {
        json_error("$label no puede pasar de $max caracteres", 422);
    }
    return $v;
}

function employee_optional_email($value, string $label): ?string
{
    $v = employee_optional_text($value, 120, $label);
    if ($v !== null && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
        json_error("$label no tiene un formato válido", 422);
    }
    return $v;
}

/** Valida un rango de fechas de vacaciones → [desde, hasta] como fechas. */
function employee_vacation_range($fromRaw, $toRaw): array
{
    $from = employee_parse_date(is_string($fromRaw) ? trim($fromRaw) : null);
    $to = employee_parse_date(is_string($toRaw) ? trim($toRaw) : null);
    if (!$from || !$to) {
        json_error('Indica la fecha de inicio y la de fin de las vacaciones', 422);
    }
    if ($to < $from) {
        json_error('La fecha de fin no puede ser antes de la de inicio', 422);
    }
    if ((int)$from->diff($to)->days + 1 > EMPLOYEE_MAX_RANGE_DAYS) {
        json_error('El rango no puede pasar de ' . EMPLOYEE_MAX_RANGE_DAYS . ' días', 422);
    }
    return [$from, $to];
}
