/** Módulo Tareas: mis tareas (únicas y frecuentes, agrupadas por vencimiento),
 *  proyectos con subtareas, y seguimiento de resultados. */

import { mountTaskEditor, taskDescriptionHtml } from '../task_desc_editor.js';
import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, formValues, inputCls, labelCls, spinner, fmtDate, debounce, isUserBusy } from '../ui.js';

const POLL_MS = 20000;

/** Preferencia guardada en este navegador (o la de siempre si no hay almacenamiento). */
function readPref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }

const PRIORITY = {
  baja:    { label: 'Baja',    cls: 'bg-slate-100 text-slate-600' },
  media:   { label: 'Media',   cls: 'bg-sky-100 text-sky-700' },
  alta:    { label: 'Alta',    cls: 'bg-amber-100 text-amber-700' },
  urgente: { label: 'Urgente', cls: 'bg-red-100 text-red-700' },
};
const STATUS = {
  pendiente:   { label: 'Pendiente',   cls: 'bg-slate-100 text-slate-600', next: 'en_progreso' },
  en_progreso: { label: 'En progreso', cls: 'bg-indigo-100 text-indigo-700', next: 'completada' },
  completada:  { label: 'Completada',  cls: 'bg-emerald-100 text-emerald-700', next: 'pendiente' },
};
const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baja: 3 };
// Mismo lenguaje de color que ya usa Resultados: tinte claro en el fondo, cenefa más
// saturada detrás del título. "Prioridad alta" no tiene un color de sección fijo —
// se saca justo por no depender de la fecha, así que usa el color de su propia
// prioridad (PRIORITY_CARD_COLORS) en vez de esta tabla.
const SECTION_COLORS = {
  completadas: { tint: 'bg-emerald-50', band: 'bg-emerald-100 text-emerald-900' },
  hoy:         { tint: 'bg-red-50',     band: 'bg-red-100 text-red-900' },
  manana:      { tint: 'bg-amber-50',   band: 'bg-amber-100 text-amber-900' },
  semana:      { tint: 'bg-blue-50',    band: 'bg-blue-100 text-blue-900' },
  posterior:   { tint: 'bg-white',      band: '' },
};
const PRIORITY_CARD_COLORS = {
  urgente: { tint: 'bg-red-50',   band: 'bg-red-100 text-red-900' },
  alta:    { tint: 'bg-amber-50', band: 'bg-amber-100 text-amber-900' },
};
// Índice 0=domingo…6=sábado, igual que Date.getDay() — mismo día que se guarda en
// tasks.weekday para el corte de una tarea semanal.
const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

let ctx;
let data = null;
let tab = 'mis';
let projectFilter = null;
// Dentro de un proyecto: pestaña abierta y cómo se ven sus tareas (esto último se recuerda en este navegador).
let projectTab = 'tareas';
let projectView = readPref('tareas.projectView', 'tarjetas');
// Mientras se arrastra una tarjeta del tablero no se repinta (se perdería lo arrastrado).
let dragging = false;
let resultsData = null;
// '' en 'user' significa "yo mismo"; solo un gestor puede cambiarlo a otra persona.
let misFilters = { status: '', project: '', user: '' };
let resultFilters = { q: '', sample_date: '', due_date: '', status: '' };
// Filtro de fecha de entrega exclusivo de la sección "Completadas", independiente
// del filtro "Entrega" de arriba (ese solo agrupa hoy/mañana/posteriores).
let completedDueFilter = '';
// Las completadas se acumulan sin límite: se muestran de 9 en 9 para no pintar
// cientos de tarjetas. `lastResultSig` detecta cuándo cambió lo que se está
// viendo (filtros o fecha de entrega) para volver a empezar en 9 — así el
// contador se reinicia solo, sin tener que acordarse de hacerlo en cada filtro.
const COMPLETED_PAGE = 9;
let completedShown = COMPLETED_PAGE;
let lastResultSig = '';
let pollTimer = null;

export async function render(root, context) {
  ctx = context;
  // Enlaces desde fuera del módulo (p. ej. el dashboard) pueden pedir una pestaña
  // concreta, como #/tareas/resultados.
  if (context.args[0] === 'resultados') tab = 'resultados';
  root.innerHTML = spinner();
  await load(root);

  const tick = async () => {
    // #tasks-view se recrea en cada paint(); si ya no está en el DOM es que el
    // router navegó a otro módulo (mismo criterio que whatsapp.js).
    if (!document.getElementById('tasks-view')?.isConnected) { clearInterval(pollTimer); return; }
    if (isUserBusy() || dragging) return; // modal abierto, foco en un campo o arrastre en curso: se reintenta en el siguiente tick
    try {
      const fresh = await apiGet('tasks/list');
      if (isUserBusy() || dragging) return; // pudo empezar a interactuar mientras la petición estaba en vuelo
      data = fresh;
      // paintResultados() reutiliza resultsData si ya tiene valor — sin esto, un
      // refresco de fondo repintaría datos viejos de Resultados sin darse cuenta.
      if (tab === 'resultados') resultsData = null;
      paint(root);
    } catch { /* red intermitente: se reintenta en el próximo tick */ }
  };
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_MS);
}

async function load(root) {
  data = await apiGet('tasks/list');
  paint(root);
}

function paint(root) {
  const tabs = [
    ['mis', 'Mis tareas', 'check-square'],
    ['proyectos', 'Proyectos', 'briefcase'],
    ['resultados', 'Resultados', 'flask'],
  ];
  root.innerHTML = `
    <div class="mx-auto max-w-7xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          ${tabs.map(([key, label, ic]) => `
            <button type="button" data-tab="${key}"
                    class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
              ${icon(ic, 'h-4 w-4')} ${label}
            </button>`).join('')}
        </div>
        <div class="flex gap-2">
          ${tab === 'resultados' ? `
          <button id="btn-new-result" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('plus', 'h-4 w-4')} Nuevos resultados
          </button>` : `
          ${data.can_manage ? `
          <button id="btn-new-project" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('briefcase', 'h-4 w-4')} Nuevo proyecto
          </button>` : ''}
          <button id="btn-new-task" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('plus', 'h-4 w-4')} Nueva tarea
          </button>`}
        </div>
      </div>
      <div id="tasks-view"></div>
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tab = b.dataset.tab; projectFilter = null; paint(root); }));
  root.querySelector('#btn-new-task')?.addEventListener('click', () => openTaskModal(null, {}));
  root.querySelector('#btn-new-project')?.addEventListener('click', () => openProjectModal(null));
  root.querySelector('#btn-new-result')?.addEventListener('click', () => openResultModal(null));

  const view = root.querySelector('#tasks-view');
  if (tab === 'mis') paintMis(view);
  else if (tab === 'proyectos') paintProyectos(view);
  else paintResultados(view);
}

/* ---------- helpers de datos ---------- */
const children = (t) => data.tasks.filter((x) => x.parent_id === t.id);
const tasksForUser = (userId) => data.tasks.filter((t) => !t.parent_id && (t.assigned_to.includes(userId) || t.created_by === userId));
const assigneeNames = (t) => (t.assigned_names || []).join(', ');
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
/* ---------- vistas ---------- */
/**
 * Agrupa por vencimiento en vez de por tipo de recurrencia: completadas siempre al
 * final; alta/urgente siempre arriba sin importar su fecha; una diaria vive en "hoy";
 * una semanal vive en "esta semana" salvo que su día de corte (`t.weekday`, elegido al
 * crearla) caiga hoy o mañana, entonces se mueve a esa sección puntual.
 */
function bucketMisTasks(list) {
  const buckets = { completadas: [], prioridad: [], hoy: [], manana: [], semana: [], posterior: [] };
  const t0 = today();
  const tm = tomorrow();
  const todayWd = new Date().getDay();
  const tomorrowWd = (todayWd + 1) % 7;
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + ((7 - todayWd) % 7)); // próximo domingo (hoy si ya es domingo)
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  for (const t of list) {
    const isRecurring = !!t.recurrence;
    const isDone = isRecurring ? t.done_now : t.status === 'completada';
    if (isDone) { buckets.completadas.push(t); continue; }
    if (t.priority === 'alta' || t.priority === 'urgente') { buckets.prioridad.push(t); continue; }
    if (t.recurrence === 'diaria') { buckets.hoy.push(t); continue; }
    if (t.recurrence === 'semanal') {
      if (t.weekday === null || t.weekday === undefined) { buckets.semana.push(t); continue; }
      buckets[t.weekday === todayWd ? 'hoy' : t.weekday === tomorrowWd ? 'manana' : 'semana'].push(t);
      continue;
    }
    if (t.due_date && t.due_date <= t0) buckets.hoy.push(t);
    else if (t.due_date === tm) buckets.manana.push(t);
    else if (t.due_date && t.due_date <= weekEndStr) buckets.semana.push(t);
    else buckets.posterior.push(t); // incluye sin fecha
  }
  return buckets;
}

function sortByDueDate(list) {
  return [...list].sort((a, b) => {
    const dueA = a.due_date || '9999';
    const dueB = b.due_date || '9999';
    return dueA !== dueB ? (dueA < dueB ? -1 : 1) : a.title.localeCompare(b.title);
  });
}

/**
 * Arma las secciones por vencimiento (prioridad alta / hoy / mañana / esta semana /
 * posterior / completadas) para cualquier lista de tareas — compartida por "Mis
 * tareas" y por el detalle de un proyecto en "Proyectos", mismo lenguaje visual para
 * ambos. Regresa `null` si la lista no genera ninguna sección (todo vacío).
 */
function renderTaskSections(list) {
  const b = bucketMisTasks(list);
  const prioridad = [...b.prioridad].sort((x, y) => {
    const p = PRIORITY_ORDER[x.priority] - PRIORITY_ORDER[y.priority];
    return p !== 0 ? p : (x.due_date || '9999').localeCompare(y.due_date || '9999');
  });
  const completadas = [...b.completadas].sort((x, y) => (y.completed_at || y.due_date || '').localeCompare(x.completed_at || x.due_date || ''));

  const group = (title, items, render) => !items.length ? '' : `
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-slate-700">${title}</h4>
        <span class="text-xs text-slate-400">${items.length}</span>
      </div>
      ${render(items)}
    </div>`;
  // Cuadrícula de tarjetas verticales: 1 columna en móvil, 2 en tablet, 3 en pantallas medianas y 4 en grandes.
  const cards = (sectionKey) => (items) => `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">${items.map((t) => misTaskCard(t, { sectionKey })).join('')}</div>`;

  const sections = [
    group('Prioridad alta', prioridad, cards('prioridad')),
    group('Con deadline para hoy', sortByDueDate(b.hoy), cards('hoy')),
    group('Con deadline para mañana', sortByDueDate(b.manana), cards('manana')),
    group('Con deadline para esta semana', sortByDueDate(b.semana), cards('semana')),
    group('Con deadline posterior', sortByDueDate(b.posterior), cards('posterior')),
    group('Completadas', completadas, cards('completadas')),
  ].filter(Boolean);

  return sections.length ? `<div class="space-y-5">${sections.join('')}</div>` : null;
}

/**
 * "Mis tareas": agrupada por vencimiento (hoy/mañana/esta semana/posterior), con
 * alta/urgente destacadas arriba en tarjetas cuadradas sin importar su fecha, y
 * completadas al final — mismo lenguaje visual que ya usa Tareas > Resultados. Un
 * gestor puede además "ver como" a otra persona del equipo con el filtro de usuario.
 */
function paintMis(view) {
  const targetUser = data.can_manage && misFilters.user ? +misFilters.user : data.me;
  let list = tasksForUser(targetUser);
  if (misFilters.status) list = list.filter((t) => t.status === misFilters.status);
  if (misFilters.project) list = list.filter((t) => t.project_id === +misFilters.project);

  view.innerHTML = `
    <div class="space-y-4">
      ${filterBarHtml()}
      ${renderTaskSections(list) || emptyState('Sin tareas pendientes', 'Crea una tarea o espera a que te asignen una.')}
    </div>`;

  wireFilterBar(view);
  wireTaskEvents(view);
}

function filterBarHtml() {
  const statusOpts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${misFilters.status === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const projectOpts = data.projects.map((p) => `<option value="${p.id}" ${String(misFilters.project) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const userOpts = data.users.map((u) => `<option value="${u.id}" ${String(misFilters.user) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`).join('');
  return `
    <div class="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-slate-200">
      <select id="f-status" class="rounded-lg border-0 bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
        <option value="">Todos los estados</option>${statusOpts}
      </select>
      <select id="f-project" class="rounded-lg border-0 bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
        <option value="">Todos los proyectos</option>${projectOpts}
      </select>
      ${data.can_manage ? `
      <select id="f-user" class="rounded-lg border-0 bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
        <option value="">Yo mismo</option>${userOpts}
      </select>` : ''}
    </div>`;
}

function wireFilterBar(view) {
  view.querySelector('#f-status').value = misFilters.status;
  view.querySelector('#f-status').addEventListener('change', (e) => { misFilters.status = e.target.value; paintMis(view); });
  view.querySelector('#f-project').value = misFilters.project;
  view.querySelector('#f-project').addEventListener('change', (e) => { misFilters.project = e.target.value; paintMis(view); });
  view.querySelector('#f-user')?.addEventListener('change', (e) => { misFilters.user = e.target.value; paintMis(view); });
}

/**
 * Tarjeta vertical compartida por "Mis tareas" y el detalle de un proyecto: título con cenefa de color
 * según la sección donde cayó (hoy/mañana/semana/posterior/completadas — ver SECTION_COLORS), o según su
 * propia prioridad en la sección "Prioridad alta" (ver PRIORITY_CARD_COLORS, esa sección se saca justo
 * por no depender de la fecha). El creador y el asignado se muestran siempre, no solo a gestores.
 * Las tareas recurrentes (diaria/semanal) usan el check binario data-recurring en vez del ciclo de
 * estado pendiente→en progreso→completada.
 *
 * Alto fijo en pantallas medianas y grandes (la cuadrícula queda pareja); lo largo — descripción con
 * imágenes, subtareas — se desplaza dentro de la tarjeta, y al tocar el título se abre completa.
 */
function misTaskCard(t, { sectionKey } = {}) {
  const isRecurring = !!t.recurrence;
  const isDone = isRecurring ? t.done_now : t.status === 'completada';
  const colors = sectionKey === 'prioridad' ? PRIORITY_CARD_COLORS[t.priority] : SECTION_COLORS[sectionKey];
  const cardTint = colors?.tint || 'bg-white';
  const proj = t.project_id ? data.projects.find((p) => p.id === t.project_id) : null;
  const subs = !isRecurring ? children(t) : [];
  const subsDone = subs.filter((s) => s.status === 'completada').length;

  return `
    <div class="flex flex-col rounded-2xl ${cardTint} p-4 shadow-sm ring-1 ring-slate-200 sm:h-[27rem]">
      <div class="flex shrink-0 items-start gap-2.5">
        <button type="button" ${isRecurring ? `data-recurring="${t.id}"` : `data-toggle="${t.id}"`} title="Completar"
                class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button type="button" data-view="${t.id}" title="Abrir la tarea completa"
                class="line-clamp-2 min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm font-bold ${colors?.band || 'text-slate-900'} ${isDone ? 'line-through opacity-70' : ''}">${escapeHtml(t.title)}</button>
      </div>
      <div class="mt-2 flex shrink-0 flex-wrap items-center gap-1.5">
        ${isRecurring
          ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${isDone ? 'Al día' : 'Pendiente'}</span>`
          : `<button type="button" data-status="${t.id}" class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[t.status].cls}" title="Cambiar estado">${STATUS[t.status].label}</button>`}
        <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
        ${proj
          ? `<span class="max-w-full truncate rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">${escapeHtml(proj.name)}</span>`
          : `<span class="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">Tarea suelta</span>`}
        ${t.recurrence === 'semanal' && t.weekday !== null && t.weekday !== undefined
          ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Cada ${WEEKDAY_NAMES[t.weekday].toLowerCase()}</span>` : ''}
        ${t.due_date ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">${fmtDate(t.due_date)}</span>` : ''}
        ${t.todo_total ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.todo_done === t.todo_total ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-50 text-sky-700'}" title="Casillas marcadas">☑ ${t.todo_done}/${t.todo_total}</span>` : ''}
      </div>
      <div class="mt-1 max-h-80 min-h-0 overflow-y-auto sm:max-h-none sm:flex-1" data-card-body>
        ${taskDescriptionHtml(t, { size: 'full' })}
        ${subs.length ? `
        <div class="mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
          <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400">Subtareas ${subsDone}/${subs.length}</p>
          ${subs.map((s) => `
            <div class="flex items-center gap-2">
              <button type="button" data-toggle="${s.id}"
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${s.status === 'completada' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
                <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <span class="min-w-0 flex-1 truncate text-sm ${s.status === 'completada' ? 'text-slate-400 line-through' : 'text-slate-700'}">${escapeHtml(s.title)}</span>
              ${canEdit(s) ? `<button type="button" data-del="${s.id}" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-300 hover:text-red-500">${icon('x', 'h-3.5 w-3.5')}</button>` : ''}
            </div>`).join('')}
        </div>` : ''}
      </div>
      <div class="mt-2 flex shrink-0 items-end justify-between gap-2">
        <div class="min-w-0 space-y-0.5 text-[11px] text-slate-400">
          ${t.creator_name ? `<p class="truncate">Creó: ${escapeHtml(t.creator_name)}</p>` : ''}
          ${assigneeNames(t) ? `<p class="truncate">Asignado: ${escapeHtml(assigneeNames(t))}</p>` : ''}
        </div>
        <div class="flex shrink-0 gap-0.5">
          ${!t.parent_id && !isRecurring ? `<button type="button" data-subtask="${t.id}" title="Agregar subtarea" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('plus', 'h-4 w-4')}</button>` : ''}
          ${canEdit(t) ? `
          <button type="button" data-edit="${t.id}" title="Editar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
          <button type="button" data-del="${t.id}" title="Eliminar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
        </div>
      </div>
    </div>`;
}

function canDeleteProject(p) {
  return data.can_manage || p.created_by === data.me;
}

/* ================= Proyectos ================= */

const PRIORITY_DOT = { baja: 'bg-slate-300', media: 'bg-sky-400', alta: 'bg-amber-400', urgente: 'bg-red-500' };
const PRIORITY_EDGE = { baja: 'border-l-slate-300', media: 'border-l-sky-400', alta: 'border-l-amber-400', urgente: 'border-l-red-500' };
const PROJECT_STATUS = {
  activo:     { label: 'Activo',     cls: 'bg-indigo-50 text-indigo-700' },
  completado: { label: 'Completado', cls: 'bg-emerald-100 text-emerald-700' },
  archivado:  { label: 'Archivado',  cls: 'bg-slate-100 text-slate-500' },
};
const BOARD_COLS = [
  { key: 'pendiente',   label: 'Pendiente',   head: 'bg-slate-100 text-slate-700',     dot: 'bg-slate-400' },
  { key: 'en_progreso', label: 'En progreso', head: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500' },
  { key: 'completada',  label: 'Completada',  head: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
];

// La vista elegida se recuerda solo en este navegador: si no hay almacenamiento, se usa la de siempre.
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no pasa nada */ } };

const moduleRoot = () => document.getElementById('module-root');
const isTaskDone = (t) => (t.recurrence ? !!t.done_now : t.status === 'completada');
/** Columna del tablero: una tarea frecuente no tiene "en progreso", solo al día o pendiente. */
const boardColumn = (t) => (t.recurrence ? (t.done_now ? 'completada' : 'pendiente') : t.status);
const projectTopTasks = (p) => data.tasks.filter((t) => t.project_id === p.id && !t.parent_id);
const hasDescription = (p) => !!(p.desc_blocks && p.desc_blocks.length);
const byPriorityThenDue = (a, b) =>
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  || (a.due_date || '9999').localeCompare(b.due_date || '9999')
  || a.title.localeCompare(b.title);

function isProjectOverdue(p) {
  const { total, done } = projectStats(p);
  return p.status === 'activo' && !!p.due_date && p.due_date < today() && !(total && done === total);
}

function projectChips(p) {
  const { total } = projectStats(p);
  const overdue = isProjectOverdue(p);
  return `
    ${p.status !== 'activo' ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PROJECT_STATUS[p.status].cls}">${PROJECT_STATUS[p.status].label}</span>` : ''}
    ${p.due_date ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}">${overdue ? 'Vencido · ' : 'Límite '}${fmtDate(p.due_date)}</span>` : ''}
    <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">${total} tarea${total === 1 ? '' : 's'}</span>
    ${p.todo_total ? `<span class="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700" title="Casillas de la descripción">☑ ${p.todo_done}/${p.todo_total}</span>` : ''}`;
}

/** Tarjeta de un proyecto en la lista: avance, fecha, responsables y lo siguiente por hacer. */
function projectCard(p) {
  const open = projectTopTasks(p).filter((t) => !isTaskDone(t)).sort(byPriorityThenDue);
  const next = open.slice(0, 3);
  const more = open.length - next.length;
  return `
    <div class="flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md ${p.status === 'archivado' ? 'opacity-60' : ''}">
      <div class="flex items-start justify-between gap-2">
        <button type="button" data-open-project="${p.id}" class="min-w-0 flex-1 text-left">
          <p class="line-clamp-2 text-sm font-bold text-slate-900 hover:text-indigo-600">${escapeHtml(p.name)}</p>
        </button>
        ${data.can_manage || canDeleteProject(p) ? `
        <div class="flex shrink-0 gap-1">
          ${data.can_manage ? `<button type="button" data-edit-project="${p.id}" title="Editar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-3.5 w-3.5')}</button>` : ''}
          ${canDeleteProject(p) ? `<button type="button" data-del-project="${p.id}" title="Eliminar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-3.5 w-3.5')}</button>` : ''}
        </div>` : ''}
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">${projectChips(p)}</div>
      ${assigneeNames(p) ? `<p class="mt-2 truncate text-[11px] text-slate-400" title="${escapeHtml(assigneeNames(p))}">Responsables: ${escapeHtml(assigneeNames(p))}</p>` : ''}
      ${projectProgress(p)}
      <div class="mt-3 space-y-1 border-t border-slate-100 pt-2.5">
        <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400">Lo siguiente</p>
        ${next.length ? next.map((t) => `
          <p class="flex items-center gap-1.5 text-xs text-slate-600">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}"></span>
            <span class="min-w-0 flex-1 truncate">${escapeHtml(t.title)}</span>
            ${t.due_date ? `<span class="shrink-0 text-slate-400">${fmtDate(t.due_date)}</span>` : ''}
          </p>`).join('') : '<p class="text-xs text-slate-400">Nada pendiente.</p>'}
        ${more > 0 ? `<p class="text-[11px] font-semibold text-slate-400">+ ${more} más</p>` : ''}
      </div>
    </div>`;
}

function paintProyectos(view) {
  if (projectFilter !== null) {
    if (data.projects.some((x) => x.id === projectFilter)) { paintProjectDetail(view); return; }
    projectFilter = null; // el proyecto ya no existe (lo borraron): vuelve a la lista
  }

  const visible = data.projects.filter((p) => p.status !== 'archivado' || data.can_manage);
  view.innerHTML = visible.length ? `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      ${visible.map(projectCard).join('')}
    </div>` : emptyState('Sin proyectos', data.can_manage ? 'Crea el primero con "Nuevo proyecto".' : 'Aún no participas en ningún proyecto.');

  view.querySelectorAll('[data-open-project]').forEach((b) =>
    b.addEventListener('click', () => { projectFilter = +b.dataset.openProject; projectTab = 'tareas'; paint(moduleRoot()); }));
  view.querySelectorAll('[data-edit-project]').forEach((b) =>
    b.addEventListener('click', () => openProjectModal(data.projects.find((p) => p.id === +b.dataset.editProject))));
  view.querySelectorAll('[data-del-project]').forEach((b) =>
    b.addEventListener('click', async () => {
      const p = data.projects.find((x) => x.id === +b.dataset.delProject);
      const ok = await confirmDialog('Eliminar proyecto', `Se eliminará "${p.name}" con todas sus tareas. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('tasks/project_delete', { id: p.id });
        toast('Proyecto eliminado');
        load(moduleRoot());
      } catch (e) { toast(e.message, 'error'); }
    }));
}

/** Detalle de un proyecto: encabezado, pestañas (Tareas / Descripción) y, en Tareas, tarjetas o tablero. */
function paintProjectDetail(view) {
  const p = data.projects.find((x) => x.id === projectFilter);
  const list = projectTopTasks(p);
  const tabBtn = (key, label, badge = '') => `
    <button type="button" data-ptab="${key}" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${projectTab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label}${badge}</button>`;
  view.innerHTML = `
    <button type="button" id="btn-back-projects" class="mb-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
      ${icon('chevron-left', 'h-4 w-4')} Todos los proyectos
    </button>
    <div class="mb-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-bold text-slate-900">${escapeHtml(p.name)}</h3>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">${projectChips(p)}</div>
          ${assigneeNames(p) ? `<p class="mt-2 text-xs text-slate-400">Responsables: ${escapeHtml(assigneeNames(p))}</p>` : ''}
        </div>
        <div class="flex items-center gap-2">
          ${data.can_manage ? `<button type="button" id="btn-edit-project" class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Editar proyecto</button>
          <button type="button" id="btn-add-to-project" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">+ Tarea</button>` : ''}
        </div>
      </div>
      ${projectProgress(p)}
    </div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        ${tabBtn('tareas', 'Tareas', `<span class="text-[11px] opacity-70">${list.length}</span>`)}
        ${tabBtn('descripcion', 'Descripción', hasDescription(p) ? '<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>' : '')}
      </div>
      ${projectTab === 'tareas' ? `
      <div class="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" role="group" aria-label="Vista de las tareas">
        ${[['tarjetas', 'Tarjetas'], ['tablero', 'Tablero']].map(([key, label]) => `
          <button type="button" data-pview="${key}" aria-pressed="${projectView === key}" class="rounded-lg px-3 py-1.5 text-sm font-semibold transition ${projectView === key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label}</button>`).join('')}
      </div>` : ''}
    </div>
    <div id="project-body"></div>`;

  view.querySelector('#btn-back-projects').addEventListener('click', () => { projectFilter = null; paint(moduleRoot()); });
  view.querySelector('#btn-add-to-project')?.addEventListener('click', () => openTaskModal(null, { project_id: projectFilter }));
  view.querySelector('#btn-edit-project')?.addEventListener('click', () => openProjectModal(p));
  view.querySelectorAll('[data-ptab]').forEach((b) =>
    b.addEventListener('click', () => { projectTab = b.dataset.ptab; paint(moduleRoot()); }));
  view.querySelectorAll('[data-pview]').forEach((b) =>
    b.addEventListener('click', () => { projectView = b.dataset.pview; savePref('tareas.projectView', projectView); paint(moduleRoot()); }));

  const body = view.querySelector('#project-body');
  if (projectTab === 'descripcion') {
    paintProjectDescription(body, p);
  } else if (projectView === 'tablero') {
    body.innerHTML = list.length ? boardHtml(list) : emptyState('Proyecto sin tareas', 'Agrega la primera tarea.');
    wireBoard(body);
    wireTaskEvents(body);
  } else {
    body.innerHTML = renderTaskSections(list) || emptyState('Proyecto sin tareas', 'Agrega la primera tarea.');
    wireTaskEvents(body);
  }
}

/** Pestaña «Descripción»: notas del proyecto con formato, casillas, imágenes y notas a mano. */
function paintProjectDescription(body, p) {
  const html = hasDescription(p) ? taskDescriptionHtml({ id: p.id, desc_blocks: p.desc_blocks }, { owner: 'project', size: 'full' }) : '';
  body.innerHTML = `
    <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      ${html || `
        <div class="py-8 text-center">
          <p class="text-sm font-medium text-slate-600">Este proyecto no tiene descripción</p>
          <p class="mt-1 text-xs text-slate-400">${data.can_manage ? 'Úsala para el alcance, notas, listas de pendientes, imágenes o dibujos.' : 'Quien gestiona las tareas puede agregarla.'}</p>
        </div>`}
      ${data.can_manage ? `<div class="mt-4 text-right"><button type="button" id="btn-edit-desc" class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">${html ? 'Editar descripción' : 'Agregar descripción'}</button></div>` : ''}
    </div>`;
  body.querySelector('#btn-edit-desc')?.addEventListener('click', () => openProjectModal(p));
  wireDescription(body, () => load(moduleRoot()));
}

/* ---------- Tablero (Pendiente / En progreso / Completada) ---------- */

function boardCard(t) {
  const subs = children(t);
  const subsDone = subs.filter((s) => s.status === 'completada').length;
  const isRecurring = !!t.recurrence;
  const done = isTaskDone(t);
  return `
    <div data-kcard="${t.id}" class="rounded-xl border-l-4 ${PRIORITY_EDGE[t.priority]} bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-start gap-2">
        ${isRecurring ? '' : `<span data-drag title="Arrastra para cambiar de columna" aria-label="Arrastrar" class="-ml-1 mt-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing">${icon('move', 'h-3.5 w-3.5')}</span>`}
        <button type="button" data-view="${t.id}" class="min-w-0 flex-1 text-left text-sm font-semibold text-slate-800 hover:text-indigo-600 ${done ? 'line-through opacity-60' : ''}">${escapeHtml(t.title)}</button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        ${isRecurring
          ? `<button type="button" data-recurring="${t.id}" class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}" title="Marcar como ${done ? 'pendiente' : 'al día'}">${done ? 'Al día' : 'Pendiente'}</button>`
          : `<button type="button" data-status="${t.id}" class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[t.status].cls}" title="Cambiar estado">${STATUS[t.status].label}</button>`}
        <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
        ${t.due_date ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${!done && t.due_date < today() ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}">${fmtDate(t.due_date)}</span>` : ''}
        ${t.todo_total ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.todo_done === t.todo_total ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-50 text-sky-700'}">☑ ${t.todo_done}/${t.todo_total}</span>` : ''}
        ${subs.length ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Subtareas ${subsDone}/${subs.length}</span>` : ''}
      </div>
      ${assigneeNames(t) ? `<p class="mt-1.5 truncate text-[11px] text-slate-400">${escapeHtml(assigneeNames(t))}</p>` : ''}
    </div>`;
}

function boardHtml(list) {
  const cols = BOARD_COLS.map((c) => {
    let items = list.filter((t) => boardColumn(t) === c.key);
    items = c.key === 'completada'
      ? items.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
      : items.sort(byPriorityThenDue);
    return `
      <div data-col="${c.key}" class="flex min-w-[85%] snap-center flex-col rounded-2xl bg-slate-100/70 p-2.5 md:min-w-0">
        <div class="mb-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 ${c.head}">
          <span class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><span class="h-2 w-2 rounded-full ${c.dot}"></span>${c.label}</span>
          <span class="text-xs font-semibold opacity-70">${items.length}</span>
        </div>
        <div class="min-h-[4rem] flex-1 space-y-2">
          ${items.length ? items.map(boardCard).join('') : '<p class="py-4 text-center text-xs text-slate-400">Suelta una tarea aquí</p>'}
        </div>
      </div>`;
  }).join('');
  return `<div class="flex snap-x gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible">${cols}</div>`;
}

/** Cambia la tarea de columna (su estado) de inmediato en pantalla y la guarda; si falla, regresa. */
async function moveTask(t, status) {
  const prev = t.status;
  t.status = status;
  paint(moduleRoot());
  try {
    await apiPost('tasks/set_status', { id: t.id, status });
    if (status === 'completada') toast('Tarea completada');
    load(moduleRoot());
  } catch (e) {
    t.status = prev;
    paint(moduleRoot());
    toast(e.message, 'error');
  }
}

/**
 * Arrastrar con Pointer Events (ratón, dedo o lápiz) desde el asa de la tarjeta. Solo el asa captura el
 * gesto (touch-action: none): el resto de la tarjeta sigue desplazando la página en una pantalla táctil.
 * Además del arrastre, la etiqueta de estado de cada tarjeta lo cambia con un toque.
 */
function wireBoard(scope) {
  scope.querySelectorAll('[data-drag]').forEach((handle) => handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = handle.closest('[data-kcard]');
    const task = data.tasks.find((x) => x.id === +card.dataset.kcard);
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const rect = card.getBoundingClientRect();
    let ghost = null;
    let overCol = null;
    const HI = ['ring-2', 'ring-indigo-400'];

    const onMove = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragging = true;
        ghost = card.cloneNode(true);
        ghost.style.cssText = `position:fixed;z-index:10000;pointer-events:none;width:${rect.width}px;left:${rect.left}px;top:${rect.top}px;opacity:.92;transform:rotate(1.5deg);box-shadow:0 12px 28px rgba(15,23,42,.25);`;
        document.body.appendChild(ghost);
        card.classList.add('opacity-40');
      }
      ghost.style.left = `${rect.left + ev.clientX - x0}px`;
      ghost.style.top = `${rect.top + ev.clientY - y0}px`;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]') || null;
      if (col !== overCol) {
        overCol?.classList.remove(...HI);
        overCol = col;
        overCol?.classList.add(...HI);
      }
    };
    const finish = (ev, cancelled) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      const moved = !!ghost;
      ghost?.remove();
      card.classList.remove('opacity-40');
      overCol?.classList.remove(...HI);
      // El repintado periódico se reanuda hasta después del soltar (que repinta por su cuenta).
      setTimeout(() => { dragging = false; }, 0);
      if (!moved || cancelled || !overCol) return;
      const status = overCol.dataset.col;
      if (status !== boardColumn(task)) moveTask(task, status);
    };
    const onUp = (ev) => finish(ev, false);
    const onCancel = (ev) => finish(ev, true);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }));
}

/* ================= Resultados por entregar ================= */
async function paintResultados(view) {
  view.innerHTML = spinner();
  if (!resultsData) {
    try {
      resultsData = await apiGet('tasks/results_list');
    } catch (e) {
      view.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
      return;
    }
  }
  view.innerHTML = `
    <div class="space-y-5">
      ${resultToolbarHtml()}
      <div id="results-sections"></div>
    </div>`;
  wireResultToolbar(view);
  lastResultSig = ''; // al volver a entrar a la pestaña, las completadas arrancan de nuevo en 9
  paintResultSections(view);
}

function resultToolbarHtml() {
  const active = resultFilters.q || resultFilters.sample_date || resultFilters.due_date || resultFilters.status;
  return `
    <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-4 w-4')}</span>
          <input id="rf-q" type="text" placeholder="Buscar paciente…" value="${escapeHtml(resultFilters.q)}" autocomplete="off"
                 class="w-full rounded-lg border-0 bg-slate-50 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <div>
          <label class="${labelCls}">Toma de muestra</label>
          <input id="rf-sample" type="date" value="${resultFilters.sample_date}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Entrega</label>
          <input id="rf-due" type="date" value="${resultFilters.due_date}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Estado</label>
          <select id="rf-status" class="${inputCls}">
            <option value="">Todos</option>
            <option value="pendiente" ${resultFilters.status === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="completado" ${resultFilters.status === 'completado' ? 'selected' : ''}>Completado</option>
          </select>
        </div>
      </div>
      ${active ? `<button id="rf-clear" type="button" class="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-500">Quitar filtros</button>` : ''}
    </div>`;
}

function wireResultToolbar(view) {
  view.querySelector('#rf-q').addEventListener('input', debounce(() => {
    resultFilters.q = view.querySelector('#rf-q').value;
    paintResultSections(view);
  }, 250));
  view.querySelector('#rf-sample').addEventListener('change', () => {
    resultFilters.sample_date = view.querySelector('#rf-sample').value;
    paintResultSections(view);
  });
  view.querySelector('#rf-due').addEventListener('change', () => {
    resultFilters.due_date = view.querySelector('#rf-due').value;
    paintResultSections(view);
  });
  view.querySelector('#rf-status').addEventListener('change', () => {
    resultFilters.status = view.querySelector('#rf-status').value;
    paintResultSections(view);
  });
  view.querySelector('#rf-clear')?.addEventListener('click', () => {
    resultFilters = { q: '', sample_date: '', due_date: '', status: '' };
    // El toolbar sí se reconstruye aquí (los inputs deben volver a mostrarse vacíos).
    view.innerHTML = `
      <div class="space-y-5">
        ${resultToolbarHtml()}
        <div id="results-sections"></div>
      </div>`;
    wireResultToolbar(view);
    paintResultSections(view);
  });
}

/** Filtra la lista ya cargada (sin volver a pedirla al servidor) por búsqueda/fechas/estado.
 *  skipDueDate: la sección Completadas tiene su propio filtro de fecha de entrega,
 *  independiente del de arriba (ver completedDueFilter). */
function applyResultFilters(items, { skipDueDate = false } = {}) {
  let out = items;
  const q = resultFilters.q.trim().toLowerCase();
  if (q) out = out.filter((r) => r.patient_name.toLowerCase().includes(q));
  if (resultFilters.sample_date) out = out.filter((r) => r.sample_date === resultFilters.sample_date);
  if (!skipDueDate && resultFilters.due_date) out = out.filter((r) => r.due_date === resultFilters.due_date);
  if (resultFilters.status) {
    out = out.filter((r) => resultIsComplete(r) === (resultFilters.status === 'completado'));
  }
  return out;
}

function resultIsComplete(r) {
  const items = r.studies || [];
  return items.length > 0 && items.every((i) => i.done);
}

/** Solo repinta la lista/secciones — el buscador y los filtros de arriba no se tocan (no pierden el foco al escribir). */
function paintResultSections(view) {
  const box = view.querySelector('#results-sections');
  if (!resultsData.items.length) {
    box.innerHTML = emptyState('Sin resultados pendientes', 'Registra un paciente con "Nuevos resultados" para darle seguimiento.');
    return;
  }
  // Las completadas ya no se mezclan arriba de cada grupo por fecha — se van
  // todas a su propia sección al final, con su propio filtro de fecha (por
  // eso el filtro "Entrega" de arriba no debe descartarlas de antemano: se
  // filtran por separado más abajo, no a partir de este `filtered`).
  const t = today();
  const tm = tomorrow();
  const pending = applyResultFilters(resultsData.items).filter((r) => !resultIsComplete(r));
  const groups = [
    { title: 'Entrega de resultados hoy', items: pending.filter((r) => r.due_date && r.due_date <= t) },
    { title: 'Entrega de resultados mañana', items: pending.filter((r) => r.due_date === tm) },
    { title: 'Entrega de resultados posteriores', items: pending.filter((r) => !r.due_date || r.due_date > tm) },
  ];

  // Si cambió lo que se está viendo, la lista de completadas vuelve a empezar en 9.
  const sig = JSON.stringify([resultFilters, completedDueFilter]);
  if (sig !== lastResultSig) {
    completedShown = COMPLETED_PAGE;
    lastResultSig = sig;
  }

  const hasAnyCompleted = resultsData.items.some((r) => resultIsComplete(r));
  let completedHtml = '';
  if (hasAnyCompleted && resultFilters.status !== 'pendiente') {
    let completed = applyResultFilters(resultsData.items.filter((r) => resultIsComplete(r)), { skipDueDate: true });
    if (completedDueFilter) completed = completed.filter((r) => r.due_date === completedDueFilter);
    completed = [...completed].sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
    const visible = completed.slice(0, completedShown);
    const restantes = completed.length - visible.length;
    completedHtml = `
      <div class="mb-6 last:mb-0">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-sm font-semibold text-slate-700">Completadas</h4>
          <div class="flex items-center gap-2">
            <input id="rf-completed-due" type="date" value="${completedDueFilter}" title="Filtrar por fecha de entrega"
                   class="rounded-lg border-0 bg-slate-50 px-2 py-1 text-xs ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
            ${completedDueFilter ? `<button id="rf-completed-clear" type="button" class="text-xs font-semibold text-indigo-600 hover:text-indigo-500">Quitar</button>` : ''}
            <span class="text-xs text-slate-400">${visible.length} de ${completed.length}</span>
          </div>
        </div>
        ${completed.length
          ? `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${visible.map((r) => resultCard(r)).join('')}</div>`
          : `<p class="text-xs text-slate-400">Sin resultados completados con esa fecha de entrega.</p>`}
        ${restantes > 0 ? `
          <div class="mt-3 flex justify-center">
            <button id="rf-completed-more" type="button"
                    class="rounded-lg px-4 py-2 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50">
              Ver más (${restantes} restante${restantes === 1 ? '' : 's'})
            </button>
          </div>` : ''}
      </div>`;
  }

  const pendingHtml = groups.filter((g) => g.items.length).map((g) => `
    <div class="mb-6 last:mb-0">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-slate-700">${g.title}</h4>
        <span class="text-xs text-slate-400">${g.items.length}</span>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${g.items.map((r) => resultCard(r)).join('')}</div>
    </div>`).join('');

  box.innerHTML = pendingHtml + completedHtml || emptyState('Sin coincidencias', 'Ajusta la búsqueda o los filtros.');

  view.querySelector('#rf-completed-due')?.addEventListener('change', (e) => {
    completedDueFilter = e.target.value;
    paintResultSections(view);
  });
  view.querySelector('#rf-completed-clear')?.addEventListener('click', () => {
    completedDueFilter = '';
    paintResultSections(view);
  });
  view.querySelector('#rf-completed-more')?.addEventListener('click', () => {
    completedShown += COMPLETED_PAGE;
    paintResultSections(view);
  });
  wireResultEvents(view);
}

function resultCard(r) {
  const items = r.studies || [];
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const complete = resultIsComplete(r);
  const overdue = r.due_date && r.due_date < today() && !complete;
  const dueCls = complete ? 'bg-emerald-100 text-emerald-700' : overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600';
  const canEditThis = resultsData.can_manage || r.created_by === resultsData.me;
  // Verde si ya está completado (manda sobre la fecha); si no, rojo si es para
  // hoy o ya venció, amarillo si es mañana, blanco (sin tinte) para lo demás —
  // mismo lenguaje de color "transparente" que ya usa el pizarrón.
  const cardTint = complete
    ? 'bg-emerald-50'
    : r.due_date && r.due_date <= today()
      ? 'bg-red-50'
      : r.due_date === tomorrow()
        ? 'bg-amber-50'
        : 'bg-white';
  // Cenefa del nombre: mismo color que la tarjeta pero más saturado (100 en vez
  // de 50), como ya se ve en el pizarrón — así el nombre resalta sobre el fondo
  // pastel de la tarjeta en vez de perderse en él.
  const nameBandCls = complete
    ? 'bg-emerald-100 text-emerald-900'
    : r.due_date && r.due_date <= today()
      ? 'bg-red-100 text-red-900'
      : r.due_date === tomorrow()
        ? 'bg-amber-100 text-amber-900'
        : 'text-slate-900';
  return `
    <div class="rounded-2xl ${cardTint} p-4 shadow-sm ring-1 ring-slate-200" data-result-card="${r.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate rounded-md px-2 py-1 text-sm font-bold ${nameBandCls}">${escapeHtml(r.patient_name)}</p>
          ${r.sample_date ? `<p class="mt-0.5 px-2 text-xs text-slate-500">Toma: ${fmtDate(r.sample_date)}</p>` : ''}
        </div>
        <div class="flex shrink-0 gap-1">
          ${canEditThis ? `
          <button type="button" data-edit-result="${r.id}" title="Editar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-3.5 w-3.5')}</button>
          <button type="button" data-del-result="${r.id}" title="Eliminar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-3.5 w-3.5')}</button>` : ''}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        ${r.due_date ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${dueCls}">${complete ? '✓ ' : overdue ? '⚠ ' : ''}Entrega ${fmtDate(r.due_date)}</span>` : ''}
        ${total ? `<span class="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">${done}/${total}</span>` : ''}
      </div>
      ${total ? `
      <div class="mt-3 space-y-1 border-t border-slate-100 pt-3">
        ${items.map((it, idx) => `
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" data-item="${idx}" ${it.done ? 'checked' : ''}
                   class="h-3.5 w-3.5 shrink-0 rounded border-slate-400 text-indigo-600 focus:ring-indigo-500">
            <span class="${it.done ? 'text-slate-400 line-through' : 'text-slate-700'}">${escapeHtml(it.text)}</span>
          </label>`).join('')}
      </div>` : `<p class="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">Sin estudios capturados.</p>`}
      <div class="mt-3 space-y-1 border-t border-slate-100 pt-3">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" data-invoice="${r.id}" ${r.needs_invoice ? 'checked' : ''}
                 class="h-3.5 w-3.5 shrink-0 rounded border-slate-400 text-violet-600 focus:ring-violet-500">
          Solicitar factura
        </label>
        ${r.needs_invoice ? `
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" data-invoice-sent="${r.id}" ${r.invoice_sent ? 'checked' : ''}
                 class="h-3.5 w-3.5 shrink-0 rounded border-slate-400 text-sky-600 focus:ring-sky-500">
          Factura enviada
        </label>` : ''}
      </div>
      ${r.observations ? `<p class="mt-2 whitespace-pre-line text-xs text-slate-500">${escapeHtml(r.observations)}</p>` : ''}
      ${r.creator_name ? `<p class="mt-2 text-[10px] text-slate-400">${escapeHtml(r.creator_name)}</p>` : ''}
    </div>`;
}

function wireResultEvents(view) {
  view.querySelectorAll('[data-result-card]').forEach((card) => {
    const id = +card.dataset.resultCard;
    const r = resultsData.items.find((x) => x.id === id);
    card.querySelectorAll('[data-item]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const idx = +cb.dataset.item;
        const prev = r.studies[idx].done;
        r.studies[idx].done = cb.checked;
        try {
          await apiPost('tasks/results_save', { id, studies: r.studies });
        } catch (e) {
          toast(e.message, 'error');
          r.studies[idx].done = prev;
        }
        paintResultSections(view);
      });
    });
    const invoiceCb = card.querySelector('[data-invoice]');
    invoiceCb?.addEventListener('change', async () => {
      const prev = r.needs_invoice;
      const prevSent = r.invoice_sent;
      r.needs_invoice = invoiceCb.checked;
      // No tiene sentido "enviada" sin "solicitada" — se destilda junto.
      if (!r.needs_invoice) r.invoice_sent = false;
      invoiceCb.disabled = true;
      try {
        await apiPost('tasks/results_save', { id, needs_invoice: r.needs_invoice });
        paintResultSections(view); // muestra/oculta "Factura enviada" según el nuevo estado
      } catch (e) {
        toast(e.message, 'error');
        r.needs_invoice = prev;
        r.invoice_sent = prevSent;
        invoiceCb.checked = prev;
        invoiceCb.disabled = false;
      }
    });
    const invoiceSentCb = card.querySelector('[data-invoice-sent]');
    invoiceSentCb?.addEventListener('change', async () => {
      const prev = r.invoice_sent;
      r.invoice_sent = invoiceSentCb.checked;
      invoiceSentCb.disabled = true;
      try {
        await apiPost('tasks/results_save', { id, invoice_sent: r.invoice_sent });
      } catch (e) {
        toast(e.message, 'error');
        r.invoice_sent = prev;
        invoiceSentCb.checked = prev;
      }
      invoiceSentCb.disabled = false;
    });
  });
  view.querySelectorAll('[data-edit-result]').forEach((b) =>
    b.addEventListener('click', () => openResultModal(resultsData.items.find((x) => x.id === +b.dataset.editResult))));
  view.querySelectorAll('[data-del-result]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = resultsData.items.find((x) => x.id === +b.dataset.delResult);
      const ok = await confirmDialog('Eliminar registro', `Se eliminará el seguimiento de resultados de "${r.patient_name}". ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('tasks/results_delete', { id: r.id });
        resultsData.items = resultsData.items.filter((x) => x.id !== r.id);
        toast('Registro eliminado');
        paintResultSections(view);
      } catch (e) {
        toast(e.message, 'error');
      }
    }));
}

/** Dropdown de búsqueda genérico bajo un input: cierra al hacer clic fuera del propio
 *  formulario (no de document), así el listener muere con el modal y no se acumula
 *  entre aperturas repetidas. Sin coincidencia no pasa nada: el texto tecleado se
 *  conserva tal cual, el resultado nunca depende de encontrar algo. */
function wireSearchDropdown(form, input, results, { searchFn, renderRow, onPick }) {
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.classList.add('hidden'); return; }
    const items = await searchFn(q);
    results.innerHTML = items.length
      ? items.map((it, i) => `<button type="button" data-idx="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-50">${renderRow(it)}</button>`).join('')
      : '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias. Se guarda tal cual lo escribas.</p>';
    results.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { onPick(items[+b.dataset.idx]); results.classList.add('hidden'); }));
    results.classList.remove('hidden');
  }, 250));
  form.addEventListener('click', (e) => {
    if (e.target !== input && !results.contains(e.target)) results.classList.add('hidden');
  });
}

function openResultModal(item) {
  const form = document.createElement('form');
  const studies = item ? item.studies.map((s) => ({ ...s })) : [];
  form.innerHTML = `
    <div class="space-y-4">
      <div class="relative">
        <label class="${labelCls}">Nombre del paciente *</label>
        <input type="text" name="patient_name" required autocomplete="off" value="${escapeHtml(item?.patient_name || '')}" class="${inputCls}">
        <div id="result-patient-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="${labelCls}">Toma de muestra</label>
          <input type="date" name="sample_date" value="${item?.sample_date || ''}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Entrega de resultados</label>
          <input type="date" name="due_date" value="${item?.due_date || ''}" class="${inputCls}">
        </div>
      </div>
      <div>
        <label class="${labelCls}">Estudios a enviar</label>
        <div id="result-studies" class="space-y-1.5"></div>
        <button type="button" id="btn-add-study" class="mt-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600">
          ${icon('plus', 'h-3.5 w-3.5')} agregar estudio
        </button>
      </div>
      <div>
        <label class="${labelCls}">Observaciones</label>
        <textarea name="observations" rows="2" class="${inputCls}" placeholder="Opcional">${escapeHtml(item?.observations || '')}</textarea>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="needs_invoice" value="1" ${item?.needs_invoice ? 'checked' : ''}
               class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Enviarle factura
      </label>
    </div>`;

  wireSearchDropdown(form, form.querySelector('[name=patient_name]'), form.querySelector('#result-patient-results'), {
    searchFn: async (q) => (await apiGet('tasks/search_patients', { q })).items,
    renderRow: (p) => `<span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">${escapeHtml(p.name)}</span><span class="shrink-0 text-xs text-slate-500">${escapeHtml(p.file_number)}</span>`,
    onPick: (p) => { form.querySelector('[name=patient_name]').value = p.name; },
  });

  const studiesBox = form.querySelector('#result-studies');
  const renderStudies = () => {
    studiesBox.innerHTML = studies.length ? studies.map((s, idx) => `
      <div class="flex items-center gap-2">
        <input type="checkbox" data-s-done="${idx}" ${s.done ? 'checked' : ''} class="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        <div class="relative min-w-0 flex-1">
          <input type="text" data-s-text="${idx}" autocomplete="off" value="${escapeHtml(s.text)}" placeholder="Estudio…" class="${inputCls}">
          <div id="result-study-results-${idx}" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
        </div>
        <button type="button" data-s-rm="${idx}" class="shrink-0 text-slate-300 hover:text-red-500">${icon('x', 'h-4 w-4')}</button>
      </div>`).join('') : `<p class="text-xs text-slate-400">Sin estudios agregados.</p>`;
    studiesBox.querySelectorAll('[data-s-done]').forEach((cb) => cb.addEventListener('change', () => { studies[+cb.dataset.sDone].done = cb.checked; }));
    studiesBox.querySelectorAll('[data-s-text]').forEach((inp) => {
      const idx = +inp.dataset.sText;
      inp.addEventListener('input', () => { studies[idx].text = inp.value; });
      wireSearchDropdown(form, inp, studiesBox.querySelector(`#result-study-results-${idx}`), {
        searchFn: async (q) => (await apiGet('tasks/search_studies', { q })).items,
        renderRow: (s) => `<span class="text-sm font-medium text-slate-800">${escapeHtml(s.name)}</span>`,
        onPick: (s) => { inp.value = s.name; studies[idx].text = s.name; },
      });
    });
    studiesBox.querySelectorAll('[data-s-rm]').forEach((b) => b.addEventListener('click', () => { studies.splice(+b.dataset.sRm, 1); renderStudies(); }));
  };
  renderStudies();
  form.querySelector('#btn-add-study').addEventListener('click', () => {
    studies.push({ text: '', done: false });
    renderStudies();
    [...studiesBox.querySelectorAll('[data-s-text]')].pop()?.focus();
  });

  modal({
    title: item ? 'Editar resultados pendientes' : 'Nuevos resultados',
    content: form,
    size: 'max-w-xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: item ? 'Guardar cambios' : 'Registrar', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('tasks/results_save', {
              ...(item ? { id: item.id } : {}),
              patient_name: v.patient_name, sample_date: v.sample_date, due_date: v.due_date,
              needs_invoice: v.needs_invoice, observations: v.observations, studies,
            });
            toast(item ? 'Registro actualizado' : 'Resultados registrados');
            close();
            resultsData = null;
            paintResultados(document.getElementById('tasks-view'));
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

/* ---------- componentes ---------- */
function projectStats(p) {
  const list = data.tasks.filter((t) => t.project_id === p.id);
  return { total: list.length, done: list.filter((t) => t.status === 'completada').length };
}

function projectProgress(p) {
  const { total, done } = projectStats(p);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
    <div class="mt-3">
      <div class="h-2 overflow-hidden rounded-full bg-slate-100">
        <div class="h-full rounded-full bg-indigo-500 transition-all" style="width:${pct}%"></div>
      </div>
      <p class="mt-1 text-right text-[11px] font-medium text-slate-400">${done}/${total} · ${pct}%</p>
    </div>`;
}

function canEdit(t) {
  return data.can_manage || t.created_by === data.me;
}

function emptyState(title, subtitle) {
  return `
    <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
      <p class="text-sm font-medium text-slate-600">${escapeHtml(title)}</p>
      <p class="mt-1 text-xs text-slate-400">${escapeHtml(subtitle)}</p>
    </div>`;
}

/* ---------- eventos ---------- */
function wireTaskEvents(view) {
  const root = () => document.getElementById('module-root');
  view.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = data.tasks.find((x) => x.id === +b.dataset.toggle);
      try {
        await apiPost('tasks/set_status', { id: t.id, status: t.status === 'completada' ? 'pendiente' : 'completada' });
        load(root());
      } catch (e) { toast(e.message, 'error'); }
    }));
  view.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = data.tasks.find((x) => x.id === +b.dataset.status);
      try {
        await apiPost('tasks/set_status', { id: t.id, status: STATUS[t.status].next });
        load(root());
      } catch (e) { toast(e.message, 'error'); }
    }));
  view.querySelectorAll('[data-recurring]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await apiPost('tasks/toggle_recurring', { id: +b.dataset.recurring });
        load(root());
      } catch (e) { toast(e.message, 'error'); }
    }));
  wireDescription(view, () => load(root()));
  view.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => openTaskView(data.tasks.find((x) => x.id === +b.dataset.view))));
  view.querySelectorAll('[data-subtask]').forEach((b) =>
    b.addEventListener('click', () => openTaskModal(null, { parent_id: +b.dataset.subtask })));
  view.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openTaskModal(data.tasks.find((x) => x.id === +b.dataset.edit), {})));
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = data.tasks.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar tarea', `¿Eliminar "${t.title}"${children(t).length ? ' y sus subtareas' : ''}?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('tasks/delete', { id: t.id });
        toast('Tarea eliminada');
        load(root());
      } catch (e) { toast(e.message, 'error'); }
    }));
}

/**
 * Lo que se puede hacer sobre la descripción de una tarea, en la tarjeta o en su vista completa:
 * marcar casillas (al marcar la última, el servidor completa la tarea) y ver una imagen en grande.
 */
function wireDescription(scope, onChange) {
  // Casillas de una tarea (data-check) o de la descripción de un proyecto (data-pcheck).
  [['data-check', 'tasks/toggle_check'], ['data-pcheck', 'tasks/project_toggle_check']].forEach(([attr, route]) =>
    scope.querySelectorAll(`[${attr}]`).forEach((b) =>
      b.addEventListener('click', async () => {
        const [id, index, done] = b.getAttribute(attr).split(':').map(Number);
        b.disabled = true;
        try {
          const res = await apiPost(route, { id, index, done: !!done });
          if (res.completed) toast('Tarea completada');
          onChange();
        } catch (e) {
          b.disabled = false;
          toast(e.message, 'error');
        }
      })));
  scope.querySelectorAll('[data-zoom]').forEach((img) =>
    img.addEventListener('click', () => modal({
      title: 'Imagen',
      content: `<img src="${escapeHtml(img.dataset.zoom)}" alt="Imagen de la tarea" class="mx-auto max-h-[75vh] max-w-full rounded-md">`,
      size: 'max-w-4xl',
    })));
}

/** La tarea completa, sin recortes: descripción con todas sus imágenes y subtareas. */
function openTaskView(t) {
  if (!t) return;
  const isRecurring = !!t.recurrence;
  const proj = t.project_id ? data.projects.find((p) => p.id === t.project_id) : null;
  const subs = !isRecurring ? children(t) : [];
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${isRecurring ? 'bg-slate-100 text-slate-600' : STATUS[t.status].cls}">${isRecurring ? (t.done_now ? 'Al día' : 'Pendiente') : STATUS[t.status].label}</span>
      <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
      ${proj ? `<span class="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">${escapeHtml(proj.name)}</span>` : ''}
      ${t.due_date ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">${fmtDate(t.due_date)}</span>` : ''}
    </div>
    ${taskDescriptionHtml(t, { size: 'full' }) || '<p class="mt-3 text-sm text-slate-400">Esta tarea no tiene descripción.</p>'}
    ${subs.length ? `
    <div class="mt-4 space-y-1">
      <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400">Subtareas</p>
      ${subs.map((s) => `<p class="text-sm ${s.status === 'completada' ? 'text-slate-400 line-through' : 'text-slate-700'}">${s.status === 'completada' ? '☑' : '☐'} ${escapeHtml(s.title)}</p>`).join('')}
    </div>` : ''}
    <div class="mt-4 space-y-0.5 text-xs text-slate-400">
      ${t.creator_name ? `<p>Creó: ${escapeHtml(t.creator_name)}</p>` : ''}
      ${assigneeNames(t) ? `<p>Asignado: ${escapeHtml(assigneeNames(t))}</p>` : ''}
    </div>`;
  const m = modal({
    title: t.title,
    content: wrap,
    size: 'max-w-2xl',
    actions: [
      { label: 'Cerrar' },
      ...(canEdit(t) ? [{ label: 'Editar', primary: true, onClick: (close) => { close(); openTaskModal(t, {}); } }] : []),
    ],
  });
  // Marcar una casilla desde aquí recarga la lista y vuelve a abrir la tarea con lo nuevo.
  wireDescription(wrap, async () => {
    m.close();
    await load(document.getElementById('module-root'));
    openTaskView(data.tasks.find((x) => x.id === t.id));
  });
}

/* ---------- modales ---------- */
/** Lista de checkboxes para asignar varias personas a la vez (tarea o proyecto). */
function assigneeCheckboxesHtml(selectedIds) {
  if (!data.users.length) {
    return '<p class="text-sm text-slate-400">Sin usuarios disponibles.</p>';
  }
  return `
    <div class="max-h-36 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-300">
      ${data.users.map((u) => `
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" data-assignee="${u.id}" ${selectedIds.includes(u.id) ? 'checked' : ''}
                 class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          ${escapeHtml(u.full_name)}
        </label>`).join('')}
    </div>`;
}

function checkedAssignees(form) {
  return [...form.querySelectorAll('[data-assignee]:checked')].map((el) => +el.dataset.assignee);
}

function openTaskModal(task, presets) {
  const isSub = !!(task?.parent_id || presets.parent_id);
  const parentId = task?.parent_id || presets.parent_id || '';
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'title', label: isSub ? 'Subtarea' : 'Título', type: 'text', required: true, span: 'sm:col-span-2' }, task?.title || '')}
      <div class="sm:col-span-2"><label class="${labelCls}">Descripción</label>
        <div id="f-desc-editor"></div>
      </div>
      ${data.can_manage ? `
      <div class="sm:col-span-2"><label class="${labelCls}">Asignar a</label>
        ${assigneeCheckboxesHtml(task?.assigned_to || [])}
      </div>` : ''}
      ${field({ key: 'priority', label: 'Prioridad', type: 'select', options: [['baja', 'Baja'], ['media', 'Media'], ['alta', 'Alta'], ['urgente', 'Urgente']] }, task?.priority || 'media')}
      ${field({ key: 'due_date', label: 'Fecha límite', type: 'date' }, task?.due_date || '')}
      ${!isSub ? `
      ${field({ key: 'recurrence', label: 'Frecuencia', type: 'select', options: [['', 'Única (no se repite)'], ['diaria', 'Diaria'], ['semanal', 'Semanal']] }, task?.recurrence || '')}
      <div id="f-weekday-wrap" class="${task?.recurrence === 'semanal' ? '' : 'hidden'}">
        ${field({ key: 'weekday', label: 'Día de corte', type: 'select', options: [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']] }, task?.weekday ?? '')}
      </div>
      <div><label class="${labelCls}">Proyecto</label>
        <select name="project_id" class="${inputCls}">
          <option value="">— Sin proyecto —</option>
          ${data.projects.filter((p) => p.status === 'activo').map((p) => `<option value="${p.id}" ${(task?.project_id || presets.project_id) === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select></div>` : ''}
    </div>`;

  const descEditor = mountTaskEditor(form.querySelector('#f-desc-editor'), task?.desc_blocks || [], { taskId: task?.id || 0 });

  form.querySelector('[name="recurrence"]')?.addEventListener('change', (e) => {
    form.querySelector('#f-weekday-wrap')?.classList.toggle('hidden', e.target.value !== 'semanal');
  });

  modal({
    title: task ? 'Editar tarea' : (isSub ? 'Nueva subtarea' : 'Nueva tarea'),
    content: form,
    size: 'max-w-3xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: task ? 'Guardar cambios' : 'Crear tarea', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          if (descEditor.busy()) {
            toast('Espera a que termine de subirse la imagen', 'error');
            return;
          }
          const v = formValues(form);
          // El campo puede estar oculto (frecuencia distinta a "Semanal"), así que no
          // se usa `required` nativo aquí — se valida a mano, igual criterio pero sin
          // depender de si el navegador constraint-valida campos no visibles.
          if (v.recurrence === 'semanal' && v.weekday === '') {
            toast('Selecciona el día de corte de la tarea semanal', 'error');
            return;
          }
          btn.disabled = true;
          try {
            await apiPost('tasks/save', {
              ...(task ? { id: task.id } : {}),
              title: v.title, description: descEditor.content(),
              assigned_to: checkedAssignees(form), priority: v.priority,
              due_date: v.due_date, recurrence: v.recurrence ?? '',
              weekday: v.recurrence === 'semanal' ? v.weekday : '',
              project_id: v.project_id ?? '', parent_id: parentId,
            });
            toast(task ? 'Tarea actualizada' : 'Tarea creada');
            close();
            load(document.getElementById('module-root'));
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function openProjectModal(project) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'name', label: 'Nombre del proyecto', type: 'text', required: true, span: 'sm:col-span-2' }, project?.name || '')}
      <div class="sm:col-span-2"><label class="${labelCls}">Descripción</label>
        <div id="p-desc-editor"></div>
      </div>
      <div class="sm:col-span-2"><label class="${labelCls}">Asignar a</label>
        ${assigneeCheckboxesHtml(project?.assigned_to || [])}
      </div>
      ${field({ key: 'due_date', label: 'Fecha límite', type: 'date' }, project?.due_date || '')}
      ${field({ key: 'status', label: 'Estado', type: 'select', options: [['activo', 'Activo'], ['completado', 'Completado'], ['archivado', 'Archivado']] }, project?.status || 'activo')}
    </div>`;

  const descEditor = mountTaskEditor(form.querySelector('#p-desc-editor'), project?.desc_blocks || [], { projectId: project?.id || 0 });

  modal({
    title: project ? 'Editar proyecto' : 'Nuevo proyecto',
    content: form,
    size: 'max-w-3xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: project ? 'Guardar cambios' : 'Crear proyecto', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          if (descEditor.busy()) {
            toast('Espera a que termine de subirse la imagen', 'error');
            return;
          }
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('tasks/project_save', {
              ...(project ? { id: project.id } : {}),
              name: v.name, description: descEditor.content(), due_date: v.due_date, status: v.status,
              assigned_to: checkedAssignees(form),
            });
            toast(project ? 'Proyecto actualizado' : 'Proyecto creado');
            close();
            load(document.getElementById('module-root'));
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}
