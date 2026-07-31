<?php
/**
 * Cliente del asistente (Google Gemini).
 *
 * La llamada sale del servidor, nunca del navegador: así la llave de la API
 * no viaja al cliente. En hosting compartido cURL suele estar disponible; si no,
 * se recurre a un stream HTTP.
 */

require_once __DIR__ . '/db.php';

const AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

function ai_defaults(): array
{
    return [
        'enabled'        => false,
        'api_key'        => '',
        'model'          => 'gemini-2.0-flash',
        'assistant_name' => 'Sirius',
        'instructions'   => "Eres el asistente del Laboratorio y Clínica Bosques Polanco. "
            . "Respondes en español, de forma breve y concreta, y ayudas al personal con el uso del sistema "
            . "y con la información que se te proporcione. No inventes datos: si no cuentas con la información, "
            . "dilo y sugiere dónde encontrarla. No emites diagnósticos definitivos.",
        'share_patient_data' => true,   // permite enviar datos clínicos al asistente
        'dx_instructions' => "Actúas como apoyo diagnóstico para personal médico. A partir del expediente que "
            . "recibas, resume los hallazgos relevantes, sugiere diagnósticos diferenciales ordenados por "
            . "probabilidad y propone estudios o conductas a considerar. Señala siempre que es un apoyo y que "
            . "la decisión final corresponde al médico tratante.",
    ];
}

function ai_config(bool $refresh = false): array
{
    static $cfg = null;
    if ($cfg !== null && !$refresh) {
        return $cfg;
    }
    $cfg = ai_defaults();
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['ai']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $saved = json_decode($row['svalue'], true);
            if (is_array($saved)) {
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
            }
        }
    } catch (Throwable $e) {
        error_log('ai_config: ' . $e->getMessage());
    }
    return $cfg;
}

function ai_save(array $values): array
{
    $cfg = array_merge(ai_config(), array_intersect_key($values, ai_defaults()));
    $cfg['enabled'] = !empty($cfg['enabled']);
    $cfg['share_patient_data'] = !empty($cfg['share_patient_data']);
    $cfg['api_key'] = trim((string)$cfg['api_key']);
    // El desplegable de modelos es un <input list=datalist>: si se teclea a mano en vez
    // de elegir una sugerencia, es fácil guardar la etiqueta bonita ("Gemini 3.5 Flash")
    // en lugar del id que espera la API ("gemini-3.5-flash"). Se normaliza para que
    // funcione de cualquier forma, en vez de fallar en silencio hasta el primer chat.
    $model = trim((string)$cfg['model']);
    if ($model !== '') {
        $model = mb_strtolower(preg_replace('/\s+/', '-', $model));
    }
    $cfg['model'] = $model ?: 'gemini-2.0-flash';
    $cfg['assistant_name'] = mb_substr(trim((string)$cfg['assistant_name']), 0, 60) ?: 'Sirius';
    $cfg['instructions'] = mb_substr(trim((string)$cfg['instructions']), 0, 4000);
    $cfg['dx_instructions'] = mb_substr(trim((string)$cfg['dx_instructions']), 0, 4000);

    $json = json_encode($cfg, JSON_UNESCAPED_UNICODE);
    $st = db()->prepare('SELECT skey FROM settings WHERE skey = ?');
    $st->execute(['ai']);
    if ($st->fetch()) {
        db()->prepare('UPDATE settings SET svalue = ? WHERE skey = ?')->execute([$json, 'ai']);
    } else {
        db()->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)')->execute(['ai', $json]);
    }
    return ai_config(true);   // refresca el caché estático para el resto de la petición
}

function ai_is_ready(): bool
{
    $cfg = ai_config();
    return !empty($cfg['enabled']) && $cfg['api_key'] !== '';
}

/** Petición HTTP al servicio; devuelve [código, cuerpo decodificado]. */
function ai_request(string $path, ?array $payload, string $apiKey, int $timeout = 45): array
{
    $url = AI_ENDPOINT . $path;
    $body = $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE);
    $headers = ['x-goog-api-key: ' . $apiKey];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POST           => $body !== null,
        ]);
        $ca = (string)(app_config()['ca_bundle'] ?? '');
        if ($ca !== '' && is_file($ca)) {
            curl_setopt($ch, CURLOPT_CAINFO, $ca);
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            // 60/77: el servidor no tiene certificados raíz para validar a Google
            if ($errno === 60 || $errno === 77) {
                throw new RuntimeException(
                    'El servidor no pudo validar el certificado de Google: le falta el paquete de '
                    . 'certificados raíz. Indica la ruta de un cacert.pem en la clave "ca_bundle" de config.php.'
                );
            }
            throw new RuntimeException('No se pudo conectar con el servicio: ' . $err);
        }
    } else {
        // Respaldo si cURL no está compilado en el servidor
        $ctx = stream_context_create(['http' => [
            'method'        => $body !== null ? 'POST' : 'GET',
            'header'        => implode("\r\n", $headers),
            'content'       => $body,
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) {
                $code = (int)$m[1];
            }
        }
        if ($raw === false) {
            throw new RuntimeException('No se pudo conectar con el servicio.');
        }
    }
    return [$code, json_decode($raw, true) ?: []];
}

/** Modelos disponibles para la llave configurada. */
function ai_list_models(string $apiKey): array
{
    [$code, $data] = ai_request('/models', null, $apiKey, 20);
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }
    $models = [];
    foreach ($data['models'] ?? [] as $m) {
        $name = str_replace('models/', '', (string)($m['name'] ?? ''));
        // Solo los que sirven para generar texto
        if ($name === '' || !in_array('generateContent', $m['supportedGenerationMethods'] ?? [], true)) {
            continue;
        }
        $models[] = ['name' => $name, 'label' => $m['displayName'] ?? $name];
    }
    usort($models, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $models;
}

/**
 * Envía una conversación al asistente.
 * $history: [['role' => 'user'|'model', 'text' => '...'], …]
 */
function ai_generate(array $history, string $systemPrompt = '', ?string $modelOverride = null, int $maxTokens = 1200): string
{
    $cfg = ai_config();
    if (!ai_is_ready()) {
        throw new RuntimeException('El asistente no está configurado. Actívalo en Admin Tools > API.');
    }
    $model = $modelOverride ?: $cfg['model'];

    $contents = [];
    foreach ($history as $turn) {
        $text = trim((string)($turn['text'] ?? ''));
        if ($text === '') {
            continue;
        }
        $contents[] = [
            'role'  => ($turn['role'] ?? 'user') === 'model' ? 'model' : 'user',
            'parts' => [['text' => $text]],
        ];
    }
    if (!$contents) {
        throw new RuntimeException('No hay nada que enviar.');
    }

    $payload = [
        'contents' => $contents,
        'generationConfig' => ['temperature' => 0.4, 'maxOutputTokens' => $maxTokens],
    ];
    if (trim($systemPrompt) !== '') {
        $payload['systemInstruction'] = ['parts' => [['text' => $systemPrompt]]];
    }

    [$code, $data] = ai_request('/models/' . rawurlencode($model) . ':generateContent', $payload, $cfg['api_key']);
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }

    $parts = $data['candidates'][0]['content']['parts'] ?? [];
    $text = '';
    foreach ($parts as $p) {
        $text .= $p['text'] ?? '';
    }
    $reason = $data['candidates'][0]['finishReason'] ?? '';
    if (trim($text) === '') {
        if ($reason === 'SAFETY') {
            return 'La respuesta fue bloqueada por los filtros de seguridad del proveedor. Reformula la consulta.';
        }
        return 'El asistente no devolvió respuesta. Intenta de nuevo.';
    }
    $text = trim($text);
    // Con expedientes muy extensos, incluso un límite generoso se puede agotar: mejor
    // avisarlo que dejar una respuesta clínica cortada a media frase sin explicación.
    if ($reason === 'MAX_TOKENS') {
        $text .= "\n\n*(Respuesta truncada por longitud; pide que continúe o sé más específico.)*";
    }
    return $text;
}

/** Traduce los errores del servicio a algo accionable. */
function ai_error_message(int $code, array $data): string
{
    $detail = $data['error']['message'] ?? '';
    return match (true) {
        $code === 400 && str_contains($detail, 'API key not valid') => 'La llave de API no es válida.',
        $code === 400 => 'Petición rechazada por el servicio' . ($detail ? ": $detail" : '.'),
        $code === 403 => 'La llave no tiene permiso para este modelo o el servicio está deshabilitado.',
        $code === 404 => 'El modelo configurado no existe. Revisa el nombre en Admin Tools > API.',
        $code === 429 => 'Se alcanzó el límite de uso del servicio. Intenta más tarde.',
        $code >= 500  => 'El servicio de IA no está disponible en este momento.',
        default       => 'Error del servicio (' . $code . ')' . ($detail ? ": $detail" : ''),
    };
}
