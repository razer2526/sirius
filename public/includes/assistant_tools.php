<?php
/**
 * Herramientas de sólo lectura que el asistente puede invocar (function calling
 * de Gemini). Cada una envuelve una consulta que ya existe en el sistema —nunca
 * una nueva fuente de datos—, y ninguna tiene efectos secundarios: el modelo
 * puede llamarlas sin que el usuario confirme nada, porque no cambian información.
 *
 * ASSISTANT_TOOLS es lo que assistant.php pasa a ai_generate(): declaration es el
 * esquema que ve el modelo, handler es la función PHP que en verdad se ejecuta.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/services.php';   // SERVICE_LABELS
require_once __DIR__ . '/../api/handlers/dashboard.php';   // dash_agenda()

function assistant_tools(array $me): array
{
    return [
        'consultar_agenda' => [
            'declaration' => [
                'name' => 'consultar_agenda',
                'description' => 'Devuelve las citas, tareas pendientes y laboratorios por entregar de un día '
                    . 'concreto (hoy o mañana), filtrado a lo que puede ver el usuario que pregunta.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'dia' => [
                            'type' => 'string',
                            'enum' => ['hoy', 'manana'],
                            'description' => 'Qué día consultar.',
                        ],
                    ],
                    'required' => ['dia'],
                ],
            ],
            'handler' => fn(array $args) => assistant_tool_agenda($args, $me),
        ],
        'buscar_paciente' => [
            'declaration' => [
                'name' => 'buscar_paciente',
                'description' => 'Busca un paciente por nombre y devuelve sus episodios (admisiones), con los '
                    . 'estudios solicitados en cada uno. Úsala para confirmar si un paciente concreto tiene '
                    . 'registrado un estudio (por ejemplo, un FilmArray) antes de responder sobre él.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'nombre' => [
                            'type' => 'string',
                            'description' => 'Nombre o parte del nombre del paciente.',
                        ],
                        'estudio' => [
                            'type' => 'string',
                            'description' => 'Opcional: palabra clave del estudio o motivo a buscar dentro de '
                                . 'sus episodios (por ejemplo "FilmArray" o "gastrointestinal").',
                        ],
                    ],
                    'required' => ['nombre'],
                ],
            ],
            'handler' => fn(array $args) => assistant_tool_buscar_paciente($args, $me),
        ],
    ];
}

function assistant_tool_agenda(array $args, array $me): array
{
    $dia = (string)($args['dia'] ?? 'hoy');
    $date = $dia === 'manana' ? date('Y-m-d', strtotime('+1 day')) : date('Y-m-d');
    $agenda = dash_agenda($me, $date);

    $out = ['dia_consultado' => $dia, 'fecha' => $date];
    if (isset($agenda['appointments'])) {
        $out['citas'] = array_map(fn($a) => [
            'titulo' => $a['title'],
            'hora' => mb_substr((string)$a['start_at'], 11, 5),
            'servicio' => $a['service'],
        ], $agenda['appointments']);
    }
    if (isset($agenda['tasks'])) {
        $out['tareas'] = array_map(fn($t) => [
            'titulo' => $t['title'],
            'prioridad' => $t['priority'] ?? null,
            'recurrencia' => $t['recurrence'] ?? null,
        ], $agenda['tasks']);
    }
    if (isset($agenda['lab_pending'])) {
        $out['laboratorios_por_entregar'] = array_map(fn($l) => [
            'paciente' => trim($l['first_name'] . ' ' . $l['paternal_surname']),
            'folio' => $l['file_number'],
        ], $agenda['lab_pending']);
    }
    return $out;
}

function assistant_tool_buscar_paciente(array $args, array $me): array
{
    $name = trim((string)($args['nombre'] ?? ''));
    if ($name === '') {
        return ['error' => 'Falta el nombre del paciente a buscar.'];
    }
    $studyFilter = trim((string)($args['estudio'] ?? ''));
    $isAdmin = is_admin_role($me);

    $pdo = db();
    // Sin acentos ni mayúsculas, no vía LIKE de SQL: quien pregunta por voz dice
    // "Garcia" y el reconocimiento de voz rara vez transcribe la tilde. La búsqueda
    // normal del sistema (episodes/search_patient) sí es sensible a acentos —aquí
    // se resuelve aparte, sin tocar ese comportamiento ya establecido en el resto
    // de la app— y a esta escala (una sola clínica) traer todos los pacientes y
    // filtrar en PHP no pesa.
    $needle = assistant_fold($name);
    $all = $pdo->query(
        'SELECT id, file_number, first_name, paternal_surname, maternal_surname, birth_date
         FROM patients WHERE is_deleted = 0'
    )->fetchAll();
    $patients = array_values(array_filter($all, function ($p) use ($needle) {
        $full = $p['first_name'] . ' ' . $p['paternal_surname'] . ' ' . ($p['maternal_surname'] ?? '');
        return str_contains(assistant_fold($full), $needle);
    }));
    usort($patients, fn($a, $b) => strcmp((string)$a['paternal_surname'], (string)$b['paternal_surname']));
    $patients = array_slice($patients, 0, 5);
    if (!$patients) {
        return ['encontrado' => false, 'mensaje' => 'No se encontró ningún paciente con ese nombre.'];
    }

    $out = [];
    foreach ($patients as $p) {
        $st2 = $pdo->prepare(
            'SELECT id, service, service_folio, admission_date, assigned_user_id, reason
             FROM episodes WHERE patient_id = ? ORDER BY admission_date DESC LIMIT 15'
        );
        $st2->execute([(int)$p['id']]);

        $episodes = [];
        foreach ($st2->fetchAll() as $e) {
            $assigned = $e['assigned_user_id'];
            // Mismo criterio de visibilidad que Expedientes/Admisión: un episodio asignado a
            // otro usuario no debe filtrarse a través del asistente.
            if (!$isAdmin && $assigned !== null && (int)$assigned !== (int)$me['id']) {
                continue;
            }
            $studies = [];
            if ($e['service'] === 'laboratorio') {
                $st3 = $pdo->prepare('SELECT study_name FROM episode_studies WHERE episode_id = ?');
                $st3->execute([(int)$e['id']]);
                $studies = array_column($st3->fetchAll(), 'study_name');
            }
            if ($studyFilter !== '') {
                $needleStudy = assistant_fold($studyFilter);
                $matches = assistant_any_contains($studies, $needleStudy)
                    || str_contains(assistant_fold((string)$e['reason']), $needleStudy);
                if (!$matches) {
                    continue;
                }
            }
            $episodes[] = [
                'servicio' => SERVICE_LABELS[$e['service']] ?? $e['service'],
                'fecha_admision' => $e['admission_date'],
                'folio_orden' => $e['service_folio'],
                'estudios_solicitados' => $studies,
            ];
        }
        // Con filtro de estudio, un paciente sin ningún episodio que lo mencione no aporta
        if ($studyFilter !== '' && !$episodes) {
            continue;
        }
        $out[] = [
            'nombre' => trim($p['first_name'] . ' ' . $p['paternal_surname'] . ' ' . ($p['maternal_surname'] ?? '')),
            'folio_paciente' => $p['file_number'],
            'fecha_nacimiento' => $p['birth_date'],
            'episodios' => $episodes,
        ];
    }

    if (!$out) {
        return [
            'encontrado' => false,
            'mensaje' => $studyFilter !== ''
                ? 'Se encontraron pacientes con ese nombre, pero ninguno con ese estudio en sus episodios visibles.'
                : 'Se encontraron pacientes con ese nombre, pero ninguno con episodios visibles para este usuario.',
        ];
    }
    return ['encontrado' => true, 'pacientes' => $out];
}

/**
 * Minúsculas y sin acentos, para comparar texto que puede venir de una
 * transcripción de voz (mismo criterio que lab_slug() en lab_catalog.php).
 */
function assistant_fold(string $s): string
{
    $s = mb_strtolower(trim($s), 'UTF-8');
    return strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
}

/** ¿Alguna cadena de la lista contiene la ya normalizada (assistant_fold) que se busca? */
function assistant_any_contains(array $haystack, string $foldedNeedle): bool
{
    foreach ($haystack as $s) {
        if (str_contains(assistant_fold((string)$s), $foldedNeedle)) {
            return true;
        }
    }
    return false;
}
