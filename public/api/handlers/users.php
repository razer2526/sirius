<?php
/** Handler users: CRUD de usuarios + matriz de permisos. Requiere módulo 'usuarios'. */

function handle_users(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'list': {
            $users = db()->query(
                'SELECT id, username, full_name, role, is_active, assignable, created_at FROM users ORDER BY username'
            )->fetchAll();
            $st = db()->query('SELECT user_id, module_key, flags FROM user_permissions');
            $perms = [];
            foreach ($st->fetchAll() as $row) {
                $flags = $row['flags'] ? json_decode($row['flags'], true) : [];
                $perms[$row['user_id']][$row['module_key']] = is_array($flags) ? $flags : [];
            }
            foreach ($users as &$u) {
                $u['id'] = (int)$u['id'];
                $u['is_active'] = (int)$u['is_active'];
                $u['assignable'] = (int)$u['assignable'];
                $u['permissions'] = $perms[$u['id']] ?? new stdClass();
            }
            json_ok(['users' => $users]);
        }

        case 'create': {
            $b = request_body();
            $username = trim($b['username'] ?? '');
            $fullName = trim($b['full_name'] ?? '');
            $password = (string)($b['password'] ?? '');
            $role     = $b['role'] ?? 'estandar';
            if ($username === '' || $fullName === '') {
                json_error('Usuario y nombre completo son obligatorios', 422);
            }
            if (strlen($password) < 6) {
                json_error('La contraseña debe tener al menos 6 caracteres', 422);
            }
            if (!in_array($role, ['estandar', 'administrador', 'developper'], true)) {
                json_error('Rol no válido', 422);
            }
            $st = db()->prepare('SELECT id FROM users WHERE username = ?');
            $st->execute([$username]);
            if ($st->fetch()) {
                json_error('Ese nombre de usuario ya existe', 422);
            }
            $assignable = !empty($b['assignable']) ? 1 : 0;
            db()->prepare('INSERT INTO users (username, password_hash, full_name, role, assignable) VALUES (?, ?, ?, ?, ?)')
                ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $fullName, $role, $assignable]);
            $id = (int)db()->lastInsertId();
            save_user_permissions($id, $b['permissions'] ?? []);
            log_activity('usuarios', 'user_create', "Creó usuario \"$username\"", 'user', $id);
            json_ok(['id' => $id]);
        }

        case 'update': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $target = find_user($id);
            $fullName = trim($b['full_name'] ?? '');
            $role     = $b['role'] ?? $target['role'];
            $isActive = isset($b['is_active']) ? (int)!!$b['is_active'] : (int)$target['is_active'];
            if ($fullName === '') {
                json_error('El nombre completo es obligatorio', 422);
            }
            if (!in_array($role, ['estandar', 'administrador', 'developper'], true)) {
                json_error('Rol no válido', 422);
            }
            if ($id === (int)$me['id'] && ($role === 'estandar' || !$isActive)) {
                json_error('No puedes quitarte a ti mismo el rol de administrador ni desactivarte', 422);
            }
            $assignable = isset($b['assignable']) ? (int)!!$b['assignable'] : (int)$target['assignable'];
            db()->prepare('UPDATE users SET full_name = ?, role = ?, is_active = ?, assignable = ? WHERE id = ?')
                ->execute([$fullName, $role, $isActive, $assignable, $id]);
            if (!empty($b['password'])) {
                if (strlen($b['password']) < 6) {
                    json_error('La contraseña debe tener al menos 6 caracteres', 422);
                }
                db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                    ->execute([password_hash($b['password'], PASSWORD_DEFAULT), $id]);
            }
            if (isset($b['permissions'])) {
                save_user_permissions($id, $b['permissions']);
            }
            log_activity('usuarios', 'user_update', "Editó usuario \"{$target['username']}\"", 'user', $id);
            json_ok();
        }

        case 'delete': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $target = find_user($id);
            if ($id === (int)$me['id']) {
                json_error('No puedes eliminar tu propio usuario', 422);
            }
            db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            log_activity('usuarios', 'user_delete', "Eliminó usuario \"{$target['username']}\"", 'user', $id);
            json_ok();
        }

        case 'set_permissions': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $target = find_user($id);
            save_user_permissions($id, $b['permissions'] ?? []);
            log_activity('usuarios', 'user_permissions', "Actualizó permisos de \"{$target['username']}\"", 'user', $id);
            json_ok();
        }
    }
}

function find_user(int $id): array
{
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Usuario no encontrado', 404);
    }
    return $row;
}

/**
 * Guarda la matriz de permisos de un usuario (transaccional).
 * $permissions: { module_key: { flag: bool, ... } | {} }  — la llave presente = acceso.
 */
function save_user_permissions(int $userId, $permissions): void
{
    if (!is_array($permissions)) {
        return;
    }
    $registry = modules_registry();
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM user_permissions WHERE user_id = ?')->execute([$userId]);
        $ins = $pdo->prepare('INSERT INTO user_permissions (user_id, module_key, flags) VALUES (?, ?, ?)');
        foreach ($permissions as $moduleKey => $flags) {
            if (!isset($registry[$moduleKey])) {
                continue; // solo módulos registrados
            }
            $validFlags = [];
            foreach (array_keys($registry[$moduleKey]['flags'] ?? []) as $f) {
                if (!empty($flags[$f])) {
                    $validFlags[$f] = true;
                }
            }
            $ins->execute([$userId, $moduleKey, $validFlags ? json_encode($validFlags) : null]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
