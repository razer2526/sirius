<?php
/**
 * Handler assistant: conversación con el asistente.
 *
 * El servidor arma el contexto (qué módulo está abierto, pendientes del usuario,
 * actividad del día) y lo manda junto con la conversación. La llave de la API
 * nunca sale de aquí.
 */

require_once __DIR__ . '/../../includes/ai.php';
require_once __DIR__ . '/../../includes/assistant_tools.php';

function handle_assistant(string $action): void
{
    $me = current_user();

    switch ($action) {
        /** Estado del asistente, para que la burbuja sepa si puede usarse. */
        case 'status': {
            $cfg = ai_config();
            json_ok([
                'ready' => ai_is_ready(),
                'name'  => $cfg['assistant_name'],
            ]);
        }

        case 'chat': {
            $b = request_body();
            $message = trim((string)($b['message'] ?? ''));
            if ($message === '') {
                json_error('Mensaje vacío', 422);
            }
            $cfg = ai_config();
            if (!ai_is_ready()) {
                json_ok([
                    'reply' => 'El asistente todavía no está configurado. Un administrador puede activarlo en '
                             . 'Admin Tools > API, capturando la llave de Gemini.',
                    'configured' => false,
                ]);
            }

            $module = preg_replace('/[^a-z_]/', '', (string)($b['module'] ?? 'dashboard'));
            $history = assistant_history($b['history'] ?? [], $message);

            // Solo Gemini sabe usarlas por ahora; con otro proveedor activo se manda
            // un arreglo vacío y el asistente responde como siempre (ver ai_generate()).
            $tools = $cfg['provider'] === 'gemini' ? assistant_tools($me) : [];

            try {
                $reply = ai_generate($history, assistant_system_prompt($cfg, $module, $me, !!$tools), null, 1200, $tools);
            } catch (Throwable $e) {
                error_log('assistant: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }

            log_activity('assistant', 'chat', mb_substr($message, 0, 120));
            json_ok(['reply' => $reply, 'configured' => true]);
        }

        /** Apoyo diagnóstico sobre un expediente concreto (Expedientes > Dx Assist). */
        case 'dx': {
            if (!user_can('expedientes') || !user_flag('expedientes', 'dx_assist')) {
                json_error('No tienes el privilegio de Dx Assist', 403);
            }
            $b = request_body();
            $patientId = (int)($b['patient_id'] ?? 0);
            $message = trim((string)($b['message'] ?? ''));
            $cfg = ai_config();
            if (!ai_is_ready()) {
                json_error('El asistente no está configurado. Actívalo en Admin Tools > API.', 422);
            }
            if (empty($cfg['share_patient_data'])) {
                json_error('El envío de datos clínicos al asistente está desactivado en Admin Tools > API.', 422);
            }

            $record = assistant_patient_record($patientId, current_user());
            if (!$record) {
                json_error('Paciente no encontrado', 404);
            }

            $history = assistant_history($b['history'] ?? [], $message ?: 'Analiza el expediente y da tu apoyo diagnóstico.');
            $system = $cfg['dx_instructions'] . "\n\nEXPEDIENTE DEL PACIENTE:\n" . $record;

            try {
                // Un análisis diagnóstico completo (hallazgos + diferenciales + estudios) necesita
                // más espacio que una respuesta de chat breve; con el límite general (1200) se
                // cortaba a media frase en expedientes con muchos campos capturados.
                $reply = ai_generate($history, $system, null, 3500);
            } catch (Throwable $e) {
                error_log('dx_assist: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }

            log_activity('expedientes', 'dx_assist', "Consultó Dx Assist del paciente #$patientId", 'patient', $patientId);
            json_ok(['reply' => $reply]);
        }
    }
}

/** Normaliza el historial recibido y agrega el mensaje nuevo. */
function assistant_history($history, string $message): array
{
    $out = [];
    if (is_array($history)) {
        // Se conservan los últimos turnos para no crecer sin límite
        foreach (array_slice($history, -10) as $turn) {
            $text = trim((string)($turn['text'] ?? ''));
            if ($text !== '') {
                // El bubble de chat (assistant.js) manda 'model' para los turnos del asistente;
                // se normaliza aquí para que ai_generate() sea independiente del proveedor.
                $role = ($turn['role'] ?? 'user') === 'model' || ($turn['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
                $out[] = ['role' => $role, 'text' => mb_substr($text, 0, 4000)];
            }
        }
    }
    $out[] = ['role' => 'user', 'text' => mb_substr($message, 0, 4000)];
    return $out;
}

/** Instrucciones + contexto de lo que el usuario está viendo. */
function assistant_system_prompt(array $cfg, string $module, array $me, bool $hasTools = false): string
{
    $labels = [
        'dashboard' => 'el panel principal', 'admision' => 'el módulo de Admisión',
        'expedientes' => 'los expedientes de pacientes', 'tareas' => 'el gestor de tareas',
        'apps' => 'las herramientas de documentos', 'usuarios' => 'la administración de usuarios',
        'membretes' => 'la configuración de membretes', 'log' => 'la bitácora', 'backup' => 'los respaldos',
    ];
    $where = $labels[$module] ?? 'el sistema';

    $prompt = $cfg['instructions'] . "\n\n"
        . "CONTEXTO ACTUAL\n"
        . "Usuario: {$me['full_name']} (rol {$me['role']}).\n"
        . "Pantalla abierta: $where.\n"
        . 'Fecha: ' . date('Y-m-d H:i') . "\n";

    $facts = assistant_facts($module, $me);
    if ($facts !== '') {
        $prompt .= "\nDATOS DEL SISTEMA (úsalos para responder; no inventes otros):\n" . $facts;
    }
    if ($hasTools) {
        $prompt .= "\nTienes herramientas para consultar la agenda de un día y para buscar un paciente con sus "
            . "episodios. Úsalas cuando la pregunta las necesite, en vez de adivinar o de solo repetir los datos "
            . "de arriba; si buscas un paciente y hay varios con nombre parecido, pregunta cuál antes de asumir.";
    } else {
        $prompt .= "\nSi te piden algo que requiera datos que no aparecen arriba, indica en qué módulo se consultan.";
    }
    return $prompt;
}

/** Resumen breve del estado del sistema, según dónde esté el usuario. */
function assistant_facts(string $module, array $me): string
{
    $lines = [];
    try {
        $today = date('Y-m-d');
        $pacientes = (int)db()->query('SELECT COUNT(*) c FROM patients WHERE is_deleted = 0')->fetch()['c'];
        $lines[] = "- Pacientes registrados: $pacientes";

        $st = db()->prepare('SELECT COUNT(*) c FROM episodes WHERE admission_date BETWEEN ? AND ?');
        $st->execute([$today . ' 00:00:00', $today . ' 23:59:59']);
        $lines[] = '- Admisiones de hoy: ' . (int)$st->fetch()['c'];

        $st = db()->prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND status <> 'completada' AND recurrence IS NULL");
        $st->execute([$me['id']]);
        $lines[] = '- Tus tareas pendientes: ' . (int)$st->fetch()['c'];

        if ($module === 'tareas') {
            $st = db()->prepare(
                "SELECT title, priority, due_date FROM tasks
                 WHERE assigned_to = ? AND status <> 'completada' ORDER BY due_date IS NULL, due_date LIMIT 8"
            );
            $st->execute([$me['id']]);
            foreach ($st->fetchAll() as $t) {
                $lines[] = "  · {$t['title']} (prioridad {$t['priority']}"
                    . ($t['due_date'] ? ", vence {$t['due_date']}" : '') . ')';
            }
        }
        if ($module === 'apps') {
            $st = db()->query("SELECT COUNT(*) c FROM documents WHERE status = 'borrador'");
            $lines[] = '- Estudios en borrador: ' . (int)$st->fetch()['c'];
        }
        if ($module === 'expedientes' || $module === 'dashboard') {
            $st = db()->query(
                'SELECT p.first_name, p.paternal_surname, e.service, e.admission_date
                 FROM episodes e JOIN patients p ON p.id = e.patient_id
                 WHERE p.is_deleted = 0 ORDER BY e.admission_date DESC LIMIT 5'
            );
            foreach ($st->fetchAll() as $r) {
                $lines[] = "  · Última admisión: {$r['first_name']} {$r['paternal_surname']}"
                    . " ({$r['service']}, {$r['admission_date']})";
            }
        }
    } catch (Throwable $e) {
        error_log('assistant_facts: ' . $e->getMessage());
    }
    return implode("\n", $lines);
}

/** Expediente completo del paciente en texto, para el apoyo diagnóstico. */
function assistant_patient_record(int $patientId, array $me): ?string
{
    require_once __DIR__ . '/../../includes/services.php';   // SERVICE_LABELS y service_sections()

    $st = db()->prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 0');
    $st->execute([$patientId]);
    $p = $st->fetch();
    if (!$p) {
        return null;
    }

    $age = null;
    if (!empty($p['birth_date'])) {
        $b = date_create((string)$p['birth_date']);
        $age = $b ? date_diff($b, date_create('now'))->y : null;
    }
    $sex = ['F' => 'femenino', 'M' => 'masculino'][$p['sex']] ?? 'no especificado';

    $out = [];
    $out[] = 'Folio: ' . $p['file_number'];
    $out[] = 'Edad: ' . ($age !== null ? $age . ' años' : 'no registrada') . ' · Sexo: ' . $sex;
    foreach ([
        'allergies' => 'Alergias', 'chronic_conditions' => 'Antecedentes personales patológicos',
        'family_history' => 'Antecedentes heredofamiliares', 'current_medications' => 'Medicamentos actuales',
        'notes' => 'Notas',
    ] as $field => $label) {
        if (!empty($p[$field])) {
            $out[] = "$label: {$p[$field]}";
        }
    }

    $st = db()->prepare('SELECT * FROM episodes WHERE patient_id = ? ORDER BY admission_date');
    $st->execute([$patientId]);
    $isAdmin = is_admin_role($me);
    foreach ($st->fetchAll() as $e) {
        // Un episodio asignado a otro usuario no debe filtrarse al asistente a través de este paciente
        if (!$isAdmin && $e['assigned_user_id'] !== null && (int)$e['assigned_user_id'] !== (int)$me['id']) {
            continue;
        }
        $label = SERVICE_LABELS[$e['service']] ?? $e['service'];
        $out[] = "\n--- $label · admisión {$e['admission_date']} ---";
        if (!empty($e['reason'])) {
            $out[] = 'Motivo: ' . $e['reason'];
        }
        $out[] = assistant_flatten_json($e['service_data'], $e['service'], 'admission');

        $cs = db()->prepare('SELECT * FROM consultations WHERE episode_id = ? ORDER BY consult_date');
        $cs->execute([$e['id']]);
        foreach ($cs->fetchAll() as $c) {
            $out[] = "  Consulta {$c['consult_date']}: " . trim((string)$c['notes']);
            $flat = assistant_flatten_json($c['params'], $e['service'], 'session');
            if ($flat !== '') {
                $out[] = '  ' . $flat;
            }
        }
    }

    $out = array_merge($out, assistant_patient_studies($patientId));
    return implode("\n", array_filter($out, fn($l) => trim((string)$l) !== ''));
}

/** Resultados de los estudios ya membretados de un paciente (moleculares y de análisis clínicos). */
function assistant_patient_studies(int $patientId): array
{
    require_once __DIR__ . '/../../includes/doc_templates.php';

    // Solo los más recientes: un expediente con muchos estudios haría el contexto enorme
    $st = db()->prepare(
        "SELECT doc_type, folio, clinical_data, results, created_at
         FROM documents WHERE patient_id = ? AND status = 'revisado'
         ORDER BY created_at DESC LIMIT 8"
    );
    $st->execute([$patientId]);
    $docs = array_reverse($st->fetchAll());
    if (!$docs) {
        return [];
    }

    $out = [];
    foreach ($docs as $d) {
        $clinical = json_decode((string)$d['clinical_data'], true) ?: [];
        $results  = json_decode((string)$d['results'], true) ?: [];
        $fecha = $clinical['fecha_reporte'] ?? mb_substr((string)$d['created_at'], 0, 10);

        if ($d['doc_type'] === 'analisis_clinicos') {
            $out[] = "\n--- Análisis clínicos · orden {$d['folio']} · $fecha ---";
            foreach ($results as $study) {
                $out[] = '· ' . ($study['name'] ?? 'Estudio');
                foreach ($study['items'] ?? [] as $it) {
                    $line = '    ' . $it['name'] . ': ' . $it['value'];
                    $line .= $it['unit'] ? ' ' . $it['unit'] : '';
                    $line .= $it['reference'] ? ' (ref: ' . $it['reference'] . ')' : '';
                    // El lector ya marcó lo que cae fuera del rango del paciente
                    $line .= $it['flag'] ? ' [' . $it['flag'] . ']' : '';
                    $out[] = $line;
                }
            }
            continue;
        }

        // Estudios moleculares: los analitos son booleanos (positivo / negativo)
        $tpl = doc_template((string)$d['doc_type']);
        if (!$tpl) {
            continue;
        }
        $nombre = $tpl['study_name'] ?? $tpl['label'];
        $out[] = "\n--- $nombre · orden {$d['folio']} · $fecha ---";
        if (!empty($clinical['tipo_muestra'])) {
            $out[] = 'Muestra: ' . $clinical['tipo_muestra']
                . (!empty($clinical['kit']) ? ' · Método: ' . $clinical['kit'] : '');
        }
        $positivos = [];
        foreach ($tpl['panels'] as $panel) {
            foreach ($panel['analytes'] as $a) {
                if (!empty($results[$a['k']])) {
                    $positivos[] = $a['l'];
                }
            }
        }
        $out[] = $positivos
            ? 'Positivo para: ' . implode(', ', $positivos)
            : 'Negativo para todos los analitos del panel.';
        if (!empty($clinical['observaciones'])) {
            $out[] = 'Observaciones: ' . $clinical['observaciones'];
        }
    }
    return $out;
}

/** Convierte los datos capturados en texto legible usando las etiquetas del catálogo. */
function assistant_flatten_json($json, string $service, string $stage): string
{
    $data = $json ? json_decode($json, true) : [];
    if (!is_array($data) || !$data) {
        return '';
    }
    $labels = [];
    $detailOf = [];
    foreach (service_sections($service, $stage) as $section) {
        foreach ($section['fields'] as $f) {
            $labels[$f['k']] = $f['l'];
            if (($f['t'] ?? '') === 'checkdetail') {
                // El detalle se guarda aparte (<clave>_det); se une a su campo padre
                $detailOf[$f['k'] . '_det'] = $f['k'];
            }
        }
    }

    $val = fn($v) => match (true) {
        is_bool($v)  => 'sí',
        is_array($v) => implode(', ', array_map('strval', $v)),   // casillas múltiples
        default      => trim((string)$v),
    };

    $parts = [];
    foreach ($data as $k => $v) {
        // La firma es una imagen: no aporta al análisis
        if ($k === 'firma' || isset($detailOf[$k]) || $v === '' || $v === false || $v === null) {
            continue;
        }
        $value = $val($v);
        if ($value === '') {
            continue;
        }
        $detail = $val($data[$k . '_det'] ?? '');
        if ($detail !== '') {
            $value .= " ($detail)";
        }
        $parts[] = ($labels[$k] ?? $k) . ': ' . $value;
    }
    return implode(' · ', $parts);
}
