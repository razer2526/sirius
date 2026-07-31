<?php
/**
 * Asistente visual de instalación de Sirius (equivalente al "instalador de
 * 5 minutos" de WordPress). Uso previsto: subir el zip de producción,
 * extraerlo, crear la base de datos en cPanel y visitar esta URL una vez.
 *
 * Qué hace:
 *  - Prueba la conexión a MySQL con los datos que se le den.
 *  - Escribe includes/config.php (nadie lo edita a mano).
 *  - Crea las tablas y siembra el administrador con las credenciales elegidas aquí.
 *  - Se autobloquea (.installed) para no poder volver a correr por accidente.
 *
 * Para actualizaciones posteriores que agreguen tablas/columnas, se usa
 * setup.php?key=... (la clave queda guardada en config.php al terminar aquí).
 */

session_start();

$installDir  = __DIR__;
$lockFile    = $installDir . '/.installed';
$configDest  = $installDir . '/../includes/config.php';

$alreadyInstalled = is_file($lockFile);

$errors = [];
$success = null;

if (!$alreadyInstalled && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (empty($_SESSION['install_nonce']) || ($_POST['nonce'] ?? '') !== $_SESSION['install_nonce']) {
        $errors[] = 'La página expiró, vuelve a intentarlo.';
    }

    $clinicName = trim($_POST['clinic_name'] ?? '');
    $dbHost     = trim($_POST['db_host'] ?? 'localhost');
    $dbName     = trim($_POST['db_name'] ?? '');
    $dbUser     = trim($_POST['db_user'] ?? '');
    $dbPass     = (string)($_POST['db_pass'] ?? '');
    $adminUser  = trim($_POST['admin_user'] ?? '');
    $adminName  = trim($_POST['admin_name'] ?? '');
    $adminPass  = (string)($_POST['admin_pass'] ?? '');
    $adminPass2 = (string)($_POST['admin_pass2'] ?? '');

    if ($clinicName === '') $errors[] = 'Escribe el nombre de la clínica.';
    if ($dbHost === '') $errors[] = 'Escribe el host de la base de datos.';
    if ($dbName === '') $errors[] = 'Escribe el nombre de la base de datos.';
    if ($dbUser === '') $errors[] = 'Escribe el usuario de la base de datos.';
    if ($adminUser === '') $errors[] = 'Escribe el usuario del administrador.';
    if ($adminName === '') $errors[] = 'Escribe el nombre completo del administrador.';
    if (mb_strlen($adminPass) < 8) $errors[] = 'La contraseña del administrador debe tener al menos 8 caracteres.';
    if ($adminPass !== $adminPass2) $errors[] = 'Las contraseñas del administrador no coinciden.';

    $pdo = null;
    if (!$errors) {
        try {
            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $dbHost, $dbName);
            $pdo = new PDO($dsn, $dbUser, $dbPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        } catch (Throwable $e) {
            $errors[] = 'No se pudo conectar a la base de datos: ' . $e->getMessage();
        }
    }

    if (!$errors) {
        $esc = static fn(string $s): string => str_replace(['\\', "'"], ['\\\\', "\\'"], $s);
        $installKey = bin2hex(random_bytes(20));
        $cronKey    = bin2hex(random_bytes(20));

        $configBody = "<?php\n"
            . "// Configuración de producción de Sirius — generada por el asistente de instalación.\n"
            . "// NUNCA subas este archivo a un repositorio público.\n"
            . "return [\n"
            . "    'db' => [\n"
            . "        'driver'      => 'mysql',\n"
            . "        'host'        => '{$esc($dbHost)}',\n"
            . "        'name'        => '{$esc($dbName)}',\n"
            . "        'user'        => '{$esc($dbUser)}',\n"
            . "        'pass'        => '{$esc($dbPass)}',\n"
            . "        'sqlite_path' => __DIR__ . '/../../data/sirius.sqlite',\n"
            . "    ],\n"
            . "    'app_env'     => 'prod',\n"
            . "    'install_key' => '{$esc($installKey)}',\n"
            . "    'cron_key'    => '{$esc($cronKey)}',\n"
            . "    'ca_bundle'   => '',\n"
            . "];\n";

        // is_writable() de PHP no es confiable en todos los sistemas de archivos
        // (falsos negativos en directorios de Windows); se confía en el resultado
        // real de la escritura en vez de una comprobación previa.
        if (@file_put_contents($configDest, $configBody, LOCK_EX) === false) {
            $errors[] = 'No se pudo escribir includes/config.php. Revisa los permisos de la carpeta includes/ (755 o 775).';
        }
    }

    if (!$errors) {
        try {
            require_once $installDir . '/../includes/db.php';
            require_once $installDir . '/schema.php';
            $log = sirius_install_schema($pdo, true, $clinicName);
            $seed = sirius_seed_admin($pdo, $adminUser, $adminPass, $adminName);
            $log = array_merge($log, $seed['log']);

            file_put_contents($lockFile, json_encode([
                'installed_at' => date('c'),
                'admin_user'   => $adminUser,
            ], JSON_PRETTY_PRINT));

            $success = [
                'log'         => $log,
                'admin_user'  => $adminUser,
                'install_key' => $installKey,
                'cron_key'    => $cronKey,
            ];
        } catch (Throwable $e) {
            $errors[] = 'Falló la instalación: ' . $e->getMessage();
        }
    }
}

$_SESSION['install_nonce'] = bin2hex(random_bytes(16));
$nonce = $_SESSION['install_nonce'];
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sirius — Instalación</title>
<link rel="icon" href="../assets/img/icons/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../assets/fonts/fonts.css">
<link rel="stylesheet" href="../assets/css/app.css">
</head>
<body class="min-h-screen bg-slate-100 font-sans text-slate-800 antialiased">
<main class="mx-auto max-w-2xl px-4 py-10">
  <div class="mb-8 text-center">
    <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-600/30">
      <svg viewBox="0 0 24 24" class="h-9 w-9 text-white" fill="currentColor"><path d="M12 1l2.4 6.9L21 9l-5.2 4.4L17.5 21 12 17.2 6.5 21l1.7-7.6L3 9l6.6-1.1z"/></svg>
    </div>
    <h1 class="text-2xl font-bold tracking-tight text-slate-900">Instalación de Sirius</h1>
    <p class="mt-1 text-sm text-slate-500">Esto solo se hace una vez.</p>
  </div>

  <?php if ($alreadyInstalled && !$success): ?>
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p class="text-sm font-semibold text-slate-800">Sirius ya está instalado en este sitio.</p>
      <p class="mt-2 text-sm text-slate-600">
        Si necesitas aplicar cambios de esquema de una actualización (tablas o columnas nuevas),
        usa <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs">setup.php?key=TU_INSTALL_KEY</code>
        (la clave está en tu <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs">includes/config.php</code>).
      </p>
      <p class="mt-2 text-sm text-slate-600">
        Si de verdad necesitas volver a correr este asistente (por ejemplo, en un sitio nuevo),
        borra el archivo <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs">install/.installed</code> primero.
      </p>
      <a href="../login.php" class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
        Ir a iniciar sesión
      </a>
    </div>

  <?php elseif ($success): ?>
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p class="text-base font-bold text-emerald-700">Instalación completada</p>
      <ul class="mt-3 space-y-1 text-xs font-mono text-slate-500">
        <?php foreach ($success['log'] as $line): ?>
          <li><?= htmlspecialchars($line) ?></li>
        <?php endforeach; ?>
      </ul>

      <div class="mt-5 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p class="text-sm font-semibold text-amber-900">Guarda esto ahora — no se vuelve a mostrar</p>
        <p class="mt-2 text-sm text-amber-800">
          Usuario administrador: <b><?= htmlspecialchars($success['admin_user']) ?></b>
        </p>
        <p class="mt-1 text-sm text-amber-800">
          Clave de instalación (para futuras actualizaciones con <code>setup.php?key=</code>):<br>
          <code class="break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-amber-200"><?= htmlspecialchars($success['install_key']) ?></code>
        </p>
        <p class="mt-2 text-sm text-amber-800">
          Clave de cron (solo si conectas Google Calendar más adelante):<br>
          <code class="break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-amber-200"><?= htmlspecialchars($success['cron_key']) ?></code>
        </p>
      </div>

      <p class="mt-4 text-sm text-slate-600">
        Este asistente ya quedó bloqueado y no se puede volver a ejecutar. Activa el SSL de tu dominio
        si aún no lo has hecho, y luego inicia sesión.
      </p>
      <a href="../login.php" class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
        Ir a iniciar sesión
      </a>
    </div>

  <?php else: ?>
    <?php if ($errors): ?>
      <div class="mb-4 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
        <?php foreach ($errors as $e): ?>
          <p class="text-sm text-red-700"><?= htmlspecialchars($e) ?></p>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <form method="post" class="space-y-5">
      <input type="hidden" name="nonce" value="<?= htmlspecialchars($nonce) ?>">

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Datos de la clínica</h2>
        <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre de la clínica</label>
        <input name="clinic_name" type="text" required value="<?= htmlspecialchars($_POST['clinic_name'] ?? 'Laboratorio y Clínica Bosques Polanco') ?>"
               class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Base de datos MySQL</h2>
        <p class="mb-3 text-xs text-slate-400">
          Créala primero en cPanel → Bases de datos MySQL (nombre, usuario y "todos los privilegios").
          cPanel te muestra aquí mismo el host, nombre y usuario que necesitas.
        </p>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Host</label>
            <input name="db_host" type="text" required value="<?= htmlspecialchars($_POST['db_host'] ?? 'localhost') ?>"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre de la BD</label>
            <input name="db_name" type="text" required placeholder="usuario_sirius" value="<?= htmlspecialchars($_POST['db_name'] ?? '') ?>"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Usuario de la BD</label>
            <input name="db_user" type="text" required placeholder="usuario_sirius" value="<?= htmlspecialchars($_POST['db_user'] ?? '') ?>"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Contraseña de la BD</label>
            <input name="db_pass" type="password" autocomplete="new-password"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Cuenta de administrador</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Usuario</label>
            <input name="admin_user" type="text" required value="<?= htmlspecialchars($_POST['admin_user'] ?? 'Admin') ?>"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre completo</label>
            <input name="admin_name" type="text" required value="<?= htmlspecialchars($_POST['admin_name'] ?? '') ?>"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Contraseña</label>
            <input name="admin_pass" type="password" required autocomplete="new-password" minlength="8"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Confirmar contraseña</label>
            <input name="admin_pass2" type="password" required autocomplete="new-password" minlength="8"
                   class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          </div>
        </div>
      </section>

      <button type="submit"
              class="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
        Instalar Sirius
      </button>
    </form>
  <?php endif; ?>

  <p class="mt-6 text-center text-xs text-slate-400">Sirius · Asistente de instalación</p>
</main>
</body>
</html>
