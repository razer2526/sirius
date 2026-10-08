<?php
/**
 * Router de desarrollo para ver la Content-Security-Policy en local.
 * `php -S` ignora .htaccess, así que aquí se lee la política de public/.htaccess y se manda como
 * cabecera en cada respuesta (modo solo reportar o estricto, según lo que diga el .htaccess).
 *
 *   tools\php\php.exe -S localhost:8081 -t public tests/csp_router.php
 *
 * Los reportes llegan a csp_report.php y salen en la consola del servidor.
 */

$public = realpath(__DIR__ . '/../public');
$path = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = realpath($public . $path);

$ht = (string)file_get_contents($public . '/.htaccess');
if (preg_match('/^\s*Header set (Content-Security-Policy(?:-Report-Only)?) "([^"]+)"/m', $ht, $m)) {
    header($m[1] . ': ' . $m[2]);
}

if ($file === false || strncmp($file, $public, strlen($public)) !== 0 || !is_file($file)) {
    return false;   // deja que php -S resuelva index.php, 404, etc.
}
if (str_contains($file, DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR)) {
    http_response_code(403);
    exit;
}
if (substr($file, -4) === '.php') {
    $_SERVER['SCRIPT_FILENAME'] = $file;
    $_SERVER['SCRIPT_NAME'] = substr($file, strlen($public));
    chdir(dirname($file));
    require $file;
    return true;
}
$types = ['css' => 'text/css', 'js' => 'text/javascript', 'json' => 'application/json', 'png' => 'image/png',
          'svg' => 'image/svg+xml', 'woff2' => 'font/woff2', 'html' => 'text/html', 'ico' => 'image/x-icon', 'jpg' => 'image/jpeg'];
header('Content-Type: ' . ($types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
readfile($file);
return true;
