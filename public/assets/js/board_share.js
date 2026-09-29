/**
 * Compartir una tarjeta del Pizarrón como imagen PNG.
 *
 * Sirius no usa librerías (nada de html2canvas), y convertir HTML arbitrario a imagen sería un
 * proyecto en sí. Pero una nota no es HTML: es un JSON de bloques (ver board_note_editor.js), así
 * que se dibuja directo en un <canvas> con fillText/drawImage. Lo que da trabajo es el texto: el
 * canvas no tiene layout, así que aquí se hace el corte de líneas, la altura de línea y la
 * alineación siguiendo lo que hace el navegador con el editor (line-height 1.5, strut de 14 px,
 * márgenes que se colapsan entre imágenes), para que la imagen salga como se ve en el pizarrón.
 *
 * Se carga bajo demanda desde pizarron.js (import()) la primera vez que se pulsa compartir.
 */

import { icon, escapeHtml, modal, toast } from './ui.js';
import { BASE, FONT_BY_KEY, toBlocks, ensureBoardFonts } from './board_note_editor.js';

/* ================= Constantes que calcan buildCard() de pizarron.js ================= */

// Hex fijos a propósito: Tailwind v4 calcula sus colores en oklch(), y un fillStyle con un formato
// que el navegador no reconozca se ignora en silencio.
const PALETTE = {
  amber:   { bg: '#fef3c7', header: '#fde68a', ring: '#fcd34d' },
  pink:    { bg: '#fce7f3', header: '#fbcfe8', ring: '#f9a8d4' },
  sky:     { bg: '#e0f2fe', header: '#bae6fd', ring: '#7dd3fc' },
  emerald: { bg: '#d1fae5', header: '#a7f3d0', ring: '#6ee7b7' },
  violet:  { bg: '#ede9fe', header: '#ddd6fe', ring: '#c4b5fd' },
  slate:   { bg: '#f1f5f9', header: '#e2e8f0', ring: '#cbd5e1' },
};
const BOARD_BG = '#f8fafc';

const MARGIN = 16;          // aire alrededor de la tarjeta, como sobre el tablero
const HEADER_H = 34;        // py-1.5 (12) + fila de 22 px
const FOOTER_H = 21;        // pie con el autor en el pizarrón público
const PAD = 8;              // p-2 del cuerpo
const LINE = 1.5;           // line-height del editor
const BOX = 16;             // casilla de un pendiente (h-4 w-4)
const BOX_GAP = 8;          // gap-2
const TODO_PAD_Y = 2;       // py-0.5
const BOX_TOP = 3;          // mt-[3px]
const IMG_MARGIN = 4;       // my-1
const IMG_MAX_H = 288;      // max-h-72
const MAX_CONTENT_H = 10000;
const MAX_PIXELS = 14e6;    // Safari en iPhone no admite un canvas de más de ~16 millones de píxeles
const TARGET_SCALE = 2;

/* ================= Utilidades ================= */

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** "nota-lista-del-lunes-20260930.png": legible al guardarla o adjuntarla. */
function fileName(item) {
  const raw = String(item.title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sin-titulo';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `nota-${slug}-${stamp}.png`;
}

function fontOf(run) {
  const size = run.z || BASE.size;
  const stack = (FONT_BY_KEY[run.f || BASE.font] || FONT_BY_KEY[BASE.font]).css;
  return `${run.i ? 'italic ' : ''}${run.b ? '700' : '400'} ${size}px ${stack}`;
}

/** Las listas antiguas ({items}) se dibujan con el mismo código que los pendientes de una nota. */
function blocksFor(item) {
  const c = item.content || {};
  if (item.type === 'checklist') {
    return (c.items || []).map((it) => ({ t: 'todo', done: !!it.done, align: 'left', runs: it.text ? [{ s: String(it.text) }] : [] }));
  }
  return toBlocks(c);
}

/* ================= Métricas de una línea ================= */

/** Ascenso/descenso de la fuente ya fijada en ctx (con respaldo si el navegador no da fontBoundingBox). */
function fontMetrics(ctx, size) {
  const m = ctx.measureText('Hg');
  const asc = m.fontBoundingBoxAscent ?? size * 0.93;
  const desc = m.fontBoundingBoxDescent ?? size * 0.24;
  return { asc, desc };
}

/**
 * En CSS cada tramo aporta su propia altura de línea (1.5 × su tamaño), centrada en su contenido
 * (medio interlineado arriba y abajo), y todos comparten la línea base. Además la línea siempre
 * incluye un "strut": la fuente del contenedor (14 px → 21 px), aunque el texto sea más chico.
 */
function lineBox(ctx, items) {
  let above = 0;
  let below = 0;
  const feed = (font, size) => {
    ctx.font = font;
    const { asc, desc } = fontMetrics(ctx, size);
    const lh = size * LINE;
    const half = (lh - (asc + desc)) / 2;
    above = Math.max(above, half + asc);
    below = Math.max(below, lh - (half + asc));
  };
  feed(`400 ${BASE.size}px ${FONT_BY_KEY[BASE.font].css}`, BASE.size); // strut
  items.forEach((it) => { if (it.text !== '') feed(it.font, it.size); });
  return { baseline: above, height: above + below };
}

/* ================= Corte de líneas ================= */

/**
 * Parte los tramos en "unidades" (palabras, que pueden cruzar tramos: "hol" en negrita + "a" normal
 * es una sola palabra y no se corta entre ellas), espacios y saltos duros.
 */
function toUnits(runs) {
  const units = [];
  let word = null;
  const closeWord = () => { if (word) { units.push(word); word = null; } };
  runs.forEach((r) => {
    const style = { font: fontOf(r), color: r.c || BASE.color, u: !!r.u, size: r.z || BASE.size };
    String(r.s || '').split('\n').forEach((seg, i) => {
      if (i > 0) { closeWord(); units.push({ hard: true }); }
      seg.split(/( +)/).forEach((tok) => {
        if (tok === '') return;
        if (tok[0] === ' ') { closeWord(); units.push({ space: true, ...style }); return; }
        if (!word) word = { pieces: [] };
        word.pieces.push({ text: tok, ...style });
      });
    });
  });
  closeWord();
  return units;
}

function measure(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Una palabra más ancha que la línea se parte por letras (el editor usa overflow-wrap: break-word). */
function splitLongWord(ctx, word, width) {
  const parts = [];
  let cur = { pieces: [], w: 0 };
  word.pieces.forEach((p) => {
    for (const ch of p.text) {
      const w = measure(ctx, ch, p.font);
      if (cur.w + w > width && cur.pieces.length) { parts.push(cur); cur = { pieces: [], w: 0 }; }
      const last = cur.pieces[cur.pieces.length - 1];
      if (last && last.font === p.font && last.color === p.color && last.u === p.u) { last.text += ch; last.w += w; }
      else cur.pieces.push({ ...p, text: ch, w });
      cur.w += w;
    }
  });
  if (cur.pieces.length) parts.push(cur);
  return parts;
}

/**
 * @returns {{lines: Array, height: number}} cada línea: { items, width, baseline, height, hard }
 */
function layoutText(ctx, runs, width) {
  const units = toUnits(runs);
  const lines = [];
  let cur = { items: [], width: 0, hard: false };

  const finish = (hard) => {
    // los espacios al final de una línea no cuentan (ni para alinear ni para justificar)
    while (cur.items.length && cur.items[cur.items.length - 1].space) cur.width -= cur.items.pop().w;
    cur.hard = hard;
    Object.assign(cur, lineBox(ctx, cur.items));
    lines.push(cur);
    cur = { items: [], width: 0, hard: false };
  };
  const addWord = (word) => {
    word.pieces.forEach((p) => {
      cur.items.push({ text: p.text, font: p.font, color: p.color, u: p.u, size: p.size, w: p.w ?? measure(ctx, p.text, p.font) });
      cur.width += cur.items[cur.items.length - 1].w;
    });
  };

  units.forEach((u) => {
    if (u.hard) { finish(true); return; }
    if (u.space) {
      if (!cur.items.length) return; // sin espacios al inicio de una línea
      const w = measure(ctx, ' ', u.font);
      cur.items.push({ text: ' ', space: true, font: u.font, color: u.color, u: u.u, size: u.size, w });
      cur.width += w;
      return;
    }
    u.pieces.forEach((p) => { p.w = measure(ctx, p.text, p.font); });
    const w = u.pieces.reduce((n, p) => n + p.w, 0);
    if (cur.width + w <= width || (!cur.items.length && w <= width)) { addWord(u); return; }
    if (cur.items.length) finish(false);
    if (w <= width) { addWord(u); return; }
    splitLongWord(ctx, u, width).forEach((part, i, all) => {
      addWord(part);
      if (i < all.length - 1) finish(false);
    });
  });
  finish(true); // la última línea (también la de un bloque vacío: mide lo que el strut)

  return { lines, height: lines.reduce((n, l) => n + l.height, 0) };
}

/** Dibuja las líneas de un bloque con su alineación. y = borde superior del bloque. */
function paintText(ctx, layout, x, y, width, align) {
  let top = y;
  layout.lines.forEach((line) => {
    let gap = 0;
    let startX = x;
    if (align === 'center') startX = x + (width - line.width) / 2;
    else if (align === 'right') startX = x + width - line.width;
    else if (align === 'justify' && !line.hard) {
      const gaps = line.items.filter((i) => i.space).length;
      if (gaps > 0) gap = (width - line.width) / gaps;
    }
    let cx = startX;
    const base = top + line.baseline;
    line.items.forEach((it) => {
      const w = it.w + (it.space ? gap : 0);
      if (!it.space) {
        ctx.font = it.font;
        ctx.fillStyle = it.color;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(it.text, cx, base);
      }
      if (it.u) {
        ctx.fillStyle = it.color;
        ctx.fillRect(cx, base + it.size * 0.1, w, Math.max(1, it.size / 14));
      }
      cx += w;
    });
    top += line.height;
  });
}

/* ================= Imágenes ================= */

function loadImage(asset) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // una imagen caída no impide generar el resto
    img.src = `board_asset.php?id=${encodeURIComponent(asset)}`;
  });
}

/* ================= Composición del cuerpo ================= */

/**
 * Coloca todos los bloques de una nota y devuelve su alto total y una función que los dibuja.
 * Se separa de la pintura para poder medir sin dibujar (la prueba de fidelidad contra el DOM).
 */
async function layoutBlocks(ctx, blocks, width) {
  const images = new Map();
  await Promise.all(blocks.filter((b) => b.t === 'img').map(async (b) => images.set(b.asset, await loadImage(b.asset))));

  const placed = [];
  let y = 0;
  let prevBottom = 0;
  let truncated = false;

  for (const b of blocks) {
    let topMargin = 0;
    let bottomMargin = 0;
    let h;
    let layout = null;
    let img = null;
    let scale = 1;

    if (b.t === 'img') {
      img = images.get(b.asset);
      topMargin = IMG_MARGIN;
      bottomMargin = IMG_MARGIN;
      if (img) {
        scale = Math.min(1, width / img.naturalWidth, IMG_MAX_H / img.naturalHeight);
        h = img.naturalHeight * scale;
      } else {
        h = 60;
      }
    } else if (b.t === 'todo') {
      layout = layoutText(ctx, b.runs || [], width - BOX - BOX_GAP);
      h = Math.max(BOX_TOP + BOX, layout.height) + TODO_PAD_Y * 2;
    } else {
      layout = layoutText(ctx, b.runs || [], width);
      h = layout.height;
    }

    // Los márgenes verticales de bloques contiguos se colapsan (dos imágenes seguidas: 4 px, no 8).
    y += Math.max(prevBottom, topMargin);
    if (y + h > MAX_CONTENT_H) { truncated = true; break; }
    placed.push({ b, y, h, layout, img, scale });
    y += h;
    prevBottom = bottomMargin;
  }
  y += prevBottom;

  const paint = (g, x0, y0) => {
    placed.forEach(({ b, y: by, h, layout, img, scale: sc }) => {
      const top = y0 + by;
      if (b.t === 'img') {
        if (img) {
          g.save();
          roundRectPath(g, x0, top, img.naturalWidth * sc, h, 6);
          g.clip();
          g.drawImage(img, x0, top, img.naturalWidth * sc, h);
          g.restore();
        } else {
          g.fillStyle = 'rgba(0,0,0,.06)';
          roundRectPath(g, x0, top, Math.min(width, 180), 60, 6);
          g.fill();
          g.fillStyle = '#64748b';
          g.font = `400 12px ${FONT_BY_KEY[BASE.font].css}`;
          g.fillText('Imagen no disponible', x0 + 12, top + 34);
        }
        return;
      }
      if (b.t === 'todo') {
        const done = !!b.done;
        const by2 = top + TODO_PAD_Y + BOX_TOP;
        g.save();
        roundRectPath(g, x0 + 0.5, by2 + 0.5, BOX - 1, BOX - 1, 4);
        g.fillStyle = done ? '#4f46e5' : '#ffffff';
        g.fill();
        g.strokeStyle = done ? '#4f46e5' : '#94a3b8';
        g.lineWidth = 1;
        g.stroke();
        if (done) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2;
          g.lineCap = 'round';
          g.lineJoin = 'round';
          g.beginPath();
          g.moveTo(x0 + 3.5, by2 + 8.5);
          g.lineTo(x0 + 6.8, by2 + 11.6);
          g.lineTo(x0 + 12.5, by2 + 4.8);
          g.stroke();
        }
        g.restore();
        g.save();
        g.globalAlpha = done ? 0.6 : 1;
        const tx = x0 + BOX + BOX_GAP;
        const tw = width - BOX - BOX_GAP;
        paintText(g, layout, tx, top + TODO_PAD_Y, tw, b.align);
        if (done) strikeLines(g, layout, tx, top + TODO_PAD_Y, tw, b.align);
        g.restore();
        return;
      }
      paintText(g, layout, x0, top, width, b.align);
    });
  };

  return { height: y, truncated, paint };
}

/** Tachado de un pendiente hecho (line-through sobre cada tramo de cada línea). */
function strikeLines(ctx, layout, x, y, width, align) {
  let top = y;
  layout.lines.forEach((line) => {
    let startX = x;
    if (align === 'center') startX = x + (width - line.width) / 2;
    else if (align === 'right') startX = x + width - line.width;
    let cx = startX;
    line.items.forEach((it) => {
      if (!it.space) {
        ctx.fillStyle = it.color;
        ctx.fillRect(cx, top + line.baseline - it.size * 0.3, it.w, Math.max(1, it.size / 14));
      }
      cx += it.w;
    });
    top += line.height;
  });
}

/* ================= Tarjeta completa ================= */

async function loadFonts(blocks) {
  ensureBoardFonts();
  const fonts = new Set([`400 ${BASE.size}px ${FONT_BY_KEY[BASE.font].css}`, `700 12px ${FONT_BY_KEY[BASE.font].css}`]);
  blocks.forEach((b) => (b.runs || []).forEach((r) => fonts.add(fontOf(r))));
  // Medir con una fuente todavía sin cargar da los anchos de la de respaldo, y el texto sale mal cortado.
  await Promise.all([...fonts].map((f) => document.fonts.load(f, 'AaBbÁáñ 0123').catch(() => null)));
}

function pinPath(ctx, cx, y) {
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.beginPath();
  ctx.arc(cx - 2, y - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Dibuja la tarjeta y devuelve { canvas, width, height, contentHeight, truncated }.
 * contentHeight es el alto del texto/imágenes SIN relleno: lo que en el DOM es el scrollHeight del
 * editor. La prueba de fidelidad compara ambos.
 */
export async function renderCardToCanvas(item) {
  const palette = PALETTE[item.color] || PALETTE.amber;
  const cardW = Math.max(180, Number(item.width) || 240);
  const innerW = cardW - PAD * 2;
  const isDrawing = item.type === 'drawing';
  const blocks = isDrawing ? [] : blocksFor(item);
  await loadFonts(blocks);

  const probe = document.createElement('canvas').getContext('2d');
  const body = isDrawing ? null : await layoutBlocks(probe, blocks, innerW);
  const showFooter = item.scope === 'public' && !!item.creator_name;

  const bodyH = isDrawing
    ? Math.max(120, (Number(item.height) || 200) - HEADER_H)
    : PAD * 2 + Math.max(body.height, BASE.size * LINE) + (body.truncated ? 22 : 0);
  const cardH = HEADER_H + bodyH + (showFooter ? FOOTER_H : 0);

  const w = cardW + MARGIN * 2;
  const h = cardH + MARGIN * 2;
  const scale = Math.min(TARGET_SCALE, Math.sqrt(MAX_PIXELS / (w * h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, w, h);

  const x = MARGIN;
  const y = MARGIN;
  // sombra de la tarjeta (shadow-md)
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,.20)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  roundRectPath(ctx, x, y, cardW, cardH, 12);
  ctx.fillStyle = palette.bg;
  ctx.fill();
  ctx.restore();

  // Todo lo de dentro se recorta a las esquinas redondeadas.
  ctx.save();
  roundRectPath(ctx, x, y, cardW, cardH, 12);
  ctx.clip();

  ctx.fillStyle = palette.header;
  ctx.fillRect(x, y, cardW, HEADER_H);
  const title = String(item.title || '').trim();
  if (title) {
    ctx.font = `700 12px ${FONT_BY_KEY[BASE.font].css}`;
    ctx.fillStyle = '#334155';
    ctx.textBaseline = 'alphabetic';
    let shown = title;
    const maxW = cardW - 20;
    if (ctx.measureText(shown).width > maxW) {
      while (shown.length > 1 && ctx.measureText(shown + '…').width > maxW) shown = shown.slice(0, -1);
      shown += '…';
    }
    ctx.fillText(shown, x + 10, y + HEADER_H / 2 + 4);
  }

  if (isDrawing) {
    const ax = x + 6;
    const ay = y + HEADER_H + 6;
    const aw = cardW - 12;
    const ah = bodyH - 12;
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, ax, ay, aw, ah, 8);
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, ax, ay, aw, ah, 8);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ((item.content && item.content.strokes) || []).forEach((s) => {
      if (!s.points || !s.points.length) return;
      ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#1e293b';
      ctx.lineWidth = Number(s.width) || 3;
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(ax + p[0], ay + p[1]) : ctx.moveTo(ax + p[0], ay + p[1])));
      if (s.points.length === 1) ctx.lineTo(ax + s.points[0][0] + 0.01, ay + s.points[0][1]);
      ctx.stroke();
    });
    ctx.restore();
  } else {
    body.paint(ctx, x + PAD, y + HEADER_H + PAD);
    if (body.truncated) {
      ctx.fillStyle = '#64748b';
      ctx.font = `italic 400 11px ${FONT_BY_KEY[BASE.font].css}`;
      ctx.fillText('… la nota continúa en Sirius', x + PAD, y + HEADER_H + bodyH - 8);
    }
  }

  if (showFooter) {
    ctx.fillStyle = 'rgba(0,0,0,.05)';
    ctx.fillRect(x, y + cardH - FOOTER_H, cardW, 1);
    ctx.fillStyle = '#64748b';
    ctx.font = `400 10px ${FONT_BY_KEY[BASE.font].css}`;
    ctx.fillText(String(item.creator_name), x + 8, y + cardH - 7);
  }
  ctx.restore();

  // borde (ring-1) y tachuela, por encima del recorte
  roundRectPath(ctx, x + 0.5, y + 0.5, cardW - 1, cardH - 1, 12);
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 1;
  ctx.stroke();
  pinPath(ctx, x + cardW / 2, y);

  return { canvas, width: w, height: h, contentHeight: body ? body.height : 0, truncated: !!(body && body.truncated), scale };
}

export async function renderCardToBlob(item) {
  const r = await renderCardToCanvas(item);
  const blob = await new Promise((resolve) => r.canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la imagen');
  return { ...r, blob };
}

/* ================= Modal: aviso + vista previa + acciones ================= */

/**
 * Primero se dibuja la imagen y LUEGO se abre el modal. navigator.share() exige un gesto reciente
 * del usuario (unos 5 s): si se dibujara después de confirmar, una nota con varias imágenes podría
 * tardar más y share() fallaría con NotAllowedError. Así cada botón es un click nuevo. El mismo
 * modal es el aviso de privacidad, el respaldo para navegadores sin compartir, y deja VER lo que
 * se va a enviar.
 */
export async function shareCard(item) {
  let rendered;
  try {
    rendered = await renderCardToBlob(item);
  } catch (e) {
    toast(e.message || 'No se pudo generar la imagen', 'error');
    return;
  }
  const { blob } = rendered;
  const name = fileName(item);
  const file = new File([blob], name, { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  const canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  const canCopy = !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);

  const box = document.createElement('div');
  box.className = 'space-y-3';
  box.innerHTML = `
    <div class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
      <span class="mt-0.5 shrink-0">${icon('alert-triangle', 'h-4 w-4')}</span>
      <p><strong>Esta imagen saldrá de Sirius</strong> y no se puede recoger una vez enviada. Revisa que no incluya datos que no deban salir.</p>
    </div>
    <div class="flex justify-center rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <img src="${url}" alt="Vista previa de ${escapeHtml(item.title || 'la nota')}" class="max-h-[45vh] w-auto max-w-full rounded">
    </div>`;

  let handle;
  const finish = () => { URL.revokeObjectURL(url); handle.close(); };
  const actions = [{ label: 'Cancelar', onClick: finish }];

  actions.push({
    label: 'Descargar',
    onClick: () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  });
  if (canCopy) {
    actions.push({
      label: 'Copiar imagen',
      onClick: async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('Imagen copiada');
        } catch {
          toast('No se pudo copiar; usa Descargar', 'error');
        }
      },
    });
  }
  if (canShare) {
    actions.push({
      label: 'Compartir',
      primary: true,
      onClick: async () => {
        try {
          await navigator.share({ files: [file], title: item.title || 'Nota de Sirius' });
          finish();
        } catch (e) {
          // Cerrar el panel del sistema sin elegir nada no es un error.
          if (e && e.name !== 'AbortError') toast('No se pudo compartir; usa Descargar', 'error');
        }
      },
    });
  }

  handle = modal({ title: 'Compartir como imagen', content: box, actions, size: 'max-w-md' });
  // Cerrar con la X o pulsando fuera también libera la vista previa.
  handle.el.addEventListener('click', (e) => {
    if (e.target === handle.el || e.target.closest('[data-close]')) URL.revokeObjectURL(url);
  });
}
