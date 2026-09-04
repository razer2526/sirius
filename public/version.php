<?php
/**
 * Versión desplegada actual (hash corto del commit), para que la SPA pueda
 * detectar si hay una actualización sin depender del ciclo del service worker.
 * Sin sesión/auth: endpoint público y ligero, se pide con cache: 'no-store'.
 */
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['version' => trim((string)@file_get_contents(__DIR__ . '/BUILD_VERSION')) ?: 'dev']);
