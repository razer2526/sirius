/**
 * Módulo Archivos: gestor de archivos privado por usuario + carpeta compartida.
 * Menú de clic derecho (o el botón ⋮ en táctil): copiar, cortar, pegar, renombrar,
 * eliminar y "compartir a lo público". Subida por botón o arrastrando archivos.
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, field, formValues, fmtDateTime, spinner,
} from '../ui.js';

const MAX_SIZE = 25 * 1024 * 1024;

let scope = 'private';
let folderId = null;
let data = null;
// Portapapeles del propio navegador (no persiste en el servidor): { mode, type, id, name, scope }
let clipboard = null;

// Selección múltiple: claves "tipo:id" (ej. "file:12", "folder:3"), con el
// último ítem tocado para poder hacer shift+clic en rango.
let selected = new Set();
let lastSelectedKey = null;
// Arrastre para selección tipo "rubber band" — a nivel de módulo porque los
// listeners de mousemove/mouseup viven en document y se registran una sola
// vez (ver bloque al final del archivo), no en cada repintado.
let dragSelect = null; // { listEl, additive, startX, startY, box }

export async function render(root) {
  await load(root);
}

async function load(root) {
  root.innerHTML = spinner();
  selected.clear();
  lastSelectedKey = null;
  try {
    data = await apiGet('files/list', { scope, folder_id: folderId });
  } catch (e) {
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
    return;
  }
  paint(root);
}

function reload() {
  load(document.getElementById('module-root'));
}

/** Repinta con los datos ya cargados (sin volver a pedirlos): para cambios que no
 *  tocan el servidor, como fijar o soltar el portapapeles. */
function repaint() {
  paint(document.getElementById('module-root'));
}

function paint(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          <button type="button" data-scope="private" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${scope === 'private' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
            Mis archivos
          </button>
          <button type="button" data-scope="public" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${scope === 'public' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
            Carpeta compartida
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="btn-new-folder" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('folder-open', 'h-4 w-4')} Carpeta
          </button>
          <button id="btn-upload" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('upload', 'h-4 w-4')} Subir archivo
          </button>
          <input id="file-input" type="file" multiple class="hidden">
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div id="breadcrumb" class="flex flex-wrap items-center gap-1 text-sm text-slate-500"></div>
        <p class="text-xs text-slate-400">${fmtSize(data.used_bytes)} usados</p>
      </div>

      ${selected.size ? `
      <div class="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-2.5 ring-1 ring-indigo-200">
        <p class="text-sm font-medium text-indigo-700">${selected.size} seleccionado(s)</p>
        <div class="flex gap-2">
          <button type="button" id="btn-bulk-delete" class="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-100">Eliminar</button>
          <button type="button" id="btn-clear-selection" class="rounded-lg px-3 py-1.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-100">Cancelar</button>
        </div>
      </div>` : ''}

      <div id="file-list" class="relative min-h-[16rem] rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition"></div>
      ${clipboard ? `
      <p class="text-xs text-slate-400">
        ${clipboard.mode === 'copy' ? 'Copiando' : 'Cortando'} "${escapeHtml(clipboard.name)}" — clic derecho en esta carpeta y "Pegar", o
        <button type="button" id="btn-clear-clipboard" class="font-semibold text-indigo-600 hover:text-indigo-500">cancelar</button>.
      </p>` : ''}
    </div>`;

  renderBreadcrumb(root.querySelector('#breadcrumb'));
  renderList(root.querySelector('#file-list'));

  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.scope === scope) return;
    scope = b.dataset.scope;
    folderId = null;
    reload();
  }));
  root.querySelector('#btn-new-folder').addEventListener('click', () => createFolder());
  root.querySelector('#btn-upload').addEventListener('click', () => root.querySelector('#file-input').click());
  root.querySelector('#file-input').addEventListener('change', (e) => {
    if (e.target.files.length) uploadFiles(e.target.files);
    e.target.value = '';
  });
  root.querySelector('#btn-clear-clipboard')?.addEventListener('click', () => { clipboard = null; repaint(); });
  root.querySelector('#btn-bulk-delete')?.addEventListener('click', () => bulkDeleteSelected());
  root.querySelector('#btn-clear-selection')?.addEventListener('click', () => { clearSelection(); repaint(); });

  const listEl = root.querySelector('#file-list');
  wireDropZone(listEl);
  wireDragSelect(listEl);
}

/* ================= Breadcrumb ================= */
function renderBreadcrumb(box) {
  const rootLabel = scope === 'private' ? 'Mis archivos' : 'Carpeta compartida';
  const crumbs = [{ id: null, name: rootLabel }, ...data.breadcrumb];
  box.innerHTML = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return `${i > 0 ? '<span class="text-slate-300">/</span>' : ''}
      <button type="button" data-goto="${c.id ?? ''}" ${last ? 'disabled' : ''}
              class="rounded px-1.5 py-0.5 ${last ? 'font-semibold text-slate-700' : 'hover:text-indigo-600'}">
        ${escapeHtml(c.name)}
      </button>`;
  }).join('');
  box.querySelectorAll('[data-goto]:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    folderId = b.dataset.goto ? +b.dataset.goto : null;
    reload();
  }));
}

/* ================= Lista ================= */
function findItem(type, id) {
  const list = type === 'folder' ? data.folders : data.files;
  return list.find((x) => x.id === id);
}

function renderList(listEl) {
  const items = [...data.folders, ...data.files];
  listEl.innerHTML = items.length ? items.map(rowHtml).join('') : `
    <div class="py-14 text-center">
      <p class="text-sm font-medium text-slate-600">Carpeta vacía</p>
      <p class="mt-1 text-xs text-slate-400">Arrastra un archivo aquí, o usa "Subir archivo" / "Carpeta".</p>
    </div>`;

  listEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-item]');
    const [type, id] = row.dataset.item.split(':');
    const item = findItem(type, +id);
    if (type === 'folder') {
      folderId = item.id;
      reload();
    } else {
      window.open(`archivo.php?id=${item.id}`, '_blank');
    }
  }));
  listEl.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = b.closest('[data-item]');
    const [type, id] = row.dataset.item.split(':');
    const r = b.getBoundingClientRect();
    openItemMenu(r.right, r.bottom + 4, findItem(type, +id));
  }));
  listEl.querySelectorAll('[data-select]').forEach((cb) => cb.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelect(cb.dataset.select);
    repaint();
  }));

  // Ctrl/Cmd+clic o Shift+clic en cualquier parte de la fila selecciona en vez
  // de abrir — se intercepta en fase de captura para llegar antes que el clic
  // del botón "abrir" (que vive más adentro, sobre el mismo elemento).
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (!row || e.target.closest('[data-select]')) return;
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) rangeSelect(row.dataset.item);
    else toggleSelect(row.dataset.item);
    repaint();
  }, true);

  listEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('[data-item]');
    if (!row) {
      openEmptyMenu(e.clientX, e.clientY);
      return;
    }
    const key = row.dataset.item;
    const [type, id] = key.split(':');
    // Clic derecho fuera de la selección actual: la reemplaza por este ítem
    // (igual que Explorer/Finder), en vez de mezclar selecciones sin relación.
    if (selected.size && !selected.has(key)) {
      clearSelection();
    }
    if (selected.size > 1) {
      openBulkMenu(e.clientX, e.clientY);
    } else {
      openItemMenu(e.clientX, e.clientY, findItem(type, +id));
    }
  });
}

function rowHtml(item) {
  const isFolder = item.type === 'folder';
  const ic = isFolder ? 'folder' : iconForFile(item);
  const key = `${item.type}:${item.id}`;
  const isSelected = selected.has(key);
  return `
    <div data-item="${key}" class="group flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 ${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}">
      <input type="checkbox" data-select="${key}" ${isSelected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(item.name)}"
             class="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isFolder ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}">${icon(ic, 'h-5 w-5')}</span>
      <button type="button" data-open class="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 hover:text-indigo-600">
        ${escapeHtml(item.name)}
      </button>
      ${!isFolder ? `<span class="hidden shrink-0 text-xs text-slate-400 sm:block">${fmtSize(item.size)}</span>` : '<span class="hidden shrink-0 sm:block"></span>'}
      ${scope === 'public' && item.creator_name ? `<span class="hidden shrink-0 truncate text-xs text-slate-400 md:block md:max-w-[120px]">${escapeHtml(item.creator_name)}</span>` : ''}
      <span class="hidden shrink-0 text-xs text-slate-400 md:block">${fmtDateTime(item.updated_at)}</span>
      <button type="button" data-menu title="Más acciones" class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        ${icon('more-vertical', 'h-4 w-4')}
      </button>
    </div>`;
}

function iconForFile(item) {
  if ((item.mime || '').startsWith('image/')) return 'image';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'package';
  return 'file-text';
}

/* ================= Menú contextual ================= */
function openItemMenu(x, y, item) {
  const isPrivate = scope === 'private';
  const isCreator = item.created_by === data.me;
  const canEdit = isPrivate || isCreator || data.can_manage;
  const canDelete = isPrivate || data.can_manage;

  const entries = [];
  if (item.type === 'folder') {
    entries.push({ label: 'Abrir', ic: 'folder-open', action: () => { folderId = item.id; reload(); } });
  } else {
    entries.push({ label: 'Descargar', ic: 'download', action: () => window.open(`archivo.php?id=${item.id}&download=1`, '_blank') });
  }
  entries.push({ label: 'Copiar', ic: 'copy', action: () => { clipboard = { mode: 'copy', type: item.type, id: item.id, name: item.name, scope }; repaint(); } });
  if (canEdit) {
    entries.push({ label: 'Cortar', ic: 'scissors', action: () => { clipboard = { mode: 'cut', type: item.type, id: item.id, name: item.name, scope }; repaint(); } });
    entries.push({ label: 'Renombrar', ic: 'edit', action: () => renameItem(item) });
  }
  if (isPrivate) {
    entries.push({ label: 'Compartir a lo público', ic: 'upload', action: () => shareItem(item) });
  }
  if (canDelete) {
    entries.push({ label: 'Eliminar', ic: 'trash', danger: true, action: () => deleteItem(item) });
  }
  showContextMenu(x, y, entries);
}

function openEmptyMenu(x, y) {
  const entries = [{ label: 'Nueva carpeta', ic: 'folder-open', action: () => createFolder() }];
  if (clipboard) {
    entries.push({ label: `Pegar "${clipboard.name}"`, ic: 'clipboard', action: () => pasteClipboard() });
  }
  showContextMenu(x, y, entries);
}

function openBulkMenu(x, y) {
  showContextMenu(x, y, [
    { label: `Eliminar (${selected.size})`, ic: 'trash', danger: true, action: () => bulkDeleteSelected() },
  ]);
}

function showContextMenu(x, y, entries) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'file-ctx-menu';
  menu.className = 'fixed z-50 min-w-[190px] overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200';
  menu.innerHTML = entries.map((e, i) => `
    <button type="button" data-i="${i}"
            class="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm ${e.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}">
      ${icon(e.ic, 'h-4 w-4')} ${escapeHtml(e.label)}
    </button>`).join('');
  document.body.appendChild(menu);

  const maxLeft = window.innerWidth - menu.offsetWidth - 8;
  const maxTop = window.innerHeight - menu.offsetHeight - 8;
  menu.style.left = Math.max(4, Math.min(x, maxLeft)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, maxTop)) + 'px';

  menu.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    closeContextMenu();
    entries[+b.dataset.i].action();
  }));
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
  document.addEventListener('keydown', escCloseMenu);
}

function closeContextMenu() {
  document.getElementById('file-ctx-menu')?.remove();
  document.removeEventListener('keydown', escCloseMenu);
}

function escCloseMenu(e) {
  if (e.key === 'Escape') closeContextMenu();
}

/* ================= Acciones ================= */
function createFolder() {
  const form = document.createElement('form');
  form.innerHTML = field({ key: 'name', label: 'Nombre de la carpeta', type: 'text', required: true }, '');
  modal({
    title: 'Nueva carpeta',
    content: form,
    size: 'max-w-sm',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Crear', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          try {
            await apiPost('files/folder_create', { scope, parent_id: folderId, name: formValues(form).name });
            close();
            reload();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function renameItem(item) {
  const form = document.createElement('form');
  form.innerHTML = field({ key: 'name', label: 'Nuevo nombre', type: 'text', required: true }, item.name);
  modal({
    title: 'Renombrar',
    content: form,
    size: 'max-w-sm',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          try {
            await apiPost(`files/${item.type}_rename`, { id: item.id, name: formValues(form).name });
            close();
            reload();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

async function deleteItem(item) {
  const ok = await confirmDialog(
    'Eliminar',
    `¿Eliminar "${item.name}"${item.type === 'folder' ? ' y todo su contenido' : ''}?`,
    { danger: true, confirmLabel: 'Eliminar' }
  );
  if (!ok) return;
  try {
    await apiPost(`files/${item.type}_delete`, { id: item.id });
    toast('Eliminado');
    reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function shareItem(item) {
  const ok = await confirmDialog(
    'Compartir a lo público',
    `Se creará una copia de "${item.name}" en la carpeta compartida. Tu copia privada no se modifica.`,
    { confirmLabel: 'Compartir' }
  );
  if (!ok) return;
  try {
    await apiPost('files/share', { type: item.type, id: item.id });
    toast('Compartido en la carpeta pública');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function pasteClipboard() {
  if (!clipboard) return;
  try {
    if (clipboard.mode === 'copy') {
      await apiPost('files/copy', { type: clipboard.type, id: clipboard.id, target_scope: scope, target_folder_id: folderId });
      toast('Copiado');
    } else {
      if (clipboard.scope !== scope) {
        toast('No se puede mover entre lo privado y lo compartido; usa "Compartir a lo público".', 'error');
        return;
      }
      const key = clipboard.type === 'folder' ? 'parent_id' : 'folder_id';
      await apiPost(`files/${clipboard.type}_move`, { id: clipboard.id, [key]: folderId });
      toast('Movido');
      clipboard = null;
    }
    reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ================= Selección múltiple ================= */
function toggleSelect(key) {
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  lastSelectedKey = key;
}

/** Selecciona el rango visual entre el último ítem tocado y `key` (orden de la lista actual). */
function rangeSelect(key) {
  const order = [...data.folders, ...data.files].map((it) => `${it.type}:${it.id}`);
  const a = lastSelectedKey ? order.indexOf(lastSelectedKey) : -1;
  const b = order.indexOf(key);
  if (a === -1 || b === -1) {
    toggleSelect(key);
    return;
  }
  const [start, end] = a < b ? [a, b] : [b, a];
  for (let i = start; i <= end; i++) selected.add(order[i]);
  lastSelectedKey = key;
}

function clearSelection() {
  selected.clear();
  lastSelectedKey = null;
}

async function bulkDeleteSelected() {
  const items = [...selected].map((key) => {
    const [type, id] = key.split(':');
    return { type, id: +id };
  });
  if (!items.length) return;
  const names = items
    .map(({ type, id }) => findItem(type, id)?.name)
    .filter(Boolean)
    .slice(0, 5);
  const preview = names.join(', ') + (items.length > names.length ? `, y ${items.length - names.length} más` : '');
  const ok = await confirmDialog(
    'Eliminar seleccionados',
    `¿Eliminar ${items.length} elemento(s)? ${preview}`,
    { danger: true, confirmLabel: 'Eliminar' }
  );
  if (!ok) return;
  try {
    const res = await apiPost('files/bulk_delete', { items });
    clearSelection();
    if (res.errors?.length) {
      toast(`${res.deleted} eliminado(s), ${res.errors.length} con error: ${res.errors[0]}`, 'error');
    } else {
      toast(res.deleted === 1 ? 'Elemento eliminado' : `${res.deleted} elementos eliminados`);
    }
    reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Selección por arrastre ("rubber band"): mousedown en área vacía del listado
 *  dibuja un rectángulo; cualquier fila que intersecte al soltar se selecciona.
 *  El estado vive a nivel de módulo porque mousemove/mouseup se escuchan en
 *  document una sola vez (bloque al final del archivo), no en cada repintado. */
function wireDragSelect(listEl) {
  listEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // solo clic izquierdo
    if (e.target.closest('[data-item]') || e.target.closest('button') || e.target.closest('input')) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) clearSelection();
    const rect = listEl.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'pointer-events-none absolute z-10 rounded border border-indigo-400 bg-indigo-400/10';
    listEl.appendChild(box);
    dragSelect = {
      listEl,
      startX: e.clientX - rect.left + listEl.scrollLeft,
      startY: e.clientY - rect.top + listEl.scrollTop,
      box,
    };
    e.preventDefault();
  });
}

/* ================= Subida ================= */
async function uploadFiles(fileList) {
  let errors = 0;
  for (const file of Array.from(fileList)) {
    if (file.size > MAX_SIZE) {
      toast(`"${file.name}" supera 25 MB y no se subió`, 'error');
      errors++;
      continue;
    }
    const fd = new FormData();
    fd.append('scope', scope);
    if (folderId !== null) fd.append('folder_id', folderId);
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=files/file_upload', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Error al subir');
    } catch (e) {
      toast(`"${file.name}": ${e.message}`, 'error');
      errors++;
    }
  }
  if (!errors && fileList.length) toast(fileList.length === 1 ? 'Archivo subido' : `${fileList.length} archivos subidos`);
  reload();
}

function wireDropZone(listEl) {
  const setActive = (on) => {
    listEl.classList.toggle('ring-2', on);
    listEl.classList.toggle('ring-indigo-400', on);
  };
  ['dragenter', 'dragover'].forEach((evt) => listEl.addEventListener(evt, (e) => { e.preventDefault(); setActive(true); }));
  ['dragleave'].forEach((evt) => listEl.addEventListener(evt, () => setActive(false)));
  listEl.addEventListener('drop', (e) => {
    e.preventDefault();
    setActive(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });
}

/* ================= Utilidades ================= */
function fmtSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Listeners de document para el arrastre de selección: se registran una sola
 * vez al cargar el módulo (import dinámico = un solo módulo vivo por sesión),
 * nunca dentro de paint()/renderList(), para no acumular listeners duplicados
 * en cada repintado. mousemove/mouseup viven en document (no en el listado)
 * porque el usuario puede soltar el botón fuera del área visible mientras arrastra.
 */
document.addEventListener('mousemove', (e) => {
  if (!dragSelect) return;
  const { listEl, startX, startY, box } = dragSelect;
  const rect = listEl.getBoundingClientRect();
  const curX = e.clientX - rect.left + listEl.scrollLeft;
  const curY = e.clientY - rect.top + listEl.scrollTop;
  const x = Math.min(startX, curX);
  const y = Math.min(startY, curY);
  const w = Math.abs(curX - startX);
  const h = Math.abs(curY - startY);
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;

  const dragRight = x + w;
  const dragBottom = y + h;
  listEl.querySelectorAll('[data-item]').forEach((row) => {
    const r = row.getBoundingClientRect();
    const rowTop = r.top - rect.top + listEl.scrollTop;
    const rowLeft = r.left - rect.left + listEl.scrollLeft;
    const intersects = !(rowLeft > dragRight || rowLeft + r.width < x || rowTop > dragBottom || rowTop + r.height < y);
    row.classList.toggle('bg-indigo-50', intersects);
    row.dataset.dragHit = intersects ? '1' : '';
  });
});

document.addEventListener('mouseup', () => {
  if (!dragSelect) return;
  const { listEl, box } = dragSelect;
  listEl.querySelectorAll('[data-item][data-drag-hit="1"]').forEach((row) => {
    selected.add(row.dataset.item);
    lastSelectedKey = row.dataset.item;
  });
  box.remove();
  dragSelect = null;
  repaint();
});

/** Supr/Delete elimina la selección — solo si Archivos está montado y no se está
 *  escribiendo en un campo (para no interceptar el Supr normal de un formulario). */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' || !selected.size) return;
  const active = document.activeElement;
  const isTyping = active && ['INPUT', 'TEXTAREA'].includes(active.tagName);
  if (isTyping || !document.getElementById('file-list')) return;
  e.preventDefault();
  bulkDeleteSelected();
});
