<?php
/**
 * Receptor de reportes de la Content-Security-Policy (modo "solo reportar").
 *
 * Los navegadores mandan aquí, por POST y sin sesión, lo que la política habría bloqueado.
 * Se registra un resumen en el error_log del servidor (cPanel → Errores) y se responde 204.
 * Sin autenticación a propósito, así que se limita el tamaño y solo se guardan campos conocidos,
 * recortados, para que nadie pueda inflar el log ni inyectar saltos de línea.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$raw = file_get_contents('php://input', false, null, 0, 8192);
$data = json_decode((string)$raw, true);
// Dos formatos: report-uri ({"csp-report": {...}}) y Reporting API ([{"type":"csp-violation","body":{...}}]).
$reports = [];
if (isset($data['csp-report']) && is_array($data['csp-report'])) {
    $reports[] = $data['csp-report'];
} elseif (is_array($data)) {
    foreach ($data as $item) {
        if (is_array($item) && isset($item['body']) && is_array($item['body'])) {
            $reports[] = $item['body'];
        }
    }
}

$clean = static fn($v): string => substr(preg_replace('/[^\x20-\x7E]/', '?', (string)$v), 0, 200);
foreach (array_slice($reports, 0, 5) as $r) {
    $directive = $r['violated-directive'] ?? $r['effectiveDirective'] ?? '';
    $blocked = $r['blocked-uri'] ?? $r['blockedURL'] ?? '';
    $page = $r['document-uri'] ?? $r['documentURL'] ?? '';
    $source = $r['source-file'] ?? $r['sourceFile'] ?? '';
    error_log('CSP: ' . $clean($directive) . ' | bloqueado: ' . $clean($blocked) . ' | página: ' . $clean($page)
        . ($source !== '' ? ' | origen: ' . $clean($source) : ''));
}
http_response_code(204);
