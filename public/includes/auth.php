<?php
/** Sesiones y autenticación. */

require_once __DIR__ . '/db.php';

const REMEMBER_COOKIE = 'SIRIUS_REMEMBER';
const REMEMBER_DAYS = 30;

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

/**
 * Usuario autenticado actual (fila de users) o null. Sin sesión activa, intenta
 * restaurarla con la cookie de "recuérdame" (ver remember_login()) antes de
 * darse por vencido — así login.php, index.php y api/index.php quedan cubiertos
 * sin tocarlos, ya que los tres ya siguen el patrón session_boot() + current_user().
 */
function current_user(): ?array
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    if (empty($_SESSION['user_id']) && !attempt_remember_login()) {
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

/** Cookie httpOnly/secure con la misma política que la de sesión (ver session_boot()). */
function remember_cookie_set(string $value, int $expires): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie(REMEMBER_COOKIE, $value, [
        'expires'  => $expires,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/**
 * Marca "Recuérdame": guarda un token selector/validador (patrón estándar — solo
 * el hash del validador vive en la base de datos, el secreto real solo en la
 * cookie del navegador) que deja restaurar la sesión sola en visitas futuras,
 * aunque la sesión de PHP haya expirado o el navegador se haya cerrado del todo.
 */
function remember_login(int $userId): void
{
    $selector = bin2hex(random_bytes(12));
    $validator = bin2hex(random_bytes(32));
    $now = date('Y-m-d H:i:s');
    $expiresAt = date('Y-m-d H:i:s', time() + REMEMBER_DAYS * 86400);

    // Aprovecha cada login para purgar tokens ya vencidos de este usuario, sin
    // necesidad de un cron aparte solo para eso.
    db()->prepare('DELETE FROM remember_tokens WHERE user_id = ? AND expires_at < ?')->execute([$userId, $now]);
    db()->prepare('INSERT INTO remember_tokens (user_id, selector, validator_hash, expires_at) VALUES (?, ?, ?, ?)')
        ->execute([$userId, $selector, hash('sha256', $validator), $expiresAt]);

    remember_cookie_set("$selector.$validator", time() + REMEMBER_DAYS * 86400);
}

/**
 * Sin sesión activa, intenta restaurarla con la cookie de "recuérdame". Rota el
 * token en cada uso (token nuevo, se borra el anterior): así, si alguien
 * reutiliza uno ya rotado, es señal de que la cookie se filtró, y se revocan
 * todos los tokens del usuario como precaución en vez de solo este.
 */
function attempt_remember_login(): bool
{
    $cookie = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (!str_contains($cookie, '.')) {
        return false;
    }
    [$selector, $validator] = explode('.', $cookie, 2);

    $st = db()->prepare('SELECT * FROM remember_tokens WHERE selector = ?');
    $st->execute([$selector]);
    $token = $st->fetch();

    if (!$token || $token['expires_at'] < date('Y-m-d H:i:s')) {
        remember_forget();
        return false;
    }
    if (!hash_equals($token['validator_hash'], hash('sha256', $validator))) {
        db()->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$token['user_id']]);
        remember_cookie_set('', time() - 42000);
        return false;
    }

    db()->prepare('DELETE FROM remember_tokens WHERE id = ?')->execute([$token['id']]);
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$token['user_id'];
    remember_login((int)$token['user_id']);
    return true;
}

/** Invalida (base de datos + cookie) el "recuérdame" de este dispositivo — sin
 *  tocar el de otros dispositivos donde el mismo usuario también lo haya marcado. */
function remember_forget(): void
{
    $cookie = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (str_contains($cookie, '.')) {
        [$selector] = explode('.', $cookie, 2);
        db()->prepare('DELETE FROM remember_tokens WHERE selector = ?')->execute([$selector]);
    }
    remember_cookie_set('', time() - 42000);
}

function do_logout(): void
{
    remember_forget();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}
