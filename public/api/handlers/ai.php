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
            // Si no se escribe una llave nueva, se conserva la guardada
            if (!array_key_exists('api_key', $b) || trim((string)$b['api_key']) === '') {
                unset($b['api_key']);
            }
            $cfg = ai_save($b);
            log_activity('api', 'ai_config', 'Actualizó la configuración del asistente'
                . ($cfg['enabled'] ? ' (activo)' : ' (inactivo)'));
            json_ok(['config' => ai_public_config()]);
        }

        /** Comprueba la llave y devuelve los modelos disponibles de la cuenta. */
        case 'test': {
            $b = request_body();
            $key = trim((string)($b['api_key'] ?? '')) ?: ai_config()['api_key'];
            if ($key === '') {
                json_error('Captura la llave de API antes de probar', 422);
            }
            try {
                $models = ai_list_models($key);
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
            if ($cfg['api_key'] === '') {
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
            json_ok(['reply' => $reply, 'model' => $cfg['model']]);
        }
    }
}

/** Configuración sin exponer la llave. */
function ai_public_config(): array
{
    $cfg = ai_config();
    $key = (string)$cfg['api_key'];
    $cfg['api_key'] = '';
    $cfg['has_key'] = $key !== '';
    $cfg['key_hint'] = $key === '' ? '' : str_repeat('•', 8) . substr($key, -4);
    return $cfg;
}
