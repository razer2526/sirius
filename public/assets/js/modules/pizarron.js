/**
 * Módulo Pizarrón: notas, checklists y dibujo a mano libre.
 * Cada usuario tiene su pizarrón privado; además existe uno público compartido
 * donde cualquiera agrega elementos, pero solo su autor (o un gestor) los toca.
 */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, confirmDialog, debounce, spinner, isUserBusy } from '../ui.js';

const POLL_MS = 20000;

const COLOR_KEYS = ['amber', 'pink', 'sky', 'emerald', 'violet', 'slate'];
const PALETTE = {
  amber:   { bg: 'bg-amber-100',   ring: 'ring-amber-300',   header: 'bg-amber-200',   swatch: 'bg-amber-500' },
  pink:    { bg: 'bg-pink-100',    ring: 'ring-pink-300',    header: 'bg-pink-200',    swatch: 'bg-pink-500' },
  sky:     { bg: 'bg-sky-100',     ring: 'ring-sky-300',     header: 'bg-sky-200',     swatch: 'bg-sky-500' },
  emerald: { bg: 'bg-emerald-100', ring: 'ring-emerald-300', header: 'bg-emerald-200', swatch: 'bg-emerald-500' },
  violet:  { bg: 'bg-violet-100',  ring: 'ring-violet-300',  header: 'bg-violet-200',  swatch: 'bg-violet-500' },
  slate:   { bg: 'bg-slate-100',   ring: 'ring-slate-300',   header: 'bg-slate-200',   swatch: 'bg-slate-500' },
};
const MIN_W = 180;
const MIN_H = 140;

// Navegación del canvas (zoom/pan) — no es dato del tablero, así que vive
// solo en el cliente (localStorage por scope), nunca se manda al backend.
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.5;
const ZOOM_BUTTON_STEP = 1.2;
const WHEEL_SCALE_FACTOR = 0.0015;
const PAN_STEP_PX = 120;
const ROTATE_CLASSES = ['-rotate-1', 'rotate-0', 'rotate-1'];

let scope = 'private';
let boardData = null;
let maxZ = 1;
let pollTimer = null;
// A diferencia de un modal o un input con foco, arrastrar/redimensionar una
// nota o dibujar un trazo no pasa por ningún elemento "enfocable" — sin esta
// bandera un repintado de fondo destruiría la tarjeta en pleno arrastre.
let boardBusy = false;
let view = { scale: 1, tx: 0, ty: 0 };
// 'cruceta' (seleccionar/arrastrar) | 'mano' (mover la vista) | 'lupa' (zoom).
// No se persiste: cada carga del módulo arranca en cruceta, el modo seguro.
let tool = 'cruceta';

export async function render(root, context) {
  await load(root);

  const tick = async () => {
    // #board-canvas se recrea en cada paint(); si ya no está en el DOM es que
    // el router navegó a otro módulo (mismo criterio que whatsapp.js/tareas.js).
    if (!document.getElementById('board-canvas')?.isConnected) { clearInterval(pollTimer); return; }
    if (isUserBusy() || boardBusy) return; // se reintenta en el siguiente tick
    try {
      const fresh = await apiGet('board/list', { scope });
      if (isUserBusy() || boardBusy) return; // pudo empezar a interactuar mientras la petición estaba en vuelo
      boardData = fresh;
      paint(document.getElementById('module-root'));
    } catch { /* red intermitente: se reintenta en el próximo tick */ }
  };
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_MS);
}

function loadView(forScope) {
  try {
    const saved = JSON.parse(localStorage.getItem(`pizarron:view:${forScope}`));
    if (saved && Number.isFinite(saved.scale) && Number.isFinite(saved.tx) && Number.isFinite(saved.ty)) return saved;
  } catch { /* localStorage no disponible o valor corrupto: usar default */ }
  return { scale: 1, tx: 0, ty: 0 };
}

function saveView() {
  try { localStorage.setItem(`pizarron:view:${scope}`, JSON.stringify(view)); } catch { /* modo privado del navegador, etc. */ }
}

async function load(root) {
  root.innerHTML = spinner();
  view = loadView(scope);
  tool = 'cruceta';
  try {
    boardData = await apiGet('board/list', { scope });
  } catch (e) {
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
    return;
  }
  paint(root);
}

function paint(root) {
  maxZ = Math.max(1, ...boardData.items.map((i) => i.z_index));

  root.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          <button type="button" data-scope="private" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${scope === 'private' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
            Mi pizarrón
          </button>
          <button type="button" data-scope="public" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${scope === 'public' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
            Pizarrón público
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="btn-add-note" type="button" class="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-400">
            ${icon('plus', 'h-4 w-4')} Nota
          </button>
          <button id="btn-add-checklist" type="button" class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
            ${icon('check-square', 'h-4 w-4')} Lista
          </button>
          <button id="btn-add-drawing" type="button" class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-500">
            ${icon('edit-3', 'h-4 w-4')} Dibujo
          </button>
        </div>
      </div>

      <div id="board-wrap" class="relative h-[72vh] touch-none overflow-hidden rounded-2xl bg-slate-50 shadow-inner ring-1 ring-slate-200">
        <div id="board-canvas" class="relative"
             style="width:1400px;height:900px;transform-origin:0 0;background-image:radial-gradient(circle,#cbd5e1 1px,transparent 1px);background-size:22px 22px;">
        </div>
        ${!boardData.items.length ? `
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p class="rounded-xl bg-white/90 px-5 py-3 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-slate-200">
            ${scope === 'private' ? 'Tu pizarrón está vacío. Agrega una nota, lista o dibujo.' : 'El pizarrón público está vacío. Sé el primero en pegar algo.'}
          </p>
        </div>` : ''}
        <div class="pointer-events-none absolute inset-0">
          <div id="board-toolbar" class="pointer-events-auto absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
            <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <button type="button" data-tool="cruceta" title="Seleccionar" class="rounded-lg px-2.5 py-1.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100">${icon('crosshair', 'h-4 w-4')}</button>
              <button type="button" data-tool="mano" title="Mover la vista" class="rounded-lg px-2.5 py-1.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100">${icon('hand', 'h-4 w-4')}</button>
              <button type="button" data-tool="lupa" title="Zoom" class="rounded-lg px-2.5 py-1.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100">${icon('search', 'h-4 w-4')}</button>
            </div>
            <div class="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <button type="button" id="btn-zoom-out" title="Alejar" class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">${icon('minus', 'h-4 w-4')}</button>
              <button type="button" id="btn-zoom-reset" title="Restablecer vista" class="w-12 rounded-lg py-1 text-center text-xs font-semibold text-slate-500 hover:bg-slate-100"><span id="zoom-pct">100%</span></button>
              <button type="button" id="btn-zoom-in" title="Acercar" class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">${icon('plus', 'h-4 w-4')}</button>
            </div>
            <div class="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <button type="button" id="btn-pan-left" title="Izquierda" class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">${icon('chevron-left', 'h-4 w-4')}</button>
              <button type="button" id="btn-pan-right" title="Derecha" class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">${icon('chevron-left', 'h-4 w-4 rotate-180')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.scope === scope) return;
    scope = b.dataset.scope;
    load(root);
  }));
  root.querySelector('#btn-add-note').addEventListener('click', () => createItem('note'));
  root.querySelector('#btn-add-checklist').addEventListener('click', () => createItem('checklist'));
  root.querySelector('#btn-add-drawing').addEventListener('click', () => createItem('drawing'));

  const canvas = root.querySelector('#board-canvas');
  boardData.items.forEach((item) => canvas.appendChild(buildCard(item)));

  const wrap = root.querySelector('#board-wrap');
  wrap.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.tool)));
  wrap.querySelector('#btn-zoom-in').addEventListener('click', () => {
    const r = wrap.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, view.scale * ZOOM_BUTTON_STEP);
  });
  wrap.querySelector('#btn-zoom-out').addEventListener('click', () => {
    const r = wrap.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, view.scale / ZOOM_BUTTON_STEP);
  });
  wrap.querySelector('#btn-zoom-reset').addEventListener('click', () => {
    view = { scale: 1, tx: 0, ty: 0 };
    applyTransform(true);
    saveView();
  });
  wrap.querySelector('#btn-pan-left').addEventListener('click', () => panBy(PAN_STEP_PX, 0));
  wrap.querySelector('#btn-pan-right').addEventListener('click', () => panBy(-PAN_STEP_PX, 0));
  wireCanvasNav(wrap);
  applyTransform(false);
  applyToolUI();
}

/* ================= Navegación del canvas (zoom / pan) ================= */
function applyTransform(animated) {
  const canvas = document.getElementById('board-canvas');
  if (!canvas) return;
  canvas.classList.toggle('transition-transform', !!animated);
  canvas.classList.toggle('duration-150', !!animated);
  canvas.classList.toggle('ease-out', !!animated);
  canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  const pct = document.getElementById('zoom-pct');
  if (pct) pct.textContent = Math.round(view.scale * 100) + '%';
}

function applyToolUI() {
  const wrap = document.getElementById('board-wrap');
  if (wrap) {
    wrap.classList.remove('cursor-grab', 'cursor-grabbing', 'cursor-zoom-in');
    if (tool === 'mano') wrap.classList.add('cursor-grab');
    else if (tool === 'lupa') wrap.classList.add('cursor-zoom-in');
  }
  document.querySelectorAll('#board-toolbar [data-tool]').forEach((b) => {
    const active = b.dataset.tool === tool;
    b.className = `rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`;
  });
}

function selectTool(next) {
  if (tool === next) return;
  tool = next;
  applyToolUI();
}

/** Hace zoom manteniendo fijo el punto (screenX, screenY), relativo a #board-wrap. */
function zoomAt(screenX, screenY, newScaleRaw) {
  const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, newScaleRaw));
  if (newScale === view.scale) return;
  const canvasX = (screenX - view.tx) / view.scale;
  const canvasY = (screenY - view.ty) / view.scale;
  view.tx = screenX - canvasX * newScale;
  view.ty = screenY - canvasY * newScale;
  view.scale = newScale;
  applyTransform(true);
  saveView();
}

function panBy(dx, dy) {
  view.tx += dx;
  view.ty += dy;
  applyTransform(true);
  saveView();
}

/** Rueda del mouse (zoom, cualquier herramienta), arrastre con la mano y clic con la lupa. */
function wireCanvasNav(wrap) {
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, view.scale * Math.exp(-e.deltaY * WHEEL_SCALE_FACTOR));
  }, { passive: false });

  let panning = false;
  let startX = 0, startY = 0, startTx = 0, startTy = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if (tool !== 'mano' || e.target.closest('#board-toolbar')) return;
    panning = true;
    boardBusy = true;
    wrap.classList.remove('cursor-grab');
    wrap.classList.add('cursor-grabbing');
    startX = e.clientX;
    startY = e.clientY;
    startTx = view.tx;
    startTy = view.ty;
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!panning) return;
    view.tx = startTx + (e.clientX - startX);
    view.ty = startTy + (e.clientY - startY);
    applyTransform(false);
  });
  const endPan = (e) => {
    if (!panning) return;
    panning = false;
    boardBusy = false;
    wrap.classList.remove('cursor-grabbing');
    if (tool === 'mano') wrap.classList.add('cursor-grab');
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    saveView();
  };
  wrap.addEventListener('pointerup', endPan);
  wrap.addEventListener('pointerleave', endPan);

  wrap.addEventListener('click', (e) => {
    if (tool !== 'lupa' || e.target.closest('#board-toolbar')) return;
    const r = wrap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, view.scale * ZOOM_BUTTON_STEP);
  });
}

async function createItem(type) {
  const n = boardData.items.length;
  const pos = 40 + ((n * 26) % 260);
  try {
    await apiPost('board/save', { scope, type, pos_x: pos, pos_y: pos });
    await refreshCanvas();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refreshCanvas() {
  try {
    boardData = await apiGet('board/list', { scope });
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  paint(document.getElementById('module-root'));
}

/** Guarda cambios parciales: actualiza el objeto local y envía solo lo que cambió. */
async function saveField(item, patch) {
  Object.assign(item, patch);
  try {
    await apiPost('board/save', { id: item.id, ...patch });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function bringToFront(el, item) {
  maxZ += 1;
  item.z_index = maxZ;
  el.style.zIndex = String(maxZ);
}

/* ================= Tarjeta ================= */
function buildCard(item) {
  const canEdit = scope === 'private' || item.created_by === boardData.me || boardData.can_manage;
  const palette = PALETTE[item.color] || PALETTE.amber;

  const rotateCls = ROTATE_CLASSES[item.id % ROTATE_CLASSES.length];
  const el = document.createElement('div');
  el.className = `absolute flex flex-col overflow-hidden rounded-xl shadow-md ring-1 ${palette.ring} ${palette.bg} ${rotateCls}`;
  el.style.left = item.pos_x + 'px';
  el.style.top = item.pos_y + 'px';
  el.style.width = item.width + 'px';
  el.style.height = item.height + 'px';
  el.style.zIndex = String(item.z_index);
  el.dataset.id = item.id;

  const pin = document.createElement('div');
  pin.className = 'pointer-events-none absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 text-red-500 drop-shadow-sm';
  pin.innerHTML = icon('pin', 'h-5 w-5');
  el.appendChild(pin);

  const header = document.createElement('div');
  header.className = `flex shrink-0 touch-none items-center gap-1 ${palette.header} px-2 py-1.5 cursor-grab active:cursor-grabbing`;
  header.innerHTML = `
    <span class="shrink-0 text-slate-500">${icon('move', 'h-3.5 w-3.5')}</span>
    <input type="text" value="${escapeHtml(item.title || '')}" placeholder="Título" ${canEdit ? '' : 'readonly tabindex="-1"'}
           class="min-w-0 flex-1 truncate border-0 bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400">
    ${canEdit ? `<button type="button" data-cycle-color title="Cambiar color" class="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10 ${palette.swatch}"></button>` : ''}
    ${canEdit ? `<button type="button" data-del title="Eliminar" class="shrink-0 rounded p-1 text-slate-500 hover:bg-black/10">${icon('trash', 'h-3.5 w-3.5')}</button>` : ''}
  `;
  el.appendChild(header);

  // Nota: el <textarea> ya es su propio contenedor de scroll (con ajuste de línea
  // nativo del navegador) — envolverlo además en un div con overflow-auto duplica
  // el scroll vertical y, por un desajuste de unos px entre ambos, aparecían dos
  // barras de desplazamiento a la vez. Lista sí necesita el overflow del wrapper:
  // sus renglones son divs planos, sin scroll propio.
  const body = document.createElement('div');
  body.className = item.type === 'drawing'
    ? 'flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-1.5'
    : item.type === 'note'
      ? 'min-h-0 flex-1 p-2'
      : 'min-h-0 flex-1 overflow-auto p-2';
  el.appendChild(body);

  if (item.type === 'note') buildNoteBody(body, item, canEdit);
  else if (item.type === 'checklist') buildChecklistBody(body, item, canEdit);
  else buildDrawingBody(body, item, canEdit);

  if (scope === 'public' && item.creator_name) {
    const foot = document.createElement('div');
    foot.className = 'shrink-0 truncate border-t border-black/5 px-2 py-1 text-[10px] text-slate-500';
    foot.textContent = item.creator_name;
    el.appendChild(foot);
  }

  if (canEdit && item.type !== 'drawing') {
    const handle = document.createElement('div');
    handle.className = 'absolute bottom-0 right-0 h-4 w-4 touch-none cursor-nwse-resize text-slate-400';
    handle.innerHTML = '<svg viewBox="0 0 24 24" class="h-4 w-4"><path d="M21 21H15M21 21V15M21 21L13 13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    el.appendChild(handle);
    wireResize(el, handle, item);
  }

  if (canEdit) {
    wireDrag(el, header, item);
    const titleInput = header.querySelector('input');
    titleInput.addEventListener('input', debounce(() => saveField(item, { title: titleInput.value }), 500));
    header.querySelector('[data-cycle-color]').addEventListener('click', async () => {
      const next = COLOR_KEYS[(COLOR_KEYS.indexOf(item.color) + 1) % COLOR_KEYS.length];
      await saveField(item, { color: next });
      await refreshCanvas();
    });
    header.querySelector('[data-del]').addEventListener('click', async () => {
      const ok = await confirmDialog('Eliminar', '¿Eliminar este elemento del pizarrón?', { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('board/delete', { id: item.id });
        await refreshCanvas();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  return el;
}

function buildNoteBody(body, item, canEdit) {
  const ta = document.createElement('textarea');
  ta.value = item.content.text || '';
  ta.placeholder = 'Escribe aquí…';
  ta.readOnly = !canEdit;
  ta.className = 'h-full w-full resize-none break-words border-0 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400';
  body.appendChild(ta);
  if (canEdit) {
    ta.addEventListener('input', debounce(() => saveField(item, { content: { text: ta.value } }), 600));
  }
}

function buildChecklistBody(body, item, canEdit) {
  item.content.items = item.content.items || [];
  const list = document.createElement('div');
  list.className = 'space-y-1';
  body.appendChild(list);

  const persist = () => saveField(item, { content: { items: item.content.items } });

  const renderRows = () => {
    list.innerHTML = '';
    item.content.items.forEach((row, idx) => {
      const line = document.createElement('div');
      line.className = 'flex items-center gap-1.5';
      line.innerHTML = `
        <input type="checkbox" ${row.done ? 'checked' : ''} ${canEdit ? '' : 'disabled'}
               class="h-3.5 w-3.5 shrink-0 rounded border-slate-400 text-indigo-600 focus:ring-indigo-500">
        <input type="text" value="${escapeHtml(row.text)}" ${canEdit ? '' : 'readonly tabindex="-1"'} placeholder="Pendiente…"
               class="min-w-0 flex-1 truncate border-0 bg-transparent text-sm outline-none ${row.done ? 'text-slate-400 line-through' : 'text-slate-800'}">
        ${canEdit ? `<button type="button" data-rm class="shrink-0 rounded p-0.5 text-slate-300 hover:text-red-500">${icon('x', 'h-3 w-3')}</button>` : ''}
      `;
      const textInput = line.querySelector('[type=text]');
      line.querySelector('[type=checkbox]').addEventListener('change', (e) => {
        row.done = e.target.checked;
        textInput.classList.toggle('line-through', row.done);
        textInput.classList.toggle('text-slate-400', row.done);
        textInput.classList.toggle('text-slate-800', !row.done);
        persist();
      });
      if (canEdit) {
        textInput.addEventListener('input', debounce(() => { row.text = textInput.value; persist(); }, 500));
        line.querySelector('[data-rm]').addEventListener('click', () => {
          item.content.items.splice(idx, 1);
          persist();
          renderRows();
        });
      }
      list.appendChild(line);
    });
  };
  renderRows();

  if (canEdit) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600';
    addBtn.innerHTML = `${icon('plus', 'h-3 w-3')} agregar`;
    addBtn.addEventListener('click', () => {
      item.content.items.push({ text: '', done: false });
      persist();
      renderRows();
      list.lastElementChild?.querySelector('[type=text]')?.focus();
    });
    body.appendChild(addBtn);
  }
}

/** Dibujo a mano libre: trazos en SVG capturados con Pointer Events (mouse, táctil o lápiz). */
function buildDrawingBody(body, item, canEdit) {
  const strokes = item.content.strokes || (item.content.strokes = []);

  const toolbar = document.createElement('div');
  toolbar.className = 'flex shrink-0 items-center gap-1.5';
  let penColor = '#1e293b';
  let penWidth = 3;

  if (canEdit) {
    const penDots = ['#1e293b', '#dc2626', '#2563eb', '#16a34a'].map((hex) => `
      <button type="button" data-pen="${hex}" class="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10" style="background:${hex}"></button>`).join('');
    toolbar.innerHTML = `
      ${penDots}
      <button type="button" data-thin class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-300">Fino</button>
      <button type="button" data-thick class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-300">Grueso</button>
      <button type="button" data-undo title="Deshacer" class="ml-auto shrink-0 rounded p-1 text-slate-500 hover:bg-black/10">${icon('undo', 'h-3.5 w-3.5')}</button>
      <button type="button" data-clear title="Borrar todo" class="shrink-0 rounded p-1 text-slate-500 hover:bg-black/10">${icon('trash', 'h-3.5 w-3.5')}</button>
    `;
  }
  body.appendChild(toolbar);

  const svgWrap = document.createElement('div');
  svgWrap.className = 'min-h-0 flex-1 overflow-hidden rounded-lg bg-white';
  body.appendChild(svgWrap);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'h-full w-full touch-none');
  svgWrap.appendChild(svg);

  const renderStrokes = () => {
    svg.innerHTML = '';
    for (const s of strokes) {
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', pointsToPath(s.points));
      path.setAttribute('stroke', s.color);
      path.setAttribute('stroke-width', String(s.width));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
  };
  renderStrokes();
  if (!canEdit) return;

  toolbar.querySelectorAll('[data-pen]').forEach((b) => b.addEventListener('click', () => { penColor = b.dataset.pen; }));
  toolbar.querySelector('[data-thin]').addEventListener('click', () => { penWidth = 2; });
  toolbar.querySelector('[data-thick]').addEventListener('click', () => { penWidth = 6; });
  toolbar.querySelector('[data-undo]').addEventListener('click', () => {
    strokes.pop();
    renderStrokes();
    saveField(item, { content: { strokes } });
  });
  toolbar.querySelector('[data-clear]').addEventListener('click', async () => {
    if (!strokes.length) return;
    const ok = await confirmDialog('Borrar dibujo', 'Se borrarán todos los trazos. ¿Continuar?', { danger: true, confirmLabel: 'Borrar' });
    if (!ok) return;
    strokes.length = 0;
    renderStrokes();
    saveField(item, { content: { strokes } });
  });

  let current = null;
  const toLocal = (e) => {
    // getBoundingClientRect() ya viene escalada por el zoom del canvas
    // (#board-canvas tiene un transform: scale ancestro); el SVG no declara
    // viewBox, así que su sistema de coordenadas interno es en píxeles sin
    // escalar — hay que revertir la escala para que el trazo caiga donde
    // realmente está el cursor.
    const r = svg.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / view.scale), Math.round((e.clientY - r.top) / view.scale)];
  };
  svg.addEventListener('pointerdown', (e) => {
    if (tool !== 'cruceta') return;
    current = { color: penColor, width: penWidth, points: [toLocal(e)] };
    strokes.push(current);
    renderStrokes();
    svg.setPointerCapture(e.pointerId);
    boardBusy = true;
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!current) return;
    current.points.push(toLocal(e));
    renderStrokes();
  });
  const endStroke = () => {
    if (!current) return;
    current = null;
    boardBusy = false;
    saveField(item, { content: { strokes } });
  };
  svg.addEventListener('pointerup', endStroke);
  svg.addEventListener('pointerleave', endStroke);
}

function pointsToPath(points) {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
}

/* ================= Arrastrar y redimensionar ================= */
function wireDrag(el, header, item) {
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  const onMove = (e) => {
    if (!dragging) return;
    // El delta del puntero llega en píxeles de pantalla; #board-canvas puede
    // estar escalado (zoom), así que hay que revertir la escala para que la
    // tarjeta se mueva 1:1 con el cursor a cualquier nivel de zoom.
    el.style.left = Math.max(0, startLeft + (e.clientX - startX) / view.scale) + 'px';
    el.style.top = Math.max(0, startTop + (e.clientY - startY) / view.scale) + 'px';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    boardBusy = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    saveField(item, { pos_x: parseInt(el.style.left, 10), pos_y: parseInt(el.style.top, 10), z_index: item.z_index });
  };
  header.addEventListener('pointerdown', (e) => {
    if (tool !== 'cruceta' || e.target.closest('input, button')) return;
    dragging = true;
    boardBusy = true;
    bringToFront(el, item);
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(el.style.left, 10) || 0;
    startTop = parseInt(el.style.top, 10) || 0;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
}

function wireResize(el, handle, item) {
  let resizing = false;
  let startX = 0, startY = 0, startW = 0, startH = 0;

  const onMove = (e) => {
    if (!resizing) return;
    el.style.width = Math.max(MIN_W, startW + (e.clientX - startX) / view.scale) + 'px';
    el.style.height = Math.max(MIN_H, startH + (e.clientY - startY) / view.scale) + 'px';
  };
  const onUp = () => {
    if (!resizing) return;
    resizing = false;
    boardBusy = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    saveField(item, { width: parseInt(el.style.width, 10), height: parseInt(el.style.height, 10) });
  };
  handle.addEventListener('pointerdown', (e) => {
    if (tool !== 'cruceta') return;
    resizing = true;
    boardBusy = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = el.offsetWidth;
    startH = el.offsetHeight;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
    e.stopPropagation();
  });
}
