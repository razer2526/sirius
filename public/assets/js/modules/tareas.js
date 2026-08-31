/** Módulo Tareas: mis tareas (únicas y frecuentes, en una sola lista ordenada),
 *  proyectos con subtareas, monitor de equipo y seguimiento de resultados. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, formValues, inputCls, labelCls, spinner, fmtDate, debounce } from '../ui.js';

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

let ctx;
let data = null;
let tab = 'mis';
let projectFilter = null;
let resultsData = null;
// '' en 'user' significa "yo mismo"; solo un gestor puede cambiarlo a otra persona.
let misFilters = { status: '', project: '', user: '' };

export async function render(root, context) {
  ctx = context;
  // Enlaces desde fuera del módulo (p. ej. el dashboard) pueden pedir una pestaña
  // concreta, como #/tareas/resultados.
  if (context.args[0] === 'resultados') tab = 'resultados';
  root.innerHTML = spinner();
  await load(root);
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

/** Para "Mis tareas": primero fecha límite, urgencia como desempate (a diferencia de
 *  sortTasks(), que usa prioridad primero — ese orden sigue rigiendo Proyectos y Equipo). */
function sortByDueThenPriority(list) {
  return [...list].sort((a, b) => {
    const doneA = a.status === 'completada' ? 1 : 0;
    const doneB = b.status === 'completada' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    const dueA = a.due_date || '9999';
    const dueB = b.due_date || '9999';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

/** Mismo criterio de "al día" que las tarjetas de tareas frecuentes de antes. */
function sortRecurring(list) {
  return [...list].sort((a, b) => {
    const doneA = a.done_now ? 1 : 0;
    const doneB = b.done_now ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

/* ---------- vistas ---------- */
/**
 * "Mis tareas" unifica lo que antes eran dos pestañas (Mis tareas + Frecuentes) en
 * una sola lista ordenada: diarias primero, luego semanales, luego el resto por
 * fecha límite y urgencia. Un gestor puede además "ver como" a otra persona del
 * equipo con el filtro de usuario, en vez de tener que ir a la pestaña Equipo.
 */
function paintMis(view) {
  const targetUser = data.can_manage && misFilters.user ? +misFilters.user : data.me;
  let list = tasksForUser(targetUser);
  if (misFilters.status) list = list.filter((t) => t.status === misFilters.status);
  if (misFilters.project) list = list.filter((t) => t.project_id === +misFilters.project);

  const daily = sortRecurring(list.filter((t) => t.recurrence === 'diaria'));
  const weekly = sortRecurring(list.filter((t) => t.recurrence === 'semanal'));
  const rest = sortByDueThenPriority(list.filter((t) => !t.recurrence));

  const group = (title, items, render) => !items.length ? '' : `
    <div>
      <h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">${title}</h4>
      ${render(items)}
    </div>`;
  const recurringCard = (items) => `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      ${items.map((t) => recurringRowHtml(t)).join('')}
    </div>`;

  const sections = [
    group('Diarias', daily, recurringCard),
    group('Semanales', weekly, recurringCard),
    group((daily.length || weekly.length) ? 'Otras tareas' : '', rest, (items) => `<div class="space-y-2.5">${items.map((t) => taskCard(t)).join('')}</div>`),
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

/** Renglón de una tarea frecuente: la interacción es "marcar hecho hoy/esta semana",
 *  distinta del ciclo de estado pendiente → en progreso → completada de una tarea
 *  normal, así que no reutiliza taskCard(). */
function recurringRowHtml(t) {
  return `
    <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <button type="button" data-recurring="${t.id}"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${t.done_now ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium ${t.done_now ? 'text-slate-400 line-through' : 'text-slate-800'}">${escapeHtml(t.title)}</p>
        ${data.can_manage && assigneeNames(t) ? `<p class="text-xs text-slate-400">${escapeHtml(assigneeNames(t))}</p>` : ''}
      </div>
      <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
      ${canEdit(t) ? `
      <button type="button" data-edit="${t.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
      <button type="button" data-del="${t.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
    </div>`;
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
            ${data.can_manage ? `
            <div class="flex shrink-0 gap-1">
              <button type="button" data-edit-project="${p.id}" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-3.5 w-3.5')}</button>
              <button type="button" data-del-project="${p.id}" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-3.5 w-3.5')}</button>
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
  paintResultadosList(view);
}

function paintResultadosList(view) {
  const items = resultsData.items;
  view.innerHTML = items.length
    ? `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${items.map((r) => resultCard(r)).join('')}</div>`
    : emptyState('Sin resultados pendientes', 'Registra un paciente con "Nuevos resultados" para darle seguimiento.');
  wireResultEvents(view);
}

function resultCard(r) {
  const items = r.studies || [];
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const complete = total > 0 && done === total;
  const overdue = r.due_date && r.due_date < today() && !complete;
  const dueCls = complete ? 'bg-emerald-100 text-emerald-700' : overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600';
  const canEditThis = resultsData.can_manage || r.created_by === resultsData.me;
  return `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${complete ? 'opacity-70' : ''}" data-result-card="${r.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-slate-900">${escapeHtml(r.patient_name)}</p>
          ${r.sample_date ? `<p class="mt-0.5 text-xs text-slate-500">Toma: ${fmtDate(r.sample_date)}</p>` : ''}
        </div>
        <div class="flex shrink-0 gap-1">
          ${canEditThis ? `
          <button type="button" data-edit-result="${r.id}" title="Editar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-3.5 w-3.5')}</button>
          <button type="button" data-del-result="${r.id}" title="Eliminar" class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-3.5 w-3.5')}</button>` : ''}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        ${r.due_date ? `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${dueCls}">${complete ? '✓ ' : overdue ? '⚠ ' : ''}Entrega ${fmtDate(r.due_date)}</span>` : ''}
        ${r.needs_invoice ? `<span class="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">Factura</span>` : ''}
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
        paintResultadosList(view);
      });
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
        paintResultadosList(view);
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
      <div><label class="${labelCls}">Proyecto</label>
        <select name="project_id" class="${inputCls}">
          <option value="">— Sin proyecto —</option>
          ${data.projects.filter((p) => p.status === 'activo').map((p) => `<option value="${p.id}" ${(task?.project_id || presets.project_id) === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select></div>` : ''}
    </div>`;

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
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('tasks/save', {
              ...(task ? { id: task.id } : {}),
              title: v.title, description: v.description,
              assigned_to: checkedAssignees(form), priority: v.priority,
              due_date: v.due_date, recurrence: v.recurrence ?? '',
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
