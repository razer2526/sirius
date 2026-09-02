/**
 * Módulo Vinculación (Admin Tools): catálogo de médicos con convenio y de
 * concierge/representantes, más las tasas globales de comisión del médico por
 * grupo de estudio. El dropdown de "Médico tratante" en Admisión de laboratorio
 * y el cálculo de Apps > Comisiones leen de estas mismas tablas.
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, spinner,
  inputCls, labelCls, debounce,
} from '../ui.js';

let doctorFilter = { q: '' };
let doctors = [];
let concierge = [];

export async function render(root, ctx) {
  const [view] = ctx.args;
  if (view === 'concierge') return renderConcierge(root);
  return renderDoctors(root);
}

function tabsHtml(active) {
  const tab = (key, label, href) => `
    <a href="${href}" class="rounded-lg px-3 py-1.5 text-sm font-semibold ${active === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label}</a>`;
  return `<div class="flex gap-1 rounded-xl bg-slate-100 p-1">
    ${tab('doctors', 'Médicos', '#/vinculacion')}
    ${tab('concierge', 'Concierge / Representantes', '#/vinculacion/concierge')}
  </div>`;
}

/* ================== Médicos ================== */
async function renderDoctors(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div>
        <h3 class="text-lg font-bold text-slate-900">Vinculación</h3>
        <p class="text-sm text-slate-500">Médicos con convenio y concierge/representantes, para el cálculo automático de comisiones.</p>
      </div>
      ${tabsHtml('doctors')}

      <section id="rates-box" class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">${spinner()}</section>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="max-w-xs flex-1">
          <input id="f-q" type="text" placeholder="Buscar médico…" class="${inputCls}">
        </div>
        <button id="btn-new" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo médico
        </button>
      </div>

      <div id="doc-list">${spinner()}</div>
    </div>`;

  await loadRates(root.querySelector('#rates-box'));

  const q = root.querySelector('#f-q');
  const load = async () => {
    doctorFilter.q = q.value.trim();
    const { items } = await apiGet('vinculacion/doctors_list', doctorFilter);
    doctors = items;
    paintDoctors(root.querySelector('#doc-list'), load);
  };
  q.addEventListener('input', debounce(() => load(), 300));
  root.querySelector('#btn-new').addEventListener('click', () => openDoctorModal(null, load));

  await load();
}

async function loadRates(box) {
  const { rates } = await apiGet('vinculacion/settings_get');
  box.innerHTML = `
    <h4 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Tasas de comisión del médico</h4>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
      <div>
        <label class="${labelCls}">Biología Molecular (%)</label>
        <input id="rate-molecular" type="number" min="0" max="100" step="0.1" value="${rates.molecular}" class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Análisis Clínicos (%)</label>
        <input id="rate-clinico" type="number" min="0" max="100" step="0.1" value="${rates.clinico}" class="${inputCls}">
      </div>
      <button id="btn-save-rates" type="button" class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Guardar tasas</button>
    </div>
    <p class="mt-2 text-xs text-slate-400">Aplican a todos los médicos con convenio; el % del concierge se define por persona más abajo.</p>`;

  box.querySelector('#btn-save-rates').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiPost('vinculacion/settings_save', {
        commission_rate_molecular: parseFloat(box.querySelector('#rate-molecular').value || '0'),
        commission_rate_clinico: parseFloat(box.querySelector('#rate-clinico').value || '0'),
      });
      toast('Tasas actualizadas');
    } catch (e2) {
      toast(e2.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function paintDoctors(box, load) {
  if (!doctors.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin médicos registrados</p>
        <p class="mt-1 text-xs text-slate-400">Da de alta al primer médico con convenio.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Médico</th>
              <th class="hidden px-4 py-3 sm:table-cell">Contacto</th>
              <th class="hidden px-4 py-3 sm:table-cell">Concierge</th>
              <th class="px-4 py-3 text-center">Estado</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${doctors.map((d) => `
              <tr>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(d.name)}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml([d.phone, d.email].filter(Boolean).join(' · ') || '—')}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml(d.concierge_name || '—')}</td>
                <td class="px-4 py-3 text-center">
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${d.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                    ${d.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-edit="${d.id}" title="Editar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    <button type="button" data-del="${d.id}" title="Eliminar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openDoctorModal(doctors.find((x) => x.id === +b.dataset.edit), load)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const d = doctors.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar médico', `Se eliminará "${d.name}" de Vinculación. Las admisiones ya registradas conservan su historial. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('vinculacion/doctors_delete', { id: d.id });
        toast('Médico eliminado');
        load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

async function openDoctorModal(doctor, load) {
  const { items: conciergeOpts } = await apiGet('vinculacion/concierge_list', { only_active: 1 });
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div>
        <label class="${labelCls}">Nombre del médico</label>
        <input type="text" id="d-name" value="${escapeHtml(doctor?.name || '')}" class="${inputCls}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${labelCls}">Teléfono</label><input type="text" id="d-phone" value="${escapeHtml(doctor?.phone || '')}" class="${inputCls}"></div>
        <div><label class="${labelCls}">Email</label><input type="email" id="d-email" value="${escapeHtml(doctor?.email || '')}" class="${inputCls}"></div>
      </div>
      <div>
        <label class="${labelCls}">ID de vinculación (opcional)</label>
        <input type="text" id="d-linking-code" value="${escapeHtml(doctor?.linking_code || '')}" placeholder="p. ej. BPM202512A3" class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Concierge que lo trajo (opcional)</label>
        <select id="d-concierge" class="${inputCls}">
          <option value="">— Ninguno —</option>
          ${conciergeOpts.map((c) => `<option value="${c.id}" ${doctor?.concierge_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="d-active" ${doctor ? (doctor.is_active ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activo (aparece en el dropdown de Admisión)
      </label>
    </div>`;

  modal({
    title: doctor ? 'Editar médico' : 'Nuevo médico',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          const name = wrap.querySelector('#d-name').value.trim();
          if (!name) { toast('Escribe el nombre del médico', 'error'); return; }
          btn.disabled = true;
          try {
            await apiPost('vinculacion/doctors_save', {
              id: doctor?.id,
              name,
              phone: wrap.querySelector('#d-phone').value.trim(),
              email: wrap.querySelector('#d-email').value.trim(),
              linking_code: wrap.querySelector('#d-linking-code').value.trim(),
              concierge_id: wrap.querySelector('#d-concierge').value || null,
              is_active: wrap.querySelector('#d-active').checked,
            });
            toast(doctor ? 'Médico actualizado' : 'Médico creado');
            close();
            load();
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
}

/* ================== Concierge / Representantes ================== */
async function renderConcierge(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div>
        <h3 class="text-lg font-bold text-slate-900">Vinculación</h3>
        <p class="text-sm text-slate-500">Médicos con convenio y concierge/representantes, para el cálculo automático de comisiones.</p>
      </div>
      ${tabsHtml('concierge')}

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-slate-500">El % de cada concierge se calcula sobre el mismo monto cobrado que la comisión del médico, de forma independiente.</p>
        <button id="btn-new" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo concierge
        </button>
      </div>

      <div id="con-list">${spinner()}</div>
    </div>`;

  const load = async () => {
    const { items } = await apiGet('vinculacion/concierge_list');
    concierge = items;
    paintConcierge(root.querySelector('#con-list'), load);
  };
  root.querySelector('#btn-new').addEventListener('click', () => openConciergeModal(null, load));

  await load();
}

function paintConcierge(box, load) {
  if (!concierge.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin concierge registrados</p>
        <p class="mt-1 text-xs text-slate-400">Da de alta al primer concierge o representante.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Concierge</th>
              <th class="hidden px-4 py-3 sm:table-cell">Contacto</th>
              <th class="px-4 py-3 text-right">% Comisión</th>
              <th class="px-4 py-3 text-center">Estado</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${concierge.map((c) => `
              <tr>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(c.name)}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml([c.phone, c.email].filter(Boolean).join(' · ') || '—')}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-700">${Number(c.commission_pct).toFixed(1)}%</td>
                <td class="px-4 py-3 text-center">
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                    ${c.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-edit="${c.id}" title="Editar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    <button type="button" data-del="${c.id}" title="Eliminar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openConciergeModal(concierge.find((x) => x.id === +b.dataset.edit), load)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = concierge.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar concierge', `Se eliminará "${c.name}". Los médicos que tenía asociados quedarán sin concierge. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('vinculacion/concierge_delete', { id: c.id });
        toast('Concierge eliminado');
        load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function openConciergeModal(person, load) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div>
        <label class="${labelCls}">Nombre</label>
        <input type="text" id="c-name" value="${escapeHtml(person?.name || '')}" class="${inputCls}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${labelCls}">Teléfono</label><input type="text" id="c-phone" value="${escapeHtml(person?.phone || '')}" class="${inputCls}"></div>
        <div><label class="${labelCls}">Email</label><input type="email" id="c-email" value="${escapeHtml(person?.email || '')}" class="${inputCls}"></div>
      </div>
      <div>
        <label class="${labelCls}">% de comisión</label>
        <input type="number" id="c-pct" min="0" max="100" step="0.1" value="${person?.commission_pct ?? 10}" class="${inputCls}">
      </div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="c-active" ${person ? (person.is_active ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activo (disponible para asociar a médicos)
      </label>
    </div>`;

  modal({
    title: person ? 'Editar concierge' : 'Nuevo concierge',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          const name = wrap.querySelector('#c-name').value.trim();
          if (!name) { toast('Escribe el nombre', 'error'); return; }
          btn.disabled = true;
          try {
            await apiPost('vinculacion/concierge_save', {
              id: person?.id,
              name,
              phone: wrap.querySelector('#c-phone').value.trim(),
              email: wrap.querySelector('#c-email').value.trim(),
              commission_pct: parseFloat(wrap.querySelector('#c-pct').value || '0'),
              is_active: wrap.querySelector('#c-active').checked,
            });
            toast(person ? 'Concierge actualizado' : 'Concierge creado');
            close();
            load();
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
}
