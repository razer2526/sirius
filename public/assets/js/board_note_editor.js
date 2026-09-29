/**
 * Editor de notas del Pizarrón: texto con formato (tipografía, tamaño, negritas,
 * cursivas, subrayado, alineación, color) y renglones de pendiente con casilla,
 * todo en la MISMA nota.
 *
 * El contenido se guarda como bloques JSON, nunca como HTML:
 *   { v: 2, blocks: [
 *       { t: 'p',    align, runs: [ { s, b?, i?, u?, c?, f?, z? } ] },
 *       { t: 'todo', align, done, runs: [ ... ] } ] }
 * Motivo: el pizarrón público lo ven todos. Guardar el innerHTML de un
 * contenteditable sería XSS almacenado; aquí el cliente arma nodos con textContent
 * y asigna estilos desde valores que el servidor ya acotó (ver board_validate_note
 * en handlers/board.php). Y de paso la nota queda como datos que se pueden dibujar
 * directo en un <canvas> (el botón de compartir como imagen, más adelante).
 *
 * Se edita sobre un contenteditable con document.execCommand. Está marcado como
 * obsoleto, pero es lo único nativo que existe para dar formato a una selección sin
 * escribir un motor de texto o meter una librería (Sirius no usa ninguna), y sigue
 * funcionando en todos los navegadores actuales. Por eso el guardado NO confía en el
 * markup que cada navegador fabrique (<b>, <span style>, <font>…): serializa leyendo
 * el estilo CALCULADO de cada nodo de texto.
 */

import { icon, escapeHtml, debounce } from './ui.js';

/* ================= Tipografías ================= */

/** Claves que el servidor acepta (BOARD_FONTS en handlers/board.php): mantener iguales. */
export const FONTS = [
  { key: 'inter',        label: 'Inter',            css: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { key: 'nunito',       label: 'Nunito',           css: "'Nunito', ui-rounded, 'Segoe UI', sans-serif" },
  { key: 'lora',         label: 'Lora',             css: "'Lora', Georgia, 'Times New Roman', serif" },
  { key: 'playfair',     label: 'Playfair Display', css: "'Playfair Display', Georgia, serif" },
  { key: 'merriweather', label: 'Merriweather',     css: "'Merriweather', Georgia, serif" },
  { key: 'caveat',       label: 'Caveat',           css: "'Caveat', 'Comic Sans MS', cursive" },
  { key: 'marker',       label: 'Permanent Marker', css: "'Permanent Marker', 'Comic Sans MS', cursive" },
  { key: 'mono',         label: 'Roboto Mono',      css: "'Roboto Mono', ui-monospace, Consolas, monospace" },
];
const FONT_BY_KEY = Object.fromEntries(FONTS.map((f) => [f.key, f]));
// El primer nombre de la pila calculada -> clave.
const FONT_KEY_BY_NAME = Object.fromEntries(FONTS.map((f) => [f.label.toLowerCase(), f.key]));

const BASE = { font: 'inter', size: 14, color: '#1e293b' };
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
const COLORS = [
  '#1e293b', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0891b2', '#2563eb', '#7c3aed',
  '#db2777', '#64748b', '#000000', '#ffffff',
];

/** Las fuentes se piden solo cuando se abre el Pizarrón (no engordan la carga de toda la app). */
export function ensureBoardFonts() {
  if (document.getElementById('board-fonts-css')) return;
  const link = document.createElement('link');
  link.id = 'board-fonts-css';
  link.rel = 'stylesheet';
  link.href = 'assets/fonts/board_fonts.css';
  document.head.appendChild(link);
}

/* ================= Contenido <-> bloques ================= */

/** Bloques de una nota, sea del formato nuevo o del anterior ({ text }). */
export function toBlocks(content) {
  if (content && Array.isArray(content.blocks)) return content.blocks;
  const text = String((content && content.text) || '');
  const lines = text === '' ? [''] : text.split('\n');
  return lines.map((line) => ({ t: 'p', align: 'left', runs: line ? [{ s: line }] : [] }));
}

function appendText(parent, text) {
  text.split('\n').forEach((part, i) => {
    if (i > 0) parent.appendChild(document.createElement('br'));
    if (part) parent.appendChild(document.createTextNode(part));
  });
}

function fillRuns(target, runs) {
  (runs || []).forEach((run) => {
    const styled = run.b || run.i || run.u || run.c || run.f || run.z;
    let holder = target;
    if (styled) {
      holder = document.createElement('span');
      const st = holder.style;
      if (run.b) st.fontWeight = '700';
      if (run.i) st.fontStyle = 'italic';
      if (run.u) st.textDecoration = 'underline';
      if (run.c) st.color = run.c;
      if (run.f && FONT_BY_KEY[run.f]) st.fontFamily = FONT_BY_KEY[run.f].css;
      if (run.z) st.fontSize = run.z + 'px';
      target.appendChild(holder);
    }
    appendText(holder, String(run.s || ''));
  });
  // Un <br> final no se ve como línea vacía, salvo que le siga otro; sin este
  // segundo, un salto de línea al final de un bloque se perdería al recargar.
  let tail = target;
  while (tail.lastChild) tail = tail.lastChild;
  if (tail.nodeName === 'BR') target.appendChild(document.createElement('br'));
  // Bloque vacío: el <br> es lo que le da altura de línea y donde cae el cursor.
  if (!target.firstChild) target.appendChild(document.createElement('br'));
}

// Palomita propia (más gruesa que los íconos del sistema, que a 12 px se ven finos).
// No se usa icon('check'): ese nombre no existe en ui.js y caería al ícono de carpeta.
const TICK_SVG = '<svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3.5" '
  + 'stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

const TODO_BOX_BASE ='todo-box mt-[3px] flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border';

function paintTodoState(block) {
  const done = block.dataset.done === '1';
  const box = block.querySelector('.todo-box');
  const txt = block.querySelector('.todo-text');
  box.className = TODO_BOX_BASE + (done ? ' border-indigo-600 bg-indigo-600 text-white' : ' border-slate-400 bg-white text-transparent');
  box.innerHTML = done ? TICK_SVG : '';
  box.setAttribute('aria-checked', done ? 'true' : 'false');
  txt.classList.toggle('line-through', done);
  txt.classList.toggle('opacity-60', done);
}

function buildBlockEl(block) {
  const align = ['center', 'right', 'justify'].includes(block.align) ? block.align : 'left';
  if (block.t === 'todo') {
    const el = document.createElement('div');
    el.dataset.b = 'todo';
    el.dataset.done = block.done ? '1' : '0';
    el.className = 'flex items-start gap-2 py-0.5';

    const box = document.createElement('span');
    // La clase inicial es la que paintTodoState usa para encontrarla (después la reemplaza).
    box.className = 'todo-box';
    box.contentEditable = 'false';
    box.setAttribute('role', 'checkbox');
    const txt = document.createElement('div');
    txt.className = 'todo-text min-w-0 flex-1';
    txt.style.textAlign = align;
    el.append(box, txt);
    fillRuns(txt, block.runs);
    paintTodoState(el);
    return el;
  }
  const el = document.createElement('div');
  el.dataset.b = 'p';
  el.style.textAlign = align;
  fillRuns(el, block.runs);
  return el;
}

function fillDoc(root, blocks) {
  root.innerHTML = '';
  (blocks.length ? blocks : [{ t: 'p', runs: [] }]).forEach((b) => root.appendChild(buildBlockEl(b)));
}

/** El elemento que contiene el texto de un bloque (en un pendiente, el de la derecha de la casilla). */
const contentOf = (block) => (block.dataset.b === 'todo' ? block.querySelector('.todo-text') : block);

function rgbToHex(str) {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(str || '');
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

/** Estilo efectivo de un nodo de texto, comparado contra el de base de la nota. */
function styleOf(el, stop) {
  const cs = getComputedStyle(el);
  const st = {};
  if (parseInt(cs.fontWeight, 10) >= 600) st.b = true;
  if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') st.i = true;
  // text-decoration no se hereda: se propaga, así que hay que subir por los ancestros.
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (getComputedStyle(n).textDecorationLine.includes('underline')) { st.u = true; break; }
  }
  const hex = rgbToHex(cs.color);
  if (hex && hex !== BASE.color) st.c = hex;
  const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const key = FONT_KEY_BY_NAME[first];
  if (key && key !== BASE.font) st.f = key;
  const size = Math.round(parseFloat(cs.fontSize));
  if (size && size !== BASE.size) st.z = size;
  return st;
}

const sameStyle = (a, b) => ['b', 'i', 'u', 'c', 'f', 'z'].every((k) => (a[k] || false) === (b[k] || false));
const BLOCKISH = new Set(['DIV', 'P', 'LI']);

/** ¿Sigue algo después de este nodo dentro del bloque? (en orden de documento, no solo entre hermanos) */
function hasContentAfter(node, limit) {
  for (let n = node; n && n !== limit; n = n.parentNode) if (n.nextSibling) return true;
  return false;
}

function collectRuns(contentEl, stop) {
  const runs = [];
  const push = (text, st) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.st, st)) last.s += text;
    else runs.push({ s: text, st });
  };
  const walk = (node) => {
    if (node.nodeType === 3) { push(node.textContent, styleOf(node.parentElement, stop)); return; }
    if (node.nodeType !== 1 || node.getAttribute('contenteditable') === 'false') return;
    if (node.nodeName === 'BR') {
      // Un <br> que cierra su contenedor es el "marcador" que pone el navegador
      // para dar altura a una línea vacía, no un salto que el usuario escribió.
      if (hasContentAfter(node, contentEl)) push('\n', styleOf(node.parentElement, stop));
      return;
    }
    if (node !== contentEl && BLOCKISH.has(node.nodeName) && runs.length) {
      const last = runs[runs.length - 1];
      if (!last.s.endsWith('\n')) push('\n', last.st);
    }
    node.childNodes.forEach(walk);
  };
  contentEl.childNodes.forEach(walk);
  return runs.map(({ s, st }) => ({ s, ...st }));
}

function alignOf(contentEl) {
  const a = getComputedStyle(contentEl).textAlign;
  return a === 'center' || a === 'right' || a === 'justify' ? a : (a === 'end' ? 'right' : 'left');
}

/** Lee el DOM del editor y devuelve los bloques. No modifica el DOM. */
function serializeDoc(root) {
  const blocks = [];
  let stray = [];

  const flushStray = () => {
    if (!stray.length) return;
    const holder = document.createElement('div');
    stray.forEach((n) => holder.appendChild(n.cloneNode(true)));
    // El clon no está en el documento: se monta un instante para poder leer estilos.
    holder.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    root.appendChild(holder);
    const runs = collectRuns(holder, root);
    root.removeChild(holder);
    if (runs.length) blocks.push({ t: 'p', align: 'left', runs });
    stray = [];
  };

  root.childNodes.forEach((node) => {
    const isBlock = node.nodeType === 1 && (node.dataset.b || BLOCKISH.has(node.nodeName));
    if (!isBlock) {
      if (node.nodeType === 3 && !node.textContent) return;
      stray.push(node);
      return;
    }
    flushStray();
    const kind = node.dataset.b === 'todo' ? 'todo' : 'p';
    const contentEl = contentOf(node) || node;
    const block = { t: kind, align: alignOf(contentEl), runs: collectRuns(contentEl, root) };
    if (kind === 'todo') block.done = node.dataset.done === '1';
    blocks.push(block);
  });
  flushStray();
  return { v: 2, blocks };
}

/* ================= Selección ================= */

function offsetOf(root, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

function saveSel(root) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return { start: offsetOf(root, r.startContainer, r.startOffset), end: offsetOf(root, r.endContainer, r.endOffset) };
}

/** Mover nodos de un lado a otro suelta la selección del navegador: se reconstruye por offsets de texto. */
function restoreSel(root, saved) {
  if (!saved) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode = null, startOff = 0, endNode = null, endOff = 0, last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent.length;
    if (!startNode && saved.start <= pos + len) { startNode = n; startOff = saved.start - pos; }
    if (!endNode && saved.end <= pos + len) { endNode = n; endOff = saved.end - pos; }
    last = n;
    pos += len;
    if (startNode && endNode) break;
  }
  const r = document.createRange();
  try {
    if (startNode) r.setStart(startNode, startOff); else if (last) r.setStart(last, last.textContent.length); else r.setStart(root, 0);
    if (endNode) r.setEnd(endNode, endOff); else if (last) r.setEnd(last, last.textContent.length); else r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch { /* la selección ya no existe: no pasa nada */ }
}

/** Bloque (hijo directo del editor) que contiene un nodo. */
function blockOf(root, node) {
  let n = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && n.nodeType === 1 ? n : null;
}

/** Bloque donde está el cursor, incluso si el navegador lo dejó a nivel del contenedor (entre bloques). */
function blockAtSelection(root) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const { startContainer, startOffset } = sel.getRangeAt(0);
  if (startContainer === root) return root.children[Math.min(startOffset, root.children.length - 1)] || null;
  return blockOf(root, startContainer);
}

function blocksInSelection(root) {
  const sel = getSelection();
  if (!sel.rangeCount) return [];
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return [];
  return [...root.children].filter((c) => r.intersectsNode(c));
}

/* ================= Instancia del editor ================= */

// Una sola nota se edita a la vez (la que tiene el foco); el menú es uno por pizarrón.
let active = null;
let menu = null;

/**
 * @param {HTMLElement} body   contenedor de la nota dentro de la tarjeta
 * @param {object} item        elemento del pizarrón (item.content se lee al montar)
 * @param {object} opts        { canEdit, cardEl, onSave(content) }
 */
export function mountNoteEditor(body, item, { canEdit, cardEl, onSave }) {
  const root = document.createElement('div');
  root.className = 'h-full w-full overflow-y-auto break-words outline-none';
  // Base tipográfica INLINE (no clases de Tailwind): v4 calcula sus colores en oklch,
  // y el serializador necesita rgb() para compararlos contra la base.
  root.style.cssText = `color:${BASE.color};font-family:${FONT_BY_KEY[BASE.font].css};font-size:${BASE.size}px;line-height:1.5;`;
  fillDoc(root, toBlocks(item.content));
  body.appendChild(root);

  if (!canEdit) {
    root.contentEditable = 'false';
    return;
  }

  const placeholder = document.createElement('span');
  placeholder.className = 'pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400';
  placeholder.textContent = 'Escribe aquí…';
  body.appendChild(placeholder);
  const syncPlaceholder = () => {
    const empty = root.children.length === 1 && root.textContent === '' && root.firstElementChild.dataset.b !== 'todo';
    placeholder.classList.toggle('hidden', !empty);
  };
  syncPlaceholder();

  root.contentEditable = 'true';
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-label', 'Nota');

  let dirty = false;
  let pendingSize = null;

  const ed = {
    root,
    cardEl,
    flush() {
      if (!dirty) return;
      dirty = false;
      onSave(serializeDoc(root));
    },
    /** Marca cambios; con `now` se guarda ya (un repintado de fondo no debe alcanzar un cambio sin guardar). */
    touch(now = false) {
      dirty = true;
      syncPlaceholder();
      if (now) ed.flush(); else debouncedFlush();
    },
    pendingSize: (px) => { pendingSize = px; },
    takePendingSize: () => { const p = pendingSize; pendingSize = null; return p; },
  };
  const debouncedFlush = debounce(() => ed.flush(), 600);

  document.execCommand('defaultParagraphSeparator', false, 'div');

  root.addEventListener('focus', () => {
    active = ed;
    showMenu();
  });
  root.addEventListener('blur', () => {
    ed.flush();
    setTimeout(() => {
      // Si el foco se fue a otro lado (no a la ventana en general), el menú se retira.
      if (active === ed && document.activeElement !== root) { active = null; hideMenu(); }
    }, 0);
  });

  root.addEventListener('input', () => {
    convertPendingFonts(ed);
    ed.touch();
  });

  root.addEventListener('keydown', (e) => handleKeydown(e, ed));

  // Solo texto plano: pegar HTML ajeno traería estilos y estructura que no son de la nota.
  root.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) document.execCommand('insertText', false, text);
  });
  root.addEventListener('drop', (e) => e.preventDefault());

  // Casilla de un pendiente. Se cancela el mousedown para no mover el cursor ni el foco.
  root.addEventListener('mousedown', (e) => { if (e.target.closest('.todo-box')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const box = e.target.closest('.todo-box');
    if (!box || !root.contains(box)) return;
    const block = box.closest('[data-b="todo"]');
    block.dataset.done = block.dataset.done === '1' ? '0' : '1';
    paintTodoState(block);
    ed.touch(true);
  });
}

/* ---- Teclado dentro de la nota ---- */

function handleKeydown(e, ed) {
  const { root } = ed;
  // Durante una composición (acento con tecla muerta, IME) Enter la confirma: no es un salto de línea.
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const block = blockOf(root, sel.getRangeAt(0).startContainer);
    if (block && block.dataset.b === 'todo') {
      e.preventDefault();
      splitTodo(ed, block);
    }
    return;
  }
  if (e.key === 'Backspace') {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const block = blockOf(root, sel.getRangeAt(0).startContainer);
    if (!block || block.dataset.b !== 'todo') return;
    const txt = contentOf(block);
    const r = document.createRange();
    r.selectNodeContents(txt);
    r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    // Al inicio del renglón, borrar hacia atrás lo saca de la lista en vez de fusionarlo con el anterior.
    if (r.toString() === '' && !r.cloneContents().querySelector('br')) {
      e.preventDefault();
      convertBlocks(ed, [block], 'p');
    }
  }
}

function caretAtStart(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function splitTodo(ed, block) {
  const txt = contentOf(block);
  // Enter en un pendiente vacío termina la lista, como en cualquier editor.
  if (txt.textContent === '') {
    convertBlocks(ed, [block], 'p');
    return;
  }
  const sel = getSelection();
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tail = document.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(txt, txt.childNodes.length);
  const frag = tail.extractContents();

  const next = buildBlockEl({ t: 'todo', done: false, align: alignOf(txt), runs: [] });
  const nextTxt = contentOf(next);
  nextTxt.innerHTML = '';
  nextTxt.appendChild(frag);
  if (!nextTxt.textContent && !nextTxt.querySelector('br')) nextTxt.appendChild(document.createElement('br'));
  if (!txt.textContent && !txt.querySelector('br')) txt.appendChild(document.createElement('br'));
  block.after(next);
  caretAtStart(nextTxt);
  ed.touch();
}

/** Convierte bloques a 'p' o a 'todo' conservando su contenido y alineación. */
function convertBlocks(ed, blocks, to) {
  const { root } = ed;
  const saved = saveSel(root);
  blocks.forEach((b) => {
    const from = b.dataset.b === 'todo' ? 'todo' : 'p';
    if (from === to) return;
    const src = contentOf(b);
    const fresh = buildBlockEl({ t: to, done: false, align: alignOf(src), runs: [] });
    const dst = contentOf(fresh);
    dst.innerHTML = '';
    while (src.firstChild) dst.appendChild(src.firstChild);
    if (!dst.firstChild) dst.appendChild(document.createElement('br'));
    b.replaceWith(fresh);
  });
  restoreSel(root, saved);
  ed.touch();
}

/* ---- Formato ---- */

function exec(cmd, value) {
  document.execCommand('styleWithCSS', false, true);
  return document.execCommand(cmd, false, value);
}

/**
 * execCommand('fontSize') solo entiende 1-7. Se pide el 7 (sin CSS, para que emita
 * <font size="7">) y aquí se reemplaza por un <span> con el tamaño real en píxeles.
 */
function convertFontTags(ed, px) {
  const { root } = ed;
  const fonts = root.querySelectorAll('font[size]');
  if (!fonts.length) return;
  const saved = saveSel(root);
  fonts.forEach((f) => {
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    while (f.firstChild) span.appendChild(f.firstChild);
    // Un tamaño anterior dentro de la selección ganaría sobre el nuevo.
    span.querySelectorAll('[style*="font-size"]').forEach((n) => { n.style.fontSize = ''; });
    f.replaceWith(span);
  });
  restoreSel(root, saved);
}

/** Con el cursor sin selección, el <font> aparece hasta que se teclea: se convierte entonces. */
function convertPendingFonts(ed) {
  if (!ed.root.querySelector('font[size]')) return;
  convertFontTags(ed, ed.takePendingSize() || BASE.size);
}

function applySize(px) {
  if (!active) return;
  const ed = active;
  const collapsed = getSelection().isCollapsed;
  // execCommand dispara 'input' de inmediato, y el manejador de input convierte los
  // <font> que encuentre: el tamaño tiene que estar declarado ANTES, o los convertiría
  // con el de base.
  ed.pendingSize(px);
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  document.execCommand('styleWithCSS', false, true);
  if (!collapsed) {
    convertFontTags(ed, px);
    ed.takePendingSize();
  }
  ed.touch();
  refreshMenu();
}

function currentSize() {
  const sel = getSelection();
  if (!sel.anchorNode) return BASE.size;
  const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  return Math.round(parseFloat(getComputedStyle(el).fontSize)) || BASE.size;
}

function stepSize(dir) {
  const cur = currentSize();
  const next = dir > 0
    ? (SIZES.find((s) => s > cur) ?? SIZES[SIZES.length - 1])
    : ([...SIZES].reverse().find((s) => s < cur) ?? SIZES[0]);
  applySize(next);
}

function toggleTodo(ed) {
  let blocks = blocksInSelection(ed.root);
  if (!blocks.length) {
    const b = blockAtSelection(ed.root);
    if (b) blocks = [b];
  }
  if (!blocks.length) return;
  const allTodo = blocks.every((b) => b.dataset.b === 'todo');
  convertBlocks(ed, blocks, allTodo ? 'p' : 'todo');
}

/* ================= Menú flotante ================= */

const BTN = 'flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100';

function menuHtml() {
  return `
    <div class="grid grid-cols-2 gap-1 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
      <button type="button" data-cmd="font" title="Tipografía" class="${BTN}">${icon('type', 'h-4 w-4')}</button>
      <button type="button" data-cmd="color" title="Color del texto" class="${BTN}"><span data-color-dot class="h-4 w-4 rounded-full ring-1 ring-black/20" style="background:${BASE.color}"></span></button>
      <button type="button" data-cmd="size-down" title="Letra más chica" class="${BTN} text-[11px] font-bold">A−</button>
      <button type="button" data-cmd="size-up" title="Letra más grande" class="${BTN} text-sm font-bold">A+</button>
      <div class="col-span-2 -mt-0.5 text-center text-[10px] font-semibold text-slate-400"><span data-size-readout>${BASE.size}</span> px</div>
      <button type="button" data-cmd="bold" title="Negrita" class="${BTN}">${icon('bold', 'h-4 w-4')}</button>
      <button type="button" data-cmd="italic" title="Cursiva" class="${BTN}">${icon('italic', 'h-4 w-4')}</button>
      <button type="button" data-cmd="underline" title="Subrayado" class="${BTN}">${icon('underline', 'h-4 w-4')}</button>
      <button type="button" data-cmd="todo" title="Lista de pendientes" class="${BTN}">${icon('check-square', 'h-4 w-4')}</button>
      <button type="button" data-cmd="align-left" title="Alinear a la izquierda" class="${BTN}">${icon('align-left', 'h-4 w-4')}</button>
      <button type="button" data-cmd="align-center" title="Centrar" class="${BTN}">${icon('align-center', 'h-4 w-4')}</button>
      <button type="button" data-cmd="align-right" title="Alinear a la derecha" class="${BTN}">${icon('align-right', 'h-4 w-4')}</button>
      <button type="button" data-cmd="align-justify" title="Justificar" class="${BTN}">${icon('align-justify', 'h-4 w-4')}</button>
    </div>
    <div data-pop="font" class="absolute hidden w-44 rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
      ${FONTS.map((f) => `
        <button type="button" data-font="${f.key}" class="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[15px] text-slate-700 hover:bg-slate-100"
                style="font-family:${f.css}">${escapeHtml(f.label)}</button>`).join('')}
    </div>
    <div data-pop="color" class="absolute hidden rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
      <div class="grid grid-cols-4 gap-1.5">
        ${COLORS.map((c) => `
          <button type="button" data-color="${c}" title="${c}" class="h-6 w-6 rounded-full ring-1 ring-black/15" style="background:${c}"></button>`).join('')}
      </div>
    </div>`;
}

/** Crea el menú dentro de #board-wrap (FUERA del canvas escalado: el zoom no debe agrandarlo ni encogerlo). */
export function attachNoteMenu(wrap) {
  active = null;
  const el = document.createElement('div');
  el.id = 'note-menu';
  el.className = 'absolute z-30 hidden select-none';
  el.innerHTML = menuHtml();
  wrap.appendChild(el);
  menu = { el };

  // Pulsar un botón le quitaría el foco (y con él la selección) al editor: el formato
  // se aplicaría a nada. Se cancela en pointerdown Y mousedown porque cada navegador
  // decide el foco en uno u otro.
  const keepFocus = (e) => e.preventDefault();
  el.addEventListener('pointerdown', keepFocus);
  el.addEventListener('mousedown', keepFocus);

  el.addEventListener('click', (e) => {
    if (!active) return;
    const ed = active;
    const fontBtn = e.target.closest('[data-font]');
    const colorBtn = e.target.closest('[data-color]');
    const cmdBtn = e.target.closest('[data-cmd]');
    if (fontBtn) {
      exec('fontName', FONT_BY_KEY[fontBtn.dataset.font].css);
      closePops();
      ed.touch();
    } else if (colorBtn) {
      exec('foreColor', colorBtn.dataset.color);
      closePops();
      ed.touch();
    } else if (cmdBtn) {
      runCommand(cmdBtn.dataset.cmd, cmdBtn, ed);
    }
    refreshMenu();
  });
}

function closePops() {
  if (!menu) return;
  menu.el.querySelectorAll('[data-pop]').forEach((p) => p.classList.add('hidden'));
}

function togglePop(name, btn) {
  const pop = menu.el.querySelector(`[data-pop="${name}"]`);
  const willOpen = pop.classList.contains('hidden');
  closePops();
  if (!willOpen) return;
  pop.classList.remove('hidden');
  placePop(pop, btn);
}

function placePop(pop, btn) {
  const wrap = menu.el.parentElement.getBoundingClientRect();
  const me = menu.el.getBoundingClientRect();
  // Del lado con más espacio: el menú suele estar a la izquierda de la nota, pero
  // pegado al borde de la vista el selector se abre hacia la derecha.
  const room = me.left - wrap.left;
  const openLeft = menu.el.dataset.side === 'left' && room >= pop.offsetWidth + 16;
  pop.style.left = openLeft ? 'auto' : '100%';
  pop.style.right = openLeft ? '100%' : 'auto';
  pop.style.marginLeft = openLeft ? '0' : '8px';
  pop.style.marginRight = openLeft ? '8px' : '0';
  let top = btn.offsetTop;
  pop.style.top = top + 'px';
  const over = pop.getBoundingClientRect().bottom - (wrap.bottom - 6);
  if (over > 0) pop.style.top = Math.max(0, top - over) + 'px';
}

function runCommand(cmd, btn, ed) {
  switch (cmd) {
    case 'font': togglePop('font', btn); return;
    case 'color': togglePop('color', btn); return;
    case 'size-down': stepSize(-1); return;
    case 'size-up': stepSize(1); return;
    case 'bold': case 'italic': case 'underline':
      exec(cmd);
      break;
    case 'align-left': exec('justifyLeft'); break;
    case 'align-center': exec('justifyCenter'); break;
    case 'align-right': exec('justifyRight'); break;
    case 'align-justify': exec('justifyFull'); break;
    case 'todo': toggleTodo(ed); return;
    default: return;
  }
  ed.touch();
}

function showMenu() {
  if (!menu) return;
  menu.el.classList.remove('hidden');
  repositionNoteMenu();
  refreshMenu();
}

function hideMenu() {
  if (!menu) return;
  closePops();
  menu.el.classList.add('hidden');
}

/** Coloca el menú a la izquierda de la nota activa; si no cabe, a la derecha. */
export function repositionNoteMenu() {
  if (!menu || !active || menu.el.classList.contains('hidden')) return;
  const w = menu.el.parentElement.getBoundingClientRect();
  const c = active.cardEl.getBoundingClientRect();
  const mw = menu.el.offsetWidth;
  const mh = menu.el.offsetHeight;
  const GAP = 10;
  let left = c.left - w.left - mw - GAP;
  let side = 'left';
  if (left < 6) {
    side = 'right';
    left = c.right - w.left + GAP;
    if (left + mw > w.width - 6) left = Math.max(6, w.width - mw - 6);
  }
  const top = Math.min(Math.max(c.top - w.top, 6), Math.max(6, w.height - mh - 6));
  menu.el.style.left = left + 'px';
  menu.el.style.top = top + 'px';
  menu.el.dataset.side = side;
}

/** Sigue al menú durante una animación de zoom/paneo (la tarjeta se mueve varios cuadros). */
export function trackNoteMenu(ms = 220) {
  if (!menu || !active) return;
  const end = performance.now() + ms;
  const tick = () => {
    repositionNoteMenu();
    if (performance.now() < end) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const ACTIVE_CLS = ['bg-indigo-100', 'text-indigo-700'];

function setActive(btn, on) {
  if (!btn) return;
  ACTIVE_CLS.forEach((c) => btn.classList.toggle(c, on));
  btn.classList.toggle('text-slate-600', !on);
}

/** Refleja en el menú el formato de donde está el cursor. */
function refreshMenu() {
  if (!menu || !active) return;
  const { root } = active;
  const sel = getSelection();
  if (!sel.anchorNode || !root.contains(sel.anchorNode)) return;
  const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const cs = getComputedStyle(el);
  const q = (name) => menu.el.querySelector(`[data-cmd="${name}"]`);

  setActive(q('bold'), document.queryCommandState('bold'));
  setActive(q('italic'), document.queryCommandState('italic'));
  setActive(q('underline'), document.queryCommandState('underline'));

  const block = blockOf(root, sel.anchorNode);
  const align = block ? alignOf(contentOf(block)) : 'left';
  ['left', 'center', 'right', 'justify'].forEach((a) => setActive(q('align-' + a), a === align));
  setActive(q('todo'), !!block && block.dataset.b === 'todo');

  menu.el.querySelector('[data-size-readout]').textContent = Math.round(parseFloat(cs.fontSize)) || BASE.size;
  const dot = menu.el.querySelector('[data-color-dot]');
  dot.style.background = rgbToHex(cs.color) || BASE.color;

  const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const fontKey = FONT_KEY_BY_NAME[first] || BASE.font;
  menu.el.querySelectorAll('[data-font]').forEach((b) => {
    const on = b.dataset.font === fontKey;
    b.classList.toggle('bg-indigo-50', on);
    b.classList.toggle('font-semibold', on);
  });
  q('font').title = 'Tipografía: ' + FONT_BY_KEY[fontKey].label;
}

// Un solo listener a nivel de módulo (el router nunca desmonta un módulo: uno puesto
// dentro de mountNoteEditor se duplicaría en cada repintado del pizarrón).
document.addEventListener('selectionchange', () => { if (active) refreshMenu(); });
