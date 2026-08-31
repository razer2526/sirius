/**
 * Módulo Bases de datos (Admin Tools): agrupa en un solo lugar del sidebar los
 * catálogos y respaldos que antes vivían sueltos. Backup y Catálogo de Estudios
 * siguen siendo sus propios módulos, con su propio permiso — aquí solo se enlaza
 * a ellos (mismas pantallas, sin tocarlas). Medicamentos es nuevo: una lista
 * interna que se sube y se vuelve a subir por CSV/JSON, igual que ya funciona el
 * Catálogo de Estudios. Todavía no la usa ningún formulario del sistema.
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, spinner,
  inputCls, labelCls, debounce,
} from '../ui.js';

export async function render(root, ctx) {
  const [section] = ctx.args;
  if (section === 'medicamentos') return renderMedicamentos(root, ctx);
  return renderHub(root);
}

/* ================== Hub ================== */
function renderHub(root) {
  const cards = [
    { href: '#/backup', iconName: 'database', label: 'Backup', sub: 'Respaldos de la base de datos' },
    { href: '#/catalogo_estudios', iconName: 'flask', label: 'Catálogo de Estudios', sub: 'Precios públicos para el Cotizador' },
    { href: '#/bases_datos/medicamentos', iconName: 'clipboard', label: 'Medicamentos', sub: 'Lista interna, se sube por CSV o JSON' },
  ];
  root.innerHTML = `
    <div class="mx-auto max-w-3xl">
      <p class="mb-5 text-sm text-slate-500">Catálogos y respaldos que administra la clínica.</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${cards.map((c) => `
          <a href="${c.href}"
             class="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">
            <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">${icon(c.iconName, 'h-7 w-7')}</span>
            <div>
              <p class="text-base font-semibold text-slate-900">${c.label}</p>
              <p class="text-sm text-slate-500">${c.sub}</p>
            </div>
            <span class="ml-auto text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </a>`).join('')}
      </div>
    </div>`;
}

/* ================== Medicamentos ================== */
let filters = { q: '', page: 1 };
let listState = { items: [], total: 0, per_page: 50 };
let selected = new Set();

function renderMedicamentos(root, ctx) {
  const [, sub] = ctx.args;
  if (sub === 'importar') return renderImport(root);
  return renderList(root);
}

async function renderList(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <a href="#/bases_datos" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Bases de datos
      </a>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-bold text-slate-900">Medicamentos</h3>
          <p class="text-sm text-slate-500">Lista interna. Todavía no la usa ningún formulario del sistema.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="#/bases_datos/medicamentos/importar" class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('upload', 'h-4 w-4')} Importar
          </a>
          <button id="btn-delete-all" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">
            ${icon('trash', 'h-4 w-4')} Eliminar todo
          </button>
          <button id="btn-new" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('plus', 'h-4 w-4')} Nuevo medicamento
          </button>
        </div>
      </div>

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label class="${labelCls}">Buscar</label>
        <input id="f-q" type="text" placeholder="Nombre del medicamento…" class="${inputCls}">
      </section>

      <div id="med-list">${spinner()}</div>
    </div>`;

  const q = root.querySelector('#f-q');
  const load = async (resetPage = true) => {
    if (resetPage) filters.page = 1;
    filters.q = q.value.trim();
    listState = await apiGet('medications/list', filters);
    paintList(root.querySelector('#med-list'), load);
  };

  q.addEventListener('input', debounce(() => load(), 300));
  root.querySelector('#btn-new').addEventListener('click', () => openMedModal(null, load));
  root.querySelector('#btn-delete-all').addEventListener('click', () => confirmDeleteAll(load));

  selected.clear();
  await load();
}

function confirmDeleteAll(load) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p class="text-sm text-slate-600">
      Se <b class="text-red-700">eliminarán todos</b> los medicamentos de la lista, sin importar los
      filtros activos. Esta acción no se puede deshacer.
    </p>
    <label class="${labelCls} mt-4">Escribe ELIMINAR para confirmar</label>
    <input type="text" id="confirm-word" autocomplete="off" class="${inputCls}" placeholder="ELIMINAR">`;

  modal({
    title: 'Eliminar toda la lista',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Eliminar todo',
        danger: true,
        onClick: async (close, btn) => {
          const word = wrap.querySelector('#confirm-word').value.trim().toUpperCase();
          if (word !== 'ELIMINAR') { toast('Escribe ELIMINAR para confirmar', 'error'); return; }
          btn.disabled = true;
          try {
            const { deleted } = await apiPost('medications/delete_all', { confirm: 'ELIMINAR' });
            toast(`${deleted} medicamento(s) eliminado(s)`);
            close();
            selected.clear();
            load();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function paintList(box, load) {
  const { items, total, page, per_page: perPage } = listState;
  const pages = Math.max(1, Math.ceil(total / perPage));

  if (!items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin medicamentos en la lista</p>
        <p class="mt-1 text-xs text-slate-400">Crea el primero o impórtalos desde un archivo.</p>
      </div>`;
    return;
  }

  const selectedHere = items.filter((it) => selected.has(it.id)).length;
  const allHereSelected = selectedHere === items.length;

  box.innerHTML = `
    ${selected.size ? `
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 ring-1 ring-indigo-200">
      <span class="text-sm font-semibold text-indigo-700">${selected.size} medicamento(s) seleccionado(s)</span>
      <div class="flex gap-2">
        <button id="btn-clear-selection" type="button" class="text-sm font-semibold text-indigo-600 hover:text-indigo-500">Quitar selección</button>
        <button id="btn-delete-selected" type="button" class="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500">
          ${icon('trash', 'h-4 w-4')} Eliminar seleccionados
        </button>
      </div>
    </div>` : ''}
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="w-10 px-4 py-3">
                <input type="checkbox" id="sel-all" ${allHereSelected ? 'checked' : ''}
                       class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
              </th>
              <th class="px-4 py-3">Medicamento</th>
              <th class="hidden px-4 py-3 sm:table-cell">Categoría</th>
              <th class="px-4 py-3 text-center">Estado</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${items.map((it) => `
              <tr class="${selected.has(it.id) ? 'bg-indigo-50/50' : ''}">
                <td class="px-4 py-3">
                  <input type="checkbox" data-sel="${it.id}" ${selected.has(it.id) ? 'checked' : ''}
                         class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                </td>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(it.name)}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml(it.category || '—')}</td>
                <td class="px-4 py-3 text-center">
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${it.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                    ${it.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-edit="${it.id}" title="Editar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    <button type="button" data-del="${it.id}" title="Eliminar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-center gap-3">
      <button id="pg-prev" ${page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
      <span class="text-sm text-slate-500">Página ${page} de ${pages} · ${total} medicamento(s)</span>
      <button id="pg-next" ${page >= pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { filters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { filters.page++; load(false); });

  box.querySelector('#sel-all')?.addEventListener('change', (e) => {
    if (e.target.checked) items.forEach((it) => selected.add(it.id));
    else items.forEach((it) => selected.delete(it.id));
    paintList(box, load);
  });
  box.querySelectorAll('[data-sel]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const id = +cb.dataset.sel;
      cb.checked ? selected.add(id) : selected.delete(id);
      paintList(box, load);
    }));
  box.querySelector('#btn-clear-selection')?.addEventListener('click', () => { selected.clear(); paintList(box, load); });
  box.querySelector('#btn-delete-selected')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Eliminar medicamentos seleccionados',
      `Se eliminarán ${selected.size} medicamento(s) de la lista. ¿Continuar?`,
      { danger: true, confirmLabel: 'Eliminar' }
    );
    if (!ok) return;
    try {
      const { deleted } = await apiPost('medications/delete_bulk', { ids: [...selected] });
      toast(`${deleted} medicamento(s) eliminado(s)`);
      selected.clear();
      load(false);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openMedModal(items.find((x) => x.id === +b.dataset.edit), load)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const it = items.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar medicamento', `Se eliminará "${it.name}" de la lista. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('medications/delete', { id: it.id });
        toast('Medicamento eliminado');
        selected.delete(it.id);
        load(false);
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function openMedModal(med, load) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div>
        <label class="${labelCls}">Nombre del medicamento</label>
        <input type="text" id="m-name" value="${escapeHtml(med?.name || '')}" class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Categoría (opcional)</label>
        <input type="text" id="m-category" value="${escapeHtml(med?.category || '')}" class="${inputCls}">
      </div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="m-active" ${med ? (med.is_active ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activo
      </label>
    </div>`;

  modal({
    title: med ? 'Editar medicamento' : 'Nuevo medicamento',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          const name = wrap.querySelector('#m-name').value.trim();
          if (!name) { toast('Escribe el nombre del medicamento', 'error'); return; }
          btn.disabled = true;
          try {
            await apiPost('medications/save', {
              id: med?.id,
              name,
              category: wrap.querySelector('#m-category').value.trim(),
              is_active: wrap.querySelector('#m-active').checked,
            });
            toast(med ? 'Medicamento actualizado' : 'Medicamento creado');
            close();
            load(false);
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
}

/* ================== Importar ================== */
function renderImport(root) {
  let file = null;
  let columns = [];

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/bases_datos/medicamentos" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Importar medicamentos</h3>
        <p class="text-sm text-slate-500">
          Sube un archivo JSON o CSV. Sirius detecta las columnas y te deja elegir cuál es el
          nombre (y, si trae, la categoría) antes de aplicar nada.
        </p>
      </div>

      <section class="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
        <span class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">${icon('upload', 'h-6 w-6')}</span>
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
          ${icon('upload', 'h-4 w-4')} <span id="imp-label">Seleccionar archivo (.json o .csv)</span>
          <input type="file" id="imp-file" accept=".json,.csv,application/json,text/csv" class="hidden">
        </label>
      </section>

      <section id="imp-detail" class="hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"></section>
    </div>`;

  root.querySelector('#imp-file').addEventListener('change', async (e) => {
    file = e.target.files[0];
    if (!file) return;
    root.querySelector('#imp-label').textContent = 'Analizando…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=medications/import_inspect', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      columns = json.data.columns;
      root.querySelector('#imp-label').textContent = file.name;
      paintMapping(root, file, json.data);
    } catch (err) {
      root.querySelector('#imp-label').textContent = 'Seleccionar archivo (.json o .csv)';
      toast(err.message, 'error');
    }
  });

  function guessColumn(cands) {
    return columns.find((c) => cands.some((k) => c.toLowerCase().includes(k))) || '';
  }

  function paintMapping(root, file, d) {
    const box = root.querySelector('#imp-detail');
    box.classList.remove('hidden');
    const opts = (selected) => columns.map((c) => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    box.innerHTML = `
      <h4 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Columnas detectadas</h4>
      <p class="mb-4 text-xs text-slate-400">${escapeHtml(file.name)} · ${d.total} fila(s) encontradas</p>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label class="${labelCls}">Nombre del medicamento *</label>
          <select id="map-name" class="${inputCls}"><option value="">— Elige —</option>${opts(guessColumn(['nombre', 'name', 'medicamento', 'descripcion']))}</select>
        </div>
        <div>
          <label class="${labelCls}">Categoría (opcional)</label>
          <select id="map-category" class="${inputCls}"><option value="">— Ninguna —</option>${opts(guessColumn(['categoria', 'category', 'grupo', 'presentacion']))}</select>
        </div>
      </div>

      <div class="mt-4 overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 font-semibold text-slate-500">
            <tr>${columns.map((c) => `<th class="px-3 py-2">${escapeHtml(c)}</th>`).join('')}</tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${d.sample.map((row) => `<tr>${columns.map((c) => `<td class="px-3 py-2 text-slate-600">${escapeHtml(row[c] ?? '')}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="mt-5 space-y-3">
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <input type="radio" name="imp-mode" value="agregar" checked class="mt-1 h-4 w-4 border-slate-300 text-indigo-600">
          <span>
            <span class="block text-sm font-semibold text-slate-800">Agregar y actualizar</span>
            <span class="block text-xs text-slate-500">Los medicamentos con el mismo nombre actualizan su categoría; los nuevos se agregan. Nada se borra.</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <input type="radio" name="imp-mode" value="reemplazar" class="mt-1 h-4 w-4 border-red-300 text-red-600">
          <span>
            <span class="block text-sm font-semibold text-red-900">Reemplazar toda la lista</span>
            <span class="block text-xs text-red-700">Borra todos los medicamentos actuales y deja únicamente los de este archivo.</span>
          </span>
        </label>
      </div>

      <div class="mt-5 flex justify-end">
        <button id="btn-apply" type="button" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          Importar
        </button>
      </div>`;

    box.querySelector('#btn-apply').addEventListener('click', () => {
      const mapping = {
        name: box.querySelector('#map-name').value,
        category: box.querySelector('#map-category').value || null,
      };
      if (!mapping.name) { toast('Elige la columna del nombre del medicamento', 'error'); return; }
      const mode = box.querySelector('input[name=imp-mode]:checked').value;
      mode === 'reemplazar' ? confirmReplace(file, mapping) : applyImport(file, mapping, 'agregar', '');
    });
  }

  function confirmReplace(file, mapping) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="text-sm text-slate-600">
        Se <b class="text-red-700">borrará</b> toda la lista actual y quedará únicamente el
        contenido de este archivo. Esta acción no se puede deshacer.
      </p>
      <label class="${labelCls} mt-4">Escribe REEMPLAZAR para confirmar</label>
      <input type="text" id="confirm-word" autocomplete="off" class="${inputCls}" placeholder="REEMPLAZAR">`;

    modal({
      title: 'Confirmar reemplazo',
      content: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Reemplazar lista',
          danger: true,
          onClick: (close, btn) => {
            const word = wrap.querySelector('#confirm-word').value.trim().toUpperCase();
            if (word !== 'REEMPLAZAR') { toast('Escribe REEMPLAZAR para confirmar', 'error'); return; }
            btn.disabled = true;
            close();
            applyImport(file, mapping, 'reemplazar', 'REEMPLAZAR');
          },
        },
      ],
    });
  }

  async function applyImport(file, mapping, mode, confirmWord) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mapping', JSON.stringify(mapping));
    fd.append('mode', mode);
    if (confirmWord) fd.append('confirm', confirmWord);
    toast('Importando…', 'info');
    try {
      const res = await fetch('api/index.php?r=medications/import_apply', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const d = json.data;
      modal({
        title: 'Importación completada',
        content: `<p class="text-sm text-slate-600">
          Se agregaron <b>${d.inserted}</b> medicamento(s) nuevo(s) y se actualizaron <b>${d.updated}</b>,
          de ${d.total} fila(s) procesadas.</p>`,
        actions: [{
          label: 'Ver lista', primary: true,
          onClick: (close) => { close(); location.hash = '#/bases_datos/medicamentos'; },
        }],
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }
}
