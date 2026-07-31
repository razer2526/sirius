<?php
/** Sesiones y autenticación. */

require_once __DIR__ . '/db.php';

function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name('SIRIUSSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

/** Usuario autenticado actual (fila de users) o null. */
function current_user(): ?array
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    if (empty($_SESSION['user_id'])) {
        return $user = null;
    }
    $st = db()->prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ? AND is_active = 1');
    $st->execute([$_SESSION['user_id']]);
    $row = $st->fetch();
    return $user = ($row ?: null);
}

/**
 * Intenta iniciar sesión. Devuelve true si las credenciales son válidas.
 * Aplica un freno simple: tras 5 intentos fallidos se exige esperar 5 minutos.
 */
function attempt_login(string $username, string $password): array
{
    $now = time();
    $fails = $_SESSION['login_fails'] ?? 0;
    $last  = $_SESSION['login_last_fail'] ?? 0;
    if ($fails >= 5 && ($now - $last) < 300) {
        return ['ok' => false, 'error' => 'Demasiados intentos. Espera 5 minutos.'];
    }
    if (($now - $last) >= 300) {
        $_SESSION['login_fails'] = 0;
    }

    $st = db()->prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
    $st->execute([$username]);
    $row = $st->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) {
        $_SESSION['login_fails'] = ($_SESSION['login_fails'] ?? 0) + 1;
        $_SESSION['login_last_fail'] = $now;
        return ['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'];
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$row['id'];
    unset($_SESSION['login_fails'], $_SESSION['login_last_fail']);
    return ['ok' => true, 'user' => $row];
}

function do_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}
