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
            if (array_key_exists('title', $b)) {
                $t = trim((string)$b['title']);
                $fields['title'] = $t !== '' ? mb_substr($t, 0, 120) : null;
            }
            if (array_key_exists('content', $b)) {
                $fields['content'] = json_encode(board_validate_content($type, $b['content']), JSON_UNESCAPED_UNICODE);
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

        case 'delete': {
            $b = request_body();
            $item = find_board_item((int)($b['id'] ?? 0));
            require_board_access($item, $me, $canManage);
            db()->prepare('DELETE FROM board_items WHERE id = ?')->execute([$item['id']]);
            log_activity(
                'pizarron', 'item_delete',
                'Eliminó ' . board_type_label($item['type']) . ' del pizarrón ' . ($item['scope'] === 'public' ? 'público' : 'privado'),
                'board_item', (int)$item['id']
            );
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
function board_validate_content(string $type, $content): array
{
    $content = is_array($content) ? $content : [];
    switch ($type) {
        case 'note':
            return ['text' => mb_substr(trim((string)($content['text'] ?? '')), 0, 4000)];

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
