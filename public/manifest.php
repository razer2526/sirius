<?php
/**
 * Manifest de PWA generado en PHP (en vez de manifest.webmanifest estático):
 * los íconos dependen del logo que el administrador haya subido en
 * Configuración > Personalización (ver includes/branding.php). Sin logo
 * personalizado, usa los íconos por defecto de Sirius.
 */
require_once __DIR__ . '/includes/branding.php';

header('Content-Type: application/manifest+json; charset=utf-8');

$brand = branding_urls();
$icon192 = $brand['icon_192'] ?: 'assets/img/icons/icon-192.png';
$icon512 = $brand['icon_512'] ?: 'assets/img/icons/icon-512.png';

echo json_encode([
    'name'             => 'Sirius — Bosques Polanco',
    'short_name'       => 'Sirius',
    'description'      => 'Sistema de gestión del Laboratorio y Clínica Bosques Polanco',
    'lang'             => 'es-MX',
    'start_url'        => './index.php',
    'scope'            => './',
    'display'          => 'standalone',
    'orientation'      => 'portrait',
    'background_color' => '#f1f5f9',
    'theme_color'      => '#4f46e5',
    'icons'            => [
        ['src' => $icon192, 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $icon512, 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $icon512, 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
], JSON_UNESCAPED_SLASHES);
