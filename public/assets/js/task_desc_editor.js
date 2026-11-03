/**
 * Editor de la descripción de una tarea: negritas, cursivas, subrayado, alineación, viñetas, renglones de
 * pendiente (casilla), imágenes (subidas o pegadas del portapapeles) y notas hechas a mano.
 *
 * Reutiliza el motor del Pizarrón (board_note_editor.js: pintar bloques, serializar el DOM leyendo
 * el estilo calculado y las reglas de Enter/Retroceso en un pendiente o viñeta), pero con una barra fija
 * en vez del menú flotante, y sin tipografías, colores ni tamaños. El servidor descarta además todo lo
 * que no sea esta forma (includes/rich_note.php), y solo acepta imágenes que son de la tarea.
 *
 * El contenido NUNCA se guarda como HTML: se arman nodos con textContent y se serializa a JSON.
 */

import { icon, escapeHtml, toast } from './ui.js';
import { openInkPad } from './ink_pad.js';
import {
  BASE, FONT_BY_KEY, fillDoc, serializeDoc, paintTodoState, handleKeydown, toggleList, exec, blockAtSelection, contentOf,
  buildBlockEl, buildImageBlock, prepareImage, removeImageWithUndo,
} from './board_note_editor.js';

const BTN = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-200 focus:outline-none';
const SEP = '<span class="mx-1 h-5 w-px bg-slate-300"></span>';

const MAX_IMAGES = 20;   // igual que RICH_NOTE_MAX_IMAGES (includes/rich_note.php)

export const taskAssetUrl =(id) => `task_asset.php?id=${encodeURIComponent(id)}`;

async function uploadTaskImage(taskId, blob, name) {
  const fd = new FormData();
  fd.append('file', blob, name || 'imagen.png');
  if (taskId) fd.append('task_id', String(taskId));
  const res = await fetch('api/index.php?r=tasks/asset_upload', {
    method: 'POST',
    headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
    body: fd,
  });
  let json;
  try { json = await res.json(); } catch { throw new Error('Respuesta no válida del servidor'); }
  if (!json.ok) throw new Error(json.error || 'No se pudo subir la imagen');
  return json.data.asset;
}

/**
 * @param {HTMLElement} container  donde se monta (barra + área de texto)
 * @param {Array} blocks           bloques iniciales ([] = vacío)
 * @param {{taskId?: number}} [opts]  tarea que se edita (las imágenes se enlazan a ella); sin id = tarea nueva
 * @returns {{ content: () => (object|string), isEmpty: () => boolean, busy: () => boolean, focus: () => void }}
 */
export function mountTaskEditor(container, blocks, { taskId = 0 } = {}) {
  container.innerHTML = `
    <div class="rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-indigo-500">
      <div class="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-1.5 py-1" role="toolbar" aria-label="Formato">
        <button type="button" data-cmd="bold" title="Negrita (Ctrl+B)" class="${BTN} font-bold">B</button>
        <button type="button" data-cmd="italic" title="Cursiva (Ctrl+I)" class="${BTN} italic">I</button>
        <button type="button" data-cmd="underline" title="Subrayado (Ctrl+U)" class="${BTN} underline">U</button>
        ${SEP}
        <button type="button" data-cmd="align-left" title="Alinear a la izquierda" class="${BTN}">${icon('align-left', 'h-4 w-4')}</button>
        <button type="button" data-cmd="align-center" title="Centrar" class="${BTN}">${icon('align-center', 'h-4 w-4')}</button>
        <button type="button" data-cmd="align-right" title="Alinear a la derecha" class="${BTN}">${icon('align-right', 'h-4 w-4')}</button>
        <button type="button" data-cmd="align-justify" title="Justificar" class="${BTN}">${icon('align-justify', 'h-4 w-4')}</button>
        ${SEP}
        <button type="button" data-cmd="bullets" title="Lista con viñetas" class="${BTN}">${icon('list', 'h-4 w-4')}</button>
        <button type="button" data-cmd="todo" title="Lista de pendientes (casillas)" class="${BTN} gap-1.5 text-xs font-semibold">
          ${icon('check-square', 'h-4 w-4')} Casillas
        </button>
        ${SEP}
        <button type="button" data-cmd="image" title="Insertar imagen (también puedes pegarla con Ctrl+V)" class="${BTN} gap-1.5 text-xs font-semibold">
          ${icon('image', 'h-4 w-4')} Imagen
        </button>
        <button type="button" data-cmd="ink" title="Escribir o dibujar a mano" class="${BTN} gap-1.5 text-xs font-semibold">
          ${icon('edit', 'h-4 w-4')} A mano
        </button>
      </div>
      <div class="relative">
        <div data-editor class="min-h-[16rem] max-h-[50vh] resize-y overflow-y-auto break-words px-3 py-2 outline-none"></div>
        <span data-placeholder class="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">Escribe la descripción… Puedes usar viñetas, casillas, imágenes y notas a mano.</span>
      </div>
      <input type="file" accept="image/*" data-image-input class="hidden">
    </div>`;

  const root = container.querySelector('[data-editor]');
  const placeholder = container.querySelector('[data-placeholder]');
  const fileInput = container.querySelector('[data-image-input]');
  // Base tipográfica INLINE y idéntica a la del Pizarrón: el serializador compara el estilo calculado
  // contra BASE para saber qué es formato del usuario y qué es el texto normal.
  root.style.cssText += `color:${BASE.color};font-family:${FONT_BY_KEY[BASE.font].css};font-size:${BASE.size}px;line-height:1.5;`;
  const withUrls = (blocks || []).map((b) => (b.t === 'img' ? { ...b, url: taskAssetUrl(b.asset) } : b));
  fillDoc(root, withUrls.length ? withUrls : [{ t: 'p', runs: [] }], true);
  root.contentEditable = 'true';
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-label', 'Descripción');

  // Un renglón solo cuenta si tiene texto (el punto de una viñeta vacía no es contenido); una casilla o una
  // imagen siempre cuentan.
  const isEmpty = () => ![...root.children].some((b) => {
    const kind = b.dataset.b;
    if (kind === 'img' || kind === 'todo') return true;
    return contentOf(b).textContent.trim() !== '';
  });
  const syncPlaceholder = () => placeholder.classList.toggle('hidden', !isEmpty());
  syncPlaceholder();

  // handleKeydown/toggleList esperan un "editor" con la raíz y un aviso de cambio.
  const ed = { root, touch: syncPlaceholder };
  let uploading = 0;

  document.execCommand('defaultParagraphSeparator', false, 'div');
  root.addEventListener('input', syncPlaceholder);
  root.addEventListener('keydown', (e) => handleKeydown(e, ed));

  /** Sube la imagen y la inserta después de `target` (o en su lugar, si es un renglón vacío). */
  async function insertImage(file, target) {
    if (!file.type.startsWith('image/')) return;
    // El servidor solo conserva las primeras MAX_IMAGES de la descripción: se avisa antes, no después de guardar.
    if (root.querySelectorAll('[data-b="img"][data-asset]').length >= MAX_IMAGES) {
      toast(`Máximo ${MAX_IMAGES} imágenes por tarea`, 'error');
      return;
    }
    const wait = document.createElement('div');
    wait.dataset.b = 'img';
    wait.contentEditable = 'false';
    wait.className = 'my-1 w-fit rounded-md bg-black/5 px-3 py-2 text-xs text-slate-500';
    wait.textContent = 'Subiendo imagen…';

    const usable = target && target.parentNode === root;
    if (usable && target.dataset.b !== 'todo' && target.dataset.b !== 'li' && target.dataset.b !== 'img' && target.textContent === '') target.replaceWith(wait);
    else if (usable) target.after(wait);
    else root.appendChild(wait);

    uploading++;
    try {
      const blob = await prepareImage(file);
      const asset = await uploadTaskImage(taskId, blob, file.name);
      if (!wait.isConnected) return;
      const block = buildImageBlock(asset.id, true, asset.url);
      wait.replaceWith(block);
      // Después de una imagen tiene que haber un renglón donde poder seguir escribiendo.
      if (!block.nextElementSibling) block.after(buildBlockEl({ t: 'p', runs: [] }, true));
      syncPlaceholder();
    } catch (err) {
      wait.remove();
      if (!root.children.length) root.appendChild(buildBlockEl({ t: 'p', runs: [] }, true));
      toast(err.message || 'No se pudo subir la imagen', 'error');
    } finally {
      uploading--;
    }
  }

  // Texto plano, o una imagen (captura de pantalla, imagen copiada): pegar HTML ajeno traería estilos y
  // estructura que no son de la descripción.
  root.addEventListener('paste', (e) => {
    e.preventDefault();
    const image = [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith('image/'));
    if (image) { insertImage(image, blockAtSelection(root)); return; }
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) document.execCommand('insertText', false, text);
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const image = [...(e.dataTransfer ? e.dataTransfer.files : [])].find((f) => f.type.startsWith('image/'));
    if (image) insertImage(image, blockAtSelection(root));
  });

  // Casilla de un pendiente y × de una imagen: no deben mover el cursor ni el foco.
  root.addEventListener('mousedown', (e) => { if (e.target.closest('.todo-box, [data-rm-img]')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm-img]');
    if (rm && root.contains(rm)) { removeImageWithUndo(ed, rm.closest('[data-b="img"]')); return; }
    const box = e.target.closest('.todo-box');
    if (!box || !root.contains(box)) return;
    const block = box.closest('[data-b="todo"]');
    block.dataset.done = block.dataset.done === '1' ? '0' : '1';
    paintTodoState(block);
  });

  // La barra no le quita el foco (ni la selección) al texto.
  container.querySelector('[role="toolbar"]').addEventListener('mousedown', (e) => e.preventDefault());

  /** El cursor tiene que estar dentro del editor; si aún no se ha puesto, empieza en el último renglón. */
  function ensureCaret() {
    root.focus();
    const sel0 = getSelection();
    if (!sel0.rangeCount || !root.contains(sel0.getRangeAt(0).startContainer)) {
      const last = root.lastElementChild;
      const r0 = document.createRange();
      r0.selectNodeContents(last ? contentOf(last) : root);
      r0.collapse(false);
      sel0.removeAllRanges();
      sel0.addRange(r0);
    }
  }

  // Ni el selector de archivos ni la hoja a mano conservan el cursor: se recuerda el renglón de destino.
  let imageTarget = null;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) insertImage(file, imageTarget);
  });

  container.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('click', async () => {
    const cmd = btn.dataset.cmd;
    ensureCaret();
    if (cmd === 'image') {
      imageTarget = blockAtSelection(root);
      fileInput.click();
      return;
    }
    if (cmd === 'ink') {
      const target = blockAtSelection(root);
      const blob = await openInkPad();
      if (blob) await insertImage(new File([blob], 'nota-a-mano.png', { type: 'image/png' }), target);
      return;
    }
    if (cmd === 'todo' || cmd === 'bullets') {
      // En un renglón vacío no hay texto al que anclar el cursor: tras convertirlo se coloca a mano
      // dentro del renglón nuevo, para poder escribir de inmediato.
      const before = blockAtSelection(root);
      const index = before ? [...root.children].indexOf(before) : -1;
      const wasEmpty = !!before && before.dataset.b !== 'img' && contentOf(before).textContent === '';
      toggleList(ed, cmd === 'todo' ? 'todo' : 'li');
      const after = index >= 0 ? root.children[index] : null;
      if (wasEmpty && after) {
        const r = document.createRange();
        r.selectNodeContents(contentOf(after));
        r.collapse(true);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else if (cmd.startsWith('align-')) {
      exec({ 'align-left': 'justifyLeft', 'align-center': 'justifyCenter', 'align-right': 'justifyRight', 'align-justify': 'justifyFull' }[cmd]);
    } else {
      exec(cmd);
    }
    syncPlaceholder();
  }));

  return {
    /** Contenido a guardar: {v:2, blocks} o '' si está vacío. */
    content: () => (isEmpty() ? '' : serializeDoc(root)),
    isEmpty,
    /** ¿Hay una imagen subiéndose? Guardar en ese momento la dejaría fuera de la tarea. */
    busy: () => uploading > 0,
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

const ALIGN_CLS = { center: 'text-center', right: 'text-right', justify: 'text-justify' };

/**
 * HTML de la descripción para la tarjeta. Las casillas son botones `data-check="<tarea>:<n>:<0|1>"`
 * (n = posición de la casilla, 0|1 = el estado al que pasaría) que la lista de tareas conecta a la API;
 * las imágenes llevan `data-zoom` para abrirlas en grande. Todo el texto sale escapado.
 *
 * `size`: 'card' (ocupa el alto sobrante de la tarjeta vertical y se desplaza), 'full' (sin límite de alto,
 * para la vista completa de la tarea).
 */
export function taskDescriptionHtml(task, { canCheck = true, size = 'card' } = {}) {
  const blocks = task.desc_blocks || [];
  if (!blocks.length) return '';
  let n = 0;
  const rows = blocks.map((b) => {
    if (b.t === 'img') {
      const url = taskAssetUrl(b.asset);
      return `<img src="${url}" alt="Imagen de la tarea" loading="lazy" data-zoom="${url}"
                   class="my-1 block max-h-60 max-w-full cursor-zoom-in rounded-md ring-1 ring-slate-200">`;
    }
    const text = (b.runs || []).map(runHtml).join('');
    const align = ALIGN_CLS[b.align] || '';
    if (b.t === 'todo') {
      const idx = n++;
      const done = !!b.done;
      const box = `<span class="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-400 bg-white text-transparent'}">
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
      const label = `<span class="min-w-0 flex-1 ${align} ${done ? 'text-slate-400 line-through' : ''}">${text || '&nbsp;'}</span>`;
      return canCheck
        ? `<button type="button" data-check="${task.id}:${idx}:${done ? 0 : 1}" role="checkbox" aria-checked="${done}"
                   class="flex w-full items-start gap-2 rounded px-0.5 py-0.5 text-left hover:bg-slate-100">${box}${label}</button>`
        : `<div class="flex items-start gap-2 px-0.5 py-0.5">${box}${label}</div>`;
    }
    if (b.t === 'li') {
      return `<div class="flex items-start gap-2 px-0.5 py-0.5"><span class="w-3 shrink-0 select-none text-center" aria-hidden="true">•</span><span class="min-w-0 flex-1 ${align}">${text || '&nbsp;'}</span></div>`;
    }
    return `<p class="min-h-[1.25em] ${align}">${text || '&nbsp;'}</p>`;
  }).join('');
  const sizing = size === 'full' ? '' : 'max-h-56 overflow-y-auto';
  return `<div class="mt-2 space-y-0.5 ${sizing} break-words rounded-lg bg-white/70 px-2.5 py-2 text-sm leading-snug text-slate-600 ring-1 ring-slate-200" data-desc>${rows}</div>`;
}
