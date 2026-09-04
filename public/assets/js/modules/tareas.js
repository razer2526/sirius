/** Módulo Tareas: mis tareas (únicas y frecuentes, en una sola lista ordenada),
 *  proyectos con subtareas, monitor de equipo y seguimiento de resultados. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, formValues, inputCls, labelCls, spinner, fmtDate, debounce, isUserBusy } from '../ui.js';

const POLL_MS = 20000;

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
let resultsData = null;
// '' en 'user' significa "yo mismo"; solo un gestor puede cambiarlo a otra persona.
let misFilters = { status: '', project: '', user: '' };
let resultFilters = { q: '', sample_date: '', due_date: '', status: '' };
// Filtro de fecha de entrega exclusivo de la sección "Completadas", independiente
// del filtro "Entrega" de arriba (ese solo agrupa hoy/mañana/posteriores).
let completedDueFilter = '';
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
    if (isUserBusy()) return; // modal abierto o foco en un campo: se reintenta en el siguiente tick
    try {
      const fresh = await apiGet('tasks/list');
      if (isUserBusy()) return; // pudo empezar a interactuar mientras la petición estaba en vuelo
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
  if (data.can_manage) tabs.push(['equipo', 'Equipo', 'users']);

  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
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
  else if (tab === 'resultados') paintResultados(view);
  else paintEquipo(view);
}

/* ---------- helpers de datos ---------- */
const children = (t) => data.tasks.filter((x) => x.parent_id === t.id);
const tasksForUser = (userId) => data.tasks.filter((t) => !t.parent_id && (t.assigned_to.includes(userId) || t.created_by === userId));
const assigneeNames = (t) => (t.assigned_names || []).join(', ');
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const isOverdue = (t) => t.due_date && t.due_date < today() && t.status !== 'completada';

function sortTasks(list) {
  return [...list].sort((a, b) => {
    const doneA = a.status === 'completada' ? 1 : 0;
    const doneB = b.status === 'completada' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1;
  });
}

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
 * "Mis tareas": agrupada por vencimiento (hoy/mañana/esta semana/posterior), con
 * alta/urgente destacadas arriba en tarjetas cuadradas sin importar su fecha, y
 * completadas al final — mismo lenguaje visual que ya usa Tareas > Resultados. Un
 * gestor puede además "ver como" a otra persona del equipo con el filtro de usuario,
 * en vez de tener que ir a la pestaña Equipo.
 */
function paintMis(view) {
  const targetUser = data.can_manage && misFilters.user ? +misFilters.user : data.me;
  let list = tasksForUser(targetUser);
  if (misFilters.status) list = list.filter((t) => t.status === misFilters.status);
  if (misFilters.project) list = list.filter((t) => t.project_id === +misFilters.project);

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
  const stack = (sectionKey) => (items) => `<div class="space-y-2.5">${items.map((t) => misTaskCard(t, { sectionKey })).join('')}</div>`;
  const squareGrid = (sectionKey) => (items) => `<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">${items.map((t) => misTaskCard(t, { square: true, sectionKey })).join('')}</div>`;

  const sections = [
    group('Prioridad alta', prioridad, squareGrid('prioridad')),
    group('Con deadline para hoy', sortByDueDate(b.hoy), stack('hoy')),
    group('Con deadline para mañana', sortByDueDate(b.manana), stack('manana')),
    group('Con deadline para esta semana', sortByDueDate(b.semana), stack('semana')),
    group('Con deadline posterior', sortByDueDate(b.posterior), stack('posterior')),
    group('Completadas', completadas, stack('completadas')),
  ].filter(Boolean);

  view.innerHTML = `
    <div class="space-y-4">
      ${filterBarHtml()}
      ${sections.length ? `<div class="space-y-5">${sections.join('')}</div>` : emptyState('Sin tareas pendientes', 'Crea una tarea o espera a que te asignen una.')}
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
 * Tarjeta de "Mis tareas": título con cenefa de color según la sección donde cayó
 * (hoy/mañana/semana/posterior/completadas — ver SECTION_COLORS), o según su propia
 * prioridad en la sección "Prioridad alta" (ver PRIORITY_CARD_COLORS, esa sección se
 * saca justo por no depender de la fecha). A diferencia de taskCard() (que comparten
 * Proyectos y Equipo, sin tocar), aquí el creador y el asignado se muestran siempre,
 * no solo a gestores. Las tareas recurrentes (diaria/semanal) usan el check binario
 * data-recurring en vez del ciclo de estado pendiente→en progreso→completada.
 */
function misTaskCard(t, { square = false, sectionKey } = {}) {
  const isRecurring = !!t.recurrence;
  const isDone = isRecurring ? t.done_now : t.status === 'completada';
  const colors = sectionKey === 'prioridad' ? PRIORITY_CARD_COLORS[t.priority] : SECTION_COLORS[sectionKey];
  const cardTint = colors?.tint || 'bg-white';
  const proj = t.project_id ? data.projects.find((p) => p.id === t.project_id) : null;
  const subs = !isRecurring ? children(t) : [];
  const subsDone = subs.filter((s) => s.status === 'completada').length;

  return `
    <div class="rounded-2xl ${cardTint} p-4 shadow-sm ring-1 ring-slate-200 ${square ? 'flex flex-col aspect-square overflow-hidden' : ''}">
      <div class="flex items-start gap-2.5">
        <button type="button" ${isRecurring ? `data-recurring="${t.id}"` : `data-toggle="${t.id}"`} title="Completar"
                class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div class="min-w-0 flex-1">
          <p class="truncate rounded-md px-2 py-1 text-sm font-bold ${colors?.band || 'text-slate-900'} ${isDone ? 'line-through opacity-70' : ''}">${escapeHtml(t.title)}</p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${isRecurring
              ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${isDone ? 'Al día' : 'Pendiente'}</span>`
              : `<button type="button" data-status="${t.id}" class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[t.status].cls}" title="Cambiar estado">${STATUS[t.status].label}</button>`}
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
            ${proj
              ? `<span class="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">${escapeHtml(proj.name)}</span>`
              : `<span class="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">Tarea suelta</span>`}
            ${t.recurrence === 'semanal' && t.weekday !== null && t.weekday !== undefined
              ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Cada ${WEEKDAY_NAMES[t.weekday].toLowerCase()}</span>` : ''}
            ${t.due_date ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">${fmtDate(t.due_date)}</span>` : ''}
          </div>
          <div class="mt-1.5 space-y-0.5 text-[11px] text-slate-400">
            ${t.creator_name ? `<p class="truncate">Creó: ${escapeHtml(t.creator_name)}</p>` : ''}
            ${assigneeNames(t) ? `<p class="truncate">Asignado: ${escapeHtml(assigneeNames(t))}</p>` : ''}
          </div>
        </div>
        <div class="flex shrink-0 gap-1">
          ${!square && !t.parent_id && !isRecurring ? `<button type="button" data-subtask="${t.id}" title="Agregar subtarea" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('plus', 'h-4 w-4')}</button>` : ''}
          ${canEdit(t) ? `
          <button type="button" data-edit="${t.id}" title="Editar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
          <button type="button" data-del="${t.id}" title="Eliminar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
        </div>
      </div>
      ${!square && subs.length ? `
      <div class="ml-9 mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
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
    </div>`;
}

function canDeleteProject(p) {
  return data.can_manage || p.created_by === data.me;
}

function paintProyectos(view) {
  if (projectFilter !== null) {
    const p = data.projects.find((x) => x.id === projectFilter);
    const list = sortTasks(data.tasks.filter((t) => t.project_id === projectFilter && !t.parent_id));
    view.innerHTML = `
      <button type="button" id="btn-back-projects" class="mb-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Todos los proyectos
      </button>
      <div class="mb-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-slate-900">${escapeHtml(p.name)}</h3>
            ${p.description ? `<p class="mt-0.5 text-sm text-slate-500">${escapeHtml(p.description)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2">
            ${p.due_date ? `<span class="text-xs font-medium text-slate-500">Límite: ${fmtDate(p.due_date)}</span>` : ''}
            ${data.can_manage ? `<button type="button" id="btn-add-to-project" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">+ Tarea</button>` : ''}
          </div>
        </div>
        ${projectProgress(p)}
      </div>
      ${list.length ? `<div class="space-y-2.5">${list.map((t) => taskCard(t)).join('')}</div>` : emptyState('Proyecto sin tareas', 'Agrega la primera tarea.')}`;
    view.querySelector('#btn-back-projects').addEventListener('click', () => { projectFilter = null; paint(document.getElementById('module-root')); });
    view.querySelector('#btn-add-to-project')?.addEventListener('click', () => openTaskModal(null, { project_id: projectFilter }));
    wireTaskEvents(view);
    return;
  }

  const visible = data.projects.filter((p) => p.status !== 'archivado' || data.can_manage);
  view.innerHTML = visible.length ? `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      ${visible.map((p) => {
        const stats = projectStats(p);
        return `
        <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md ${p.status === 'archivado' ? 'opacity-60' : ''}">
          <div class="flex items-start justify-between gap-2">
            <button type="button" data-open-project="${p.id}" class="min-w-0 flex-1 text-left">
              <p class="truncate text-sm font-bold text-slate-900 hover:text-indigo-600">${escapeHtml(p.name)}</p>
              <p class="mt-0.5 text-xs text-slate-500">
                ${stats.total} tarea(s)${p.due_date ? ` · límite ${fmtDate(p.due_date)}` : ''}
                ${p.status !== 'activo' ? ` · ${p.status}` : ''}
              </p>
            </button>
            ${data.can_manage || canDeleteProject(p) ? `
            <div class="flex shrink-0 gap-1">
              ${data.can_manage ? `<button type="button" data-edit-project="${p.id}" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-3.5 w-3.5')}</button>` : ''}
              ${canDeleteProject(p) ? `<button type="button" data-del-project="${p.id}" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-3.5 w-3.5')}</button>` : ''}
            </div>` : ''}
          </div>
          ${projectProgress(p)}
        </div>`;
      }).join('')}
    </div>` : emptyState('Sin proyectos', data.can_manage ? 'Crea el primero con "Nuevo proyecto".' : 'Aún no participas en ningún proyecto.');

  view.querySelectorAll('[data-open-project]').forEach((b) =>
    b.addEventListener('click', () => { projectFilter = +b.dataset.openProject; paint(document.getElementById('module-root')); }));
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
        load(document.getElementById('module-root'));
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function paintEquipo(view) {
  const grupos = [...data.users.map((u) => ({ id: u.id, name: u.full_name })), { id: null, name: 'Sin asignar' }];
  const html = grupos.map((g) => {
    const list = sortTasks(data.tasks.filter((t) => !t.parent_id && !t.recurrence
      && (g.id === null ? t.assigned_to.length === 0 : t.assigned_to.includes(g.id))));
    if (!list.length) return '';
    const done = list.filter((t) => t.status === 'completada').length;
    return `
      <div>
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-sm font-semibold text-slate-700">${escapeHtml(g.name)}</h4>
          <span class="text-xs text-slate-400">${done}/${list.length} completadas</span>
        </div>
        <div class="space-y-2.5">${list.map((t) => taskCard(t)).join('')}</div>
      </div>`;
  }).filter(Boolean).join('');
  view.innerHTML = html ? `<div class="space-y-6">${html}</div>` : emptyState('Sin tareas asignadas', 'Crea tareas y asígnalas al equipo.');
  wireTaskEvents(view);
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

  const hasAnyCompleted = resultsData.items.some((r) => resultIsComplete(r));
  let completedHtml = '';
  if (hasAnyCompleted && resultFilters.status !== 'pendiente') {
    let completed = applyResultFilters(resultsData.items.filter((r) => resultIsComplete(r)), { skipDueDate: true });
    if (completedDueFilter) completed = completed.filter((r) => r.due_date === completedDueFilter);
    completed = [...completed].sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
    completedHtml = `
      <div class="mb-6 last:mb-0">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-sm font-semibold text-slate-700">Completadas</h4>
          <div class="flex items-center gap-2">
            <input id="rf-completed-due" type="date" value="${completedDueFilter}" title="Filtrar por fecha de entrega"
                   class="rounded-lg border-0 bg-slate-50 px-2 py-1 text-xs ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
            ${completedDueFilter ? `<button id="rf-completed-clear" type="button" class="text-xs font-semibold text-indigo-600 hover:text-indigo-500">Quitar</button>` : ''}
            <span class="text-xs text-slate-400">${completed.length}</span>
          </div>
        </div>
        ${completed.length
          ? `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${completed.map((r) => resultCard(r)).join('')}</div>`
          : `<p class="text-xs text-slate-400">Sin resultados completados con esa fecha de entrega.</p>`}
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

function taskCard(t) {
  const subs = children(t);
  const subsDone = subs.filter((s) => s.status === 'completada').length;
  const st = STATUS[t.status];
  const proj = t.project_id ? data.projects.find((p) => p.id === t.project_id) : null;
  return `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${t.status === 'completada' ? 'opacity-70' : ''}">
      <div class="flex items-start gap-3">
        <button type="button" data-toggle="${t.id}" title="Completar"
                class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${t.status === 'completada' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold ${t.status === 'completada' ? 'text-slate-400 line-through' : 'text-slate-900'}">${escapeHtml(t.title)}</p>
          ${t.description ? `<p class="mt-0.5 text-xs text-slate-500">${escapeHtml(t.description)}</p>` : ''}
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" data-status="${t.id}" class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}" title="Cambiar estado">${st.label}</button>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
            ${t.due_date ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${isOverdue(t) ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}">${isOverdue(t) ? '⚠ ' : ''}${fmtDate(t.due_date)}</span>` : ''}
            ${proj ? `<span class="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">${escapeHtml(proj.name)}</span>` : ''}
            ${data.can_manage && assigneeNames(t) ? `<span class="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">${escapeHtml(assigneeNames(t))}</span>` : ''}
          </div>
        </div>
        <div class="flex shrink-0 gap-1">
          ${!t.parent_id ? `<button type="button" data-subtask="${t.id}" title="Agregar subtarea" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('plus', 'h-4 w-4')}</button>` : ''}
          ${canEdit(t) ? `
          <button type="button" data-edit="${t.id}" title="Editar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
          <button type="button" data-del="${t.id}" title="Eliminar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
        </div>
      </div>
      ${subs.length ? `
      <div class="ml-9 mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-slate-400">Subtareas ${subsDone}/${subs.length}</p>
        ${subs.map((s) => `
          <div class="flex items-center gap-2">
            <button type="button" data-toggle="${s.id}"
                    class="flex h-4.5 w-4.5 h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${s.status === 'completada' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
              <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <span class="min-w-0 flex-1 truncate text-sm ${s.status === 'completada' ? 'text-slate-400 line-through' : 'text-slate-700'}">${escapeHtml(s.title)}</span>
            ${canEdit(s) ? `<button type="button" data-del="${s.id}" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-300 hover:text-red-500">${icon('x', 'h-3.5 w-3.5')}</button>` : ''}
          </div>`).join('')}
      </div>` : ''}
    </div>`;
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
      ${field({ key: 'description', label: 'Descripción', type: 'textarea', rows: 2, span: 'sm:col-span-2' }, task?.description || '')}
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

  form.querySelector('[name="recurrence"]')?.addEventListener('change', (e) => {
    form.querySelector('#f-weekday-wrap')?.classList.toggle('hidden', e.target.value !== 'semanal');
  });

  modal({
    title: task ? 'Editar tarea' : (isSub ? 'Nueva subtarea' : 'Nueva tarea'),
    content: form,
    size: 'max-w-xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: task ? 'Guardar cambios' : 'Crear tarea', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
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
              title: v.title, description: v.description,
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
      ${field({ key: 'description', label: 'Descripción', type: 'textarea', rows: 2, span: 'sm:col-span-2' }, project?.description || '')}
      <div class="sm:col-span-2"><label class="${labelCls}">Asignar a</label>
        ${assigneeCheckboxesHtml(project?.assigned_to || [])}
      </div>
      ${field({ key: 'due_date', label: 'Fecha límite', type: 'date' }, project?.due_date || '')}
      ${field({ key: 'status', label: 'Estado', type: 'select', options: [['activo', 'Activo'], ['completado', 'Completado'], ['archivado', 'Archivado']] }, project?.status || 'activo')}
    </div>`;

  modal({
    title: project ? 'Editar proyecto' : 'Nuevo proyecto',
    content: form,
    size: 'max-w-xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: project ? 'Guardar cambios' : 'Crear proyecto', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('tasks/project_save', {
              ...(project ? { id: project.id } : {}),
              name: v.name, description: v.description, due_date: v.due_date, status: v.status,
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
