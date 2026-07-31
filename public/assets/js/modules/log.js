/** Módulo Log (Admin Tools): bitácora de actividad de los usuarios. */

import { apiGet } from '../api.js';
import { icon, escapeHtml, spinner, inputCls, labelCls, debounce, fmtDateTime } from '../ui.js';

/** Etiquetas legibles para las acciones que registra el sistema. */
const ACTIONS = {
  login: ['Inicio de sesión', 'bg-emerald-100 text-emerald-700'],
  login_failed: ['Intento fallido', 'bg-red-100 text-red-700'],
  logout: ['Cierre de sesión', 'bg-slate-100 text-slate-600'],
  user_create: ['Alta de usuario', 'bg-indigo-100 text-indigo-700'],
  user_update: ['Edición de usuario', 'bg-indigo-100 text-indigo-700'],
  user_delete: ['Baja de usuario', 'bg-red-100 text-red-700'],
  user_permissions: ['Cambio de permisos', 'bg-amber-100 text-amber-700'],
  episode_create: ['Admisión', 'bg-sky-100 text-sky-700'],
  patient_view: ['Consulta de expediente', 'bg-slate-100 text-slate-600'],
  patient_update: ['Edición de expediente', 'bg-amber-100 text-amber-700'],
  patient_delete: ['Baja de expediente', 'bg-red-100 text-red-700'],
  patient_print: ['Exportación de expediente', 'bg-slate-100 text-slate-600'],
  consultation_create: ['Consulta subsecuente', 'bg-sky-100 text-sky-700'],
  document_create: ['Estudio creado', 'bg-sky-100 text-sky-700'],
  document_update: ['Estudio editado', 'bg-amber-100 text-amber-700'],
  document_review: ['Estudio liberado', 'bg-emerald-100 text-emerald-700'],
  document_delete: ['Estudio eliminado', 'bg-red-100 text-red-700'],
  document_download: ['Descarga de estudio', 'bg-slate-100 text-slate-600'],
  ficha_parse: ['Lectura de ficha', 'bg-slate-100 text-slate-600'],
  lab_parse: ['Lectura de orden', 'bg-slate-100 text-slate-600'],
  lab_catalog_save: ['Catálogo actualizado', 'bg-indigo-100 text-indigo-700'],
  letterhead_save: ['Membrete configurado', 'bg-amber-100 text-amber-700'],
  letterhead_upload: ['Imagen de membrete', 'bg-amber-100 text-amber-700'],
  letterhead_remove: ['Imagen eliminada', 'bg-red-100 text-red-700'],
  project_create: ['Proyecto creado', 'bg-sky-100 text-sky-700'],
  project_update: ['Proyecto editado', 'bg-amber-100 text-amber-700'],
  project_delete: ['Proyecto eliminado', 'bg-red-100 text-red-700'],
  task_create: ['Tarea creada', 'bg-sky-100 text-sky-700'],
  task_update: ['Tarea editada', 'bg-amber-100 text-amber-700'],
  task_status: ['Cambio de estado', 'bg-slate-100 text-slate-600'],
  task_recurring_done: ['Tarea frecuente hecha', 'bg-emerald-100 text-emerald-700'],
  task_delete: ['Tarea eliminada', 'bg-red-100 text-red-700'],
  chat: ['Consulta al asistente', 'bg-violet-100 text-violet-700'],
  study_create: ['Estudio creado', 'bg-sky-100 text-sky-700'],
  study_update: ['Estudio editado', 'bg-amber-100 text-amber-700'],
  study_delete: ['Estudio eliminado', 'bg-red-100 text-red-700'],
  import_merge: ['Catálogo importado (agregar)', 'bg-indigo-100 text-indigo-700'],
  import_replace: ['Catálogo reemplazado', 'bg-red-100 text-red-700'],
  quote_create: ['Cotización creada', 'bg-sky-100 text-sky-700'],
  quote_delete: ['Cotización eliminada', 'bg-red-100 text-red-700'],
  quote_download: ['Descarga de cotización', 'bg-slate-100 text-slate-600'],
};

const MODULE_LABELS = {
  auth: 'Acceso', admision: 'Admisión', expedientes: 'Expedientes', usuarios: 'Usuarios',
  tareas: 'Tareas', apps: 'Apps', membretes: 'Membretes', assistant: 'Asistente', log: 'Log',
  catalogo_estudios: 'Catálogo de Estudios',
};

let filters = { q: '', user: '', module: '', from: '', to: '', page: 1 };

export async function render(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-6xl space-y-4">
      <div id="log-summary" class="grid grid-cols-2 gap-3 sm:grid-cols-3"></div>

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div class="lg:col-span-2">
            <label class="${labelCls}">Buscar</label>
            <input id="f-q" type="text" placeholder="Detalle, acción o usuario…" class="${inputCls}">
          </div>
          <div><label class="${labelCls}">Usuario</label><select id="f-user" class="${inputCls}"></select></div>
          <div><label class="${labelCls}">Módulo</label><select id="f-module" class="${inputCls}"></select></div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="${labelCls}">Desde</label><input id="f-from" type="date" class="${inputCls}"></div>
            <div><label class="${labelCls}">Hasta</label><input id="f-to" type="date" class="${inputCls}"></div>
          </div>
        </div>
        <div class="mt-3 flex justify-end">
          <button id="f-clear" type="button" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Limpiar filtros</button>
        </div>
      </section>

      <div id="log-list">${spinner()}</div>
    </div>`;

  const q = root.querySelector('#f-q');
  const user = root.querySelector('#f-user');
  const module = root.querySelector('#f-module');
  const from = root.querySelector('#f-from');
  const to = root.querySelector('#f-to');

  const load = async (resetPage = true) => {
    if (resetPage) filters.page = 1;
    filters.q = q.value.trim();
    filters.user = user.value;
    filters.module = module.value;
    filters.from = from.value;
    filters.to = to.value;
    const data = await apiGet('activity/list', filters);
    paintFacets(user, module, data);
    paintList(root.querySelector('#log-list'), data, load);
  };

  q.addEventListener('input', debounce(() => load(), 300));
  [user, module, from, to].forEach((el) => el.addEventListener('change', () => load()));
  root.querySelector('#f-clear').addEventListener('click', () => {
    q.value = ''; user.value = ''; module.value = ''; from.value = ''; to.value = '';
    load();
  });

  apiGet('activity/summary').then((s) => paintSummary(root.querySelector('#log-summary'), s));
  await load();
}

function paintSummary(box, s) {
  const card = (label, value, iconName, cls) => `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-center gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cls}">${icon(iconName, 'h-5 w-5')}</span>
        <div class="min-w-0">
          <p class="text-xl font-bold leading-tight text-slate-900">${escapeHtml(String(value))}</p>
          <p class="truncate text-xs font-medium text-slate-500">${label}</p>
        </div>
      </div>
    </div>`;
  box.innerHTML =
    card('Movimientos hoy', s.today, 'activity', 'bg-emerald-50 text-emerald-600') +
    card('Registros totales', s.total, 'list', 'bg-indigo-50 text-indigo-600') +
    card('Desde', s.since ? fmtDateTime(s.since) : '—', 'calendar', 'bg-slate-100 text-slate-500');
}

/** Las listas de usuarios y módulos se llenan una sola vez, conservando la selección. */
function paintFacets(userSel, moduleSel, data) {
  if (!userSel.dataset.filled) {
    userSel.innerHTML = '<option value="">Todos</option>' +
      data.users.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    moduleSel.innerHTML = '<option value="">Todos</option>' +
      data.modules.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(MODULE_LABELS[m] || m)}</option>`).join('');
    userSel.dataset.filled = '1';
    userSel.value = filters.user;
    moduleSel.value = filters.module;
  }
}

function paintList(box, data, load) {
  if (!data.entries.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin movimientos</p>
        <p class="mt-1 text-xs text-slate-400">Ajusta los filtros para ver otros registros.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3 w-44">Fecha</th>
              <th class="px-4 py-3">Usuario</th>
              <th class="hidden px-4 py-3 sm:table-cell">Módulo</th>
              <th class="px-4 py-3">Acción</th>
              <th class="px-4 py-3">Detalle</th>
              <th class="hidden px-4 py-3 lg:table-cell w-32">Origen</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${data.entries.map((e) => {
              const [label, cls] = ACTIONS[e.action] || [e.action, 'bg-slate-100 text-slate-600'];
              return `
              <tr class="${e.action === 'login_failed' ? 'bg-red-50/50' : ''}">
                <td class="px-4 py-2.5 text-xs text-slate-500">${fmtDateTime(e.created_at)}</td>
                <td class="px-4 py-2.5 font-medium text-slate-800">${escapeHtml(e.username || '—')}</td>
                <td class="hidden px-4 py-2.5 text-slate-600 sm:table-cell">${escapeHtml(MODULE_LABELS[e.module_key] || e.module_key)}</td>
                <td class="px-4 py-2.5"><span class="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}">${escapeHtml(label)}</span></td>
                <td class="px-4 py-2.5 text-slate-600">${escapeHtml(e.detail || '')}</td>
                <td class="hidden px-4 py-2.5 text-xs text-slate-400 lg:table-cell">${escapeHtml(e.ip || '')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-center gap-3">
      <button id="pg-prev" ${data.page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
      <span class="text-sm text-slate-500">Página ${data.page} de ${data.pages} · ${data.total} registro(s)</span>
      <button id="pg-next" ${data.page >= data.pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { filters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { filters.page++; load(false); });
}
