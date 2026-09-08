<?php
/**
 * Handler marketing: calendario de planeación de contenido (Facebook), su
 * portafolio histórico y el asistente de IA que arma un borrador del mes y
 * ayuda a redactar captions. Reutiliza ai_generate() de includes/ai.php tal
 * cual — el mismo cliente multiproveedor que ya usa el Asistente Sirius.
 *
 * Sin integración con Canva ni con Facebook: canva_url es solo un campo de
 * texto (liga al diseño) y "publicada" es un estatus que la propia persona de
 * marketing marca a mano tras publicar manualmente.
 */

require_once __DIR__ . '/../../includes/ai.php';

const MARKETING_MAX_SIZE = 8 * 1024 * 1024;
const MARKETING_DIR = __DIR__ . '/../../uploads/marketing/';
const CONTENT_POST_STATUSES = ['idea', 'diseno', 'programada', 'publicada'];
const CONTENT_POST_CATEGORIES = ['organico', 'ads', 'story', 'efemeride', 'promocion'];
const CONTENT_COLOR_KEYS = ['amber', 'pink', 'sky', 'emerald', 'violet', 'slate', 'indigo', 'rose'];

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

            if ($id > 0) {
                find_content_post($id);
                db()->prepare(
                    'UPDATE content_posts SET post_date=?, title=?, category=?, status=?, caption=?, canva_url=?, emoji=?, color=? WHERE id=?'
                )->execute([$postDate, $title, $category, $status, $caption ?: null, $canvaUrl ?: null, $emoji ?: null, $color, $id]);
                log_activity('marketing', 'post_update', "Actualizó la publicación \"$title\"", 'content_post', $id);
            } else {
                db()->prepare(
                    'INSERT INTO content_posts (post_date, title, category, status, caption, canva_url, emoji, color, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$postDate, $title, $category, $status, $caption ?: null, $canvaUrl ?: null, $emoji ?: null, $color, (int)$me['id']]);
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
                . "\nConversas con la persona de marketing para resolver dudas puntuales o ajustar ideas. Sé breve. "
                . "Si propones una publicación concreta para agregar al calendario, incluye además de tu respuesta "
                . "normal una línea aparte con el formato SUGERENCIA: AAAA-MM-DD | Título | categoria | ángulo.";
            $history = marketing_chat_history($b['history'] ?? [], $message);

            try {
                $reply = ai_generate($history, $systemPrompt, null, 1200);
            } catch (Throwable $e) {
                error_log('marketing chat: ' . $e->getMessage());
                json_error($e->getMessage(), 502);
            }
            log_activity('marketing', 'chat', mb_substr($message, 0, 120));
            json_ok(['reply' => $reply, 'suggestions' => marketing_parse_suggestions($reply, $from, $to)]);
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
        'title'         => $row['title'],
        'category'      => $row['category'],
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

    $st2 = db()->prepare('SELECT post_date, title FROM content_posts WHERE post_date BETWEEN ? AND ? ORDER BY post_date');
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
            $prompt .= "- {$e['post_date']}: {$e['title']}\n";
        }
    }
    return $prompt;
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
