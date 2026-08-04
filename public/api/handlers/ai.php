<?php
/**
 * Handler ai: configuración del asistente (Admin Tools > API).
 * La llave nunca se devuelve completa al navegador: solo se indica si existe.
 */

require_once __DIR__ . '/../../includes/ai.php';

function handle_ai(string $action): void
{
    if (!is_admin_role(current_user())) {
        json_error('Esta configuración requiere rol de administrador', 403);
    }

    switch ($action) {
        case 'get': {
            json_ok(['config' => ai_public_config()]);
        }

        case 'save': {
            $b = request_body();
            $cfg = ai_save($b);
            log_activity('api', 'ai_config', 'Actualizó la configuración del asistente'
                . ($cfg['enabled'] ? ' (activo)' : ' (inactivo)'));
            json_ok(['config' => ai_public_config()]);
        }

        /** Comprueba la llave y devuelve los modelos disponibles de la cuenta. */
        case 'test': {
            $b = request_body();
            $cfg = ai_config();
            $provider = (string)($b['provider'] ?? $cfg['provider']);
            if (!isset(AI_PROVIDERS[$provider])) {
                json_error('Proveedor no reconocido', 422);
            }
            $key = trim((string)($b['api_key'] ?? '')) ?: $cfg['providers'][$provider]['api_key'];
            if ($key === '') {
                json_error('Captura la llave de API antes de probar', 422);
            }
            try {
                $models = ai_list_models($provider, $key);
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            json_ok([
                'models' => $models,
                'count'  => count($models),
            ]);
        }

        /** Prueba de extremo a extremo con el modelo configurado. */
        case 'ping': {
            $cfg = ai_config();
            $provider = $cfg['provider'];
            if ($cfg['providers'][$provider]['api_key'] === '') {
                json_error('Falta la llave de API', 422);
            }
            try {
                $reply = ai_generate(
                    [['role' => 'user', 'text' => 'Responde únicamente con: listo']],
                    'Eres un servicio de verificación. Responde con una sola palabra.'
                );
            } catch (Throwable $e) {
                json_error($e->getMessage(), 422);
            }
            json_ok(['reply' => $reply, 'model' => $cfg['providers'][$provider]['model'], 'provider' => $provider]);
        }
    }
}

/** Configuración sin exponer las llaves. */
function ai_public_config(): array
{
    $cfg = ai_config();
    foreach ($cfg['providers'] as $name => $p) {
        $key = (string)$p['api_key'];
        $p['api_key'] = '';
        $p['has_key'] = $key !== '';
        $p['key_hint'] = $key === '' ? '' : str_repeat('•', 8) . substr($key, -4);
        $cfg['providers'][$name] = $p;
    }
    return $cfg;
}
