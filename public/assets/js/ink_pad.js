/**
 * Hoja para escribir o dibujar a mano (dedo, lápiz de la tablet o mouse) y devolverlo como imagen PNG.
 * Se usa en la descripción de las tareas: la nota manuscrita se inserta como cualquier otra imagen.
 *
 * Pointer Events sin librerías (mismo enfoque que los dibujos del Pizarrón). El PNG sale recortado al
 * trazo, sobre fondo blanco, para que en la tarjeta no ocupe una hoja entera.
 *
 *   const blob = await openInkPad();   // Blob image/png, o null si se cancela
 */

import { icon, toast } from './ui.js';

const COLORS = ['#1e293b', '#dc2626', '#2563eb', '#16a34a'];
const WIDTHS = { thin: 2, thick: 5 };
const PAD = 14;
const MAX_SIDE = 1600;

export function openInkPad() {
  return new Promise((resolve) => {
    const strokes = [];
    let color = COLORS[0];
    let width = WIDTHS.thin;
    let current = null;

    const wrap = document.createElement('div');
    // Por encima de los modales (z-index 9999 en ui.js modal()).
    wrap.style.zIndex = '10000';
    wrap.className = 'fixed inset-0 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4';
    wrap.innerHTML = `
      <div class="flex max-h-[96vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" role="dialog" aria-label="Nota a mano">
        <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 class="text-base font-semibold text-slate-900">Nota a mano</h3>
          <button type="button" data-cancel class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">${icon('x', 'h-5 w-5')}</button>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          ${COLORS.map((hex, i) => `<button type="button" data-pen="${hex}" aria-label="Color ${i + 1}" class="h-6 w-6 rounded-full ring-1 ring-black/15" style="background:${hex}"></button>`).join('')}
          <span class="mx-1 h-5 w-px bg-slate-200"></span>
          <button type="button" data-width="thin" class="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300">Fino</button>
          <button type="button" data-width="thick" class="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300">Grueso</button>
          <span class="flex-1"></span>
          <button type="button" data-undo class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">${icon('undo', 'h-3.5 w-3.5')} Deshacer</button>
          <button type="button" data-clear class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">${icon('trash', 'h-3.5 w-3.5')} Borrar todo</button>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden bg-slate-100 p-3">
          <canvas data-canvas class="block w-full touch-none rounded-lg bg-white shadow-inner ring-1 ring-slate-300" style="height:min(60vh,26rem);cursor:crosshair"></canvas>
        </div>
        <div class="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" data-cancel class="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Cancelar</button>
          <button type="button" data-done class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Insertar en la tarea</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const canvas = wrap.querySelector('[data-canvas]');
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const mark = () => {
      wrap.querySelectorAll('[data-pen]').forEach((b) => b.classList.toggle('ring-2', b.dataset.pen === color));
      wrap.querySelectorAll('[data-pen]').forEach((b) => b.classList.toggle('ring-indigo-500', b.dataset.pen === color));
      wrap.querySelectorAll('[data-width]').forEach((b) => {
        const on = WIDTHS[b.dataset.width] === width;
        b.classList.toggle('bg-indigo-50', on);
        b.classList.toggle('text-indigo-700', on);
      });
    };

    const drawStroke = (s) => {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = s.points;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    };

    const redraw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokes.forEach(drawStroke);
    };

    // La resolución interna sigue al tamaño en pantalla (también al girar la tablet).
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      redraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    requestAnimationFrame(resize);

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      current = { color, width, points: [local(e)] };
      strokes.push(current);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (events.length ? events : [e]).forEach((ev) => current.points.push(local(ev)));
      redraw();
    });
    const end = () => { current = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    wrap.querySelectorAll('[data-pen]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.pen; mark(); }));
    wrap.querySelectorAll('[data-width]').forEach((b) => b.addEventListener('click', () => { width = WIDTHS[b.dataset.width]; mark(); }));
    wrap.querySelector('[data-undo]').addEventListener('click', () => { strokes.pop(); redraw(); });
    wrap.querySelector('[data-clear]').addEventListener('click', () => { strokes.length = 0; redraw(); });
    mark();

    const finish = (blob) => {
      ro.disconnect();
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(blob);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Solo cierra la hoja, no el modal de la tarea que está debajo.
      e.stopPropagation();
      finish(null);
    };
    document.addEventListener('keydown', onKey, true);

    wrap.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => finish(null)));
    wrap.querySelector('[data-done]').addEventListener('click', async () => {
      if (!strokes.length) { toast('Escribe o dibuja algo primero', 'error'); return; }
      finish(await exportPng(canvas, strokes, dpr));
    });
  });
}

/** PNG recortado al trazo (con un margen), sobre fondo blanco y con el lado mayor limitado. */
async function exportPng(canvas, strokes, dpr) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x - s.width / 2); maxX = Math.max(maxX, x + s.width / 2);
      minY = Math.min(minY, y - s.width / 2); maxY = Math.max(maxY, y + s.width / 2);
    }
  }
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const x0 = Math.max(0, Math.floor(minX - PAD));
  const y0 = Math.max(0, Math.floor(minY - PAD));
  const x1 = Math.min(cssW, Math.ceil(maxX + PAD));
  const y1 = Math.min(cssH, Math.ceil(maxY + PAD));
  const sw = Math.max(1, Math.round((x1 - x0) * dpr));
  const sh = Math.max(1, Math.round((y1 - y0) * dpr));
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvas, Math.round(x0 * dpr), Math.round(y0 * dpr), sw, sh, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}
