/** Módulo Tareas: mis tareas, frecuentes, proyectos con subtareas y monitor de equipo. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, formValues, inputCls, labelCls, spinner, fmtDate } from '../ui.js';

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
    ['frecuentes', 'Frecuentes', 'repeat'],
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
  else if (tab === 'frecuentes') paintFrecuentes(view);
  else if (tab === 'proyectos') paintProyectos(view);
  else if (tab === 'resultados') paintResultados(view);
  else paintEquipo(view);
}

/* ---------- helpers de datos ---------- */
const children = (t) => data.tasks.filter((x) => x.parent_id === t.id);
const isMine = (t) => t.assigned_to === data.me || t.created_by === data.me;
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

/* ---------- vistas ---------- */
function paintMis(view) {
  const list = sortTasks(data.tasks.filter((t) => !t.parent_id && !t.recurrence && isMine(t)));
  view.innerHTML = list.length
    ? `<div class="space-y-2.5">${list.map((t) => taskCard(t)).join('')}</div>`
    : emptyState('Sin tareas pendientes', 'Crea una tarea o espera a que te asignen una.');
  wireTaskEvents(view);
}

function paintFrecuentes(view) {
  const list = data.tasks.filter((t) => t.recurrence && (data.can_manage ? true : isMine(t)));
  const grupos = [['diaria', 'Diarias'], ['semanal', 'Semanales']]
    .map(([key, label]) => {
      const items = list.filter((t) => t.recurrence === key);
      if (!items.length) return '';
      return `
        <div>
          <h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">${label}</h4>
          <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            ${items.map((t) => `
              <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                <button type="button" data-recurring="${t.id}"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${t.done_now ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}">
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium ${t.done_now ? 'text-slate-400 line-through' : 'text-slate-800'}">${escapeHtml(t.title)}</p>
                  ${data.can_manage && t.assigned_name ? `<p class="text-xs text-slate-400">${escapeHtml(t.assigned_name)}</p>` : ''}
                </div>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
                ${canEdit(t) ? `
                <button type="button" data-edit="${t.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                <button type="button" data-del="${t.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');
  view.innerHTML = grupos || emptyState('Sin tareas frecuentes', 'Crea una tarea y márcala como diaria o semanal.');
  wireTaskEvents(view);
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
    const list = sortTasks(data.tasks.filter((t) => !t.parent_id && !t.recurrence && t.assigned_to === g.id));
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

function openResultModal(item) {
  const form = document.createElement('form');
  const studies = item ? item.studies.map((s) => ({ ...s })) : [];
  form.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="${labelCls}">Nombre del paciente *</label>
        <input type="text" name="patient_name" required value="${escapeHtml(item?.patient_name || '')}" class="${inputCls}">
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
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="needs_invoice" value="1" ${item?.needs_invoice ? 'checked' : ''}
               class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Enviarle factura
      </label>
    </div>`;

  const studiesBox = form.querySelector('#result-studies');
  const renderStudies = () => {
    studiesBox.innerHTML = studies.length ? studies.map((s, idx) => `
      <div class="flex items-center gap-2">
        <input type="checkbox" data-s-done="${idx}" ${s.done ? 'checked' : ''} class="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        <input type="text" data-s-text="${idx}" value="${escapeHtml(s.text)}" placeholder="Estudio…" class="${inputCls} flex-1">
        <button type="button" data-s-rm="${idx}" class="shrink-0 text-slate-300 hover:text-red-500">${icon('x', 'h-4 w-4')}</button>
      </div>`).join('') : `<p class="text-xs text-slate-400">Sin estudios agregados.</p>`;
    studiesBox.querySelectorAll('[data-s-done]').forEach((cb) => cb.addEventListener('change', () => { studies[+cb.dataset.sDone].done = cb.checked; }));
    studiesBox.querySelectorAll('[data-s-text]').forEach((inp) => inp.addEventListener('input', () => { studies[+inp.dataset.sText].text = inp.value; }));
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
              needs_invoice: v.needs_invoice, studies,
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
            ${data.can_manage && t.assigned_name ? `<span class="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">${escapeHtml(t.assigned_name)}</span>` : ''}
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
function openTaskModal(task, presets) {
  const isSub = !!(task?.parent_id || presets.parent_id);
  const parentId = task?.parent_id || presets.parent_id || '';
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'title', label: isSub ? 'Subtarea' : 'Título', type: 'text', required: true, span: 'sm:col-span-2' }, task?.title || '')}
      ${field({ key: 'description', label: 'Descripción', type: 'textarea', rows: 2, span: 'sm:col-span-2' }, task?.description || '')}
      ${data.can_manage ? `
      <div><label class="${labelCls}">Asignar a</label>
        <select name="assigned_to" class="${inputCls}">
          <option value="">— Sin asignar —</option>
          ${data.users.map((u) => `<option value="${u.id}" ${task?.assigned_to === u.id ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`).join('')}
        </select></div>` : ''}
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
              assigned_to: v.assigned_to ?? '', priority: v.priority,
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
            await apiPost('tasks/project_save', { ...(project ? { id: project.id } : {}), ...v });
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
