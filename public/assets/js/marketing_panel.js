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

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

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
let tab = 'calendar'; // 'calendar' | 'list' | 'portfolio'
let year;
let month;
let posts = [];
let commemorative = [];
let chatHistory = [];
let chatOpen = false;
const portfolioFilters = { status: '', category: '', q: '' };

export async function renderMarketing(root) {
  const today = new Date();
  year = today.getFullYear();
  month = today.getMonth() + 1;
  await loadMonth(root);
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ================= Layout principal ================= */
function paint(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-6xl space-y-4 pb-20">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-bold text-slate-900">Marketing</h3>
          <p class="text-sm text-slate-500">Planeación de publicaciones para Facebook.</p>
        </div>
        <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          <button type="button" data-tab="calendar" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === 'calendar' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">Calendario</button>
          <button type="button" data-tab="list" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">Lista</button>
          <button type="button" data-tab="portfolio" class="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === 'portfolio' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">Portafolio</button>
        </div>
      </div>

      ${tab !== 'portfolio' ? monthToolbarHtml() : ''}
      <div id="tab-content"></div>
    </div>
    <button type="button" id="btn-chat-toggle" title="Asistente de planeación" class="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500">
      ${icon('sparkles', 'h-6 w-6')}
    </button>
    <div id="chat-panel"></div>`;

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    repaint();
  }));

  const content = root.querySelector('#tab-content');
  if (tab === 'calendar') renderCalendarTab(content);
  else if (tab === 'list') renderListTab(content);
  else renderPortfolioTab(content);

  wireMonthToolbar(root);
  root.querySelector('#btn-chat-toggle').addEventListener('click', () => {
    chatOpen = !chatOpen;
    renderChatPanel(root);
  });
  renderChatPanel(root);
}

/* ================= Barra de mes (Calendario/Lista) ================= */
function monthToolbarHtml() {
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-center gap-2">
        <button type="button" id="btn-prev-month" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">${icon('chevron-left', 'h-4 w-4')}</button>
        <span class="min-w-[9rem] text-center text-sm font-semibold text-slate-800">${MONTH_NAMES[month - 1]} ${year}</span>
        <button type="button" id="btn-next-month" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">${icon('chevron-left', 'h-4 w-4 rotate-180')}</button>
        <button type="button" id="btn-today" class="ml-2 rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">Hoy</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" id="btn-generate-month" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('sparkles', 'h-4 w-4')} Generar borrador del mes
        </button>
        <button type="button" id="btn-new-post" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          ${icon('plus', 'h-4 w-4')} Nueva publicación
        </button>
      </div>
    </div>`;
}

function wireMonthToolbar(root) {
  root.querySelector('#btn-prev-month')?.addEventListener('click', () => {
    month--; if (month < 1) { month = 12; year--; }
    reload();
  });
  root.querySelector('#btn-next-month')?.addEventListener('click', () => {
    month++; if (month > 12) { month = 1; year++; }
    reload();
  });
  root.querySelector('#btn-today')?.addEventListener('click', () => {
    const t = new Date();
    year = t.getFullYear(); month = t.getMonth() + 1;
    reload();
  });
  root.querySelector('#btn-new-post')?.addEventListener('click', () => {
    openPostModal(null, reload, `${year}-${String(month).padStart(2, '0')}-01`);
  });
  root.querySelector('#btn-generate-month')?.addEventListener('click', (e) => generateMonthDraft(e.currentTarget));
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

/* ================= Vista Calendario ================= */
function renderCalendarTab(container) {
  const commemByDay = {};
  for (const c of commemorative) (commemByDay[c.day] ||= []).push(c);
  const postsByDay = {};
  for (const p of posts) {
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
    <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4">
      <div class="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
        ${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7 gap-1">
        ${cells.map((d) => dayCellHtml(d, commemByDay[d] || [], postsByDay[d] || [])).join('')}
      </div>
    </div>`;

  container.querySelectorAll('[data-day-cell]').forEach((cellEl) => {
    cellEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-post]') || e.target.closest('[data-new-post]')) return;
      openPostModal(null, reload, cellEl.dataset.dayCell);
    });
  });
  container.querySelectorAll('[data-open-post]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPostModal(posts.find((p) => p.id === +b.dataset.openPost), reload);
  }));
  container.querySelectorAll('[data-new-post]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPostModal(null, reload, b.dataset.newPost);
  }));
}

function dayCellHtml(d, commemList, dayPosts) {
  if (!d) return '<div class="min-h-[110px] rounded-lg bg-slate-50/60"></div>';
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const isToday = dateStr === todayStr();
  const commemChips = commemList.map((c) => `
    <p class="truncate px-1 text-[10px] text-slate-400" title="${escapeHtml(c.label)}">${c.emoji_suggestion || ''} ${escapeHtml(c.label)}</p>`).join('');
  const postChips = dayPosts.slice(0, 3).map((p) => `
    <button type="button" data-open-post="${p.id}" class="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[11px] ${PALETTE[p.color]?.bg || 'bg-slate-100'}">
      <span class="shrink-0">${emojiOrIconHtml(p.emoji, 'h-3 w-3')}</span>
      <span class="truncate font-medium text-slate-700">${escapeHtml(p.title)}</span>
    </button>`).join('');
  const overflow = dayPosts.length > 3 ? `<p class="px-1 text-[10px] text-slate-400">+${dayPosts.length - 3} más</p>` : '';
  return `
    <div data-day-cell="${dateStr}" class="group flex min-h-[110px] flex-col gap-0.5 rounded-lg p-1 ring-1 ring-slate-100 hover:ring-indigo-200">
      <div class="flex items-center justify-between px-0.5">
        <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-indigo-600 text-white' : 'text-slate-500'}">${d}</span>
        <button type="button" data-new-post="${dateStr}" class="hidden h-5 w-5 items-center justify-center rounded text-indigo-500 hover:bg-indigo-100 group-hover:flex">${icon('plus', 'h-3.5 w-3.5')}</button>
      </div>
      ${commemChips}
      <div class="flex-1 space-y-0.5 overflow-y-auto">${postChips}${overflow}</div>
    </div>`;
}

/* ================= Vista Lista ================= */
function renderListTab(container) {
  const sorted = [...posts].sort((a, b) => a.post_date.localeCompare(b.post_date));
  container.innerHTML = `
    <div class="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th class="px-4 py-2">Fecha</th>
            <th class="px-2 py-2"></th>
            <th class="px-2 py-2">Título</th>
            <th class="hidden px-2 py-2 sm:table-cell">Categoría</th>
            <th class="px-2 py-2">Estatus</th>
            <th class="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.length ? sorted.map(listRowHtml).join('') : '<tr><td colspan="6" class="py-10 text-center text-sm text-slate-400">Sin publicaciones este mes.</td></tr>'}
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
      <td class="px-2 py-2">${emojiOrIconHtml(post.emoji, 'h-4 w-4')}</td>
      <td class="px-2 py-2 font-medium text-slate-800">${escapeHtml(post.title)}</td>
      <td class="hidden px-2 py-2 text-xs text-slate-500 sm:table-cell">${CATEGORY_LABELS[post.category] || post.category}</td>
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
  const wrap = document.createElement('form');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="${labelCls}">Fecha</label>
          <input type="date" name="post_date" value="${post?.post_date || defaultDate || todayStr()}" required class="${inputCls}">
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
              title: values.title,
              category: values.category,
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
  panel.innerHTML = `
    <div class="fixed bottom-24 right-6 z-40 flex h-[28rem] w-80 max-w-[90vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
      <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <p class="text-sm font-semibold text-slate-800">Asistente de planeación</p>
        <button type="button" id="btn-chat-close" class="rounded-lg p-1 text-slate-400 hover:bg-slate-100">${icon('x', 'h-4 w-4')}</button>
      </div>
      <div id="chat-messages" class="flex-1 space-y-2 overflow-y-auto p-3 text-sm"></div>
      <form id="chat-form" class="flex items-center gap-2 border-t border-slate-100 p-2">
        <input id="chat-input" type="text" placeholder="Pregúntale al asistente…" autocomplete="off" class="${inputCls}">
        <button type="submit" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">${icon('send', 'h-4 w-4')}</button>
      </form>
    </div>`;

  paintChatMessages(panel);
  panel.querySelector('#btn-chat-close').addEventListener('click', () => { chatOpen = false; renderChatPanel(root); });
  panel.querySelector('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = panel.querySelector('#chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    const historySoFar = chatHistory.slice();
    chatHistory.push({ role: 'user', text: message });
    paintChatMessages(panel);
    try {
      const res = await apiPost('marketing/chat', { message, history: historySoFar, year, month });
      chatHistory.push({ role: 'assistant', text: res.reply, suggestions: res.suggestions });
    } catch (err) {
      chatHistory.push({ role: 'assistant', text: `⚠️ ${err.message}` });
    }
    paintChatMessages(panel);
  });
}

function paintChatMessages(panel) {
  const box = panel.querySelector('#chat-messages');
  if (!box) return;
  if (!chatHistory.length) {
    box.innerHTML = '<p class="text-xs text-slate-400">Pregúntale ideas de contenido, ajustes a una publicación, o pide que agregue algo directo al calendario.</p>';
    return;
  }
  box.innerHTML = chatHistory.map((m, i) => `
    <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
      <div class="max-w-[85%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}">
        <p class="whitespace-pre-wrap">${escapeHtml(stripSuggestionLines(m.text))}</p>
        ${(m.suggestions || []).map((s, si) => `
          <button type="button" data-add-suggestion="${i}:${si}" class="mt-1.5 block w-full rounded-lg bg-white px-2 py-1.5 text-left text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            + Agregar "${escapeHtml(s.title)}" el ${fmtDate(s.post_date)}
          </button>`).join('')}
      </div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;

  box.querySelectorAll('[data-add-suggestion]').forEach((b) => b.addEventListener('click', async () => {
    const [mi, si] = b.dataset.addSuggestion.split(':').map(Number);
    const s = chatHistory[mi].suggestions[si];
    b.disabled = true;
    try {
      await apiPost('marketing/post_save', {
        id: 0, post_date: s.post_date, title: s.title, category: s.category,
        status: 'idea', caption: s.angle, color: 'sky',
      });
      b.textContent = 'Agregada ✓';
      if (+s.post_date.slice(5, 7) === month && +s.post_date.slice(0, 4) === year) reload();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
}

/** Oculta del globo de chat las líneas SUGERENCIA: (ya se muestran como botones). */
function stripSuggestionLines(text) {
  return text.split('\n').filter((l) => !l.trim().toUpperCase().startsWith('SUGERENCIA:')).join('\n').trim();
}
