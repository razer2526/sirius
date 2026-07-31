<?php
/**
 * Handler files: gestor de archivos privado por usuario + carpeta compartida.
 *
 * Los archivos se guardan en disco con nombre aleatorio bajo uploads/archivos/
 * (acceso bloqueado por .htaccess); solo se sirven a través de archivo.php, que
 * verifica sesión y permisos antes de leer un solo byte.
 *
 * Permisos: en lo privado, solo el dueño toca sus carpetas/archivos. En lo público,
 * cualquiera con acceso al módulo sube y organiza lo suyo (crear/renombrar/mover),
 * pero **eliminar del compartido requiere el flag "delete_shared" (o ser admin)**,
 * incluso sobre tu propia subida — así nadie borra sin autorización el trabajo de otros.
 */

const FILE_MAX_SIZE = 25 * 1024 * 1024;
const FILE_COPY_LIMIT = 300;
const FILES_DIR = __DIR__ . '/../../uploads/archivos/';

function handle_files(string $action): void
{
    $me = current_user();
    $canManage = is_admin_role($me) || user_flag('archivos', 'delete_shared');

    switch ($action) {
        case 'list': {
            $scope = ($_GET['scope'] ?? '') === 'public' ? 'public' : 'private';
            $ownerId = $scope === 'private' ? (int)$me['id'] : null;
            $folderId = isset($_GET['folder_id']) && $_GET['folder_id'] !== '' ? (int)$_GET['folder_id'] : null;

            $breadcrumb = $folderId !== null ? file_breadcrumb($folderId, $scope, $ownerId) : [];
            json_ok([
                'scope'       => $scope,
                'folder_id'   => $folderId,
                'can_manage'  => $canManage,
                'me'          => (int)$me['id'],
                'breadcrumb'  => $breadcrumb,
                'folders'     => fetch_folders($scope, $ownerId, $folderId),
                'files'       => fetch_files($scope, $ownerId, $folderId),
                'used_bytes'  => file_used_bytes($scope, $ownerId),
            ]);
        }

        /* ---- Carpetas ---- */
        case 'folder_create': {
            $b = request_body();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre es obligatorio', 422);
            }
            $scope = ($b['scope'] ?? '') === 'public' ? 'public' : 'private';
            $ownerId = $scope === 'private' ? (int)$me['id'] : null;
            $parentId = isset($b['parent_id']) && $b['parent_id'] !== '' ? (int)$b['parent_id'] : null;
            if ($parentId !== null) {
                find_folder($parentId, $scope, $ownerId);
            }
            db()->prepare('INSERT INTO file_folders (scope, owner_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?)')
                ->execute([$scope, $ownerId, $parentId, mb_substr($name, 0, 150), (int)$me['id']]);
            $id = (int)db()->lastInsertId();
            log_activity('archivos', 'folder_create', "Creó la carpeta \"$name\"" . ($scope === 'public' ? ' en lo compartido' : ''), 'file_folder', $id);
            json_ok(['id' => $id]);
        }

        case 'folder_rename': {
            $b = request_body();
            $folder = find_folder_by_id((int)($b['id'] ?? 0));
            require_file_edit($folder, $me, $canManage);
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre es obligatorio', 422);
            }
            db()->prepare('UPDATE file_folders SET name = ? WHERE id = ?')->execute([mb_substr($name, 0, 150), $folder['id']]);
            json_ok(['id' => (int)$folder['id']]);
        }

        case 'folder_move': {
            $b = request_body();
            $folder = find_folder_by_id((int)($b['id'] ?? 0));
            require_file_edit($folder, $me, $canManage);
            $targetId = isset($b['parent_id']) && $b['parent_id'] !== '' ? (int)$b['parent_id'] : null;
            if ($targetId !== null) {
                find_folder($targetId, $folder['scope'], $folder['owner_id'] !== null ? (int)$folder['owner_id'] : null);
                if ($targetId === (int)$folder['id'] || folder_is_descendant($targetId, (int)$folder['id'])) {
                    json_error('No puedes mover una carpeta dentro de sí misma', 422);
                }
            }
            db()->prepare('UPDATE file_folders SET parent_id = ? WHERE id = ?')->execute([$targetId, $folder['id']]);
            json_ok(['id' => (int)$folder['id']]);
        }

        case 'folder_delete': {
            $folder = find_folder_by_id((int)(request_body()['id'] ?? 0));
            require_file_delete($folder, $me, $canManage);
            file_delete_folder_tree((int)$folder['id']);
            log_activity('archivos', 'folder_delete', "Eliminó la carpeta \"{$folder['name']}\"", 'file_folder', (int)$folder['id']);
            json_ok();
        }

        /* ---- Archivos ---- */
        case 'file_upload': {
            if (empty($_FILES['file'])) {
                json_error('No se recibió el archivo', 422);
            }
            $file = $_FILES['file'];
            // PHP rechaza a nivel de servidor (upload_max_filesize/post_max_size) antes de que
            // el archivo llegue aquí; ambos casos deben dar el mismo mensaje claro al usuario.
            if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                json_error('El archivo supera el límite de 25 MB', 422);
            }
            if ($file['error'] !== UPLOAD_ERR_OK) {
                json_error('No se recibió el archivo', 422);
            }
            if ($file['size'] > FILE_MAX_SIZE) {
                json_error('El archivo supera el límite de 25 MB', 422);
            }
            if (!is_uploaded_file($file['tmp_name'])) {
                json_error('Subida no válida', 422);
            }
            $scope = ($_POST['scope'] ?? '') === 'public' ? 'public' : 'private';
            $ownerId = $scope === 'private' ? (int)$me['id'] : null;
            $folderId = isset($_POST['folder_id']) && $_POST['folder_id'] !== '' ? (int)$_POST['folder_id'] : null;
            if ($folderId !== null) {
                find_folder($folderId, $scope, $ownerId);
            }

            if (!is_dir(FILES_DIR)) {
                @mkdir(FILES_DIR, 0775, true);
            }
            $storedName = bin2hex(random_bytes(20));
            if (!move_uploaded_file($file['tmp_name'], FILES_DIR . $storedName)) {
                json_error('No se pudo guardar el archivo', 500);
            }
            @chmod(FILES_DIR . $storedName, 0644);
            $mime = @mime_content_type(FILES_DIR . $storedName) ?: 'application/octet-stream';
            $name = mb_substr(trim((string)($file['name'] ?? '')), 0, 200);
            if ($name === '') {
                $name = 'archivo';
            }

            db()->prepare(
                'INSERT INTO files (scope, owner_id, folder_id, name, stored_name, mime, size, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$scope, $ownerId, $folderId, $name, $storedName, $mime, (int)$file['size'], (int)$me['id']]);
            $id = (int)db()->lastInsertId();
            log_activity('archivos', 'file_upload', "Subió \"$name\"" . ($scope === 'public' ? ' a la carpeta compartida' : ''), 'file', $id);
            json_ok(['id' => $id]);
        }

        case 'file_rename': {
            $b = request_body();
            $file = find_file_by_id((int)($b['id'] ?? 0));
            require_file_edit($file, $me, $canManage);
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') {
                json_error('El nombre es obligatorio', 422);
            }
            db()->prepare('UPDATE files SET name = ? WHERE id = ?')->execute([mb_substr($name, 0, 200), $file['id']]);
            json_ok(['id' => (int)$file['id']]);
        }

        case 'file_move': {
            $b = request_body();
            $file = find_file_by_id((int)($b['id'] ?? 0));
            require_file_edit($file, $me, $canManage);
            $targetId = isset($b['folder_id']) && $b['folder_id'] !== '' ? (int)$b['folder_id'] : null;
            if ($targetId !== null) {
                find_folder($targetId, $file['scope'], $file['owner_id'] !== null ? (int)$file['owner_id'] : null);
            }
            db()->prepare('UPDATE files SET folder_id = ? WHERE id = ?')->execute([$targetId, $file['id']]);
            json_ok(['id' => (int)$file['id']]);
        }

        case 'file_delete': {
            $file = find_file_by_id((int)(request_body()['id'] ?? 0));
            require_file_delete($file, $me, $canManage);
            @unlink(FILES_DIR . $file['stored_name']);
            db()->prepare('DELETE FROM files WHERE id = ?')->execute([$file['id']]);
            log_activity('archivos', 'file_delete', "Eliminó \"{$file['name']}\"", 'file', (int)$file['id']);
            json_ok();
        }

        /* ---- Copiar y compartir ---- */
        case 'copy': {
            $b = request_body();
            $type = ($b['type'] ?? '') === 'folder' ? 'folder' : 'file';
            $targetScope = ($b['target_scope'] ?? '') === 'public' ? 'public' : 'private';
            $targetOwnerId = $targetScope === 'private' ? (int)$me['id'] : null;
            $targetFolderId = isset($b['target_folder_id']) && $b['target_folder_id'] !== '' ? (int)$b['target_folder_id'] : null;
            if ($targetFolderId !== null) {
                find_folder($targetFolderId, $targetScope, $targetOwnerId);
            }
            $newId = file_perform_copy($type, (int)($b['id'] ?? 0), $me, $targetScope, $targetOwnerId, $targetFolderId);
            json_ok(['id' => $newId]);
        }

        case 'share': {
            $b = request_body();
            $type = ($b['type'] ?? '') === 'folder' ? 'folder' : 'file';
            $newId = file_perform_copy($type, (int)($b['id'] ?? 0), $me, 'public', null, null);
            log_activity('archivos', 'share', 'Compartió a la carpeta pública', $type === 'folder' ? 'file_folder' : 'file', $newId);
            json_ok(['id' => $newId]);
        }
    }
}

/* ================= Consultas ================= */

/** Fragmento SQL NULL-seguro: agrega el parámetro a $params solo si $val no es null. */
function null_clause(string $col, ?int $val, array &$params): string
{
    if ($val === null) {
        return "$col IS NULL";
    }
    $params[] = $val;
    return "$col = ?";
}

function fetch_folders(string $scope, ?int $ownerId, ?int $folderId): array
{
    $params = [$scope];
    $sql = 'SELECT * FROM file_folders WHERE scope = ? AND ' . null_clause('owner_id', $ownerId, $params)
         . ' AND ' . null_clause('parent_id', $folderId, $params) . ' ORDER BY name';
    $st = db()->prepare($sql);
    $st->execute($params);
    return array_map('folder_out', $st->fetchAll());
}

function fetch_files(string $scope, ?int $ownerId, ?int $folderId): array
{
    $params = [$scope];
    $sql = 'SELECT files.*, u.full_name AS creator_name FROM files
            LEFT JOIN users u ON u.id = files.created_by
            WHERE files.scope = ? AND ' . null_clause('files.owner_id', $ownerId, $params)
          . ' AND ' . null_clause('files.folder_id', $folderId, $params) . ' ORDER BY files.name';
    $st = db()->prepare($sql);
    $st->execute($params);
    return array_map('file_out', $st->fetchAll());
}

function file_used_bytes(string $scope, ?int $ownerId): int
{
    $params = [$scope];
    $sql = 'SELECT COALESCE(SUM(size), 0) s FROM files WHERE scope = ? AND ' . null_clause('owner_id', $ownerId, $params);
    $st = db()->prepare($sql);
    $st->execute($params);
    return (int)$st->fetch()['s'];
}

/** Carpeta validada contra el scope/dueño pedido; 404 si no existe o no le pertenece. */
function find_folder(int $id, string $scope, ?int $ownerId): array
{
    $params = [$id, $scope];
    $sql = 'SELECT * FROM file_folders WHERE id = ? AND scope = ? AND ' . null_clause('owner_id', $ownerId, $params);
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    if (!$row) {
        json_error('Carpeta no encontrada', 404);
    }
    return $row;
}

function find_folder_by_id(int $id): array
{
    $st = db()->prepare('SELECT * FROM file_folders WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Carpeta no encontrada', 404);
    }
    return $row;
}

function find_file_by_id(int $id): array
{
    $st = db()->prepare('SELECT * FROM files WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        json_error('Archivo no encontrado', 404);
    }
    return $row;
}

/** Ruta de carpetas desde la raíz hasta $folderId (para el breadcrumb). */
function file_breadcrumb(int $folderId, string $scope, ?int $ownerId): array
{
    find_folder($folderId, $scope, $ownerId); // valida que sea del scope/dueño correcto
    $crumbs = [];
    $current = $folderId;
    $guard = 0;
    while ($current !== null && $guard++ < 50) {
        $st = db()->prepare('SELECT id, name, parent_id FROM file_folders WHERE id = ?');
        $st->execute([$current]);
        $row = $st->fetch();
        if (!$row) {
            break;
        }
        array_unshift($crumbs, ['id' => (int)$row['id'], 'name' => $row['name']]);
        $current = $row['parent_id'] !== null ? (int)$row['parent_id'] : null;
    }
    return $crumbs;
}

/** ¿$candidateId está dentro del árbol de $ancestorId (o es el mismo)? */
function folder_is_descendant(int $candidateId, int $ancestorId): bool
{
    $current = $candidateId;
    $guard = 0;
    while ($guard++ < 500) {
        if ($current === $ancestorId) {
            return true;
        }
        $st = db()->prepare('SELECT parent_id FROM file_folders WHERE id = ?');
        $st->execute([$current]);
        $row = $st->fetch();
        if (!$row || $row['parent_id'] === null) {
            return false;
        }
        $current = (int)$row['parent_id'];
    }
    return false;
}

function folder_out(array $row): array
{
    return [
        'id'         => (int)$row['id'],
        'type'       => 'folder',
        'name'       => $row['name'],
        'parent_id'  => $row['parent_id'] !== null ? (int)$row['parent_id'] : null,
        'created_by' => $row['created_by'] !== null ? (int)$row['created_by'] : null,
        'updated_at' => $row['updated_at'],
    ];
}

function file_out(array $row): array
{
    return [
        'id'           => (int)$row['id'],
        'type'         => 'file',
        'name'         => $row['name'],
        'mime'         => $row['mime'],
        'size'         => (int)$row['size'],
        'folder_id'    => $row['folder_id'] !== null ? (int)$row['folder_id'] : null,
        'created_by'   => $row['created_by'] !== null ? (int)$row['created_by'] : null,
        'creator_name' => $row['creator_name'] ?? null,
        'updated_at'   => $row['updated_at'],
    ];
}

/* ================= Permisos ================= */

/** Renombrar o mover: dueño (privado) o autor/gestor (público). */
function require_file_edit(array $row, array $me, bool $canManage): void
{
    if ($row['scope'] === 'private') {
        if ((int)$row['owner_id'] !== (int)$me['id']) {
            json_error('Ese elemento pertenece a la carpeta privada de otro usuario', 403);
        }
        return;
    }
    if ((int)$row['created_by'] !== (int)$me['id'] && !$canManage) {
        json_error('Solo quien lo subió (o un gestor de archivos) puede modificarlo', 403);
    }
}

/** Eliminar: dueño (privado) o gestor de archivos/admin (público) — el autor no basta. */
function require_file_delete(array $row, array $me, bool $canManage): void
{
    if ($row['scope'] === 'private') {
        if ((int)$row['owner_id'] !== (int)$me['id']) {
            json_error('Ese elemento pertenece a la carpeta privada de otro usuario', 403);
        }
        return;
    }
    if (!$canManage) {
        json_error('Solo un administrador puede eliminar archivos de la carpeta compartida', 403);
    }
}

/** Leer/copiar desde el origen: lo privado solo si es tuyo; lo público siempre es visible. */
function require_file_read(array $row, array $me): void
{
    if ($row['scope'] === 'private' && (int)$row['owner_id'] !== (int)$me['id']) {
        json_error('No tienes acceso a ese elemento', 403);
    }
}

/* ================= Borrado en cascada (carpeta) ================= */

/** Borra del disco todos los archivos del árbol antes de eliminar la carpeta raíz
 *  (la base de datos limpia el resto sola vía ON DELETE CASCADE). */
function file_delete_folder_tree(int $folderId): void
{
    $folderIds = [$folderId];
    $queue = [$folderId];
    $guard = 0;
    while ($queue && $guard++ < FILE_COPY_LIMIT * 5) {
        $st = db()->prepare('SELECT id FROM file_folders WHERE parent_id = ?');
        $st->execute([array_shift($queue)]);
        foreach ($st->fetchAll() as $row) {
            $folderIds[] = (int)$row['id'];
            $queue[] = (int)$row['id'];
        }
    }
    $marks = implode(',', array_fill(0, count($folderIds), '?'));
    $st = db()->prepare("SELECT stored_name FROM files WHERE folder_id IN ($marks)");
    $st->execute($folderIds);
    foreach ($st->fetchAll() as $row) {
        @unlink(FILES_DIR . $row['stored_name']);
    }
    db()->prepare('DELETE FROM file_folders WHERE id = ?')->execute([$folderId]);
}

/* ================= Copiar ================= */

function file_perform_copy(string $type, int $id, array $me, string $targetScope, ?int $targetOwnerId, ?int $targetFolderId): int
{
    if ($type === 'file') {
        $file = find_file_by_id($id);
        require_file_read($file, $me);
        return file_copy_single($file, $targetScope, $targetOwnerId, $targetFolderId, (int)$me['id']);
    }

    $folder = find_folder_by_id($id);
    require_file_read($folder, $me);
    $sameOwner = $folder['owner_id'] !== null ? (int)$folder['owner_id'] : null;
    if ($targetFolderId !== null && $targetScope === $folder['scope'] && $targetOwnerId === $sameOwner
        && ($targetFolderId === (int)$folder['id'] || folder_is_descendant($targetFolderId, (int)$folder['id']))) {
        json_error('No puedes copiar una carpeta dentro de sí misma', 422);
    }
    if (file_count_tree((int)$folder['id']) > FILE_COPY_LIMIT) {
        json_error('Esta carpeta tiene demasiados elementos para copiar de una vez (máximo ' . FILE_COPY_LIMIT . ')', 422);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $newId = file_copy_folder_tree((int)$folder['id'], $targetScope, $targetOwnerId, $targetFolderId, (int)$me['id']);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $newId;
}

function file_copy_single(array $file, string $targetScope, ?int $targetOwnerId, ?int $targetFolderId, int $me): int
{
    $newStored = bin2hex(random_bytes(20));
    if (!@copy(FILES_DIR . $file['stored_name'], FILES_DIR . $newStored)) {
        json_error('No se pudo copiar el archivo', 500);
    }
    db()->prepare(
        'INSERT INTO files (scope, owner_id, folder_id, name, stored_name, mime, size, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$targetScope, $targetOwnerId, $targetFolderId, $file['name'], $newStored, $file['mime'], $file['size'], $me]);
    return (int)db()->lastInsertId();
}

function file_copy_folder_tree(int $folderId, string $targetScope, ?int $targetOwnerId, ?int $targetParentId, int $me): int
{
    $st = db()->prepare('SELECT * FROM file_folders WHERE id = ?');
    $st->execute([$folderId]);
    $folder = $st->fetch();

    db()->prepare('INSERT INTO file_folders (scope, owner_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?)')
        ->execute([$targetScope, $targetOwnerId, $targetParentId, $folder['name'], $me]);
    $newFolderId = (int)db()->lastInsertId();

    $st = db()->prepare('SELECT * FROM files WHERE folder_id = ?');
    $st->execute([$folderId]);
    foreach ($st->fetchAll() as $file) {
        file_copy_single($file, $targetScope, $targetOwnerId, $newFolderId, $me);
    }

    $st = db()->prepare('SELECT id FROM file_folders WHERE parent_id = ?');
    $st->execute([$folderId]);
    foreach ($st->fetchAll() as $child) {
        file_copy_folder_tree((int)$child['id'], $targetScope, $targetOwnerId, $newFolderId, $me);
    }
    return $newFolderId;
}

/** Cuenta carpetas + archivos del árbol (incluida la carpeta raíz), para el tope de copiado. */
function file_count_tree(int $folderId): int
{
    $count = 1;
    $queue = [$folderId];
    $guard = 0;
    while ($queue && $guard++ < FILE_COPY_LIMIT * 5) {
        $current = array_shift($queue);
        $st = db()->prepare('SELECT id FROM file_folders WHERE parent_id = ?');
        $st->execute([$current]);
        foreach ($st->fetchAll() as $row) {
            $count++;
            $queue[] = (int)$row['id'];
        }
        $st = db()->prepare('SELECT COUNT(*) c FROM files WHERE folder_id = ?');
        $st->execute([$current]);
        $count += (int)$st->fetch()['c'];
        if ($count > FILE_COPY_LIMIT) {
            return $count;
        }
    }
    return $count;
}
