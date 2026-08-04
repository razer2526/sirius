/**
 * Módulo Catálogo de Estudios (Admin Tools): administración del catálogo que usa
 * el Cotizador (Apps > Cotizador). Aquí se listan, crean, editan y eliminan los
 * estudios, y se exporta/importa el catálogo completo en JSON o CSV.
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, spinner,
  inputCls, labelCls, debounce,
} from '../ui.js';

let filters = { q: '', category: '', page: 1 };
let listState = { items: [], total: 0, per_page: 50, categories: [] };

export async function render(root, ctx) {
  const [view] = ctx.args;
  if (view === 'importar') return renderImport(root);
  return renderList(root);
}

/* ================== Lista ================== */
async function renderList(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-6xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-bold text-slate-900">Catálogo de Estudios</h3>
          <p class="text-sm text-slate-500">Precios públicos que usa el Cotizador para armar cotizaciones.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="btn-export-json" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('download', 'h-4 w-4')} JSON
          </button>
          <button id="btn-export-csv" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('download', 'h-4 w-4')} CSV
          </button>
          <a href="#/catalogo_estudios/importar" class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            ${icon('upload', 'h-4 w-4')} Importar
          </a>
          <button id="btn-new" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('plus', 'h-4 w-4')} Nuevo estudio
          </button>
        </div>
      </div>

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="sm:col-span-2">
            <label class="${labelCls}">Buscar</label>
            <input id="f-q" type="text" placeholder="Nombre del estudio…" class="${inputCls}">
          </div>
          <div><label class="${labelCls}">Categoría</label><select id="f-category" class="${inputCls}"><option value="">Todas</option></select></div>
        </div>
      </section>

      <div id="cat-list">${spinner()}</div>
    </div>`;

  const q = root.querySelector('#f-q');
  const category = root.querySelector('#f-category');

  const load = async (resetPage = true) => {
    if (resetPage) filters.page = 1;
    filters.q = q.value.trim();
    filters.category = category.value;
    listState = await apiGet('catalog/list', filters);
    paintCategories(category);
    paintList(root.querySelector('#cat-list'), load);
  };

  q.addEventListener('input', debounce(() => load(), 300));
  category.addEventListener('change', () => load());

  root.querySelector('#btn-new').addEventListener('click', () => openStudyModal(null, load));
  root.querySelector('#btn-export-json').addEventListener('click', () => exportCatalog('json'));
  root.querySelector('#btn-export-csv').addEventListener('click', () => exportCatalog('csv'));

  await load();
}

function commissionGroupLabel(group) {
  if (group === 'molecular') return 'Biología Molecular';
  if (group === 'clinico') return 'Análisis Clínicos';
  return '—';
}

function paintCategories(sel) {
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas</option>' +
    listState.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}

function paintList(box, load) {
  const { items, total, page, per_page: perPage } = listState;
  const pages = Math.max(1, Math.ceil(total / perPage));

  if (!items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin estudios en el catálogo</p>
        <p class="mt-1 text-xs text-slate-400">Crea el primero o impórtalos desde un archivo.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Estudio</th>
              <th class="hidden px-4 py-3 sm:table-cell">Categoría</th>
              <th class="hidden px-4 py-3 lg:table-cell">Comisión</th>
              <th class="px-4 py-3 text-right">Precio público</th>
              <th class="px-4 py-3 text-center">Estado</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${items.map((it) => `
              <tr>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(it.name)}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml(it.category || '—')}</td>
                <td class="hidden px-4 py-3 text-slate-500 lg:table-cell">${escapeHtml(commissionGroupLabel(it.commission_group))}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-700">$${Number(it.public_price).toFixed(2)}</td>
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
      <span class="text-sm text-slate-500">Página ${page} de ${pages} · ${total} estudio(s)</span>
      <button id="pg-next" ${page >= pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { filters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { filters.page++; load(false); });

  box.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openStudyModal(items.find((x) => x.id === +b.dataset.edit), load)));
  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const it = items.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar estudio', `Se eliminará "${it.name}" del catálogo. Las cotizaciones ya guardadas no se ven afectadas. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('catalog/delete', { id: it.id });
        toast('Estudio eliminado');
        load(false);
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function openStudyModal(study, load) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div>
        <label class="${labelCls}">Nombre del estudio</label>
        <input type="text" id="s-name" value="${escapeHtml(study?.name || '')}" class="${inputCls}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="${labelCls}">Categoría (opcional)</label>
          <input type="text" id="s-category" list="s-cat-list" value="${escapeHtml(study?.category || '')}" class="${inputCls}">
          <datalist id="s-cat-list">${listState.categories.map((c) => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
        </div>
        <div>
          <label class="${labelCls}">Precio público</label>
          <input type="number" id="s-price" min="0" step="0.01" value="${study?.public_price ?? 0}" class="${inputCls}">
        </div>
      </div>
      <div>
        <label class="${labelCls}">Grupo de comisión (convenio médico/concierge)</label>
        <select id="s-commission-group" class="${inputCls}">
          <option value="" ${!study?.commission_group ? 'selected' : ''}>No aplica</option>
          <option value="molecular" ${study?.commission_group === 'molecular' ? 'selected' : ''}>Biología Molecular</option>
          <option value="clinico" ${study?.commission_group === 'clinico' ? 'selected' : ''}>Análisis Clínicos</option>
        </select>
      </div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="s-active" ${study ? (study.is_active ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activo (visible en el Cotizador)
      </label>
    </div>`;

  const { close } = modal({
    title: study ? 'Editar estudio' : 'Nuevo estudio',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (closeFn, btn) => {
          const name = wrap.querySelector('#s-name').value.trim();
          if (!name) { toast('Escribe el nombre del estudio', 'error'); return; }
          btn.disabled = true;
          try {
            await apiPost('catalog/save', {
              id: study?.id,
              name,
              category: wrap.querySelector('#s-category').value.trim(),
              commission_group: wrap.querySelector('#s-commission-group').value,
              public_price: parseFloat(wrap.querySelector('#s-price').value || '0'),
              is_active: wrap.querySelector('#s-active').checked,
            });
            toast(study ? 'Estudio actualizado' : 'Estudio creado');
            closeFn();
            load(false);
          } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
          }
        },
      },
    ],
  });
  void close;
}

/* ================== Exportar ================== */
async function exportCatalog(format) {
  toast('Preparando archivo…', 'info');
  const { items } = await apiGet('catalog/export_all');
  const stamp = new Date().toISOString().slice(0, 10);
  let blob, fileName;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    fileName = `catalogo-estudios-${stamp}.json`;
  } else {
    const cols = ['id', 'name', 'category', 'commission_group', 'public_price', 'is_active'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')].concat(items.map((it) => cols.map((c) => esc(it[c])).join(',')));
    blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    fileName = `catalogo-estudios-${stamp}.csv`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ================== Importar ================== */
function renderImport(root) {
  let file = null;
  let columns = [];

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/catalogo_estudios" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Importar catálogo</h3>
        <p class="text-sm text-slate-500">
          Sube el archivo JSON o CSV exportado desde tu sistema. Sirius detecta las columnas
          y te deja elegir cuál es el nombre, la categoría y el precio antes de aplicar nada.
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
      const res = await fetch('api/index.php?r=catalog/import_inspect', {
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

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label class="${labelCls}">Nombre del estudio *</label>
          <select id="map-name" class="${inputCls}"><option value="">— Elige —</option>${opts(guessColumn(['nombre', 'name', 'estudio', 'descripcion']))}</select>
        </div>
        <div>
          <label class="${labelCls}">Categoría (opcional)</label>
          <select id="map-category" class="${inputCls}"><option value="">— Ninguna —</option>${opts(guessColumn(['categoria', 'category', 'area', 'grupo']))}</select>
        </div>
        <div>
          <label class="${labelCls}">Precio público *</label>
          <select id="map-price" class="${inputCls}"><option value="">— Elige —</option>${opts(guessColumn(['precio', 'price', 'costo']))}</select>
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
            <span class="block text-xs text-slate-500">Los estudios con el mismo nombre actualizan su precio y categoría; los nuevos se agregan. Nada se borra.</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <input type="radio" name="imp-mode" value="reemplazar" class="mt-1 h-4 w-4 border-red-300 text-red-600">
          <span>
            <span class="block text-sm font-semibold text-red-900">Reemplazar todo el catálogo</span>
            <span class="block text-xs text-red-700">Borra todos los estudios actuales y deja únicamente los de este archivo.</span>
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
        public_price: box.querySelector('#map-price').value || null,
      };
      if (!mapping.name) { toast('Elige la columna del nombre del estudio', 'error'); return; }
      const mode = box.querySelector('input[name=imp-mode]:checked').value;
      mode === 'reemplazar' ? confirmReplace(file, mapping) : applyImport(file, mapping, 'agregar', '');
    });
  }

  function confirmReplace(file, mapping) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="text-sm text-slate-600">
        Se <b class="text-red-700">borrará</b> todo el catálogo actual y quedará únicamente el
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
          label: 'Reemplazar catálogo',
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
      const res = await fetch('api/index.php?r=catalog/import_apply', {
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
          Se agregaron <b>${d.inserted}</b> estudio(s) nuevo(s) y se actualizaron <b>${d.updated}</b>,
          de ${d.total} fila(s) procesadas.</p>`,
        actions: [{
          label: 'Ver catálogo', primary: true,
          onClick: (close) => { close(); location.hash = '#/catalogo_estudios'; },
        }],
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }
}
