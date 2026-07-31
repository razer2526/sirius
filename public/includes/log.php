<?php
/** Bitácora de actividad. Llamar en todo login/logout y toda escritura. */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';

function log_activity(
    string $moduleKey,
    string $action,
    ?string $detail = null,
    ?string $entityType = null,
    ?int $entityId = null,
    ?array $userOverride = null
): void {
    try {
        $user = $userOverride ?? current_user();
        $st = db()->prepare(
            'INSERT INTO activity_log (user_id, username, module_key, action, detail, entity_type, entity_id, ip, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $user['id'] ?? null,
            $user['username'] ?? null,
            $moduleKey,
            $action,
            $detail !== null ? mb_substr($detail, 0, 500) : null,
            $entityType,
            $entityId,
            $_SERVER['REMOTE_ADDR'] ?? null,
            date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        // La bitácora nunca debe tumbar la operación principal.
        error_log('log_activity: ' . $e->getMessage());
    }
}
