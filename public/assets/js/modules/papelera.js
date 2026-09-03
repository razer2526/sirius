/** Módulo Papelera (Admin Tools): elementos archivados (soft-delete) por usuarios
 *  estándar al borrar tareas, proyectos, resultados o notas del pizarrón —
 *  restaurar o eliminar en definitiva. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, confirmDialog, spinner, inputCls, labelCls, fmtDateTime } from '../ui.js';

const TYPE_LABELS = { task: 'Tarea', project: 'Proyecto', result_delivery: 'Resultado', board_item: 'Pizarrón' };

let filters = { type: '', page: 1 };

export async function render(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div id="tr-counts" class="grid grid-cols-2 gap-3 sm:grid-cols-4"></div>
      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label class="${labelCls}">Tipo</label>
        <select id="f-type" class="${inputCls} sm:max-w-xs">
          <option value="">Todos</option>
          ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
      </section>
      <div id="tr-list">${spinner()}</div>
    </div>`;

  const type = root.querySelector('#f-type');
  const load = async (resetPage = true) => {
    if (resetPage) filters.page = 1;
    filters.type = type.value;
    const data = await apiGet('papelera/list', filters);
    paintCounts(root.querySelector('#tr-counts'), data.counts);
    paintList(root.querySelector('#tr-list'), data, load);
  };
  type.addEventListener('change', () => load());
  await load();
}

function paintCounts(box, counts) {
  box.innerHTML = Object.entries(TYPE_LABELS).map(([k, label]) => `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p class="text-xl font-bold text-slate-900">${counts[k] || 0}</p>
      <p class="text-xs font-medium text-slate-500">${label}</p>
    </div>`).join('');
}

function paintList(box, data, load) {
  if (!data.items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">La papelera está vacía</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Tipo</th>
              <th class="px-4 py-3">Resumen</th>
              <th class="px-4 py-3">Archivado por</th>
              <th class="px-4 py-3">Cuándo</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${data.items.map((it) => `
              <tr>
                <td class="px-4 py-2.5"><span class="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">${TYPE_LABELS[it.entity_type] || it.entity_type}</span></td>
                <td class="px-4 py-2.5 text-slate-800">${escapeHtml(it.summary)}</td>
                <td class="px-4 py-2.5 text-slate-600">${escapeHtml(it.archived_by_name || '—')}</td>
                <td class="px-4 py-2.5 text-xs text-slate-500">${fmtDateTime(it.archived_at)}</td>
                <td class="px-4 py-2.5">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-restore="${it.id}" title="Restaurar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">${icon('undo', 'h-4 w-4')}</button>
                    <button type="button" data-purge="${it.id}" title="Eliminar permanentemente" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-center gap-3">
      <button id="pg-prev" ${data.page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
      <span class="text-sm text-slate-500">Página ${data.page} de ${data.pages} · ${data.total} elemento(s)</span>
      <button id="pg-next" ${data.page >= data.pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { filters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { filters.page++; load(false); });

  box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await apiPost('papelera/restore', { id: +b.dataset.restore });
      toast('Elemento restaurado');
      load(false);
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
  box.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Eliminar permanentemente', 'Esta acción no se puede deshacer. ¿Continuar?', { danger: true, confirmLabel: 'Eliminar' });
    if (!ok) return;
    try {
      await apiPost('papelera/purge', { id: +b.dataset.purge });
      toast('Elemento eliminado permanentemente');
      load(false);
    } catch (e) { toast(e.message, 'error'); }
  }));
}
