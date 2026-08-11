<?php
/** Handler auth: estado de sesión para el arranque de la SPA. */

function handle_auth(string $action): void
{
    if ($action === 'session') {
        $user = current_user();
        $registry = [];
        // El registro completo solo es útil para armar la matriz de permisos.
        if (user_can('usuarios')) {
            foreach (modules_registry() as $key => $def) {
                $registry[] = [
                    'key'   => $key,
                    'label' => $def['label'],
                    'icon'  => $def['icon'],
                    'group' => $def['group'] ?? null,
                    'flags' => $def['flags'] ?? new stdClass(),
                ];
            }
        }
        // La interfaz necesita saber si el correo saliente está activo para no
        // ofrecer acciones que siempre fallarían (reenviar la ficha, por ejemplo).
        require_once __DIR__ . '/../../includes/mailer.php';

        json_ok([
            'user' => [
                'id'        => (int)$user['id'],
                'username'  => $user['username'],
                'full_name' => $user['full_name'],
                'role'      => $user['role'],
            ],
            'modules'  => user_modules(),
            'registry' => $registry,
            'features' => ['mail' => mail_is_ready()],
            'csrf'     => csrf_token(),
        ]);
    }
}
