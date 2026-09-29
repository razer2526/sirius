<?php
/**
 * Handler board: pizarrón privado (uno por usuario) y pizarrón público (compartido).
 *
 * En el privado, solo el dueño ve y toca sus notas. En el público cualquiera con
 * acceso al módulo puede agregar elementos; solo quien lo creó (o el flag "manage")
 * puede editarlo, moverlo o borrarlo — así nadie desordena las notas de otro.
 */

const BOARD_TYPES = ['note', 'checklist', 'drawing'];
const BOARD_COLORS = ['amber', 'pink', 'sky', 'emerald', 'violet', 'slate'];
// Claves de tipografía que el editor de notas sabe dibujar (ver board_note_editor.js).
const BOARD_FONTS = ['inter', 'nunito', 'lora', 'playfair', 'merriweather', 'caveat', 'marker', 'mono'];
const BOARD_ALIGNS = ['left', 'center', 'right', 'justify'];
const BOARD_NOTE_MAX_BLOCKS = 200;
const BOARD_NOTE_MAX_RUNS = 300;
const BOARD_NOTE_MAX_CHARS = 20000;
const BOARD_NOTE_MAX_IMAGES = 20;
// Imágenes pegadas en notas: el cliente las reduce antes de subir; este tope es la red de seguridad.
const BOARD_ASSET_MAX_SIZE = 8 * 1024 * 1024;
const BOARD_ASSETS_PER_ITEM = 40;
const BOARD_ASSET_DIR = __DIR__ . '/../../uploads/board/';

function handle_board(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('pizarron', 'manage');

    switch ($action) {
        case 'list': {
            $scope = ($_GET['scope'] ?? '') === 'public' ? 'public' : 'private';
            if ($scope === 'private') {
                $st = db()->prepare('SELECT * FROM board_items WHERE scope = ? AND owner_id = ? ORDER BY z_index, id');
                $st->execute(['private', $me['id']]);
            } else {
                $st = db()->prepare(
                    'SELECT b.*, u.full_name AS creator_name FROM board_items b
                     LEFT JOIN users u ON u.id = b.created_by
                     WHERE b.scope = ? ORDER BY b.z_index, b.id'
                );
                $st->execute(['public']);
            }
            json_ok([
                'scope'      => $scope,
                'can_manage' => $canManage,
                'me'         => (int)$me['id'],
                'items'      => array_map('board_out', $st->fetchAll()),
            ]);
        }

        case 'save': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $item = null;

            if ($id > 0) {
                $item = find_board_item($id);
                require_board_access($item, $me, $canManage);
                $type = $item['type'];       // el tipo no cambia una vez creado
                $scope = $item['scope'];
                $ownerId = $item['owner_id'];
            } else {
                $type = in_array($b['type'] ?? '', BOARD_TYPES, true) ? $b['type'] : null;
                if (!$type) {
                    json_error('Tipo de nota no válido', 422);
                }
                $scope = ($b['scope'] ?? '') === 'public' ? 'public' : 'private';
                $ownerId = $scope === 'private' ? (int)$me['id'] : null;
            }

            $fields = [];
            $clean = null;
            if (array_key_exists('title', $b)) {
                $t = trim((string)$b['title']);
                $fields['title'] = $t !== '' ? mb_substr($t, 0, 120) : null;
            }
            if (array_key_exists('content', $b)) {
                // $id es 0 en una nota nueva: aún no puede tener imágenes.
                $clean = board_validate_content($type, $b['content'], $id);
                $fields['content'] = json_encode($clean, JSON_UNESCAPED_UNICODE);
            }
            if (array_key_exists('color', $b)) {
                $fields['color'] = in_array($b['color'], BOARD_COLORS, true) ? $b['color'] : 'amber';
            }
            foreach (['pos_x', 'pos_y', 'width', 'height', 'z_index'] as $f) {
                if (array_key_exists($f, $b)) {
                    $fields[$f] = max(0, (int)$b[$f]);
                }
            }

            if ($item) {
                if ($fields) {
                    $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($fields)));
                    db()->prepare("UPDATE board_items SET $sets WHERE id = ?")->execute([...array_values($fields), $id]);
                }
                if ($clean !== null && $type === 'note') {
                    board_prune_assets($id, $clean);
                }
                json_ok(['id' => $id]);
            }

            // Elemento nuevo: lo no enviado se completa con un default razonable
            $fields += [
                'title'   => null,
                'content' => json_encode(board_validate_content($type, []), JSON_UNESCAPED_UNICODE),
                'color'   => 'amber',
                'pos_x'   => 40,
                'pos_y'   => 40,
                'width'   => $type === 'drawing' ? 320 : 240,
                'height'  => $type === 'drawing' ? 240 : 200,
                'z_index' => board_next_z($scope, $ownerId),
            ];
            db()->prepare(
                'INSERT INTO board_items (scope, owner_id, type, title, content, color, pos_x, pos_y, width, height, z_index, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $scope, $ownerId, $type,
                $fields['title'], $fields['content'], $fields['color'],
                $fields['pos_x'], $fields['pos_y'], $fields['width'], $fields['height'], $fields['z_index'],
                (int)$me['id'],
            ]);
            $id = (int)db()->lastInsertId();
            log_activity(
                'pizarron', 'item_create',
                'Creó ' . board_type_label($type) . ' en el pizarrón ' . ($scope === 'public' ? 'público' : 'privado'),
                'board_item', $id
            );
            if ($scope === 'public') {
                require_once __DIR__ . '/../../includes/webpush.php';
                notify_module_users(
                    'pizarron', 'Nuevo en el pizarrón',
                    $me['full_name'] . ' agregó ' . board_type_label($type) . ' al pizarrón público.',
                    '#/pizarron', (int)$me['id']
                );
            }
            json_ok(['id' => $id]);
        }

        case 'asset_upload': {
            // Multipart: los datos vienen en $_POST/$_FILES, no en el cuerpo JSON.
            $item = find_board_item((int)($_POST['item_id'] ?? 0));
            require_board_access($item, $me, $canManage);
            if ($item['type'] !== 'note') {
                json_error('Solo las notas admiten imágenes', 422);
            }
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió la imagen', 422);
            }
            $file = $_FILES['file'];
            if ($file['size'] > BOARD_ASSET_MAX_SIZE) {
                json_error('La imagen supera 8 MB', 422);
            }
            // getimagesize lee el contenido real: renombrar un archivo a .png no lo vuelve imagen.
            $allowed = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
            $info = @getimagesize($file['tmp_name']);
            if (!$info || !isset($allowed[$info[2]])) {
                json_error('Solo se aceptan imágenes PNG, JPG, GIF o WEBP', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            if (count(board_item_asset_ids((int)$item['id'], false)) >= BOARD_ASSETS_PER_ITEM) {
                json_error('Esta nota ya tiene demasiadas imágenes', 422);
            }
            if (!is_dir(BOARD_ASSET_DIR)) {
                @mkdir(BOARD_ASSET_DIR, 0775, true);
            }
            $stored = 'img-' . date('YmdHis') . '-' . bin2hex(random_bytes(6)) . '.' . $allowed[$info[2]];
            if (!move_uploaded_file($file['tmp_name'], BOARD_ASSET_DIR . $stored)) {
                json_error('No se pudo guardar la imagen', 500);
            }
            @chmod(BOARD_ASSET_DIR . $stored, 0644);
            db()->prepare('INSERT INTO board_assets (item_id, stored_name, mime, size, created_by) VALUES (?, ?, ?, ?, ?)')
                ->execute([(int)$item['id'], $stored, $info['mime'] ?? 'image/*', (int)$file['size'], (int)$me['id']]);
            $assetId = (int)db()->lastInsertId();
            board_item_asset_ids((int)$item['id'], false, true);
            json_ok(['asset' => ['id' => $assetId, 'url' => 'board_asset.php?id=' . $assetId]]);
        }

        case 'delete': {
            $b = request_body();
            $item = find_board_item((int)($b['id'] ?? 0));
            require_board_access($item, $me, $canManage);
            $scopeLabel = $item['scope'] === 'public' ? 'público' : 'privado';
            if ($canManage) {
                db()->prepare('DELETE FROM board_items WHERE id = ?')->execute([$item['id']]);
                // Solo aquí: la papelera (rama de abajo) conserva los archivos para poder restaurar la nota.
                board_delete_assets((int)$item['id']);
                log_activity(
                    'pizarron', 'item_delete',
                    'Eliminó ' . board_type_label($item['type']) . ' del pizarrón ' . $scopeLabel,
                    'board_item', (int)$item['id']
                );
            } else {
                require_once __DIR__ . '/../../includes/trash.php';
                db()->prepare('DELETE FROM board_items WHERE id = ?')->execute([$item['id']]);
                $typeNoun = ['note' => 'Nota', 'checklist' => 'Lista', 'drawing' => 'Dibujo'][$item['type']] ?? ucfirst($item['type']);
                $summary = $item['title'] ? "{$item['title']} ($typeNoun)" : $typeNoun;
                trash_archive('board_item', (int)$item['id'], $item, null, null, $summary, $me);
                log_activity(
                    'pizarron', 'item_delete',
                    'Movió a la papelera ' . board_type_label($item['type']) . ' del pizarrón ' . $scopeLabel,
                    'board_item', (int)$item['id']
                );
            }
            json_ok();
        }
    }
}

/** Siguiente z-index del tablero (para que lo último tocado quede encima). */
function board_next_z(string $scope, ?int $ownerId): int
{
    if ($scope === 'private') {
        $st = db()->prepare('SELECT COALESCE(MAX(z_index), 0) mx FROM board_items WHERE scope = ? AND owner_id = ?');
        $st->execute(['private', $ownerId]);
    } else {
        $st = db()->query("SELECT COALESCE(MAX(z_index), 0) mx FROM board_items WHERE scope = 'public'");
    }
    return (int)$st->fetch()['mx'] + 1;
}

/**
 * Limita el contenido a lo que cada tipo necesita. Los trazos del dibujo llegan
 * del cliente ya en coordenadas locales de la tarjeta, así que solo se acotan
 * cantidades y rangos (nunca se confía en la forma exacta que mande el navegador).
 */
function board_validate_content(string $type, $content, int $itemId = 0): array
{
    $content = is_array($content) ? $content : [];
    switch ($type) {
        case 'note':
            return board_validate_note($content, $itemId);

        case 'checklist':
            $items = [];
            foreach (array_slice((array)($content['items'] ?? []), 0, 60) as $it) {
                $text = trim((string)(is_array($it) ? ($it['text'] ?? '') : ''));
                if ($text === '') {
                    continue;
                }
                $items[] = ['text' => mb_substr($text, 0, 300), 'done' => !empty($it['done'])];
            }
            return ['items' => $items];

        case 'drawing':
            $strokes = [];
            foreach (array_slice((array)($content['strokes'] ?? []), 0, 300) as $s) {
                if (!is_array($s)) {
                    continue;
                }
                $points = [];
                foreach (array_slice((array)($s['points'] ?? []), 0, 3000) as $p) {
                    if (!is_array($p) || count($p) < 2) {
                        continue;
                    }
                    $points[] = [round((float)$p[0], 1), round((float)$p[1], 1)];
                }
                if (!$points) {
                    continue;
                }
                $strokes[] = [
                    'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string)($s['color'] ?? '')) ? $s['color'] : '#1e293b',
                    'width' => max(1, min(12, (float)($s['width'] ?? 3))),
                    'points' => $points,
                ];
            }
            return ['strokes' => $strokes];
    }
    return [];
}

/**
 * Nota con formato: una lista de bloques (párrafo o renglón de pendiente) hechos
 * de tramos con estilo. El contenido NUNCA es HTML: el cliente arma nodos con
 * textContent y asigna estilos desde estos valores ya acotados, así que una nota
 * en el pizarrón público no puede ejecutar nada en el navegador de quien la mira.
 *
 * Una nota sin la clave "blocks" es del formato anterior ({text}) y se conserva
 * tal cual: un cliente con la versión vieja en caché sigue pudiendo guardarla.
 */
function board_validate_note(array $content, int $itemId = 0): array
{
    if (!array_key_exists('blocks', $content)) {
        return ['text' => mb_substr(trim((string)($content['text'] ?? '')), 0, 4000)];
    }

    $blocks = [];
    $chars = 0;
    $images = 0;
    foreach (array_slice((array)$content['blocks'], 0, BOARD_NOTE_MAX_BLOCKS) as $b) {
        if (!is_array($b)) {
            continue;
        }
        // Una imagen solo se puede referenciar si su archivo se subió A ESTA nota: no se
        // puede colar el id de la imagen de otra (ni del pizarrón privado de alguien más).
        if (($b['t'] ?? '') === 'img') {
            $assetId = (int)($b['asset'] ?? 0);
            if ($assetId > 0 && $images < BOARD_NOTE_MAX_IMAGES && in_array($assetId, board_item_asset_ids($itemId), true)) {
                $blocks[] = ['t' => 'img', 'asset' => $assetId];
                $images++;
            }
            continue;
        }

        $type = $b['t'] ?? 'p';
        if ($type !== 'p' && $type !== 'todo') {
            continue;
        }

        $runs = [];
        foreach (array_slice((array)($b['runs'] ?? []), 0, BOARD_NOTE_MAX_RUNS) as $r) {
            if (!is_array($r) || $chars >= BOARD_NOTE_MAX_CHARS) {
                continue;
            }
            $s = (string)($r['s'] ?? '');
            if ($s === '') {
                continue;
            }
            $s = mb_substr($s, 0, BOARD_NOTE_MAX_CHARS - $chars);
            $chars += mb_strlen($s);

            $run = ['s' => $s];
            foreach (['b', 'i', 'u'] as $flag) {
                if (!empty($r[$flag])) {
                    $run[$flag] = true;
                }
            }
            if (isset($r['c']) && preg_match('/^#[0-9a-fA-F]{6}$/', (string)$r['c'])) {
                $run['c'] = strtolower($r['c']);
            }
            if (isset($r['f']) && in_array($r['f'], BOARD_FONTS, true)) {
                $run['f'] = $r['f'];
            }
            if (isset($r['z']) && is_numeric($r['z'])) {
                $run['z'] = max(8, min(96, (int)round((float)$r['z'])));
            }
            $runs[] = $run;
        }

        $block = [
            't'     => $type,
            'align' => in_array($b['align'] ?? '', BOARD_ALIGNS, true) ? $b['align'] : 'left',
            'runs'  => $runs,
        ];
        if ($type === 'todo') {
            $block['done'] = !empty($b['done']);
        }
        $blocks[] = $block;
    }
    return ['v' => 2, 'blocks' => $blocks];
}

/** Ids de las imágenes subidas a una nota (una consulta por petición y nota). */
function board_item_asset_ids(int $itemId, bool $useCache = true, bool $forget = false): array
{
    static $cache = [];
    if ($forget) {
        unset($cache[$itemId]);
        return [];
    }
    if ($itemId <= 0) {
        return [];
    }
    if (!$useCache || !isset($cache[$itemId])) {
        $st = db()->prepare('SELECT id FROM board_assets WHERE item_id = ?');
        $st->execute([$itemId]);
        $cache[$itemId] = array_map('intval', array_column($st->fetchAll(), 'id'));
    }
    return $cache[$itemId];
}

/**
 * Borra las imágenes de una nota que ya no aparecen en su contenido. Solo las de más de un
 * día: una imagen recién subida existe en el servidor unos instantes antes de que el
 * autoguardado la registre en la nota, y un guardado intermedio no debe llevársela.
 */
function board_prune_assets(int $itemId, array $content): void
{
    $used = [];
    foreach ((array)($content['blocks'] ?? []) as $blk) {
        if (is_array($blk) && ($blk['t'] ?? '') === 'img') {
            $used[(int)$blk['asset']] = true;
        }
    }
    $cutoff = date('Y-m-d H:i:s', time() - 86400);
    $st = db()->prepare('SELECT id, stored_name FROM board_assets WHERE item_id = ? AND created_at < ?');
    $st->execute([$itemId, $cutoff]);
    foreach ($st->fetchAll() as $row) {
        if (isset($used[(int)$row['id']])) {
            continue;
        }
        @unlink(BOARD_ASSET_DIR . basename($row['stored_name']));
        db()->prepare('DELETE FROM board_assets WHERE id = ?')->execute([(int)$row['id']]);
    }
}

/** Borrado definitivo de una nota: se van también sus archivos. */
function board_delete_assets(int $itemId): void
{
    $st = db()->prepare('SELECT stored_name FROM board_assets WHERE item_id = ?');
    $st->execute([$itemId]);
    foreach ($st->fetchAll() as $row) {
        @unlink(BOARD_ASSET_DIR . basename($row['stored_name']));
    }
    db()->prepare('DELETE FROM board_assets WHERE item_id = ?')->execute([$itemId]);
}

function board_type_label(string $type): string
{
    return ['note' => 'una nota', 'checklist' => 'una lista', 'drawing' => 'un dibujo'][$type] ?? $type;
}

function board_out(array $row): array
{
    return [
        'id'           => (int)$row['id'],
        'scope'        => $row['scope'],
        'owner_id'     => $row['owner_id'] !== null ? (int)$row['owner_id'] : null,
        'type'         => $row['type'],
        'title'        => $row['title'],
        'content'      => json_decode((string)$row['content'], true) ?: [],
        'color'        => $row['color'],
        'pos_x'        => (int)$row['pos_x'],
        'pos_y'        => (int)$row['pos_y'],
        'width'        => (int)$row['width'],
        'height'       => (int)$row['height'],
        'z_index'      => (int)$row['z_index'],
        'created_by'   => $row['created_by'] !== null ? (int)$row['created_by'] : null,
        'creator_name' => $row['creator_name'] ?? null,
    ];
}

function find_board_item(int $id): array
{
    $st = db()->prepare('SELECT * FROM board_items WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Elemento no encontrado', 404);
    }
    return $row;
}

/** Privado: solo el dueño. Público: quien lo creó o un gestor del pizarrón. */
function require_board_access(array $item, array $me, bool $canManage): void
{
    if ($item['scope'] === 'private') {
        if ((int)$item['owner_id'] !== (int)$me['id']) {
            json_error('Ese elemento pertenece al pizarrón privado de otro usuario', 403);
        }
        return;
    }
    if ((int)$item['created_by'] !== (int)$me['id'] && !$canManage) {
        json_error('Solo quien lo creó (o un gestor del pizarrón) puede modificarlo', 403);
    }
}
