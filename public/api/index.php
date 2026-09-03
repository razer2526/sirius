<?php
/**
 * Front controller de la API JSON de Sirius.
 * Todas las peticiones: api/index.php?r=recurso/accion
 * Flujo: sesión → login → CSRF (escrituras) → permiso de módulo → handler.
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/response.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/csrf.php';
require_once __DIR__ . '/../includes/permissions.php';
require_once __DIR__ . '/../includes/log.php';

if (app_config()['app_env'] === 'dev') {
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
} else {
    ini_set('display_errors', '0');
}

session_boot();

// recurso => [archivo handler, module_key requerido (null = solo login)]
$routes = [
    'auth'          => ['auth.php', null],
    'users'         => ['users.php', 'usuarios'],
    'patients'      => ['patients.php', 'expedientes'],
    'episodes'      => ['episodes.php', 'admision'],
    'consultations' => ['consultations.php', 'expedientes'],
    'dashboard'     => ['dashboard.php', 'dashboard'],
    'tasks'         => ['tasks.php', 'tareas'],
    'inventory'     => ['inventory.php', 'inventario'],
    'board'         => ['board.php', 'pizarron'],
    'files'         => ['archivos.php', 'archivos'],
    'appointments'  => ['appointments.php', 'calendario'],
    'documents'     => ['documents.php', 'apps'],
    'labs'          => ['labs.php', 'apps'],
    'letterhead'    => ['letterhead.php', 'membretes'],
    'activity'      => ['activity.php', 'log'],
    'backups'       => ['backups.php', 'backup'],
    'ai'            => ['ai.php', 'api'],
    'calendar'      => ['calendar.php', 'api'],
    'assistant'     => ['assistant.php', null],
    'catalog'       => ['catalog.php', 'catalogo_estudios'],
    'quotes'        => ['quotes.php', 'apps'],
    'vinculacion'   => ['vinculacion.php', 'vinculacion'],
    'commissions'   => ['commissions.php', 'apps'],
    'lab_templates' => ['lab_templates.php', 'plantillas_estudios'],
    'mail'          => ['mail.php', 'api'],
    'whatsapp'        => ['whatsapp.php', 'whatsapp'],
    'whatsapp_config' => ['whatsapp_config.php', 'whatsapp_config'],
    'cobertura'     => ['cobertura.php', 'cobertura'],
    'coverage'      => ['cobertura.php', 'apps'],
    'push'          => ['push.php', null],
];

$r = (string)($_GET['r'] ?? '');
$parts = explode('/', $r, 2);
$resource = $parts[0] ?? '';
$action   = $parts[1] ?? '';

if (!isset($routes[$resource]) || $action === '') {
    json_error('Ruta no válida', 404);
}

if (!current_user()) {
    json_error('No autenticado', 401);
}

$isWrite = $_SERVER['REQUEST_METHOD'] !== 'GET';
if ($isWrite && !csrf_verify()) {
    json_error('Token CSRF inválido', 403);
}

[$handlerFile, $moduleKey] = $routes[$resource];
if ($moduleKey !== null && !user_can($moduleKey)) {
    json_error('No tienes permiso para este módulo', 403);
}

try {
    require __DIR__ . '/handlers/' . $handlerFile;
    // Cada handler define handle_<recurso>(string $action): void
    $fn = 'handle_' . $resource;
    if (!function_exists($fn)) {
        json_error('Handler no disponible', 500);
    }
    $fn($action);
    json_error('Acción no válida', 404); // el handler debió responder y salir
} catch (PDOException $e) {
    error_log('API DB error: ' . $e->getMessage());
    $msg = app_config()['app_env'] === 'dev' ? $e->getMessage() : 'Error de base de datos';
    json_error($msg, 500);
} catch (Throwable $e) {
    error_log('API error: ' . $e->getMessage());
    $msg = app_config()['app_env'] === 'dev' ? $e->getMessage() : 'Error interno';
    json_error($msg, 500);
}
