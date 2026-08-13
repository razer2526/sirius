<?php
/**
 * Permisos por módulo.
 * Roles administrador y developper tienen acceso total (incluidos todos los flags).
 * Los usuarios estandar requieren fila en user_permissions por módulo.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';

function modules_registry(): array
{
    static $registry = null;
    if ($registry === null) {
        $registry = require __DIR__ . '/modules.php';
    }
    return $registry;
}

/** Mapa module_key => flags (arreglo) para un usuario estandar. */
function user_permission_rows(int $userId): array
{
    static $cache = [];
    if (!isset($cache[$userId])) {
        $st = db()->prepare('SELECT module_key, flags FROM user_permissions WHERE user_id = ?');
        $st->execute([$userId]);
        $map = [];
        foreach ($st->fetchAll() as $row) {
            $flags = $row['flags'] ? json_decode($row['flags'], true) : [];
            $map[$row['module_key']] = is_array($flags) ? $flags : [];
        }
        $cache[$userId] = $map;
    }
    return $cache[$userId];
}

function is_admin_role(?array $user): bool
{
    return $user && in_array($user['role'], ['administrador', 'developper'], true);
}

function user_can(string $moduleKey): bool
{
    $user = current_user();
    if (!$user) {
        return false;
    }
    if (is_admin_role($user)) {
        return isset(modules_registry()[$moduleKey]);
    }
    return array_key_exists($moduleKey, user_permission_rows((int)$user['id']));
}

/**
 * Privilegio extra dentro de un módulo (ej. 'dx_assist' en expedientes).
 *
 * Los flags declarados en 'mode_flags' son la excepción a "el administrador puede
 * todo": no otorgan permisos sino que cambian la forma de trabajar (ej. 'wizard'
 * sustituye el formulario completo por el asistente). Concederlos por rol dejaría
 * al administrador sin manera de volver a la interfaz normal, así que se exigen
 * marcados explícitamente en la matriz de permisos.
 */
function user_flag(string $moduleKey, string $flag): bool
{
    $user = current_user();
    if (!$user) {
        return false;
    }
    $isMode = in_array($flag, modules_registry()[$moduleKey]['mode_flags'] ?? [], true);
    if (is_admin_role($user) && !$isMode) {
        return true;
    }
    $rows = user_permission_rows((int)$user['id']);
    return !empty($rows[$moduleKey][$flag]);
}

/** Lista de módulos visibles para el usuario (para el sidebar de la SPA). */
function user_modules(): array
{
    $user = current_user();
    if (!$user) {
        return [];
    }
    $out = [];
    foreach (modules_registry() as $key => $def) {
        if (!user_can($key)) {
            continue;
        }
        $flags = [];
        foreach (array_keys($def['flags'] ?? []) as $f) {
            $flags[$f] = user_flag($key, $f);
        }
        $out[] = [
            'key'   => $key,
            'label' => $def['label'],
            'icon'  => $def['icon'],
            'group' => $def['group'] ?? null,
            'flags' => $flags,
        ];
    }
    return $out;
}
