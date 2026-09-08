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
// Vista elegida: 'list' | 'details' | 'icons-sm' | 'icons-md' | 'icons-lg'.
// Es una preferencia del navegador de quien la usa, no algo que viva en el
// servidor — por eso localStorage y no una columna de usuario.
let viewMode = 'list';
try {
  viewMode = localStorage.getItem('sirius_archivos_view') || 'list';
} catch {
  // localStorage puede fallar (ventana privada, cuota) — se queda en 'list'
}
// Portapapeles del propio navegador (no persiste en el servidor):
// { mode: 'copy'|'cut', items: [{type, id, name}], scope }. Solo copiar tiene
// atajo de teclado (Ctrl/Cmd+C, Ctrl/Cmd+V) — cortar sigue existiendo desde el
// menú por si alguien ya lo usa, pero sin atajo, para no facilitar mover algo
// sin querer con un Ctrl+X accidental.
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
        <div class="flex items-center gap-3">
          <select id="view-mode" class="rounded-lg border-0 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="list">Lista</option>
            <option value="details">Detalles</option>
            <option value="icons-sm">Iconos pequeños</option>
            <option value="icons-md">Iconos medianos</option>
            <option value="icons-lg">Iconos grandes</option>
          </select>
          <p class="text-xs text-slate-400">${fmtSize(data.used_bytes)} usados</p>
        </div>
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
        ${clipboard.mode === 'copy' ? 'Copiando' : 'Cortando'} ${escapeHtml(clipboardLabel())} — Ctrl+V aquí (o clic derecho y "Pegar"), o
        <button type="button" id="btn-clear-clipboard" class="font-semibold text-indigo-600 hover:text-indigo-500">cancelar</button>.
      </p>` : ''}
    </div>`;

  renderBreadcrumb(root.querySelector('#breadcrumb'));
  renderList(root.querySelector('#file-list'));

  const viewSelect = root.querySelector('#view-mode');
  viewSelect.value = viewMode;
  viewSelect.addEventListener('change', () => {
    viewMode = viewSelect.value;
    try { localStorage.setItem('sirius_archivos_view', viewMode); } catch { /* ver arriba */ }
    repaint();
  });

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

/** Clases de grid completas y literales (Tailwind escanea el texto fuente,
 *  no puede ver un valor armado en tiempo de ejecución con un template). */
const ICON_GRID_COLS = {
  'icons-sm': 'grid-cols-[repeat(auto-fill,minmax(76px,1fr))]',
  'icons-md': 'grid-cols-[repeat(auto-fill,minmax(108px,1fr))]',
  'icons-lg': 'grid-cols-[repeat(auto-fill,minmax(156px,1fr))]',
};
const TILE_SIZE = { 'icons-sm': 'sm', 'icons-md': 'md', 'icons-lg': 'lg' };

function renderList(listEl) {
  const items = [...data.folders, ...data.files];
  if (!items.length) {
    listEl.innerHTML = `
      <div class="py-14 text-center">
        <p class="text-sm font-medium text-slate-600">Carpeta vacía</p>
        <p class="mt-1 text-xs text-slate-400">Arrastra un archivo aquí, o usa "Subir archivo" / "Carpeta".</p>
      </div>`;
  } else if (viewMode === 'details') {
    listEl.innerHTML = detailsTableHtml(items);
  } else if (viewMode in ICON_GRID_COLS) {
    const size = TILE_SIZE[viewMode];
    listEl.innerHTML = `<div class="grid ${ICON_GRID_COLS[viewMode]} gap-1 p-3">${items.map((it) => tileHtml(it, size)).join('')}</div>`;
  } else {
    listEl.innerHTML = items.map(rowHtml).join('');
  }

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
  const key = `${item.type}:${item.id}`;
  const isSelected = selected.has(key);
  return `
    <div data-item="${key}" class="group flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 ${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}">
      <input type="checkbox" data-select="${key}" ${isSelected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(item.name)}"
             class="h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}">
      ${itemIconHtml(item, 'h-9 w-9', 'h-5 w-5')}
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

/** Vista Detalles: tabla con columnas explícitas (nombre, tipo, tamaño, autor, fecha). */
function detailsTableHtml(items) {
  const showCreator = scope === 'public';
  return `
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
          <th class="w-8 px-3 py-2"></th>
          <th class="px-2 py-2">Nombre</th>
          <th class="hidden px-2 py-2 sm:table-cell">Tipo</th>
          <th class="hidden px-2 py-2 sm:table-cell">Tamaño</th>
          ${showCreator ? '<th class="hidden px-2 py-2 md:table-cell">Autor</th>' : ''}
          <th class="hidden px-2 py-2 md:table-cell">Modificado</th>
          <th class="w-10 px-2 py-2"></th>
        </tr>
      </thead>
      <tbody>${items.map((it) => detailsRowHtml(it, showCreator)).join('')}</tbody>
    </table>`;
}

function detailsRowHtml(item, showCreator) {
  const isFolder = item.type === 'folder';
  const key = `${item.type}:${item.id}`;
  const isSelected = selected.has(key);
  return `
    <tr data-item="${key}" class="group border-b border-slate-100 last:border-0 ${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}">
      <td class="px-3 py-2">
        <input type="checkbox" data-select="${key}" ${isSelected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(item.name)}"
               class="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}">
      </td>
      <td class="px-2 py-2">
        <div class="flex min-w-0 items-center gap-2.5">
          ${itemIconHtml(item, 'h-7 w-7', 'h-4 w-4', 'rounded-md')}
          <button type="button" data-open class="min-w-0 flex-1 truncate text-left font-medium text-slate-800 hover:text-indigo-600">${escapeHtml(item.name)}</button>
        </div>
      </td>
      <td class="hidden px-2 py-2 text-xs text-slate-500 sm:table-cell">${isFolder ? 'Carpeta' : fileTypeLabel(item)}</td>
      <td class="hidden px-2 py-2 text-xs text-slate-500 sm:table-cell">${isFolder ? '—' : fmtSize(item.size)}</td>
      ${showCreator ? `<td class="hidden truncate px-2 py-2 text-xs text-slate-500 md:table-cell">${escapeHtml(item.creator_name || '')}</td>` : ''}
      <td class="hidden px-2 py-2 text-xs text-slate-500 md:table-cell">${fmtDateTime(item.updated_at)}</td>
      <td class="px-2 py-2 text-right">
        <button type="button" data-menu title="Más acciones" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">${icon('more-vertical', 'h-4 w-4')}</button>
      </td>
    </tr>`;
}

/** Vistas de iconos (pequeños/medianos/grandes): mismas dimensiones box+ícono
 *  escritas completas (ver ICON_GRID_COLS) para que Tailwind las encuentre. */
const TILE_DIMS = {
  sm: { box: 'h-14 w-14', icon: 'h-6 w-6' },
  md: { box: 'h-20 w-20', icon: 'h-8 w-8' },
  lg: { box: 'h-28 w-28', icon: 'h-11 w-11' },
};

function tileHtml(item, size) {
  const { box, icon: iconCls } = TILE_DIMS[size];
  const key = `${item.type}:${item.id}`;
  const isSelected = selected.has(key);
  return `
    <div data-item="${key}" class="group relative flex flex-col items-center gap-1.5 rounded-xl p-2 text-center ${isSelected ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}">
      <input type="checkbox" data-select="${key}" ${isSelected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(item.name)}"
             class="absolute left-1.5 top-1.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}">
      <button type="button" data-menu title="Más acciones" class="absolute right-1 top-1 rounded-lg p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100">
        ${icon('more-vertical', 'h-3.5 w-3.5')}
      </button>
      ${itemIconHtml(item, box, iconCls, 'rounded-xl')}
      <button type="button" data-open class="w-full truncate text-xs font-medium text-slate-700 hover:text-indigo-600">
        ${escapeHtml(item.name)}
      </button>
    </div>`;
}

/** Ícono compartido por las 5 vistas: miniatura real para imágenes (cacheada
 *  en el servidor, ver includes/thumbnails.php), ícono genérico por tipo para
 *  todo lo demás — carpetas incluidas. */
function itemIconHtml(item, boxCls, iconCls, roundedCls = 'rounded-lg') {
  const isFolder = item.type === 'folder';
  const isImage = !isFolder && (item.mime || '').startsWith('image/');
  if (isImage) {
    return `<img src="archivo.php?id=${item.id}&thumb=1" loading="lazy" alt=""
                 class="${boxCls} shrink-0 ${roundedCls} bg-slate-100 object-cover">`;
  }
  const ic = isFolder ? 'folder' : iconForFile(item);
  return `<span class="flex ${boxCls} shrink-0 items-center justify-center ${roundedCls} ${isFolder ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}">${icon(ic, iconCls)}</span>`;
}

function iconForFile(item) {
  if ((item.mime || '').startsWith('image/')) return 'image';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'package';
  return 'file-text';
}

/** Etiqueta corta de tipo para la vista Detalles. */
function fileTypeLabel(item) {
  const mime = item.mime || '';
  if (mime.startsWith('image/')) return 'Imagen';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  const ext = (item.name.split('.').pop() || '').toUpperCase();
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) return 'Comprimido';
  return ext || 'Archivo';
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
  entries.push({ label: 'Copiar', ic: 'copy', action: () => { clipboard = { mode: 'copy', items: [{ type: item.type, id: item.id, name: item.name }], scope }; repaint(); } });
  if (canEdit) {
    entries.push({ label: 'Mover a…', ic: 'move', action: () => openMoveModal([{ type: item.type, id: item.id, name: item.name }]) });
    entries.push({ label: 'Cortar', ic: 'scissors', action: () => { clipboard = { mode: 'cut', items: [{ type: item.type, id: item.id, name: item.name }], scope }; repaint(); } });
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
    entries.push({ label: `Pegar ${clipboardLabel()}`, ic: 'clipboard', action: () => pasteClipboard() });
  }
  showContextMenu(x, y, entries);
}

function openBulkMenu(x, y) {
  const items = selectedItems();
  showContextMenu(x, y, [
    { label: `Copiar (${items.length})`, ic: 'copy', action: () => { clipboard = { mode: 'copy', items, scope }; repaint(); } },
    { label: `Mover a… (${items.length})`, ic: 'move', action: () => openMoveModal(items) },
    { label: `Eliminar (${items.length})`, ic: 'trash', danger: true, action: () => bulkDeleteSelected() },
  ]);
}

/** La selección actual como [{type, id, name}], en el orden de la lista visible. */
function selectedItems() {
  return [...data.folders, ...data.files]
    .filter((it) => selected.has(`${it.type}:${it.id}`))
    .map((it) => ({ type: it.type, id: it.id, name: it.name }));
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

/** Texto sin escapar: quien lo use decide cómo insertarlo (HTML crudo en
 *  paint(), o como label de un botón del menú contextual que ya se escapa solo). */
function clipboardLabel() {
  const n = clipboard.items.length;
  return n === 1 ? `"${clipboard.items[0].name}"` : `${n} elementos`;
}

async function pasteClipboard() {
  if (!clipboard) return;
  const items = clipboard.items.map(({ type, id }) => ({ type, id }));
  try {
    if (clipboard.mode === 'copy') {
      const res = await apiPost('files/bulk_copy', { items, target_scope: scope, target_folder_id: folderId });
      reportBulkResult(res.copied, res.errors, 'copiado(s)');
    } else {
      if (clipboard.scope !== scope) {
        toast('No se puede mover entre lo privado y lo compartido; usa "Compartir a lo público".', 'error');
        return;
      }
      const res = await apiPost('files/bulk_move', { items, target_folder_id: folderId });
      reportBulkResult(res.moved, res.errors, 'movido(s)');
      clipboard = null;
    }
    reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Mensaje uniforme para las operaciones en bloque (mover/copiar/eliminar). */
function reportBulkResult(count, errors, verb) {
  if (errors?.length) {
    toast(`${count} ${verb}, ${errors.length} con error: ${errors[0]}`, 'error');
  } else {
    toast(`${count} elemento(s) ${verb}`);
  }
}

/**
 * "Mover a…": selector de carpeta destino dentro del mismo scope de los ítems
 * (mover entre privado y compartido no existe — para eso está "Compartir a lo
 * público"). Navega igual que el listado principal pero en un árbol aparte,
 * sin ofrecer como destino ninguna de las carpetas que se están moviendo.
 */
async function openMoveModal(items) {
  const itemScope = scope;
  const movingFolderIds = new Set(items.filter((it) => it.type === 'folder').map((it) => it.id));
  let pickFolderId = folderId; // arranca en la carpeta actual
  let pickBreadcrumb = data.breadcrumb;
  let pickFolders = [];

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div id="move-breadcrumb" class="flex flex-wrap items-center gap-1 text-sm text-slate-500"></div>
      <div id="move-list" class="max-h-64 overflow-y-auto rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100"></div>
    </div>`;

  async function loadPicker() {
    const res = await apiGet('files/list', { scope: itemScope, folder_id: pickFolderId });
    pickFolders = res.folders.filter((f) => !movingFolderIds.has(f.id));
    pickBreadcrumb = res.breadcrumb;
    paintPicker();
  }

  function paintPicker() {
    const rootLabel = itemScope === 'private' ? 'Mis archivos' : 'Carpeta compartida';
    const crumbs = [{ id: null, name: rootLabel }, ...pickBreadcrumb];
    const bc = wrap.querySelector('#move-breadcrumb');
    bc.innerHTML = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return `${i > 0 ? '<span class="text-slate-300">/</span>' : ''}
        <button type="button" data-goto="${c.id ?? ''}" ${last ? 'disabled' : ''}
                class="rounded px-1.5 py-0.5 ${last ? 'font-semibold text-slate-700' : 'hover:text-indigo-600'}">
          ${escapeHtml(c.name)}
        </button>`;
    }).join('');
    bc.querySelectorAll('[data-goto]:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      pickFolderId = b.dataset.goto ? +b.dataset.goto : null;
      loadPicker();
    }));

    const box = wrap.querySelector('#move-list');
    box.innerHTML = pickFolders.length ? pickFolders.map((f) => `
      <button type="button" data-pick-folder="${f.id}" class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50">
        ${icon('folder', 'h-4 w-4 shrink-0 text-amber-500')} <span class="truncate">${escapeHtml(f.name)}</span>
      </button>`).join('') : '<div class="px-3 py-6 text-center text-xs text-slate-400">Sin subcarpetas aquí.</div>';
    box.querySelectorAll('[data-pick-folder]').forEach((b) => b.addEventListener('click', () => {
      pickFolderId = +b.dataset.pickFolder;
      loadPicker();
    }));
  }

  await loadPicker();

  modal({
    title: `Mover ${items.length > 1 ? `${items.length} elementos` : `"${items[0].name}"`}`,
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Mover aquí', primary: true,
        onClick: async (close, btn) => {
          btn.disabled = true;
          try {
            const res = await apiPost('files/bulk_move', {
              items: items.map(({ type, id }) => ({ type, id })),
              target_folder_id: pickFolderId,
            });
            close();
            reportBulkResult(res.moved, res.errors, 'movido(s)');
            clearSelection();
            reload();
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
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
  const items = selectedItems();
  if (!items.length) return;
  const names = items.map((it) => it.name).slice(0, 5);
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
    reportBulkResult(res.deleted, res.errors, 'eliminado(s)');
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

/** Evita robarle los atajos de teclado a cualquier otra pantalla o formulario:
 *  Archivos debe estar montado y el foco no debe estar escribiendo texto. */
function shortcutsBlocked() {
  const active = document.activeElement;
  const isTyping = active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable);
  return isTyping || !document.getElementById('file-list');
}

/** Supr/Delete elimina la selección. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' || !selected.size || shortcutsBlocked()) return;
  e.preventDefault();
  bulkDeleteSelected();
});

/**
 * Ctrl/Cmd+C copia la selección al portapapeles interno — solo si no hay texto
 * genuinamente seleccionado en la página (si lo hay, gana el copiar nativo del
 * navegador, no el de archivos). Ctrl/Cmd+V pega lo que haya en el
 * portapapeles (copiar o cortar: cortar no tiene su propio atajo — ver arriba
 * — pero si ya se activó desde el menú, Ctrl+V sí lo completa).
 */
document.addEventListener('keydown', (e) => {
  const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
  const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
  if (!isCopy && !isPaste) return;
  if (shortcutsBlocked()) return;

  if (isCopy) {
    if (!selected.size || window.getSelection().toString() !== '') return;
    e.preventDefault();
    clipboard = { mode: 'copy', items: selectedItems(), scope };
    toast(clipboard.items.length === 1 ? 'Copiado' : `${clipboard.items.length} elementos copiados`);
    repaint();
  } else if (clipboard) {
    e.preventDefault();
    pasteClipboard();
  }
});
