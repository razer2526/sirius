<?php
/**
 * Instalador de Sirius: crea tablas (idempotente) y siembra el usuario Admin.
 * Uso: install/setup.php?key=<install_key de config.php>
 *
 * Este endpoint sigue vivo DESPUÉS de la primera instalación: en cada
 * actualización que traiga cambios de esquema (tablas o columnas nuevas),
 * se vuelve a visitar esta URL para aplicarlos — es idempotente y nunca
 * borra datos. La primera instalación normalmente se hace con el asistente
 * visual (install/index.php), que además escribe config.php y crea el
 * administrador con las credenciales que tú elijas.
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/schema.php';

header('Content-Type: text/plain; charset=utf-8');

$cfg = app_config();
$key = $_GET['key'] ?? '';
if (!hash_equals((string)$cfg['install_key'], (string)$key)) {
    http_response_code(403);
    exit("Clave de instalación incorrecta. Usa setup.php?key=...\n");
}

$pdo = db();
$isMysql = db_driver() === 'mysql';

foreach (sirius_install_schema($pdo, $isMysql) as $line) {
    echo $line . "\n";
}

// ---- Seed: usuario Admin (solo si no hay ninguno; el asistente visual ya
// crea uno con credenciales propias, esto es para desarrollo/emergencia) ----
$result = sirius_seed_admin($pdo, 'Admin', '08135038', 'Administrador');
foreach ($result['log'] as $line) {
    echo $line . "\n";
}
if ($result['created']) {
    echo "Contraseña por defecto: cámbiala tras el primer inicio de sesión.\n";
}

echo "\nInstalación/actualización completa.\n";
