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

require_once __DIR__ . '/../../includes/trash.php';

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
            if (file_count_tree((int)$folder['id']) > FILE_COPY_LIMIT) {
                json_error('Esta carpeta tiene demasiados elementos para eliminar de una vez (máximo ' . FILE_COPY_LIMIT . ')', 422);
            }
            file_archive_folder_tree($folder, $me);
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
            file_archive_to_trash($file, $me);
            json_ok();
        }

        /** Elimina varios archivos/carpetas de una sola llamada (selección múltiple
         *  en la interfaz). No aborta todo el lote por un solo elemento inválido:
         *  cada uno se procesa por separado y los que fallan se listan en 'errors'. */
        case 'bulk_delete': {
            $b = request_body();
            $items = is_array($b['items'] ?? null) ? $b['items'] : [];
            if (!$items) {
                json_error('No hay elementos seleccionados', 422);
            }
            if (count($items) > FILE_COPY_LIMIT) {
                json_error('Selecciona como máximo ' . FILE_COPY_LIMIT . ' elementos a la vez', 422);
            }
            $deleted = 0;
            $errors = [];
            foreach ($items as $it) {
                $type = ($it['type'] ?? '') === 'folder' ? 'folder' : 'file';
                $id = (int)($it['id'] ?? 0);
                if ($type === 'folder') {
                    $folder = find_folder_by_id_safe($id);
                    if (!$folder) {
                        $errors[] = "Carpeta #$id: no encontrada";
                        continue;
                    }
                    $reason = file_delete_denied_reason($folder, $me, $canManage);
                    if ($reason !== null) {
                        $errors[] = "\"{$folder['name']}\": $reason";
                        continue;
                    }
                    if (file_count_tree($id) > FILE_COPY_LIMIT) {
                        $errors[] = "\"{$folder['name']}\": tiene demasiados elementos";
                        continue;
                    }
                    file_archive_folder_tree($folder, $me);
                } else {
                    $file = find_file_by_id_safe($id);
                    if (!$file) {
                        $errors[] = "Archivo #$id: no encontrado";
                        continue;
                    }
                    $reason = file_delete_denied_reason($file, $me, $canManage);
                    if ($reason !== null) {
                        $errors[] = "\"{$file['name']}\": $reason";
                        continue;
                    }
                    file_archive_to_trash($file, $me);
                }
                $deleted++;
            }
            json_ok(['deleted' => $deleted, 'errors' => $errors]);
        }

        /**
         * Mueve varios archivos/carpetas a una carpeta destino (siempre dentro del
         * mismo scope: mover entre privado y compartido no existe, para eso está
         * "Compartir a lo público"). Como bulk_delete, un elemento inválido no
         * aborta el resto del lote.
         */
        case 'bulk_move': {
            $b = request_body();
            $items = is_array($b['items'] ?? null) ? $b['items'] : [];
            if (!$items) {
                json_error('No hay elementos seleccionados', 422);
            }
            if (count($items) > FILE_COPY_LIMIT) {
                json_error('Selecciona como máximo ' . FILE_COPY_LIMIT . ' elementos a la vez', 422);
            }
            $targetId = isset($b['target_folder_id']) && $b['target_folder_id'] !== '' ? (int)$b['target_folder_id'] : null;

            $moved = 0;
            $errors = [];
            foreach ($items as $it) {
                $type = ($it['type'] ?? '') === 'folder' ? 'folder' : 'file';
                $id = (int)($it['id'] ?? 0);
                if ($type === 'folder') {
                    $folder = find_folder_by_id_safe($id);
                    if (!$folder) {
                        $errors[] = "Carpeta #$id: no encontrada";
                        continue;
                    }
                    $reason = file_edit_denied_reason($folder, $me, $canManage);
                    if ($reason !== null) {
                        $errors[] = "\"{$folder['name']}\": $reason";
                        continue;
                    }
                    if ($targetId !== null) {
                        $target = find_folder_by_id_safe($targetId);
                        if (!$target || $target['scope'] !== $folder['scope'] || $target['owner_id'] != $folder['owner_id']) {
                            $errors[] = "\"{$folder['name']}\": carpeta destino no válida";
                            continue;
                        }
                        if ($targetId === $id || folder_is_descendant($targetId, $id)) {
                            $errors[] = "\"{$folder['name']}\": no puedes moverla dentro de sí misma";
                            continue;
                        }
                    }
                    db()->prepare('UPDATE file_folders SET parent_id = ? WHERE id = ?')->execute([$targetId, $id]);
                } else {
                    $file = find_file_by_id_safe($id);
                    if (!$file) {
                        $errors[] = "Archivo #$id: no encontrado";
                        continue;
                    }
                    $reason = file_edit_denied_reason($file, $me, $canManage);
                    if ($reason !== null) {
                        $errors[] = "\"{$file['name']}\": $reason";
                        continue;
                    }
                    if ($targetId !== null) {
                        $target = find_folder_by_id_safe($targetId);
                        if (!$target || $target['scope'] !== $file['scope'] || $target['owner_id'] != $file['owner_id']) {
                            $errors[] = "\"{$file['name']}\": carpeta destino no válida";
                            continue;
                        }
                    }
                    db()->prepare('UPDATE files SET folder_id = ? WHERE id = ?')->execute([$targetId, $id]);
                }
                $moved++;
            }
            if ($moved) {
                log_activity('archivos', 'bulk_move', "Movió $moved elemento(s)");
            }
            json_ok(['moved' => $moved, 'errors' => $errors]);
        }

        /** Copia varios archivos/carpetas (Ctrl+V de una selección múltiple). */
        case 'bulk_copy': {
            $b = request_body();
            $items = is_array($b['items'] ?? null) ? $b['items'] : [];
            if (!$items) {
                json_error('No hay elementos seleccionados', 422);
            }
            if (count($items) > FILE_COPY_LIMIT) {
                json_error('Selecciona como máximo ' . FILE_COPY_LIMIT . ' elementos a la vez', 422);
            }
            $targetScope = ($b['target_scope'] ?? '') === 'public' ? 'public' : 'private';
            $targetOwnerId = $targetScope === 'private' ? (int)$me['id'] : null;
            $targetFolderId = isset($b['target_folder_id']) && $b['target_folder_id'] !== '' ? (int)$b['target_folder_id'] : null;
            if ($targetFolderId !== null) {
                find_folder($targetFolderId, $targetScope, $targetOwnerId);
            }

            $copied = 0;
            $errors = [];
            foreach ($items as $it) {
                $type = ($it['type'] ?? '') === 'folder' ? 'folder' : 'file';
                $id = (int)($it['id'] ?? 0);
                if ($type === 'folder') {
                    $folder = find_folder_by_id_safe($id);
                    if (!$folder) {
                        $errors[] = "Carpeta #$id: no encontrada";
                        continue;
                    }
                    $reason = file_read_denied_reason($folder, $me);
                    if ($reason !== null) {
                        $errors[] = "\"{$folder['name']}\": $reason";
                        continue;
                    }
                    $sameOwner = $folder['owner_id'] !== null ? (int)$folder['owner_id'] : null;
                    if ($targetFolderId !== null && $targetScope === $folder['scope'] && $targetOwnerId === $sameOwner
                        && ($targetFolderId === $id || folder_is_descendant($targetFolderId, $id))) {
                        $errors[] = "\"{$folder['name']}\": no puedes copiarla dentro de sí misma";
                        continue;
                    }
                    if (file_count_tree($id) > FILE_COPY_LIMIT) {
                        $errors[] = "\"{$folder['name']}\": tiene demasiados elementos";
                        continue;
                    }
                    file_copy_folder_tree($id, $targetScope, $targetOwnerId, $targetFolderId, (int)$me['id']);
                } else {
                    $file = find_file_by_id_safe($id);
                    if (!$file) {
                        $errors[] = "Archivo #$id: no encontrado";
                        continue;
                    }
                    $reason = file_read_denied_reason($file, $me);
                    if ($reason !== null) {
                        $errors[] = "\"{$file['name']}\": $reason";
                        continue;
                    }
                    file_copy_single($file, $targetScope, $targetOwnerId, $targetFolderId, (int)$me['id']);
                }
                $copied++;
            }
            json_ok(['copied' => $copied, 'errors' => $errors]);
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

/** Como find_folder_by_id/find_file_by_id, pero regresa null en vez de cortar
 *  la petición — para el borrado en bloque, donde un elemento inválido no debe
 *  abortar los demás (json_error() termina el script, no se puede atrapar). */
function find_folder_by_id_safe(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM file_folders WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function find_file_by_id_safe(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM files WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
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
    $reason = file_edit_denied_reason($row, $me, $canManage);
    if ($reason !== null) {
        json_error(ucfirst($reason), 403);
    }
}

/** Misma regla que require_file_edit, pero regresa el motivo (o null) en vez
 *  de cortar la petición — para usarla dentro de mover/copiar en bloque. */
function file_edit_denied_reason(array $row, array $me, bool $canManage): ?string
{
    if ($row['scope'] === 'private') {
        return (int)$row['owner_id'] !== (int)$me['id'] ? 'ese elemento pertenece a la carpeta privada de otro usuario' : null;
    }
    return ((int)$row['created_by'] !== (int)$me['id'] && !$canManage) ? 'solo quien lo subió (o un gestor de archivos) puede modificarlo' : null;
}

/** Eliminar: dueño (privado) o gestor de archivos/admin (público) — el autor no basta. */
function require_file_delete(array $row, array $me, bool $canManage): void
{
    $reason = file_delete_denied_reason($row, $me, $canManage);
    if ($reason !== null) {
        json_error(ucfirst($reason), 403);
    }
}

/** Misma regla que require_file_delete, pero regresa el motivo (o null si sí
 *  puede) en vez de cortar la petición — para usarla dentro del borrado en bloque. */
function file_delete_denied_reason(array $row, array $me, bool $canManage): ?string
{
    if ($row['scope'] === 'private') {
        return (int)$row['owner_id'] !== (int)$me['id'] ? 'ese elemento pertenece a la carpeta privada de otro usuario' : null;
    }
    return $canManage ? null : 'solo un administrador puede eliminar archivos de la carpeta compartida';
}

/** Leer/copiar desde el origen: lo privado solo si es tuyo; lo público siempre es visible. */
function require_file_read(array $row, array $me): void
{
    $reason = file_read_denied_reason($row, $me);
    if ($reason !== null) {
        json_error(ucfirst($reason), 403);
    }
}

/** Misma regla que require_file_read, pero regresa el motivo (o null) en vez
 *  de cortar la petición — para usarla dentro de copiar en bloque. */
function file_read_denied_reason(array $row, array $me): ?string
{
    return ($row['scope'] === 'private' && (int)$row['owner_id'] !== (int)$me['id']) ? 'no tienes acceso a ese elemento' : null;
}

/* ================= Papelera ================= */

/** Archiva un archivo a la papelera (nunca borra el binario del disco: sobrevive
 *  hasta que se purgue desde Admin Tools > Papelera, por si se restaura). */
function file_archive_to_trash(array $file, array $me, ?int $relatedTrashId = null): int
{
    $trashId = trash_archive('file', (int)$file['id'], $file, null, null,
        'Archivo "' . $file['name'] . '"', $me, $relatedTrashId);
    db()->prepare('DELETE FROM files WHERE id = ?')->execute([$file['id']]);
    log_activity('archivos', 'file_delete', "Eliminó \"{$file['name']}\"", 'file', (int)$file['id']);
    return $trashId;
}

/**
 * Archiva una carpeta y todo su árbol (subcarpetas + archivos) a la papelera,
 * de hijos hacia el padre para que cada uno enlace a la papelera de su padre
 * inmediato vía related_trash_id (igual que proyecto→tareas, pero anidado en
 * vez de un solo nivel). No borra nada del disco.
 */
function file_archive_folder_tree(array $folder, array $me, ?int $relatedTrashId = null): int
{
    $folderId = (int)$folder['id'];
    $trashId = trash_archive('file_folder', $folderId, $folder, null, null,
        'Carpeta "' . $folder['name'] . '"', $me, $relatedTrashId);

    $st = db()->prepare('SELECT * FROM files WHERE folder_id = ?');
    $st->execute([$folderId]);
    foreach ($st->fetchAll() as $file) {
        file_archive_to_trash($file, $me, $trashId);
    }

    $st = db()->prepare('SELECT * FROM file_folders WHERE parent_id = ?');
    $st->execute([$folderId]);
    foreach ($st->fetchAll() as $child) {
        file_archive_folder_tree($child, $me, $trashId);
    }

    db()->prepare('DELETE FROM file_folders WHERE id = ?')->execute([$folderId]);
    log_activity('archivos', 'folder_delete', "Eliminó la carpeta \"{$folder['name']}\"", 'file_folder', $folderId);
    return $trashId;
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
