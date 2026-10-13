/**
 * Editor de la descripción de una tarea: negritas, cursivas, subrayado y renglones de pendiente
 * (casilla), en el mismo formato de bloques que las notas del Pizarrón.
 *
 * Reutiliza el motor del Pizarrón (board_note_editor.js: pintar bloques, serializar el DOM leyendo
 * el estilo calculado y las reglas de Enter/Retroceso en un pendiente), pero con una barra fija
 * mínima en vez del menú flotante, y sin tipografías, colores, tamaños ni imágenes. El servidor
 * descarta además todo lo que no sea negrita/cursiva/subrayado/casilla (includes/rich_note.php).
 *
 * El contenido NUNCA se guarda como HTML: se arman nodos con textContent y se serializa a JSON.
 */

import { icon, escapeHtml } from './ui.js';
import {
  BASE, FONT_BY_KEY, fillDoc, serializeDoc, paintTodoState, handleKeydown, toggleTodo, exec, blockAtSelection, contentOf,
} from './board_note_editor.js';

const BTN = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-200 focus:outline-none';

/**
 * @param {HTMLElement} container  donde se monta (barra + área de texto)
 * @param {Array} blocks           bloques iniciales ([] = vacío)
 * @returns {{ content: () => (object|string), isEmpty: () => boolean, focus: () => void }}
 */
export function mountTaskEditor(container, blocks) {
  container.innerHTML = `
    <div class="rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-indigo-500">
      <div class="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-1.5 py-1" role="toolbar" aria-label="Formato">
        <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)" class="${BTN} font-bold">B</button>
        <button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)" class="${BTN} italic">I</button>
        <button type="button" data-cmd="underline" title="Subrayado (Ctrl+U)" class="${BTN} underline">U</button>
        <span class="mx-1 h-5 w-px bg-slate-300"></span>
        <button type="button" data-cmd="todo" title="Lista de pendientes (casillas)" class="${BTN} gap-1.5 text-xs font-semibold">
          ${icon('check-square', 'h-4 w-4')} Casillas
        </button>
      </div>
      <div class="relative">
        <div data-editor class="min-h-[16rem] max-h-[50vh] resize-y overflow-y-auto break-words px-3 py-2 outline-none"></div>
        <span data-placeholder class="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">Escribe la descripción… Usa «Casillas» para hacer una lista de pendientes.</span>
      </div>
    </div>`;

  const root = container.querySelector('[data-editor]');
  const placeholder = container.querySelector('[data-placeholder]');
  // Base tipográfica INLINE y idéntica a la del Pizarrón: el serializador compara el estilo calculado
  // contra BASE para saber qué es formato del usuario y qué es el texto normal.
  root.style.cssText += `color:${BASE.color};font-family:${FONT_BY_KEY[BASE.font].css};font-size:${BASE.size}px;line-height:1.5;`;
  fillDoc(root, blocks && blocks.length ? blocks : [{ t: 'p', runs: [] }], true);
  root.contentEditable = 'true';
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-label', 'Descripción');

  const isEmpty = () => root.textContent.trim() === '' && !root.querySelector('[data-b="todo"]');
  const syncPlaceholder = () => placeholder.classList.toggle('hidden', !isEmpty());
  syncPlaceholder();

  // handleKeydown/toggleTodo esperan un "editor" con la raíz y un aviso de cambio.
  const ed = { root, touch: syncPlaceholder };

  document.execCommand('defaultParagraphSeparator', false, 'div');
  root.addEventListener('input', syncPlaceholder);
  root.addEventListener('keydown', (e) => handleKeydown(e, ed));

  // Solo texto plano: pegar HTML ajeno traería estilos y estructura que no son de la descripción.
  root.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) document.execCommand('insertText', false, text);
  });
  root.addEventListener('drop', (e) => e.preventDefault());

  // Casilla de un pendiente: no debe mover el cursor ni el foco.
  root.addEventListener('mousedown', (e) => { if (e.target.closest('.todo-box')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const box = e.target.closest('.todo-box');
    if (!box || !root.contains(box)) return;
    const block = box.closest('[data-b="todo"]');
    block.dataset.done = block.dataset.done === '1' ? '0' : '1';
    paintTodoState(block);
  });

  // La barra no le quita el foco (ni la selección) al texto.
  container.querySelector('[role="toolbar"]').addEventListener('mousedown', (e) => e.preventDefault());
  container.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('click', () => {
    root.focus();
    // Si aún no se ha puesto el cursor en el texto, empieza en el último renglón.
    const sel0 = getSelection();
    if (!sel0.rangeCount || !root.contains(sel0.getRangeAt(0).startContainer)) {
      const last = root.lastElementChild;
      const r0 = document.createRange();
      r0.selectNodeContents(last ? contentOf(last) : root);
      r0.collapse(false);
      sel0.removeAllRanges();
      sel0.addRange(r0);
    }
    if (btn.dataset.cmd === 'todo') {
      // En un renglón vacío no hay texto al que anclar el cursor: tras convertirlo se coloca a mano
      // dentro del renglón nuevo, para poder escribir el pendiente de inmediato.
      const before = blockAtSelection(root);
      const index = before ? [...root.children].indexOf(before) : -1;
      const wasEmpty = !!before && contentOf(before).textContent === '';
      toggleTodo(ed);
      const after = index >= 0 ? root.children[index] : null;
      if (wasEmpty && after) {
        const r = document.createRange();
        r.selectNodeContents(contentOf(after));
        r.collapse(true);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else {
      exec(btn.dataset.cmd);
    }
    syncPlaceholder();
  }));

  return {
    /** Contenido a guardar: {v:2, blocks} o '' si está vacío. */
    content: () => (isEmpty() ? '' : serializeDoc(root)),
    isEmpty,
    focus: () => root.focus(),
  };
}

/* ================= Vista de solo lectura (tarjeta) ================= */

const runHtml = (r) => {
  let h = escapeHtml(r.s).replaceAll('\n', '<br>');
  if (r.u) h = `<u>${h}</u>`;
  if (r.i) h = `<em>${h}</em>`;
  if (r.b) h = `<strong>${h}</strong>`;
  return h;
};

/**
 * HTML de la descripción para la tarjeta. Las casillas son botones `data-check="<tarea>:<n>:<0|1>"`
 * (n = posición de la casilla, 0|1 = el estado al que pasaría) que la lista de tareas conecta a la API.
 * Todo el texto sale escapado.
 */
export function taskDescriptionHtml(task, { canCheck = true } = {}) {
  const blocks = task.desc_blocks || [];
  if (!blocks.length) return '';
  let n = 0;
  const rows = blocks.map((b) => {
    const text = (b.runs || []).map(runHtml).join('');
    if (b.t === 'todo') {
      const idx = n++;
      const done = !!b.done;
      const box = `<span class="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-400 bg-white text-transparent'}">
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
      const label = `<span class="min-w-0 flex-1 ${done ? 'text-slate-400 line-through' : ''}">${text || '&nbsp;'}</span>`;
      return canCheck
        ? `<button type="button" data-check="${task.id}:${idx}:${done ? 0 : 1}" role="checkbox" aria-checked="${done}"
                   class="flex w-full items-start gap-2 rounded px-0.5 py-0.5 text-left hover:bg-slate-100">${box}${label}</button>`
        : `<div class="flex items-start gap-2 px-0.5 py-0.5">${box}${label}</div>`;
    }
    return `<p class="min-h-[1.25em]">${text || '&nbsp;'}</p>`;
  }).join('');
  return `<div class="mt-2 max-h-56 space-y-0.5 overflow-y-auto break-words rounded-lg bg-white/70 px-2.5 py-2 text-sm leading-snug text-slate-600 ring-1 ring-slate-200">${rows}</div>`;
}
