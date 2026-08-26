<?php
/**
 * Lectura genérica de un archivo subido (JSON o CSV) a [columnas, filas asociativas].
 * No asume nombres de columna fijos, porque el archivo de origen (exportado desde
 * otro sistema) puede cambiar con el tiempo. Compartido por los importadores del
 * Catálogo de Estudios y de Medicamentos: ambos suben una lista plana y dejan que
 * el usuario elija qué columna es cuál antes de aplicar nada.
 */

function import_parse_uploaded_file(): array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_error('No se recibió el archivo', 422);
    }
    $file = $_FILES['file'];
    if ($file['size'] > 20 * 1024 * 1024) {
        json_error('El archivo supera 20 MB', 422);
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        json_error('Subida no válida', 422);
    }
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $content = file_get_contents($file['tmp_name']);

    if ($ext === 'csv') {
        return import_parse_csv($content);
    }
    if ($ext === 'json') {
        return import_parse_json($content);
    }
    // Sin extensión reconocible: se intenta JSON primero y si falla, CSV.
    $decoded = json_decode($content, true);
    if ($decoded !== null) {
        return import_parse_json($content);
    }
    return import_parse_csv($content);
}

function import_parse_json(string $content): array
{
    $data = json_decode($content, true);
    if ($data === null) {
        json_error('El archivo no es un JSON válido', 422);
    }
    if (is_array($data) && array_is_list($data)) {
        $rows = $data;
    } elseif (is_array($data)) {
        // Objeto con una sola propiedad tipo lista, ej. {"estudios": [...]}
        $listProps = array_filter($data, fn($v) => is_array($v) && array_is_list($v));
        if (count($listProps) === 1) {
            $rows = reset($listProps);
        } else {
            json_error('No se reconoce la estructura del JSON (se espera una lista)', 422);
        }
    } else {
        json_error('No se reconoce la estructura del JSON', 422);
    }

    $columns = [];
    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        foreach (array_keys($row) as $k) {
            if (!in_array($k, $columns, true)) {
                $columns[] = (string)$k;
            }
        }
        $out[] = $row;
    }
    if (!$columns) {
        json_error('El JSON no contiene objetos con columnas reconocibles', 422);
    }
    return [$columns, $out];
}

function import_parse_csv(string $content): array
{
    // BOM de Excel
    $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);
    $lines = preg_split('/\r\n|\r|\n/', $content);
    $lines = array_values(array_filter($lines, fn($l) => trim($l) !== ''));
    if (!$lines) {
        json_error('El CSV está vacío', 422);
    }
    $delim = substr_count($lines[0], ';') > substr_count($lines[0], ',') ? ';' : ',';
    $header = str_getcsv($lines[0], $delim);
    $header = array_map(fn($h) => trim((string)$h), $header);

    $out = [];
    foreach (array_slice($lines, 1) as $line) {
        $cells = str_getcsv($line, $delim);
        $row = [];
        foreach ($header as $i => $col) {
            $row[$col] = $cells[$i] ?? '';
        }
        $out[] = $row;
    }
    return [$header, $out];
}
