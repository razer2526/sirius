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
            'key'    => $key,
            'label'  => $def['label'],
            'icon'   => $def['icon'],
            'group'  => $def['group'] ?? null,
            'flags'  => $flags,
            'hidden' => !empty($def['hidden']),
        ];
    }
    return $out;
}

/* ---------- Acceso a episodios ---------- */

/**
 * Carga un episodio con el folio de su paciente, o corta con 404.
 * Vive aquí y no en un handler porque lo usan varios (episodes, consultations)
 * y cada archivo de handler se carga por separado en cada petición.
 */
function find_open_episode(int $episodeId): array
{
    $st = db()->prepare(
        'SELECT e.*, p.file_number, p.is_deleted FROM episodes e
         JOIN patients p ON p.id = e.patient_id WHERE e.id = ?'
    );
    $st->execute([$episodeId]);
    $episode = $st->fetch();
    if (!$episode || (int)$episode['is_deleted'] === 1) {
        json_error('Episodio no encontrado', 404);
    }
    return $episode;
}

/** Un episodio restringido a otro usuario no debe aceptar consultas ni ediciones de quien no tiene acceso. */
function require_episode_visible(array $episode, array $me): void
{
    if (is_admin_role($me)) {
        return;
    }
    $assigned = $episode['assigned_user_id'] ?? null;
    if ($assigned !== null && (int)$assigned !== (int)$me['id']) {
        json_error('No tienes acceso a este expediente', 403);
    }
}

/** ¿Puede $me ver este paciente? Admin ve todo; el resto solo si tiene al menos un
 *  episodio general o asignado a él. Vive aquí (no en patients.php) porque también
 *  la usa episodes.php al adjuntar documentos, y cada handler se carga por separado. */
function patient_is_visible(array $patient, array $me): bool
{
    if (is_admin_role($me)) {
        return true;
    }
    $st = db()->prepare(
        'SELECT 1 FROM episodes WHERE patient_id = ? AND (assigned_user_id IS NULL OR assigned_user_id = ?) LIMIT 1'
    );
    $st->execute([$patient['id'], (int)$me['id']]);
    return (bool)$st->fetch();
}
