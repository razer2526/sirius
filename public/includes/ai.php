<?php
/**
 * Cliente del asistente: Google Gemini, OpenAI (ChatGPT) o Anthropic (Claude),
 * según el proveedor configurado en Admin Tools > API.
 *
 * La llamada sale del servidor, nunca del navegador: así la llave de la API
 * no viaja al cliente. En hosting compartido cURL suele estar disponible; si no,
 * se recurre a un stream HTTP.
 */

require_once __DIR__ . '/db.php';

const AI_PROVIDERS = [
    'gemini' => ['label' => 'Google Gemini', 'default_model' => 'gemini-2.0-flash'],
    'openai' => ['label' => 'OpenAI (ChatGPT)', 'default_model' => ''],
    'claude' => ['label' => 'Anthropic (Claude)', 'default_model' => 'claude-sonnet-5'],
];

function ai_defaults(): array
{
    $providers = [];
    foreach (AI_PROVIDERS as $name => $def) {
        $providers[$name] = ['api_key' => '', 'model' => $def['default_model']];
    }
    return [
        'provider'       => 'gemini',
        'enabled'        => false,
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
        'providers' => $providers,
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
                // Formato previo (solo Gemini, api_key/model en la raíz): se migra en memoria
                // a la forma multi-proveedor sin tocar lo ya guardado en la base de datos.
                if (!isset($saved['providers']) && array_key_exists('api_key', $saved)) {
                    $saved['providers'] = [
                        'gemini' => [
                            'api_key' => $saved['api_key'],
                            'model'   => $saved['model'] ?? AI_PROVIDERS['gemini']['default_model'],
                        ],
                    ];
                    $saved['provider'] = 'gemini';
                }
                $defaultProviders = $cfg['providers'];
                $cfg = array_merge($cfg, array_intersect_key($saved, $cfg));
                // 'providers' es anidado: array_merge de arriba lo reemplaza entero con lo guardado
                // (que puede no traer los 3 proveedores todavía, p.ej. justo tras la migración) —
                // se reconstruye explícitamente para no perder los valores por defecto de los demás.
                $cfg['providers'] = $defaultProviders;
                if (isset($saved['providers']) && is_array($saved['providers'])) {
                    foreach ($cfg['providers'] as $name => $default) {
                        if (isset($saved['providers'][$name]) && is_array($saved['providers'][$name])) {
                            $cfg['providers'][$name] = array_merge($default, array_intersect_key($saved['providers'][$name], $default));
                        }
                    }
                }
            }
        }
    } catch (Throwable $e) {
        error_log('ai_config: ' . $e->getMessage());
    }
    return $cfg;
}

function ai_save(array $values): array
{
    $cfg = ai_config();
    $provider = (string)($values['provider'] ?? '');
    if (isset(AI_PROVIDERS[$provider])) {
        $cfg['provider'] = $provider;
    }
    $cfg['enabled'] = !empty($values['enabled']);
    $cfg['share_patient_data'] = !empty($values['share_patient_data']);
    if (array_key_exists('assistant_name', $values)) {
        $cfg['assistant_name'] = mb_substr(trim((string)$values['assistant_name']), 0, 60) ?: 'Sirius';
    }
    if (array_key_exists('instructions', $values)) {
        $cfg['instructions'] = mb_substr(trim((string)$values['instructions']), 0, 4000);
    }
    if (array_key_exists('dx_instructions', $values)) {
        $cfg['dx_instructions'] = mb_substr(trim((string)$values['dx_instructions']), 0, 4000);
    }

    $incomingProviders = is_array($values['providers'] ?? null) ? $values['providers'] : [];
    foreach (AI_PROVIDERS as $name => $def) {
        $incoming = is_array($incomingProviders[$name] ?? null) ? $incomingProviders[$name] : [];
        $p = $cfg['providers'][$name];
        if (array_key_exists('api_key', $incoming) && trim((string)$incoming['api_key']) !== '') {
            $p['api_key'] = trim((string)$incoming['api_key']);
        }
        if (array_key_exists('model', $incoming) && trim((string)$incoming['model']) !== '') {
            $model = trim((string)$incoming['model']);
            // El desplegable de modelos es un <input list=datalist>: si se teclea a mano en vez
            // de elegir una sugerencia (solo aplica a Gemini, cuyos ids son así), es fácil guardar
            // la etiqueta bonita ("Gemini 3.5 Flash") en lugar del id que espera la API. Se normaliza
            // para que funcione de cualquier forma, en vez de fallar en silencio hasta el primer chat.
            if ($name === 'gemini') {
                $model = mb_strtolower(preg_replace('/\s+/', '-', $model));
            }
            $p['model'] = $model;
        }
        $cfg['providers'][$name] = $p;
    }

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
    $provider = $cfg['provider'];
    return !empty($cfg['enabled']) && ($cfg['providers'][$provider]['api_key'] ?? '') !== '';
}

/** Petición HTTP genérica; devuelve [código, cuerpo decodificado]. */
function ai_http(string $url, array $headers, ?array $payload, int $timeout = 45): array
{
    $body = $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE);
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
            // 60/77: el servidor no tiene certificados raíz para validar al proveedor
            if ($errno === 60 || $errno === 77) {
                throw new RuntimeException(
                    'El servidor no pudo validar el certificado del proveedor: le falta el paquete de '
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

/** Modelos disponibles para la llave configurada, según el proveedor. */
function ai_list_models(string $provider, string $apiKey): array
{
    return match ($provider) {
        'gemini' => ai_list_models_gemini($apiKey),
        'openai' => ai_list_models_openai($apiKey),
        'claude' => ai_list_models_claude($apiKey),
        default  => throw new RuntimeException('Proveedor no reconocido.'),
    };
}

function ai_list_models_gemini(string $apiKey): array
{
    [$code, $data] = ai_http(
        'https://generativelanguage.googleapis.com/v1beta/models',
        ['x-goog-api-key: ' . $apiKey],
        null,
        20
    );
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

function ai_list_models_openai(string $apiKey): array
{
    [$code, $data] = ai_http(
        'https://api.openai.com/v1/models',
        ['Authorization: Bearer ' . $apiKey],
        null,
        20
    );
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }
    $models = [];
    foreach ($data['data'] ?? [] as $m) {
        $id = (string)($m['id'] ?? '');
        // El catálogo de OpenAI incluye embeddings/whisper/tts/dall-e/moderation: solo interesan
        // los modelos de chat.
        if ($id === '' || !preg_match('/^(gpt-|chatgpt|o1|o3|o4)/i', $id)) {
            continue;
        }
        $models[] = ['name' => $id, 'label' => $id];
    }
    usort($models, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $models;
}

function ai_list_models_claude(string $apiKey): array
{
    [$code, $data] = ai_http(
        'https://api.anthropic.com/v1/models',
        ['x-api-key: ' . $apiKey, 'anthropic-version: 2023-06-01'],
        null,
        20
    );
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }
    $models = [];
    foreach ($data['data'] ?? [] as $m) {
        $id = (string)($m['id'] ?? '');
        if ($id === '') {
            continue;
        }
        $models[] = ['name' => $id, 'label' => $m['display_name'] ?? $id];
    }
    return $models;
}

/**
 * Envía una conversación al asistente, con el proveedor configurado.
 * $history: [['role' => 'user'|'assistant', 'text' => '...'], …]
 * $tools: solo lo honra Gemini (ver ai_generate_gemini). Con otro proveedor activo,
 * se ignora en silencio y el asistente responde como siempre, sin poder consultar
 * nada por su cuenta — no es un error, es la degradación esperada.
 */
function ai_generate(array $history, string $systemPrompt = '', ?string $modelOverride = null, int $maxTokens = 1200, array $tools = []): string
{
    $cfg = ai_config();
    if (!ai_is_ready()) {
        throw new RuntimeException('El asistente no está configurado. Actívalo en Admin Tools > API.');
    }
    $provider = $cfg['provider'];
    $pcfg = $cfg['providers'][$provider];
    $model = $modelOverride ?: $pcfg['model'];
    if (trim((string)$model) === '') {
        throw new RuntimeException('No hay un modelo configurado para este proveedor. Configúralo en Admin Tools > API.');
    }

    $turns = [];
    foreach ($history as $turn) {
        $text = trim((string)($turn['text'] ?? ''));
        if ($text === '') {
            continue;
        }
        $turns[] = ['role' => ($turn['role'] ?? 'user') === 'assistant' ? 'assistant' : 'user', 'text' => $text];
    }
    if (!$turns) {
        throw new RuntimeException('No hay nada que enviar.');
    }

    return match ($provider) {
        'gemini' => ai_generate_gemini($turns, $systemPrompt, $model, $maxTokens, $pcfg['api_key'], $tools),
        'openai' => ai_generate_openai($turns, $systemPrompt, $model, $maxTokens, $pcfg['api_key']),
        'claude' => ai_generate_claude($turns, $systemPrompt, $model, $maxTokens, $pcfg['api_key']),
        default  => throw new RuntimeException('Proveedor no reconocido.'),
    };
}

/**
 * $tools: ['nombre_funcion' => ['declaration' => [...esquema Gemini...], 'handler' => callable]].
 *
 * Cuando el modelo pide una herramienta, Gemini exige que el turno se repita tal
 * cual —incluida una "thoughtSignature" opaca que viaja junto al functionCall—
 * para poder continuar razonando en la siguiente vuelta; omitirla es un 400
 * ("Function call is missing a thought_signature"), verificado contra la API real
 * antes de escribir esto. Por eso $parts se reenvía sin tocar, no reconstruido.
 */
function ai_generate_gemini(array $turns, string $systemPrompt, string $model, int $maxTokens, string $apiKey, array $tools = []): string
{
    // ai_http() da a cURL hasta 45s por llamada; el límite por defecto de PHP
    // (30s) puede cortar la petición ANTES de que cURL alcance a fallar por su
    // cuenta, y entonces el usuario ve un error 500 en blanco en vez del mensaje
    // claro que ya arma ai_error_message(). Con herramientas la exposición es
    // mayor (hasta 4 vueltas), pero se vio también sin herramientas: se amplía
    // aquí siempre, no solo cuando $tools no está vacío.
    if (strpos((string)ini_get('disable_functions'), 'set_time_limit') === false) {
        @set_time_limit(120);
    }

    $contents = [];
    foreach ($turns as $t) {
        $contents[] = [
            'role'  => $t['role'] === 'assistant' ? 'model' : 'user',
            'parts' => [['text' => $t['text']]],
        ];
    }

    $payload = [
        'contents' => $contents,
        'generationConfig' => ['temperature' => 0.4, 'maxOutputTokens' => $maxTokens],
    ];
    if (trim($systemPrompt) !== '') {
        $payload['systemInstruction'] = ['parts' => [['text' => $systemPrompt]]];
    }
    if ($tools) {
        $payload['tools'] = [[
            'functionDeclarations' => array_values(array_map(fn($t) => $t['declaration'], $tools)),
        ]];
    }

    // Tope de vueltas herramienta->respuesta: una consulta normal resuelve en una,
    // pero sin límite un modelo que insiste en llamar herramientas dejaría la
    // petición del usuario colgada indefinidamente.
    for ($round = 0; $round < 4; $round++) {
        [$code, $data] = ai_http(
            'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent',
            ['x-goog-api-key: ' . $apiKey],
            $payload
        );
        if ($code !== 200) {
            throw new RuntimeException(ai_error_message($code, $data));
        }

        $parts = $data['candidates'][0]['content']['parts'] ?? [];
        $reason = $data['candidates'][0]['finishReason'] ?? '';
        $calls = $tools ? array_values(array_filter($parts, fn($p) => isset($p['functionCall']))) : [];

        if (!$calls) {
            return ai_gemini_final_text($parts, $reason);
        }

        // El modelo pidió una o más herramientas: se ejecutan aquí (nunca en el
        // proveedor) y se le devuelve el resultado para que complete la respuesta.
        $payload['contents'][] = ['role' => 'model', 'parts' => $parts];
        $resultParts = [];
        foreach ($calls as $call) {
            $name = (string)($call['functionCall']['name'] ?? '');
            $args = $call['functionCall']['args'] ?? [];
            $tool = $tools[$name] ?? null;
            $result = $tool ? ($tool['handler'])(is_array($args) ? $args : [])
                             : ['error' => "Herramienta \"$name\" no reconocida."];
            $resultParts[] = ['functionResponse' => ['name' => $name, 'response' => $result]];
        }
        $payload['contents'][] = ['role' => 'user', 'parts' => $resultParts];
    }
    throw new RuntimeException('El asistente no pudo completar la consulta tras varios intentos.');
}

function ai_gemini_final_text(array $parts, string $reason): string
{
    $text = '';
    foreach ($parts as $p) {
        $text .= $p['text'] ?? '';
    }
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

function ai_generate_openai(array $turns, string $systemPrompt, string $model, int $maxTokens, string $apiKey): string
{
    $messages = [];
    if (trim($systemPrompt) !== '') {
        $messages[] = ['role' => 'system', 'content' => $systemPrompt];
    }
    foreach ($turns as $t) {
        $messages[] = ['role' => $t['role'], 'content' => $t['text']];
    }

    $payload = [
        'model' => $model,
        'messages' => $messages,
        'max_completion_tokens' => $maxTokens,
    ];

    [$code, $data] = ai_http(
        'https://api.openai.com/v1/chat/completions',
        ['Authorization: Bearer ' . $apiKey],
        $payload
    );
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }

    $text = trim((string)($data['choices'][0]['message']['content'] ?? ''));
    $reason = $data['choices'][0]['finish_reason'] ?? '';
    if ($text === '') {
        if ($reason === 'content_filter') {
            return 'La respuesta fue bloqueada por los filtros de contenido del proveedor. Reformula la consulta.';
        }
        return 'El asistente no devolvió respuesta. Intenta de nuevo.';
    }
    if ($reason === 'length') {
        $text .= "\n\n*(Respuesta truncada por longitud; pide que continúe o sé más específico.)*";
    }
    return $text;
}

function ai_generate_claude(array $turns, string $systemPrompt, string $model, int $maxTokens, string $apiKey): string
{
    $messages = [];
    foreach ($turns as $t) {
        $messages[] = ['role' => $t['role'], 'content' => $t['text']];
    }

    $payload = [
        'model' => $model,
        'max_tokens' => $maxTokens,
        'messages' => $messages,
    ];
    if (trim($systemPrompt) !== '') {
        $payload['system'] = $systemPrompt;
    }

    [$code, $data] = ai_http(
        'https://api.anthropic.com/v1/messages',
        ['x-api-key: ' . $apiKey, 'anthropic-version: 2023-06-01'],
        $payload
    );
    if ($code !== 200) {
        throw new RuntimeException(ai_error_message($code, $data));
    }

    $text = '';
    foreach ($data['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $text .= $block['text'] ?? '';
        }
    }
    $text = trim($text);
    $reason = $data['stop_reason'] ?? '';
    if ($text === '') {
        return 'El asistente no devolvió respuesta. Intenta de nuevo.';
    }
    if ($reason === 'max_tokens') {
        $text .= "\n\n*(Respuesta truncada por longitud; pide que continúe o sé más específico.)*";
    }
    return $text;
}

/** Traduce los errores del servicio a algo accionable. */
function ai_error_message(int $code, array $data): string
{
    $detail = $data['error']['message'] ?? '';
    return match (true) {
        $code === 400 && stripos($detail, 'api key not valid') !== false => 'La llave de API no es válida.',
        $code === 400 => 'Petición rechazada por el servicio' . ($detail ? ": $detail" : '.'),
        $code === 401 => 'La llave de API no es válida o no tiene permiso.',
        $code === 403 => 'La llave no tiene permiso para este modelo o el servicio está deshabilitado.',
        $code === 404 => 'El modelo configurado no existe. Revisa el nombre en Admin Tools > API.',
        $code === 429 => 'Se alcanzó el límite de uso del servicio. Intenta más tarde.',
        $code >= 500  => 'El servicio de IA no está disponible en este momento.',
        default       => 'Error del servicio (' . $code . ')' . ($detail ? ": $detail" : ''),
    };
}
