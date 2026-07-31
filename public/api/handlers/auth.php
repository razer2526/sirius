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
        json_ok([
            'user' => [
                'id'        => (int)$user['id'],
                'username'  => $user['username'],
                'full_name' => $user['full_name'],
                'role'      => $user['role'],
            ],
            'modules'  => user_modules(),
            'registry' => $registry,
            'csrf'     => csrf_token(),
        ]);
    }
}
