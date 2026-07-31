<?php
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/log.php';

session_boot();
$user = current_user();
if ($user) {
    log_activity('auth', 'logout', 'Cierre de sesión', 'user', (int)$user['id'], $user);
}
do_logout();
header('Location: login.php');
exit;
