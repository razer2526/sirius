<?php
/** Respuestas JSON estandarizadas de la API. */

/** Encabezados comunes: las respuestas llevan datos clínicos y no deben cachearse. */
function json_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
}

function json_ok($data = null): void
{
    json_headers();
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $code = 400): void
{
    http_response_code($code);
    json_headers();
    echo json_encode(['ok' => false, 'error' => $message, 'code' => $code], JSON_UNESCAPED_UNICODE);
    exit;
}

/** Cuerpo JSON de la petición como arreglo asociativo. */
function request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
