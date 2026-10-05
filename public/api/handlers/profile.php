<?php
/**
 * Handler profile (menú del avatar > Perfil): la ficha del propio empleado, solo lectura.
 *
 * No recibe ningún id: siempre es el usuario de la sesión, así que no hay manera de pedir la
 * ficha de otra persona. Lo que el administrador decidió ocultar se omite aquí, en el servidor
 * (employee_view con $forEmployee), no se esconde en pantalla.
 */

require_once __DIR__ . '/../../includes/employees.php';

function handle_profile(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'get': {
            $st = db()->prepare('SELECT id, username, full_name, is_active FROM users WHERE id = ?');
            $st->execute([(int)$me['id']]);
            $user = $st->fetch();
            if (!$user) {
                json_error('Usuario no encontrado', 404);
            }
            json_ok(employee_view($user, true));
        }
    }
}
