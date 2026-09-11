<?php
/**
 * Handler marketing: calendario de planeación de contenido para redes, su
 * portafolio histórico, la biblioteca de recursos y el copiloto de IA que arma
 * un borrador del mes, redacta captions y propone acciones sobre las
 * publicaciones. Reutiliza ai_generate() de includes/ai.php tal cual — el mismo
 * cliente multiproveedor que ya usa el Asistente Sirius.
 *
 * Sin integración con Canva ni con las plataformas de redes: canva_url es solo
 * una liga al diseño y "publicada" es un estatus que la propia persona de
 * marketing marca a mano. Es una herramienta de organización y planeación, no
 * de publicación ni de métricas.
 */

require_once __DIR__ . '/../../includes/ai.php';

const MARKETING_MAX_SIZE = 8 * 1024 * 1024;
const MARKETING_DIR = __DIR__ . '/../../uploads/marketing/';
const CONTENT_POST_STATUSES = ['idea', 'diseno', 'programada', 'publicada'];
const CONTENT_POST_CATEGORIES = ['organico', 'ads', 'story', 'efemeride', 'promocion'];
const CONTENT_POST_CHANNELS = ['facebook', 'instagram', 'tiktok', 'google_ads'];
const CONTENT_COLOR_KEYS = ['amber', 'pink', 'sky', 'emerald', 'violet', 'slate', 'indigo', 'rose'];

/**
 * Normaliza las redes a la forma que guarda la columna: CSV con comas centinela
 * (",facebook,instagram,"), para que un LIKE futuro no confunda "tiktok" dentro
 * de otro nombre. Cadena vacía = sin red asignada.
 */
function content_channels_in($value): string
{
    $list = is_array($value) ? $value : explode(',', (string)$value);
    $clean = [];
    foreach ($list as $c) {
        $c = trim((string)$c);
        if (in_array($c, CONTENT_POST_CHANNELS, true) && !in_array($c, $clean, true)) {
            $clean[] = $c;
        }
    }
    return $clean ? ',' . implode(',', $clean) . ',' : '';
}

/** CSV con centinelas => arreglo limpio para el cliente. */
function content_channels_out($stored): array
{
    return array_values(array_filter(explode(',', (string)$stored), static fn($c) => $c !== ''));
}

function handle_marketing(string $action): void
{
    $me = current_user();

    switch ($action) {
        case 'posts_list': {
            $from = trim((string)($_GET['from'] ?? ''));
            $to = trim((string)($_GET['to'] ?? ''));
            $status = trim((string)($_GET['status'] ?? ''));
            $category = trim((string)($_GET['category'] ?? ''));
            $where = [];
            $params = [];
            if ($from !== '' && $to !== '') {
                $where[] = 'cp.post_date BETWEEN ? AND ?';
                $params[] = $from;
                $params[] = $to;
            }
            if (in_array($status, CONTENT_POST_STATUSES, true)) {
                $where[] = 'cp.status = ?';
                $params[] = $status;
            }
            if ($category !== '') {
                $where[] = 'cp.category = ?';
                $params[] = $category;
            }
            $sql = 'SELECT cp.*, u.full_name AS creator_name FROM content_posts cp LEFT JOIN users u ON u.id = cp.created_by';
            if ($where) {
                $sql .= ' WHERE ' . implode(' AND ', $where);
            }
            $sql .= ' ORDER BY cp.post_date, cp.id';
            $st = db()->prepare($sql);
            $st->execute($params);
            json_ok(['posts' => array_map('content_post_out', $st->fetchAll())]);
        }

        case 'post_save': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $postDate = trim((string)($b['post_date'] ?? ''));
            $title = trim((string)($b['title'] ?? ''));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $postDate)) {
                json_error('Fecha no válida', 422);
            }
            if ($title === '') {
                json_error('El título es obligatorio', 422);
            }
            $category = in_array($b['category'] ?? '', CONTENT_POST_CATEGORIES, true) ? $b['category'] : 'organico';
            $status = in_array($b['status'] ?? '', CONTENT_POST_STATUSES, true) ? $b['status'] : 'idea';
            $caption = mb_substr(trim((string)($b['caption'] ?? '')), 0, 4000);
            $canvaUrl = mb_substr(trim((string)($b['canva_url'] ?? '')), 0, 500);
            // Cabe un emoji o un ícono de Bootstrap con prefijo "bi:nombre-del-icono" (ver marketing.js)
            $emoji = mb_substr(trim((string)($b['emoji'] ?? '')), 0, 40);
            $color = in_array($b['color'] ?? '', CONTENT_COLOR_KEYS, true) ? $b['color'] : 'sky';
            $title = mb_substr($title, 0, 150);
            $channels = content_channels_in($b['channels'] ?? []);
            $postTime = trim((string)($b['post_time'] ?? ''));
            if ($postTime !== '' && !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $postTime)) {
                json_error('Hora no válida', 422);
            }
            $postTime = $postTime === '' ? null : mb_substr($postTime, 0, 5) . ':00';

            if ($id > 0) {
                find_content_post($id);
                db()->prepare(
                    'UPDATE content_posts SET post_date=?, post_time=?, title=?, category=?, channels=?, status=?, caption=?, canva_url=?, emoji=?, color=? WHERE id=?'
                )->execute([$postDate, $postTime, $title, $category, $channels, $status, $caption ?: null, $canvaUrl ?: null, $emoji ?: null, $color, $id]);
                log_activity('marketing', 'post_update', "Actualizó la publicación \"$title\"", 'content_post', $id);
            } else {
                db()->prepare(
                    'INSERT INTO content_posts (post_date, post_time, title, category, channels, status, caption, canva_url, emoji, color, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$postDate, $postTime, $title, $category, $channels, $status, $caption ?: null, $canvaUrl ?: null, $emoji ?: null, $color, (int)$me['id']]);
                $id = (int)db()->lastInsertId();
                log_activity('marketing', 'post_create', "Creó la publicación \"$title\"", 'content_post', $id);
            }
            json_ok(['post' => content_post_out(find_content_post($id))]);
        }

        case 'post_delete': {
            $id = (int)(request_body()['id'] ?? 0);
            $post = find_content_post($id);
            if ($post['thumbnail_file']) {
                @unlink(MARKETING_DIR . basename($post['thumbnail_file']));
            }
            db()->prepare('DELETE FROM content_posts WHERE id = ?')->execute([$id]);
            log_activity('marketing', 'post_delete', "Eliminó la publicación \"{$post['title']}\"", 'content_post', $id);
            json_ok();
        }

        /** Miniatura de referencia (opcional): la publicación final siempre vive en Canva. */
        case 'thumbnail_upload': {
            $id = (int)($_POST['id'] ?? 0);
            $post = find_content_post($id);
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió la imagen', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > MARKETING_MAX_SIZE) {
                json_error('La imagen supera 8 MB', 422);
            }
            $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
            $info = @getimagesize($file['tmp_name']);
            if (!$info || !isset($allowed[$info[2]])) {
                json_error('Solo se aceptan imágenes PNG, JPG, GIF o WEBP', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            if (!is_dir(MARKETING_DIR)) {
                @mkdir(MARKETING_DIR, 0775, true);
            }
            $name = 'thumb-' . date('YmdHis') . '-' . bin2hex(random_bytes(6)) . '.' . $allowed[$info[2]];
            if (!move_uploaded_file($file['tmp_name'], MARKETING_DIR . $name)) {
                json_error('No se pudo guardar la imagen', 500);
            }
            @chmod(MARKETING_DIR . $name, 0644);
            if ($post['thumbnail_file']) {
                @unlink(MARKETING_DIR . basename($post['thumbnail_file']));
            }
            db()->prepare('UPDATE content_posts SET thumbnail_file = ? WHERE id = ?')->execute([$name, $id]);
            json_ok(['post' => content_post_out(find_content_post($id))]);
        }

        /* ---- Biblioteca de recursos ---- */
        case 'assets_list': {
            $st = db()->query('SELECT * FROM marketing_assets ORDER BY created_at DESC, id DESC');
            json_ok(['assets' => array_map('marketing_asset_out', $st->fetchAll())]);
        }

        case 'asset_upload': {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió la imagen', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > MARKETING_MAX_SIZE) {
                json_error('La imagen supera 8 MB', 422);
            }
            $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
            $info = @getimagesize($file['tmp_name']);
            if (!$info || !isset($allowed[$info[2]])) {
                json_error('Solo se aceptan imágenes PNG, JPG, GIF o WEBP', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            if (!is_dir(MARKETING_DIR)) {
                @mkdir(MARKETING_DIR, 0775, true);
            }
            $stored = 'asset-' . date('YmdHis') . '-' . bin2hex(random_bytes(6)) . '.' . $allowed[$info[2]];
            if (!move_uploaded_file($file['tmp_name'], MARKETING_DIR . $stored)) {
                json_error('No se pudo guardar la imagen', 500);
            }
            @chmod(MARKETING_DIR . $stored, 0644);
            $name = mb_substr(trim((string)($_POST['name'] ?? $file['name'])), 0, 150) ?: $stored;
            db()->prepare('INSERT INTO marketing_assets (name, stored_name, mime, size, created_by) VALUES (?, ?, ?, ?, ?)')
                ->execute([$name, $stored, $info['mime'] ?? 'image/*', (int)$file['size'], (int)$me['id']]);
            $assetId = (int)db()->lastInsertId();
            log_activity('marketing', 'asset_upload', "Subió el recurso \"$name\"", 'marketing_asset', $assetId);
            $st = db()->prepare('SELECT * FROM marketing_assets WHERE id = ?');
            $st->execute([$assetId]);
            json_ok(['asset' => marketing_asset_out($st->fetch())]);
        }

        case 'asset_delete': {
            $assetId = (int)(request_body()['id'] ?? 0);
            $st = db()->prepare('SELECT * FROM marketing_assets WHERE id = ?');
            $st->execute([$assetId]);
            $asset = $st->fetch();
            if (!$asset) {
                json_error('Recurso no encontrado', 404);
            }
            @unlink(MARKETING_DIR . basename($asset['stored_name']));
            db()->prepare('DELETE FROM marketing_assets WHERE id = ?')->execute([$assetId]);
            log_activity('marketing', 'asset_delete', "Eliminó el recurso \"{$asset['name']}\"", 'marketing_asset', $assetId);
            json_ok();
        }

        /* ---- Catálogo de fechas conmemorativas ---- */
        case 'commemorative_dates_list': {
            $month = (int)($_GET['month'] ?? 0);
            if ($month >= 1 && $month <= 12) {
                $st = db()->prepare('SELECT * FROM commemorative_dates WHERE month = ? ORDER BY day');
                $st->execute([$month]);
            } else {
                $st = db()->query('SELECT * FROM commemorative_dates ORDER BY month, day');
            }
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['month'] = (int)$r['month'];
                $r['day'] = (int)$r['day'];
            }
            unset($r);
            json_ok(['dates' => $rows]);
        }

        case 'commemorative_date_save': {
            if (!is_admin_role($me)) {
                json_error('Esta acción requiere rol de administrador', 403);
            }
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $month = (int)($b['month'] ?? 0);
            $day = (int)($b['day'] ?? 0);
            $label = trim((string)($b['label'] ?? ''));
            if ($month < 1 || $month > 12 || $day < 1 || $day > 31 || $label === '') {
                json_error('Completa mes, día y etiqueta', 422);
            }
            $emoji = mb_substr(trim((string)($b['emoji_suggestion'] ?? '')), 0, 8);
            $category = trim((string)($b['category'] ?? ''));
            $label = mb_substr($label, 0, 150);
            if ($id > 0) {
                db()->prepare('UPDATE commemorative_dates SET month=?, day=?, label=?, emoji_suggestion=?, category=? WHERE id=?')
                    ->execute([$month, $day, $label, $emoji ?: null, $category ?: null, $id]);
            } else {
                db()->prepare('INSERT INTO commemorative_dates (month, day, label, emoji_suggestion, category) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$month, $day, $label, $emoji ?: null, $category ?: null]);
                $id = (int)db()->lastInsertId();
            }
            log_activity('marketing', 'commemorative_date_save', "Guardó la fecha conmemorativa \"$label\"");
            json_ok(['id' => $id]);
        }

        case 'commemorative_date_delete': {
            if (!is_admin_role($me)) {
                json_error('Esta acción requiere rol de administrador', 403);
            }
            db()->prepare('DELETE FROM commemorative_dates WHERE id = ?')->execute([(int)(request_body()['id'] ?? 0)]);
            json_ok();
        }

        /* ---- Asistente de IA ---- */

        /** Un clic arma un borrador del mes: crea publicaciones en estado "idea"
         *  en los días vacíos, priorizando las fechas conmemorativas del mes. */
        case 'generate_month_draft': {
            $b = request_body();
            $year = (int)($b['year'] ?? date('Y'));
            $month = (int)($b['month'] ?? date('n'));
            if ($month < 1 || $month > 12) {
                json_error('Mes no válido', 422);
            }
            [$from, $to, , $commemorative, $existing] = marketing_month_context($year, $month);
            $systemPrompt = marketing_system_prompt_month($year, $month, $commemorative, $existing)
                . "\nGenera entre 6 y 10 ideas de publicaciones para los días de ese mes que aún no tienen nada "
                . "planeado, priorizando las fechas conmemorativas listadas arriba y completando con contenido "
                . "genérico de salud/bienestar donde no haya una fecha especial. Responde SOLO con líneas en este "
                . "formato exacto, una idea por línea, sin texto antes ni después ni numeración:\n"
                . "SUGERENCIA: AAAA-MM-DD | Título breve | categoria | ángulo o mensaje clave en una frase\n"
                . 'La "categoria" debe ser una de: ' . implode(', ', CONTENT_POST_CATEGORIES) . '.';

            try {
                $reply = ai_generate([['role' => 'user', 'text' => 'Genera el borrador de contenido del mes.']], $systemPrompt, null, 1800);
            } catch (Throwable $e) {
                error_log('marketing generate_month_draft: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }

            $existingDates = array_column($existing, 'post_date');
            $created = [];
            foreach (marketing_parse_suggestions($reply, $from, $to) as $s) {
                if (in_array($s['post_date'], $existingDates, true)) {
                    continue; // no duplicar un día que ya tiene algo planeado (o ya sugerido en esta misma tanda)
                }
                db()->prepare(
                    'INSERT INTO content_posts (post_date, title, category, status, caption, color, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                )->execute([$s['post_date'], $s['title'], $s['category'], 'idea', $s['angle'], 'sky', (int)$me['id']]);
                $existingDates[] = $s['post_date'];
                $created[] = content_post_out(find_content_post((int)db()->lastInsertId()));
            }
            log_activity('marketing', 'generate_month_draft', 'Generó un borrador de ' . count($created) . " publicación(es) para $month/$year");
            json_ok(['created' => $created]);
        }

        /** Redacta un caption a partir del título/fecha/ángulo de una publicación ya guardada. */
        case 'suggest_caption': {
            $id = (int)(request_body()['id'] ?? 0);
            $post = find_content_post($id);
            $d = date_create($post['post_date']);
            $commem = null;
            if ($d) {
                $st = db()->prepare('SELECT label FROM commemorative_dates WHERE month = ? AND day = ?');
                $st->execute([(int)$d->format('n'), (int)$d->format('j')]);
                $commem = $st->fetch();
            }
            $systemPrompt = 'Eres el redactor de contenido para Facebook del Laboratorio y Clínica Bosques Polanco. '
                . 'Escribes en español, tono cercano y profesional, orientado a salud preventiva. Genera SOLO el '
                . 'texto del caption (sin explicaciones ni comillas), de 3 a 5 líneas, y termina con 2 a 4 hashtags relevantes.';
            $userMsg = "Publicación: \"{$post['title']}\" el {$post['post_date']}"
                . ($commem ? " (fecha conmemorativa: {$commem['label']})" : '')
                . (!empty($post['caption']) ? "\nÁngulo/borrador actual: {$post['caption']}" : '');

            try {
                // 500 se quedaba corto y truncaba el caption a media frase (verificado
                // contra la API real): unas pocas líneas + hashtags en español necesitan
                // más margen del que parece a simple vista.
                $caption = ai_generate([['role' => 'user', 'text' => $userMsg]], $systemPrompt, null, 1000);
            } catch (Throwable $e) {
                error_log('marketing suggest_caption: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }
            json_ok(['caption' => trim($caption)]);
        }

        /** Chat libre para ajustes puntuales — mismo patrón sin persistir historial que Asistente Sirius. */
        case 'chat': {
            $b = request_body();
            $message = trim((string)($b['message'] ?? ''));
            if ($message === '') {
                json_error('Mensaje vacío', 422);
            }
            $year = (int)($b['year'] ?? date('Y'));
            $month = (int)($b['month'] ?? date('n'));
            if ($month < 1 || $month > 12) {
                json_error('Mes no válido', 422);
            }
            [$from, $to, , $commemorative, $existing] = marketing_month_context($year, $month);
            $systemPrompt = marketing_system_prompt_month($year, $month, $commemorative, $existing)
                . "\nConversas con la persona de marketing para resolver dudas puntuales o ajustar ideas. Sé breve."
                . marketing_actions_prompt();
            $history = marketing_chat_history($b['history'] ?? [], $message);

            try {
                $reply = ai_generate($history, $systemPrompt, null, 1200);
            } catch (Throwable $e) {
                error_log('marketing chat: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }
            log_activity('marketing', 'chat', mb_substr($message, 0, 120));
            // SUGERENCIA: se sigue aceptando como alias de "ACCION: crear" — es el
            // formato que aún usa el prompt de generate_month_draft.
            $legacy = array_map(static fn($s) => [
                'verb' => 'crear', 'post_date' => $s['post_date'], 'title' => $s['title'],
                'category' => $s['category'], 'channels' => [], 'angle' => $s['angle'],
                'label' => "Agregar \"" . mb_substr($s['title'], 0, 60) . "\" el {$s['post_date']}",
            ], marketing_parse_suggestions($reply, $from, $to));

            json_ok([
                'reply'   => $reply,
                'actions' => array_merge(marketing_parse_actions($reply, $existing), $legacy),
            ]);
        }
    }
}

/* ================= Datos ================= */

function find_content_post(int $id): array
{
    $st = db()->prepare('SELECT * FROM content_posts WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Publicación no encontrada', 404);
    }
    return $row;
}

function content_post_out(array $row): array
{
    return [
        'id'            => (int)$row['id'],
        'post_date'     => $row['post_date'],
        'post_time'     => $row['post_time'] ?? null,
        'title'         => $row['title'],
        'category'      => $row['category'],
        'channels'      => content_channels_out($row['channels'] ?? ''),
        'status'        => $row['status'],
        'caption'       => $row['caption'],
        'canva_url'     => $row['canva_url'],
        'thumbnail_url' => $row['thumbnail_file'] ? 'marketing_asset.php?id=' . $row['id'] : null,
        'emoji'         => $row['emoji'],
        'color'         => $row['color'],
        'creator_name'  => $row['creator_name'] ?? null,
        'created_at'    => $row['created_at'],
        'updated_at'    => $row['updated_at'],
    ];
}

function marketing_asset_out(array $row): array
{
    return [
        'id'         => (int)$row['id'],
        'name'       => $row['name'],
        'url'        => 'marketing_asset.php?asset=' . (int)$row['id'],
        'mime'       => $row['mime'],
        'size'       => (int)$row['size'],
        'created_at' => $row['created_at'],
    ];
}

/* ================= IA ================= */

/** [$from, $to, $lastDay, $commemorativeRows, $existingPostsRows] del mes pedido. */
function marketing_month_context(int $year, int $month): array
{
    $mm = str_pad((string)$month, 2, '0', STR_PAD_LEFT);
    $from = "$year-$mm-01";
    $lastDay = (int)date('t', strtotime($from));
    $to = "$year-$mm-" . str_pad((string)$lastDay, 2, '0', STR_PAD_LEFT);

    $st = db()->prepare('SELECT day, label, emoji_suggestion FROM commemorative_dates WHERE month = ? ORDER BY day');
    $st->execute([$month]);
    $commemorative = $st->fetchAll();

    // El id va incluido a propósito: los verbos mover/estado/caption del copiloto
    // operan sobre publicaciones concretas, y sin el id el modelo se los inventaría.
    $st2 = db()->prepare('SELECT id, post_date, title, status FROM content_posts WHERE post_date BETWEEN ? AND ? ORDER BY post_date');
    $st2->execute([$from, $to]);
    $existing = $st2->fetchAll();

    return [$from, $to, $lastDay, $commemorative, $existing];
}

/** Contexto compartido por generate_month_draft y chat: fechas conmemorativas + lo ya planeado ese mes. */
function marketing_system_prompt_month(int $year, int $month, array $commemorative, array $existing): string
{
    $monthNames = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    $prompt = 'Eres un asistente de planeación de contenido para Facebook del Laboratorio y Clínica Bosques Polanco '
        . "(laboratorio clínico y clínica de especialidades médicas). Ayudas a la persona de marketing a decidir "
        . "qué publicar, con un tono profesional pero cercano, enfocado en salud preventiva y bienestar. Respondes en español.\n\n";
    $prompt .= "MES: {$monthNames[$month]} $year\n\n";
    $prompt .= "FECHAS CONMEMORATIVAS DE ESE MES:\n";
    foreach ($commemorative as $c) {
        $prompt .= "- Día {$c['day']}: {$c['label']}" . ($c['emoji_suggestion'] ? ' ' . $c['emoji_suggestion'] : '') . "\n";
    }
    if ($existing) {
        $prompt .= "\nPUBLICACIONES YA PLANEADAS ESE MES (no las repitas ni sugieras esas mismas fechas):\n";
        foreach ($existing as $e) {
            $prompt .= "- [id {$e['id']}] {$e['post_date']} ({$e['status']}): {$e['title']}\n";
        }
    }
    return $prompt;
}

/** Gramática de acciones que el copiloto puede proponer. Nada se aplica solo: cada
 *  línea válida se convierte en un botón que la persona presiona — misma regla que
 *  ya sigue assistant_tools.php, donde las herramientas del modelo son de solo
 *  lectura justamente para no tener que confirmar. */
function marketing_actions_prompt(): string
{
    $cats = implode('|', CONTENT_POST_CATEGORIES);
    $chans = implode('|', CONTENT_POST_CHANNELS);
    $states = implode('|', CONTENT_POST_STATUSES);
    return "\nTú NO puedes aplicar cambios: solo los PROPONES, y la persona decide si los acepta con un botón.\n"
        . "Nunca digas que ya hiciste, moviste o cambiaste algo — di que lo propones o lo sugieres.\n"
        . "CUANDO PROPONGAS CAMBIOS CONCRETOS, escríbelos como líneas sueltas con este formato exacto,\n"
        . "además de tu respuesta normal en texto. Usa solo ids que aparezcan arriba:\n"
        . "ACCION: crear | AAAA-MM-DD | Título | $cats | redes separadas por coma ($chans) | ángulo breve\n"
        . "ACCION: mover | id | AAAA-MM-DD\n"
        . "ACCION: estado | id | $states\n"
        . "ACCION: caption | id | el texto del caption en una sola línea\n";
}

/**
 * Extrae las acciones propuestas. Lo que no valide (verbo desconocido, id que no
 * existe, enum fuera de catálogo) se ignora y se queda como texto plano: nunca se
 * convierte en un botón que prometa algo que fallaría al presionarlo.
 */
function marketing_parse_actions(string $text, array $existing): array
{
    $byId = [];
    foreach ($existing as $e) {
        $byId[(int)$e['id']] = $e;
    }
    $out = [];
    foreach (explode("\n", $text) as $line) {
        $line = trim($line);
        if (stripos($line, 'ACCION:') !== 0) {
            continue;
        }
        $parts = array_map('trim', explode('|', trim(substr($line, strlen('ACCION:')))));
        $verb = strtolower(array_shift($parts) ?? '');

        if ($verb === 'crear' && count($parts) >= 5) {
            [$date, $title, $category, $channels, $angle] = $parts;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $title === '') {
                continue;
            }
            $out[] = [
                'verb'      => 'crear',
                'post_date' => $date,
                'title'     => mb_substr($title, 0, 150),
                'category'  => in_array($category, CONTENT_POST_CATEGORIES, true) ? $category : 'organico',
                'channels'  => content_channels_out(content_channels_in($channels)),
                'angle'     => mb_substr($angle, 0, 500),
                'label'     => "Agregar \"" . mb_substr($title, 0, 60) . "\" el $date",
            ];
            continue;
        }

        $id = (int)($parts[0] ?? 0);
        if (!isset($byId[$id])) {
            continue;
        }
        $title = mb_substr($byId[$id]['title'], 0, 60);

        if ($verb === 'mover' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $parts[1] ?? '')) {
            $out[] = ['verb' => 'mover', 'id' => $id, 'post_date' => $parts[1], 'label' => "Mover \"$title\" al {$parts[1]}"];
        } elseif ($verb === 'estado' && in_array($parts[1] ?? '', CONTENT_POST_STATUSES, true)) {
            $out[] = ['verb' => 'estado', 'id' => $id, 'status' => $parts[1], 'label' => "Marcar \"$title\" como {$parts[1]}"];
        } elseif ($verb === 'caption' && trim($parts[1] ?? '') !== '') {
            $out[] = ['verb' => 'caption', 'id' => $id, 'caption' => mb_substr($parts[1], 0, 4000), 'label' => "Escribir el caption de \"$title\""];
        }
    }
    return $out;
}

/** Extrae las líneas "SUGERENCIA: fecha | título | categoria | ángulo" de una respuesta del modelo. */
function marketing_parse_suggestions(string $text, string $from, string $to): array
{
    $out = [];
    foreach (explode("\n", $text) as $line) {
        $line = trim($line);
        if (stripos($line, 'SUGERENCIA:') !== 0) {
            continue;
        }
        $line = trim(substr($line, strlen('SUGERENCIA:')));
        $parts = array_map('trim', explode('|', $line));
        if (count($parts) < 4) {
            continue;
        }
        [$date, $title, $category, $angle] = [$parts[0], $parts[1], $parts[2], $parts[3]];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $date < $from || $date > $to || $title === '') {
            continue;
        }
        $out[] = [
            'post_date' => $date,
            'title'     => mb_substr($title, 0, 150),
            'category'  => in_array($category, CONTENT_POST_CATEGORIES, true) ? $category : 'organico',
            'angle'     => mb_substr($angle, 0, 4000),
        ];
    }
    return $out;
}

/** Normaliza el historial del chat recibido y agrega el mensaje nuevo (igual que assistant_history()). */
function marketing_chat_history($history, string $message): array
{
    $out = [];
    if (is_array($history)) {
        foreach (array_slice($history, -10) as $turn) {
            $text = trim((string)($turn['text'] ?? ''));
            if ($text !== '') {
                $role = ($turn['role'] ?? 'user') === 'assistant' ? 'assistant' : 'user';
                $out[] = ['role' => $role, 'text' => mb_substr($text, 0, 4000)];
            }
        }
    }
    $out[] = ['role' => 'user', 'text' => mb_substr($message, 0, 4000)];
    return $out;
}
