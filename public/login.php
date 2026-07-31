<?php
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/csrf.php';
require_once __DIR__ . '/includes/log.php';

session_boot();

if (current_user()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_verify()) {
        $error = 'Sesión expirada. Intenta de nuevo.';
    } else {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';
        $result = attempt_login($username, $password);
        if ($result['ok']) {
            log_activity('auth', 'login', 'Inicio de sesión', 'user', (int)$result['user']['id'], $result['user']);
            header('Location: index.php');
            exit;
        }
        log_activity('auth', 'login_failed', 'Intento fallido para "' . $username . '"');
        $error = $result['error'];
    }
}
$csrf = csrf_token();
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sirius — Iniciar sesión</title>
<link rel="icon" href="assets/img/icons/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/fonts/fonts.css">
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body class="min-h-screen bg-slate-100 font-sans text-slate-800 antialiased">
<main class="flex min-h-screen items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-600/30">
        <svg viewBox="0 0 24 24" class="h-9 w-9 text-white" fill="currentColor"><path d="M12 1l2.4 6.9L21 9l-5.2 4.4L17.5 21 12 17.2 6.5 21l1.7-7.6L3 9l6.6-1.1z"/></svg>
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">Sirius</h1>
      <p class="mt-1 text-sm text-slate-500">Laboratorio y Clínica Bosques Polanco</p>
    </div>

    <form method="post" class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <input type="hidden" name="_csrf" value="<?= htmlspecialchars($csrf) ?>">
      <?php if ($error): ?>
      <div class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"><?= htmlspecialchars($error) ?></div>
      <?php endif; ?>
      <label class="mb-1 block text-sm font-medium text-slate-700" for="username">Usuario</label>
      <input id="username" name="username" type="text" required autofocus autocomplete="username"
             class="mb-4 w-full rounded-lg border-0 bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
      <label class="mb-1 block text-sm font-medium text-slate-700" for="password">Contraseña</label>
      <input id="password" name="password" type="password" required autocomplete="current-password"
             class="mb-6 w-full rounded-lg border-0 bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
      <button type="submit"
              class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
        Iniciar sesión
      </button>
    </form>
    <p class="mt-6 text-center text-xs text-slate-400">Sirius · Sistema de gestión clínica</p>
  </div>
</main>
</body>
</html>
