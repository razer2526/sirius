/**
 * Panel de Marketing: planeación de contenido para redes, su portafolio histórico
 * y el copiloto de IA (genera un borrador del mes, sugiere captions y opera las
 * herramientas de la sección con confirmación explícita).
 *
 * Vive en assets/js/ y no en modules/ porque ya no es un módulo del router: es una
 * herramienta dentro de Apps (#/apps/marketing), y modules/ se reserva para puntos
 * de entrada del router. Mismo criterio que coverage_map.js.
 *
 * Sin integración con Canva ni con las plataformas de redes a propósito: canva_url
 * es solo una liga al diseño y el estatus se marca a mano. Es una herramienta de
 * organización y planeación, no de publicación ni de métricas.
 */

import { apiGet, apiPost } from './api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, formValues, fmtDate, spinner,
  inputCls, labelCls, debounce,
} from './ui.js';
import { BOOTSTRAP_ICON_CATS, BOOTSTRAP_ICONS } from './marketing_icons.js';

/* ================= Paleta y catálogos ================= */
// Mismo diccionario que ya usa el Pizarrón (pizarron.js) — bg/ring/header/swatch
// por nombre de color, para que el contraste fondo/texto quede resuelto solo.
const COLOR_KEYS = ['amber', 'pink', 'sky', 'emerald', 'violet', 'slate', 'indigo', 'rose'];
const PALETTE = {
  amber:   { bg: 'bg-amber-100',   ring: 'ring-amber-300',   header: 'bg-amber-200',   swatch: 'bg-amber-500' },
  pink:    { bg: 'bg-pink-100',    ring: 'ring-pink-300',    header: 'bg-pink-200',    swatch: 'bg-pink-500' },
  sky:     { bg: 'bg-sky-100',     ring: 'ring-sky-300',     header: 'bg-sky-200',     swatch: 'bg-sky-500' },
  emerald: { bg: 'bg-emerald-100', ring: 'ring-emerald-300', header: 'bg-emerald-200', swatch: 'bg-emerald-500' },
  violet:  { bg: 'bg-violet-100',  ring: 'ring-violet-300',  header: 'bg-violet-200',  swatch: 'bg-violet-500' },
  slate:   { bg: 'bg-slate-100',   ring: 'ring-slate-300',   header: 'bg-slate-200',   swatch: 'bg-slate-500' },
  indigo:  { bg: 'bg-indigo-100',  ring: 'ring-indigo-300',  header: 'bg-indigo-200',  swatch: 'bg-indigo-500' },
  rose:    { bg: 'bg-rose-100',    ring: 'ring-rose-300',    header: 'bg-rose-200',    swatch: 'bg-rose-500' },
};

const STATUS_LABELS = { idea: 'Idea', diseno: 'Diseñando', programada: 'Programada', publicada: 'Publicada' };
const STATUS_BADGE = {
  idea: 'bg-slate-100 text-slate-600', diseno: 'bg-amber-100 text-amber-700',
  programada: 'bg-sky-100 text-sky-700', publicada: 'bg-emerald-100 text-emerald-700',
};
const CATEGORY_LABELS = { organico: 'Orgánico', ads: 'Ads', story: 'Story', efemeride: 'Efeméride', promocion: 'Promoción' };

// Redes donde se publica. Mismo criterio que PALETTE: las clases van completas y
// literales porque Tailwind escanea el código fuente buscando cadenas enteras — un
// `bg-${canal}-500` construido en tiempo de ejecución sale sin estilo.
const CHANNELS = {
  facebook:   { label: 'Facebook',   dot: 'bg-indigo-600', chip: 'bg-indigo-50 text-indigo-700', pill: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  instagram:  { label: 'Instagram',  dot: 'bg-pink-500',   chip: 'bg-pink-50 text-pink-700',     pill: 'border-pink-200 bg-pink-50 text-pink-700' },
  tiktok:     { label: 'TikTok',     dot: 'bg-slate-900',  chip: 'bg-slate-200 text-slate-800',  pill: 'border-slate-300 bg-slate-100 text-slate-800' },
  google_ads: { label: 'Google Ads', dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-800',   pill: 'border-amber-200 bg-amber-50 text-amber-800' },
};
// Las publicaciones anteriores al campo `channels` no tienen red: se marcan así en
// vez de dejarlas sin etiqueta, y nunca se les asigna una a ciegas.
const NO_CHANNEL = { label: 'Sin red', chip: 'bg-slate-100 text-slate-500' };

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Emoji agrupados por tema — a color, sin depender de ningún servicio externo.
const EMOJI_GROUPS = {
  'Salud': ['🩺', '❤️', '🧠', '🦴', '🩸', '💊', '🧬', '🦷', '👁️', '🫀', '🫁', '🧴', '🧼', '🩹', '⚕️', '🚑'],
  'Celebración': ['🎉', '🎊', '🎈', '🎁', '🏆', '🥳', '✨', '🌟', '⭐', '🎗️', '🕊️', '🎄', '🎃'],
  'Comida': ['🍎', '🥗', '🍽️', '☕', '🥑', '🍊', '🥦', '🍇', '🍓', '🥕'],
  'Cintas y corazones': ['🎗️', '💗', '💙', '💛', '💚', '💜', '🩷', '🤍', '♥️'],
  'Otros': ['📅', '📸', '📢', '💡', '📝', '🔔', '📈', '🎯', '🤝', '👵', '🧒', '🌍', '☀️', '🌙', '💧'],
};


/** Ícono compartido por calendario/lista/portafolio/selector: emoji tal cual,
 *  o un ícono de Bootstrap Icons (autohospedado, prefijo "bi:") como SVG inline. */
function emojiOrIconHtml(value, sizeCls = 'h-5 w-5') {
  if (!value) return '';
  if (value.startsWith('bi:')) {
    const def = BOOTSTRAP_ICONS[value.slice(3)];
    if (!def) return '';
    const [viewBox, inner] = def;
    return `<svg viewBox="${viewBox}" class="${sizeCls} inline-block fill-current" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  }
  return `<span class="${sizeCls} inline-flex items-center justify-center leading-none">${escapeHtml(value)}</span>`;
}

/* ================= Estado del panel ================= */
const VIEWS = ['mes', 'semana', 'dia'];
let view = 'mes';      // 'mes' | 'semana' | 'dia' | 'lista' | 'portafolio'
let year;
let month;
let selectedDate = ''; // 'YYYY-MM-DD' — el día que muestra la barra izquierda
let channelFilter = ''; // '' = todos
let posts = [];
let commemorative = [];
let chatHistory = [];
let chatOpen = false;
const portfolioFilters = { status: '', category: '', q: '' };

export async function renderMarketing(root, ctx, routeView) {
  view = (routeView && [...VIEWS, 'lista', 'portafolio'].includes(routeView)) ? routeView : 'mes';
  if (!year) {
    const today = new Date();
    year = today.getFullYear();
    month = today.getMonth() + 1;
  }
  syncSelectedDate();
  await loadMonth(root);
}

/** El día seleccionado nunca queda vacío: hoy si cae en el mes visible, si no el 1.
 *  Tampoco se arrastra el día del mes anterior — "el 28 de un mes que solo estaba
 *  ojeando" es un estado que sorprende más de lo que ayuda. */
function syncSelectedDate() {
  const t = new Date();
  const sameMonth = t.getFullYear() === year && t.getMonth() + 1 === month;
  const day = sameMonth ? t.getDate() : 1;
  selectedDate = dateStr(year, month, day);
}

function dateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function loadMonth(root) {
  root.innerHTML = spinner();
  const mm = String(month).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  try {
    const [{ posts: p }, { dates }] = await Promise.all([
      apiGet('marketing/posts_list', { from, to }),
      apiGet('marketing/commemorative_dates_list', { month }),
    ]);
    posts = p;
    commemorative = dates;
  } catch (e) {
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
    return;
  }
  paint(root);
}

function reload() {
  loadMonth(document.getElementById('module-root'));
}

function repaint() {
  paint(document.getElementById('module-root'));
}

function todayStr() {
  const d = new Date();
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* ================= Canales ================= */
/** Publicaciones del mes que pasan el filtro de canal. Las que no tienen ningún
 *  canal asignado (las de antes de que existiera el campo) se muestran siempre que
 *  no haya un filtro específico activo, en vez de desaparecer sin explicación. */
function visiblePosts() {
  if (!channelFilter) return posts;
  return posts.filter((p) => (p.channels || []).includes(channelFilter));
}

function channelCounts() {
  const counts = { '': posts.length };
  for (const key of Object.keys(CHANNELS)) counts[key] = 0;
  for (const p of posts) for (const c of (p.channels || [])) if (counts[c] !== undefined) counts[c]++;
  return counts;
}

/** `max` existe porque en la celda del mes cuatro redes apiladas estiran la tarjeta
 *  hasta desbordar el día; ahí se recortan a dos y el resto se resume. */
function channelChipsHtml(list, sizeCls = 'text-[9px]', max = 0) {
  const valid = (list || []).filter((c) => CHANNELS[c]);
  if (!valid.length) {
    return `<span class="rounded px-1 py-0.5 ${sizeCls} font-medium ${NO_CHANNEL.chip}">${NO_CHANNEL.label}</span>`;
  }
  const shown = max > 0 ? valid.slice(0, max) : valid;
  const rest = valid.length - shown.length;
  return shown
    .map((c) => `<span class="rounded px-1 py-0.5 ${sizeCls} font-medium ${CHANNELS[c].chip}">${CHANNELS[c].label}</span>`)
    .join(' ')
    + (rest > 0 ? ` <span class="rounded px-1 py-0.5 ${sizeCls} font-medium text-slate-500">+${rest}</span>` : '');
}

/** '14:30:00' → '02:30 PM'. Devuelve '' si no hay hora. */
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h12).padStart(2, '0')}:${m} ${suffix}`;
}

/* ================= Layout principal ================= */
function paint(root) {
  // La barra del día se oculta donde sería redundante o no aplica: en la vista Día
  // porque es exactamente el mismo contenido, y en Portafolio porque ese es un
  // archivo histórico completo, no un mes.
  const showDayPanel = view !== 'dia' && view !== 'portafolio';

  root.innerHTML = `
    <div class="flex flex-col gap-3">
      ${topBarHtml()}
      <div class="flex min-w-0 flex-col gap-3 lg:flex-row">
        ${showDayPanel ? '<aside id="day-panel" class="lg:w-80 lg:shrink-0"></aside>' : ''}
        <section id="view-content" class="min-w-0 flex-1"></section>
      </div>
      ${dockHtml()}
    </div>
    <div id="chat-panel"></div>`;

  if (showDayPanel) renderDayPanel(root.querySelector('#day-panel'));
  renderView(root.querySelector('#view-content'));
  wireTopBar(root);
  wireDock(root);
  renderChatPanel(root);
}

/* ================= Dock inferior ================= */
/** sticky dentro de #module-root (que ya es el contenedor con scroll) en vez de
 *  fixed: así no compite en la capa z-40 con la burbuja global del asistente, y el
 *  pr-20 le reserva su lugar para que el último botón no quede debajo. */
function dockHtml() {
  const pending = pendingPosts().length;
  const dockBtn = (id, iconName, label, hoverCls, badge = '') => `
    <div class="group relative">
      <button type="button" id="${id}" class="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100/80 ${hoverCls} active:scale-95">
        ${icon(iconName, 'h-5 w-5')}${badge}
      </button>
      <span class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 shadow-md transition group-hover:opacity-100">${label}</span>
    </div>`;

  return `
    <div class="sticky -bottom-24 z-30 -mx-4 -mb-24 flex items-center justify-center border-t border-slate-200 bg-white/90 px-4 py-1.5 pr-20 backdrop-blur-md sm:-mx-6 sm:px-6 sm:pr-24">
      <div class="flex items-center gap-1.5">
        ${dockBtn('dock-library', 'image', 'Biblioteca de recursos', 'hover:text-emerald-700')}
        ${dockBtn('dock-pending', 'clipboard', `Qué sigue (${pending})`, 'hover:text-amber-700',
          pending ? `<span class="absolute -top-0.5 right-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-extrabold text-white ring-2 ring-white">${pending}</span>` : '')}
        <div class="mx-0.5 h-6 w-px bg-slate-200"></div>
        <div class="group relative">
          <button type="button" id="dock-copilot" class="flex h-10 items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-95">
            ${icon('sparkles', 'h-4 w-4')} <span class="tracking-wide">Copiloto IA</span>
          </button>
          <span class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 shadow-md transition group-hover:opacity-100">Planear y redactar con IA</span>
        </div>
        <div class="mx-0.5 h-6 w-px bg-slate-200"></div>
        ${dockBtn('dock-draft', 'edit-3', 'Generar borrador del mes', 'hover:text-indigo-700')}
      </div>
    </div>`;
}

function wireDock(root) {
  root.querySelector('#dock-library')?.addEventListener('click', () => openLibraryModal());
  root.querySelector('#dock-pending')?.addEventListener('click', () => openPendingModal());
  root.querySelector('#dock-copilot')?.addEventListener('click', () => {
    chatOpen = !chatOpen;
    renderChatPanel(root);
  });
  root.querySelector('#dock-draft')?.addEventListener('click', (e) => generateMonthDraft(e.currentTarget));
}

/* ================= "Qué sigue" ================= */
/** Lo que falta cerrar, derivado de lo que ya hay: publicaciones de hoy en adelante
 *  que siguen en idea o diseño. No necesita tabla propia. */
function pendingPosts() {
  const today = todayStr();
  return posts
    .filter((p) => (p.status === 'idea' || p.status === 'diseno') && p.post_date >= today)
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
}

function openPendingModal() {
  const list = pendingPosts();
  const body = list.length
    ? `<div class="space-y-2">${list.map((p) => `
        <button type="button" data-pending="${p.id}" class="flex w-full items-center gap-3 rounded-xl p-2.5 text-left ring-1 ring-slate-200 transition hover:ring-emerald-300">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${PALETTE[p.color]?.bg || 'bg-slate-100'}">${emojiOrIconHtml(p.emoji || '📅', 'h-5 w-5')}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-slate-800">${escapeHtml(p.title)}</span>
            <span class="block text-xs text-slate-500">${fmtDate(p.post_date)}${p.post_time ? ' · ' + fmtTime(p.post_time) : ''}</span>
          </span>
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[p.status] || ''}">${STATUS_LABELS[p.status] || ''}</span>
        </button>`).join('')}</div>`
    : '<p class="py-8 text-center text-sm text-slate-400">Nada pendiente: todo lo que viene está programado o publicado.</p>';

  const m = modal({
    title: `Qué sigue (${list.length})`,
    content: body,
    size: 'max-w-md',
    actions: [{ label: 'Cerrar' }],
  });
  m.el.querySelectorAll('[data-pending]').forEach((b) => b.addEventListener('click', () => {
    const post = posts.find((p) => p.id === +b.dataset.pending);
    m.close();
    openPostModal(post, reload);
  }));
}

/* ================= Barra superior ================= */
function topBarHtml() {
  const counts = channelCounts();
  const statusCounts = { idea: 0, diseno: 0, programada: 0, publicada: 0 };
  for (const p of posts) if (statusCounts[p.status] !== undefined) statusCounts[p.status]++;

  const viewBtn = (key, label) => `
    <button type="button" data-view="${key}" class="rounded-md px-3 py-1.5 text-xs font-semibold transition ${
      view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
    }">${label}</button>`;

  const secondaryBtn = (key, label, iconName) => `
    <button type="button" data-view="${key}" class="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
      view === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
    }">${icon(iconName, 'h-4 w-4 text-slate-500')}<span>${label}</span></button>`;

  const channelPill = (key, label, dot, activeCls) => `
    <button type="button" data-channel="${key}" class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
      channelFilter === key ? activeCls : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
    }">
      <span class="h-2 w-2 rounded-full ${dot}"></span> ${label} (${counts[key] || 0})
    </button>`;

  return `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div class="flex flex-wrap items-center gap-4">
          <a href="#/apps" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
            ${icon('chevron-left', 'h-4 w-4')} Apps
          </a>
          <div class="flex items-center rounded-lg border border-slate-200/80 bg-slate-100 p-1 text-slate-600">
            <button type="button" id="btn-prev-month" title="Mes anterior" class="rounded-md p-1.5 transition hover:bg-white hover:text-slate-900">${icon('chevron-left', 'h-4 w-4')}</button>
            <div class="flex items-center gap-1.5 px-3 py-0.5 text-sm font-bold text-slate-800">
              <span>${MONTH_NAMES[month - 1]} ${year}</span>
              <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Mes ${month}</span>
            </div>
            <button type="button" id="btn-next-month" title="Mes siguiente" class="rounded-md p-1.5 transition hover:bg-white hover:text-slate-900">${icon('chevron-left', 'h-4 w-4 rotate-180')}</button>
          </div>
          <button type="button" id="btn-today" class="rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">Hoy</button>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/80 p-1">
            ${secondaryBtn('lista', 'Lista', 'list')}
            ${secondaryBtn('portafolio', 'Portafolio', 'image')}
          </div>
          <div class="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/90 p-1">
            ${viewBtn('mes', 'Mes')}${viewBtn('semana', 'Semana')}${viewBtn('dia', 'Día')}
          </div>
          <button type="button" id="btn-new-post" class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95">
            ${icon('plus', 'h-4 w-4')} Nueva Publicación
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50 px-4 py-2">
        <div class="flex items-center gap-2 overflow-x-auto py-0.5">
          <span class="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Canales:</span>
          ${channelPill('', 'Todos', 'bg-slate-400', 'border-slate-300 bg-slate-200 text-slate-800')}
          ${Object.entries(CHANNELS).map(([k, c]) => channelPill(k, c.label, c.dot, c.pill)).join('')}
        </div>
        <div class="flex items-center gap-4 text-xs font-medium text-slate-500">
          <div class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-sky-500"></span>Programadas: <strong class="text-slate-700">${statusCounts.programada}</strong></div>
          <div class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>En diseño: <strong class="text-slate-700">${statusCounts.diseno}</strong></div>
          <div class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>Publicadas: <strong class="text-slate-700">${statusCounts.publicada}</strong></div>
        </div>
      </div>
    </div>`;
}

function wireTopBar(root) {
  root.querySelector('#btn-prev-month')?.addEventListener('click', () => {
    month--; if (month < 1) { month = 12; year--; }
    syncSelectedDate();
    reload();
  });
  root.querySelector('#btn-next-month')?.addEventListener('click', () => {
    month++; if (month > 12) { month = 1; year++; }
    syncSelectedDate();
    reload();
  });
  root.querySelector('#btn-today')?.addEventListener('click', () => {
    const t = new Date();
    year = t.getFullYear(); month = t.getMonth() + 1;
    syncSelectedDate();
    reload();
  });
  root.querySelector('#btn-new-post')?.addEventListener('click', () => {
    openPostModal(null, reload, selectedDate);
  });
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === view) return;
    view = b.dataset.view;
    // La vista va en la URL; el día seleccionado se queda en memoria a propósito:
    // si cada clic en el calendario tocara el hash, el botón "atrás" del navegador
    // recorrería el calendario día por día.
    window.location.hash = `#/apps/marketing/${view}`;
  }));
  root.querySelectorAll('[data-channel]').forEach((b) => b.addEventListener('click', () => {
    channelFilter = b.dataset.channel;
    repaint();
  }));
}

function renderView(container) {
  if (view === 'lista') return renderListTab(container);
  if (view === 'portafolio') return renderPortfolioTab(container);
  if (view === 'semana') return renderWeekView(container);
  if (view === 'dia') return renderDayView(container);
  return renderCalendarTab(container);
}

async function generateMonthDraft(btn) {
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `${icon('sparkles', 'h-4 w-4')} Generando…`;
  try {
    const res = await apiPost('marketing/generate_month_draft', { year, month });
    toast(res.created.length
      ? `${res.created.length} idea(s) agregadas al calendario`
      : 'La IA no encontró días vacíos que llenar este mes.');
    reload();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ================= Tarjeta de publicación (compartida) ================= */
/** La misma tarjeta en la celda del mes, la columna de la semana y la barra del día.
 *  `maxChannels` la recorta donde el espacio vertical es escaso. */
function postCardHtml(p, maxChannels = 0) {
  const time = fmtTime(p.post_time);
  return `
    <button type="button" data-open-post="${p.id}" class="w-full cursor-pointer rounded-lg border p-1.5 text-left text-[11px] shadow-sm transition hover:shadow ${PALETTE[p.color]?.bg || 'bg-slate-100'} ${PALETTE[p.color]?.ring ? 'border-transparent ring-1 ' + PALETTE[p.color].ring : 'border-slate-200'}">
      <div class="mb-0.5 flex items-center justify-between gap-1 text-[9px] font-semibold text-slate-500">
        <span class="flex min-w-0 items-center gap-1">
          ${emojiOrIconHtml(p.emoji, 'h-3 w-3')}
          <span class="truncate">${escapeHtml(CATEGORY_LABELS[p.category] || p.category)}</span>
        </span>
        ${time ? `<span class="shrink-0">${time}</span>` : ''}
      </div>
      <p class="line-clamp-2 font-bold leading-tight text-slate-800">${escapeHtml(p.title)}</p>
      <div class="mt-1 flex items-center justify-between gap-1">
        <span class="flex min-w-0 flex-wrap gap-0.5">${channelChipsHtml(p.channels, 'text-[9px]', maxChannels)}</span>
        <span class="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[p.status] || ''}">${STATUS_LABELS[p.status] || ''}</span>
      </div>
    </button>`;
}

/** Los tres botones que toda vista con tarjetas necesita: abrir publicación,
 *  crear una en un día concreto y seleccionar el día para la barra izquierda. */
function wireDayInteractions(container) {
  container.querySelectorAll('[data-open-post]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPostModal(posts.find((p) => p.id === +b.dataset.openPost), reload);
  }));
  container.querySelectorAll('[data-new-post]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPostModal(null, reload, b.dataset.newPost);
  }));
  container.querySelectorAll('[data-select-day]').forEach((cellEl) => {
    cellEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-post]') || e.target.closest('[data-new-post]')) return;
      selectedDate = cellEl.dataset.selectDay;
      repaint();
    });
  });
}

/* ================= Barra izquierda: el día seleccionado ================= */
function renderDayPanel(container) {
  const [y, m, d] = selectedDate.split('-').map(Number);
  const weekday = WEEKDAYS_LONG[new Date(y, m - 1, d).getDay()];
  const dayPosts = visiblePosts()
    .filter((p) => p.post_date === selectedDate)
    .sort((a, b) => (a.post_time || '99').localeCompare(b.post_time || '99'));
  const dayCommem = commemorative.filter((c) => c.day === d);
  const isToday = selectedDate === todayStr();

  container.innerHTML = `
    <div class="flex overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="flex w-14 shrink-0 select-none flex-col items-center justify-between border-r border-slate-200 bg-[#edf5f0] py-5">
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700/10 text-emerald-700">${icon('calendar', 'h-4 w-4')}</span>
        <h2 class="text-2xl font-black uppercase tracking-widest text-[#72a382]" style="writing-mode:vertical-rl;transform:rotate(180deg)">${MONTH_NAMES[month - 1]}</h2>
        <span class="text-xs font-black text-emerald-800/60">${year}</span>
      </div>

      <div class="min-w-0 flex-1 p-4">
        <div class="border-b border-slate-200 pb-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-bold uppercase tracking-wider text-slate-400">${weekday}</p>
              <p class="text-3xl font-black leading-none text-slate-900">${d}<span class="ml-1 text-sm font-bold text-slate-400">${MONTH_NAMES[month - 1]}</span></p>
            </div>
            ${isToday ? '<span class="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">HOY</span>' : ''}
          </div>
        </div>

        ${dayCommem.length ? `
        <div class="mt-3">
          <p class="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
            ${icon('flag', 'h-3.5 w-3.5 text-emerald-600')} Efemérides
          </p>
          <div class="space-y-1.5">
            ${dayCommem.map((c) => `
              <div class="rounded-lg border border-sky-100 bg-sky-50/70 p-2 text-xs text-slate-700">
                ${escapeHtml(c.emoji_suggestion || '')} ${escapeHtml(c.label)}
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div class="mt-4">
          <p class="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-700">
            <span class="flex items-center gap-1.5">${icon('camera', 'h-3.5 w-3.5 text-emerald-600')} Publicaciones</span>
            <span class="font-semibold text-slate-400">${dayPosts.length}</span>
          </p>
          <div class="space-y-1.5">
            ${dayPosts.length
              ? dayPosts.map(postCardHtml).join('')
              : '<p class="rounded-lg bg-slate-50 px-2 py-4 text-center text-xs text-slate-400">Nada planeado este día.</p>'}
          </div>
        </div>

        <button type="button" data-new-post="${selectedDate}" class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700">
          ${icon('plus', 'h-3.5 w-3.5')} Nueva publicación este día
        </button>
      </div>
    </div>`;

  wireDayInteractions(container);
}

/* ================= Vista Mes ================= */
function renderCalendarTab(container) {
  const commemByDay = {};
  for (const c of commemorative) (commemByDay[c.day] ||= []).push(c);
  const postsByDay = {};
  for (const p of visiblePosts()) {
    const day = +p.post_date.slice(8, 10);
    (postsByDay[day] ||= []).push(p);
  }

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  container.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="grid grid-cols-7 bg-[#005a9c] text-white">
        ${WEEKDAYS.map((w) => `<div class="border-r border-white/20 px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider last:border-r-0">${w}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7 gap-px bg-slate-200">
        ${cells.map((d) => dayCellHtml(d, commemByDay[d] || [], postsByDay[d] || [])).join('')}
      </div>
    </div>`;

  wireDayInteractions(container);
}

function dayCellHtml(d, commemList, dayPosts) {
  if (!d) return '<div class="min-h-[118px] bg-slate-50/70"></div>';
  const iso = dateStr(year, month, d);
  const isToday = iso === todayStr();
  const isSelected = iso === selectedDate;
  const commemChips = commemList.map((c) => `
    <p class="truncate text-[10px] text-slate-400" title="${escapeHtml(c.label)}">${escapeHtml(c.emoji_suggestion || '')} ${escapeHtml(c.label)}</p>`).join('');
  const cards = dayPosts.slice(0, 2).map((p) => postCardHtml(p, 2)).join('');
  const overflow = dayPosts.length > 2 ? `<p class="text-[10px] font-medium text-slate-400">+${dayPosts.length - 2} más</p>` : '';
  const dayBadge = isToday
    ? 'bg-emerald-600 text-white'
    : isSelected ? 'bg-slate-900 text-white' : 'text-slate-700';

  return `
    <div data-select-day="${iso}" class="group flex min-h-[118px] cursor-pointer flex-col gap-1 bg-white p-2 transition hover:bg-slate-50 ${isSelected ? 'ring-2 ring-inset ring-emerald-500' : ''}">
      <div class="flex items-start justify-between">
        <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${dayBadge}">${d}</span>
        <button type="button" data-new-post="${iso}" title="Nueva publicación" class="text-slate-300 opacity-0 transition hover:text-emerald-600 group-hover:opacity-100">${icon('plus', 'h-4 w-4')}</button>
      </div>
      ${commemChips}
      <div class="flex-1 space-y-1">${cards || (commemChips ? '' : '<p class="text-[10px] italic text-slate-300">Sin publicaciones</p>')}${overflow}</div>
    </div>`;
}

/* ================= Vista Semana ================= */
/** Siete columnas con la misma tarjeta del mes. Sin rejilla de franjas horarias:
 *  con una o dos publicaciones al día sería una pared de renglones vacíos. */
function renderWeekView(container) {
  const [y, m, d] = selectedDate.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay());

  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    const iso = dateStr(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
    days.push({
      iso,
      num: cur.getDate(),
      weekday: WEEKDAYS[cur.getDay()],
      inMonth: cur.getMonth() + 1 === month,
      posts: visiblePosts()
        .filter((p) => p.post_date === iso)
        .sort((a, b) => (a.post_time || '99').localeCompare(b.post_time || '99')),
      commem: cur.getMonth() + 1 === month ? commemorative.filter((c) => c.day === cur.getDate()) : [],
    });
  }

  container.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="grid grid-cols-7 bg-[#005a9c] text-white">
        ${days.map((d2) => `
          <div class="border-r border-white/20 px-2 py-2.5 text-center last:border-r-0">
            <p class="text-[11px] font-bold uppercase tracking-wider">${d2.weekday}</p>
            <p class="text-lg font-black leading-none">${d2.num}</p>
          </div>`).join('')}
      </div>
      <div class="grid grid-cols-7 gap-px bg-slate-200">
        ${days.map((d2) => `
          <div data-select-day="${d2.iso}" class="group flex min-h-[22rem] cursor-pointer flex-col gap-1 p-2 transition ${d2.inMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/70'} ${d2.iso === selectedDate ? 'ring-2 ring-inset ring-emerald-500' : ''}">
            ${d2.commem.map((c) => `<p class="truncate text-[10px] text-slate-400" title="${escapeHtml(c.label)}">${escapeHtml(c.emoji_suggestion || '')} ${escapeHtml(c.label)}</p>`).join('')}
            ${d2.posts.map((p) => postCardHtml(p, 2)).join('')
              || '<p class="text-[10px] italic text-slate-300">Sin publicaciones</p>'}
            <button type="button" data-new-post="${d2.iso}" class="mt-auto flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-1.5 text-[10px] font-semibold text-slate-400 opacity-0 transition hover:border-emerald-400 hover:text-emerald-700 group-hover:opacity-100">
              ${icon('plus', 'h-3 w-3')} Agregar
            </button>
          </div>`).join('')}
      </div>
    </div>`;

  wireDayInteractions(container);
}

/* ================= Vista Día ================= */
/** Monta el mismo contenido de la barra izquierda en la columna principal —
 *  dos puntos de montaje, un solo renderizador. */
function renderDayView(container) {
  renderDayPanel(container);
}

/* ================= Vista Lista ================= */
function renderListTab(container) {
  const sorted = [...visiblePosts()].sort((a, b) =>
    a.post_date.localeCompare(b.post_date) || (a.post_time || '99').localeCompare(b.post_time || '99'));
  container.innerHTML = `
    <div class="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-200 bg-[#005a9c] text-left text-xs font-bold uppercase tracking-wider text-white">
            <th class="px-4 py-2.5">Fecha</th>
            <th class="px-2 py-2.5">Hora</th>
            <th class="px-2 py-2.5"></th>
            <th class="px-2 py-2.5">Título</th>
            <th class="hidden px-2 py-2.5 sm:table-cell">Redes</th>
            <th class="hidden px-2 py-2.5 md:table-cell">Categoría</th>
            <th class="px-2 py-2.5">Estatus</th>
            <th class="w-10 px-2 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.length ? sorted.map(listRowHtml).join('') : '<tr><td colspan="8" class="py-10 text-center text-sm text-slate-400">Sin publicaciones este mes.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  container.querySelectorAll('[data-edit-row]').forEach((b) => b.addEventListener('click', () => {
    openPostModal(posts.find((p) => p.id === +b.dataset.editRow), reload);
  }));
}

function listRowHtml(post) {
  return `
    <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td class="px-4 py-2 text-xs text-slate-500">${fmtDate(post.post_date)}</td>
      <td class="px-2 py-2 text-xs font-medium text-slate-500">${fmtTime(post.post_time) || '—'}</td>
      <td class="px-2 py-2">${emojiOrIconHtml(post.emoji, 'h-4 w-4')}</td>
      <td class="px-2 py-2 font-medium text-slate-800">${escapeHtml(post.title)}</td>
      <td class="hidden px-2 py-2 sm:table-cell"><span class="flex flex-wrap gap-0.5">${channelChipsHtml(post.channels, 'text-[10px]')}</span></td>
      <td class="hidden px-2 py-2 text-xs text-slate-500 md:table-cell">${CATEGORY_LABELS[post.category] || post.category}</td>
      <td class="px-2 py-2"><span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[post.status]}">${STATUS_LABELS[post.status]}</span></td>
      <td class="px-2 py-2 text-right">
        <button type="button" data-edit-row="${post.id}" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">${icon('edit', 'h-4 w-4')}</button>
      </td>
    </tr>`;
}

/* ================= Vista Portafolio ================= */
async function renderPortfolioTab(container) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <input id="pf-q" type="text" placeholder="Buscar por título…" value="${escapeHtml(portfolioFilters.q)}" class="${inputCls} max-w-xs">
        <select id="pf-status" class="${inputCls} max-w-[10rem]">
          <option value="">Todos los estatus</option>
          ${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${portfolioFilters.status === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="pf-category" class="${inputCls} max-w-[10rem]">
          <option value="">Todas las categorías</option>
          ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<option value="${k}" ${portfolioFilters.category === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div id="pf-grid" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">${spinner()}</div>
    </div>`;

  let currentList = [];
  const loadGrid = async () => {
    const grid = container.querySelector('#pf-grid');
    if (!grid) return;
    const params = {};
    if (portfolioFilters.status) params.status = portfolioFilters.status;
    if (portfolioFilters.category) params.category = portfolioFilters.category;
    try {
      currentList = (await apiGet('marketing/posts_list', params)).posts;
    } catch (e) {
      grid.innerHTML = `<p class="col-span-full text-sm text-red-600">${escapeHtml(e.message)}</p>`;
      return;
    }
    if (portfolioFilters.q) {
      const q = portfolioFilters.q.toLowerCase();
      currentList = currentList.filter((p) => p.title.toLowerCase().includes(q));
    }
    grid.innerHTML = currentList.length
      ? currentList.map(portfolioTileHtml).join('')
      : '<p class="col-span-full py-10 text-center text-sm text-slate-400">Sin publicaciones con estos filtros.</p>';
    grid.querySelectorAll('[data-edit-post]').forEach((b) => b.addEventListener('click', () => {
      openPostModal(currentList.find((p) => p.id === +b.dataset.editPost), loadGrid);
    }));
  };

  container.querySelector('#pf-q').addEventListener('input', debounce(() => {
    portfolioFilters.q = container.querySelector('#pf-q').value;
    loadGrid();
  }, 250));
  container.querySelector('#pf-status').addEventListener('change', (e) => { portfolioFilters.status = e.target.value; loadGrid(); });
  container.querySelector('#pf-category').addEventListener('change', (e) => { portfolioFilters.category = e.target.value; loadGrid(); });
  await loadGrid();
}

function portfolioTileHtml(post) {
  return `
    <div class="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="flex h-28 items-center justify-center overflow-hidden ${post.thumbnail_url ? 'bg-slate-100' : (PALETTE[post.color]?.bg || 'bg-slate-100')}">
        ${post.thumbnail_url
          ? `<img src="${escapeHtml(post.thumbnail_url)}" alt="" class="h-full w-full object-cover">`
          : emojiOrIconHtml(post.emoji || '📅', 'h-10 w-10')}
      </div>
      <div class="flex-1 space-y-1 p-3">
        <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(post.title)}</p>
        <p class="text-xs text-slate-400">${fmtDate(post.post_date)}</p>
        <span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[post.status]}">${STATUS_LABELS[post.status]}</span>
      </div>
      <div class="flex border-t border-slate-100">
        ${post.canva_url
          ? `<a href="${escapeHtml(post.canva_url)}" target="_blank" rel="noopener" class="flex-1 py-2 text-center text-xs font-semibold text-indigo-600 hover:bg-indigo-50">Abrir en Canva</a>`
          : '<span class="flex-1 py-2 text-center text-xs text-slate-300">Sin liga</span>'}
        <button type="button" data-edit-post="${post.id}" class="flex-1 border-l border-slate-100 py-2 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50">Editar</button>
      </div>
    </div>`;
}

/* ================= Modal de publicación ================= */
function openPostModal(post, onSaved, defaultDate) {
  let chosenEmoji = post?.emoji || '';
  let chosenColor = post?.color || 'sky';
  const chosenChannels = new Set(post?.channels || []);
  const wrap = document.createElement('form');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="${labelCls}">Fecha</label>
          <input type="date" name="post_date" value="${post?.post_date || defaultDate || todayStr()}" required class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Hora</label>
          <input type="time" name="post_time" value="${(post?.post_time || '').slice(0, 5)}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Categoría</label>
          <select name="category" class="${inputCls}">
            ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<option value="${k}" ${(post?.category || 'organico') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="${labelCls}">Título</label>
        <input type="text" name="title" value="${escapeHtml(post?.title || '')}" required class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Redes</label>
        <div id="channel-picks" class="flex flex-wrap gap-2 pt-1">
          ${Object.entries(CHANNELS).map(([k, c]) => `
            <button type="button" data-channel-pick="${k}" class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              chosenChannels.has(k) ? c.pill : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            }">
              <span class="h-2 w-2 rounded-full ${c.dot}"></span> ${c.label}
            </button>`).join('')}
        </div>
      </div>
      <div class="flex items-end gap-3">
        <div>
          <label class="${labelCls}">Ícono</label>
          <button type="button" id="btn-pick-icon" class="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100">
            <span id="icon-preview">${chosenEmoji ? emojiOrIconHtml(chosenEmoji, 'h-6 w-6') : icon('image', 'h-5 w-5 text-slate-300')}</span>
          </button>
        </div>
        <div class="flex-1">
          <label class="${labelCls}">Color</label>
          <div id="color-swatches" class="flex flex-wrap gap-1.5 pt-1.5">
            ${COLOR_KEYS.map((c) => `<button type="button" data-color="${c}" class="h-6 w-6 rounded-full ${PALETTE[c].swatch} ring-2 ${chosenColor === c ? 'ring-slate-800' : 'ring-transparent'}"></button>`).join('')}
          </div>
        </div>
        <div>
          <label class="${labelCls}">Estatus</label>
          <select name="status" class="${inputCls}">
            ${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${(post?.status || 'idea') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="${labelCls}">Liga de Canva</label>
        <input type="url" name="canva_url" value="${escapeHtml(post?.canva_url || '')}" placeholder="https://www.canva.com/design/…" class="${inputCls}">
      </div>
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="${labelCls}">Caption</label>
          <button type="button" id="btn-suggest-caption" class="text-xs font-semibold text-indigo-600 hover:text-indigo-500">Sugerir caption</button>
        </div>
        <textarea name="caption" rows="4" class="${inputCls}">${escapeHtml(post?.caption || '')}</textarea>
      </div>
      ${post ? `
      <div>
        <label class="${labelCls}">Miniatura de referencia</label>
        <div class="flex items-center gap-3">
          <div id="thumb-preview" class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
            ${post.thumbnail_url ? `<img src="${escapeHtml(post.thumbnail_url)}" alt="" class="h-full w-full object-cover">` : icon('image', 'h-5 w-5 text-slate-300')}
          </div>
          <label class="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            Subir
            <input id="thumb-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden">
          </label>
        </div>
      </div>` : ''}
    </div>`;

  wrap.querySelector('#btn-pick-icon').addEventListener('click', () => {
    openIconPicker(chosenEmoji, (value) => {
      chosenEmoji = value;
      wrap.querySelector('#icon-preview').innerHTML = value ? emojiOrIconHtml(value, 'h-6 w-6') : icon('image', 'h-5 w-5 text-slate-300');
    });
  });

  wrap.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    chosenColor = b.dataset.color;
    wrap.querySelectorAll('[data-color]').forEach((x) => {
      x.classList.toggle('ring-slate-800', x.dataset.color === chosenColor);
      x.classList.toggle('ring-transparent', x.dataset.color !== chosenColor);
    });
  }));

  wrap.querySelectorAll('[data-channel-pick]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.channelPick;
    const active = chosenChannels.has(key);
    if (active) chosenChannels.delete(key); else chosenChannels.add(key);
    // Se reemplaza la lista completa de clases para no mezclar la activa con la
    // inactiva: son dos cadenas literales distintas, no una variante de la otra.
    b.className = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      chosenChannels.has(key) ? CHANNELS[key].pill : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
    }`;
  }));

  wrap.querySelector('#btn-suggest-caption').addEventListener('click', async (e) => {
    if (!post) { toast('Guarda la publicación primero para poder sugerir un caption.', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await apiPost('marketing/suggest_caption', { id: post.id });
      wrap.querySelector('[name="caption"]').value = res.caption;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  wrap.querySelector('#thumb-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !post) return;
    const fd = new FormData();
    fd.append('id', post.id);
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=marketing/thumbnail_upload', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      post.thumbnail_url = json.data.post.thumbnail_url;
      wrap.querySelector('#thumb-preview').innerHTML = `<img src="${escapeHtml(post.thumbnail_url)}" alt="" class="h-full w-full object-cover">`;
      toast('Miniatura actualizada');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  modal({
    title: post ? 'Editar publicación' : 'Nueva publicación',
    content: wrap,
    size: 'max-w-lg',
    actions: [
      { label: 'Cancelar' },
      ...(post ? [{
        label: 'Eliminar', danger: true,
        onClick: async (close, btn) => {
          const ok = await confirmDialog('Eliminar publicación', `¿Eliminar "${post.title}"?`, { danger: true, confirmLabel: 'Eliminar' });
          if (!ok) return;
          btn.disabled = true;
          try {
            await apiPost('marketing/post_delete', { id: post.id });
            toast('Publicación eliminada');
            close();
            onSaved();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        },
      }] : []),
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          if (!wrap.reportValidity()) return;
          const values = formValues(wrap);
          btn.disabled = true;
          try {
            await apiPost('marketing/post_save', {
              id: post?.id || 0,
              post_date: values.post_date,
              post_time: values.post_time,
              title: values.title,
              category: values.category,
              channels: [...chosenChannels],
              status: values.status,
              caption: values.caption,
              canva_url: values.canva_url,
              emoji: chosenEmoji,
              color: chosenColor,
            });
            toast(post ? 'Publicación actualizada' : 'Publicación creada');
            close();
            onSaved();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
}

/* ================= Selector de ícono (Emoji / Bootstrap Icons) ================= */
function openIconPicker(currentValue, onPick) {
  let activeTab = currentValue && currentValue.startsWith('bi:') ? 'icons' : 'emoji';
  let closeModal = () => {};
  const wrap = document.createElement('div');

  function paintPicker() {
    const emojiHtml = Object.entries(EMOJI_GROUPS).map(([group, list]) => `
      <div>
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">${group}</p>
        <div class="flex flex-wrap gap-1">
          ${list.map((e) => `<button type="button" data-pick-emoji="${e}" class="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-slate-100">${e}</button>`).join('')}
        </div>
      </div>`).join('');
    const iconsHtml = Object.entries(BOOTSTRAP_ICON_CATS).map(([group, names]) => `
      <div>
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">${group}</p>
        <div class="flex flex-wrap gap-1">
          ${names.map((n) => `<button type="button" data-pick-icon="${n}" title="${n}" class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">${emojiOrIconHtml('bi:' + n, 'h-5 w-5')}</button>`).join('')}
        </div>
      </div>`).join('');

    wrap.innerHTML = `
      <div class="space-y-3">
        <div class="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" data-picker-tab="emoji" class="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${activeTab === 'emoji' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}">Emoji</button>
          <button type="button" data-picker-tab="icons" class="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold ${activeTab === 'icons' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}">Íconos</button>
        </div>
        <div class="max-h-72 space-y-3 overflow-y-auto pr-1">
          ${activeTab === 'emoji' ? emojiHtml : iconsHtml}
        </div>
      </div>`;

    wrap.querySelectorAll('[data-picker-tab]').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.pickerTab; paintPicker(); }));
    wrap.querySelectorAll('[data-pick-emoji]').forEach((b) => b.addEventListener('click', () => { onPick(b.dataset.pickEmoji); closeModal(); }));
    wrap.querySelectorAll('[data-pick-icon]').forEach((b) => b.addEventListener('click', () => { onPick('bi:' + b.dataset.pickIcon); closeModal(); }));
  }
  paintPicker();

  const handle = modal({
    title: 'Elegir ícono',
    content: wrap,
    size: 'max-w-md',
    actions: [
      { label: 'Quitar ícono', onClick: (close) => { onPick(''); close(); } },
      { label: 'Cerrar' },
    ],
  });
  closeModal = handle.close;
}

/* ================= Asistente de IA: chat ================= */
function renderChatPanel(root) {
  const panel = root.querySelector('#chat-panel');
  if (!panel) return;
  if (!chatOpen) {
    panel.innerHTML = '';
    return;
  }
  // Anclado a la izquierda y por encima del dock: a la derecha vive la burbuja
  // global del asistente, y encimarlas ya había sido un problema.
  panel.innerHTML = `
    <div class="fixed bottom-20 left-6 z-40 flex h-[28rem] w-80 max-w-[90vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 lg:left-auto lg:right-28">
      <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <p class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          ${icon('sparkles', 'h-4 w-4 text-emerald-600')} Copiloto de Marketing
        </p>
        <button type="button" id="btn-chat-close" class="rounded-lg p-1 text-slate-400 hover:bg-slate-100">${icon('x', 'h-4 w-4')}</button>
      </div>
      <div id="chat-messages" class="flex-1 space-y-2 overflow-y-auto p-3 text-sm"></div>
      <form id="chat-form" class="flex items-center gap-2 border-t border-slate-100 p-2">
        <input id="chat-input" type="text" placeholder="Pregúntale al asistente…" autocomplete="off" class="${inputCls}">
        <button type="submit" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">${icon('send', 'h-4 w-4')}</button>
      </form>
    </div>`;

  paintChatMessages();
  panel.querySelector('#btn-chat-close').addEventListener('click', () => { chatOpen = false; renderChatPanel(root); });
  panel.querySelector('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = panel.querySelector('#chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    const historySoFar = chatHistory.slice();
    chatHistory.push({ role: 'user', text: message });
    paintChatMessages();
    try {
      const res = await apiPost('marketing/chat', { message, history: historySoFar, year, month });
      chatHistory.push({ role: 'assistant', text: res.reply, actions: res.actions });
    } catch (err) {
      chatHistory.push({ role: 'assistant', text: `⚠️ ${err.message}` });
    }
    paintChatMessages();
  });
}

/** Busca la caja viva en cada pintado en vez de recibirla: una respuesta de IA
 *  puede tardar varios segundos, y si el panel se re-renderizó mientras tanto
 *  (un filtro, un cambio de vista) la referencia capturada apunta a un nodo ya
 *  desconectado y la respuesta se pierde sin dejar rastro. */
function paintChatMessages() {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  if (!chatHistory.length) {
    box.innerHTML = '<p class="text-xs text-slate-400">Pregúntale ideas de contenido, ajustes a una publicación, o pide que agregue algo directo al calendario.</p>';
    return;
  }
  box.innerHTML = chatHistory.map((m, i) => `
    <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
      <div class="max-w-[85%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}">
        <p class="whitespace-pre-wrap">${escapeHtml(stripActionLines(m.text))}</p>
        ${(m.actions || []).map((a, ai) => a.done
          ? `<p class="mt-1.5 block w-full rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">${escapeHtml(a.label)} ✓</p>`
          : `<button type="button" data-do-action="${i}:${ai}" class="mt-1.5 block w-full rounded-lg bg-white px-2 py-1.5 text-left text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            ${escapeHtml(a.label)}
          </button>`).join('')}
      </div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;

  // Nada se aplica solo: cada acción propuesta por el modelo es un botón que la
  // persona presiona, y se ejecuta por el mismo post_save de siempre.
  box.querySelectorAll('[data-do-action]').forEach((b) => b.addEventListener('click', async () => {
    const [mi, ai] = b.dataset.doAction.split(':').map(Number);
    const a = chatHistory[mi].actions[ai];
    b.disabled = true;
    try {
      const target = a.verb === 'crear' ? null : posts.find((p) => p.id === a.id);
      if (a.verb !== 'crear' && !target) throw new Error('Esa publicación ya no está en el mes visible.');

      const payload = a.verb === 'crear'
        ? { id: 0, post_date: a.post_date, title: a.title, category: a.category, channels: a.channels || [], status: 'idea', caption: a.angle, color: 'sky' }
        : {
            id: target.id,
            post_date: a.verb === 'mover' ? a.post_date : target.post_date,
            post_time: target.post_time || '',
            title: target.title,
            category: target.category,
            channels: target.channels || [],
            status: a.verb === 'estado' ? a.status : target.status,
            caption: a.verb === 'caption' ? a.caption : (target.caption || ''),
            canva_url: target.canva_url || '',
            emoji: target.emoji || '',
            color: target.color,
          };

      await apiPost('marketing/post_save', payload);
      // Se marca en el historial y no solo en el botón: reload() vuelve a pintar el
      // chat desde chatHistory y una marca puesta solo en el DOM se perdería,
      // invitando a repetir la acción.
      a.done = true;
      const d = a.verb === 'crear' || a.verb === 'mover' ? a.post_date : target.post_date;
      if (+d.slice(5, 7) === month && +d.slice(0, 4) === year) reload();
      else paintChatMessages();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
}

/** Oculta del globo de chat las líneas de protocolo (ya se muestran como botones). */
function stripActionLines(text) {
  return text.split('\n')
    .filter((l) => {
      const u = l.trim().toUpperCase();
      return !u.startsWith('ACCION:') && !u.startsWith('SUGERENCIA:');
    })
    .join('\n').trim();
}

/* ================= Biblioteca de recursos ================= */
/** Imágenes reutilizables entre publicaciones. Vive aparte de Archivos a propósito:
 *  Archivos es un gestor completo con carpetas, alcances y papelera, y acoplarlo
 *  aquí ataría Marketing a su modelo de permisos. */
async function openLibraryModal() {
  const body = document.createElement('div');
  body.innerHTML = spinner();
  modal({
    title: 'Biblioteca de recursos',
    content: body,
    size: 'max-w-2xl',
    actions: [{ label: 'Cerrar' }],
  });

  const paintGrid = async () => {
    let assets = [];
    try {
      ({ assets } = await apiGet('marketing/assets_list'));
    } catch (e) {
      body.innerHTML = `<p class="py-6 text-center text-sm text-red-600">${escapeHtml(e.message)}</p>`;
      return;
    }
    body.innerHTML = `
      <div class="space-y-3">
        <label class="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700">
          ${icon('upload', 'h-4 w-4')} Subir imagen (máx. 8 MB)
          <input type="file" id="lib-file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden">
        </label>
        ${assets.length ? `
        <div class="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          ${assets.map((a) => `
            <div class="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <img src="${a.url}" alt="${escapeHtml(a.name)}" class="h-24 w-full bg-slate-100 object-cover">
              <div class="p-2">
                <p class="truncate text-xs font-semibold text-slate-700" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</p>
                <div class="mt-1 flex items-center justify-between">
                  <a href="${a.url}" target="_blank" rel="noopener" class="text-[11px] font-semibold text-emerald-700 hover:underline">Abrir</a>
                  <button type="button" data-del-asset="${a.id}" class="text-[11px] font-semibold text-slate-400 hover:text-red-600">Eliminar</button>
                </div>
              </div>
            </div>`).join('')}
        </div>` : '<p class="py-8 text-center text-sm text-slate-400">Todavía no hay recursos. Sube la primera imagen.</p>'}
      </div>`;

    body.querySelector('#lib-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      body.innerHTML = spinner();
      try {
        const r = await fetch('api/index.php?r=marketing/asset_upload', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
          body: fd,
        });
        const json = await r.json();
        if (!json.ok) throw new Error(json.error || 'No se pudo subir');
        toast('Recurso agregado');
      } catch (err) {
        toast(err.message, 'error');
      }
      paintGrid();
    });

    body.querySelectorAll('[data-del-asset]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Eliminar recurso', '¿Eliminar esta imagen de la biblioteca?', { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('marketing/asset_delete', { id: +b.dataset.delAsset });
        toast('Recurso eliminado');
        paintGrid();
      } catch (e) { toast(e.message, 'error'); }
    }));

  };

  paintGrid();
}
