/**
 * Módulo Plantillas de Estudios (Admin Tools).
 *
 * Una plantilla fija qué determinaciones trae un estudio y en qué orden. Los
 * valores de referencia se capturan aquí una sola vez y se reutilizan en cada
 * reporte, en vez de re-interpretar el PDF del laboratorio de referencia cada
 * ocasión (que es de donde venían las referencias incompletas o equivocadas).
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, spinner,
  inputCls, labelCls, debounce,
} from '../ui.js';

const SEX_LABELS = { A: 'Ambos', F: 'Femenino', M: 'Masculino' };

export async function render(root, ctx) {
  const [view, id] = ctx.args;
  if (view === 'nueva') return renderEditor(root, null);
  if (view && /^\d+$/.test(view)) return renderEditor(root, +view);
  return renderList(root);
}

/* ================== Lista de plantillas ================== */
async function renderList(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-bold text-slate-900">Plantillas de Estudios</h3>
          <p class="text-sm text-slate-500">
            Definen las determinaciones y los valores de referencia de cada estudio de análisis clínicos.
          </p>
        </div>
        <a href="#/plantillas_estudios/nueva"
           class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nueva plantilla
        </a>
      </div>

      <div class="relative">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
        <input id="f-q" type="text" placeholder="Buscar plantilla…" autocomplete="off"
               class="w-full rounded-xl border-0 bg-white py-2.5 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-indigo-500">
      </div>

      <div id="tpl-list">${spinner()}</div>
    </div>`;

  const q = root.querySelector('#f-q');
  const load = async () => {
    const res = await apiGet('lab_templates/studies_list', { q: q.value.trim() });
    paintList(root.querySelector('#tpl-list'), res.items, load);
  };
  q.addEventListener('input', debounce(load, 300));
  await load();
}

function paintList(box, items, reload) {
  if (!items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm text-slate-500">Todavía no hay plantillas.</p>
        <p class="mt-1 text-xs text-slate-400">
          Crea una y usa "Proponer desde PDF" para capturar de golpe las determinaciones de un estudio.
        </p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-2.5">Estudio</th>
            <th class="px-4 py-2.5 w-40">Determinaciones</th>
            <th class="px-4 py-2.5 w-24">Estado</th>
            <th class="px-4 py-2.5 w-24"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${items.map((s) => `
            <tr class="hover:bg-slate-50">
              <td class="px-4 py-2.5">
                <a href="#/plantillas_estudios/${s.id}" class="font-medium text-slate-900 hover:text-indigo-600">${escapeHtml(s.name)}</a>
              </td>
              <td class="px-4 py-2.5 text-slate-500">${s.item_count}</td>
              <td class="px-4 py-2.5">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                  ${s.is_active ? 'Activa' : 'Inactiva'}
                </span>
              </td>
              <td class="px-4 py-2.5 text-right">
                <button type="button" data-del="${s.id}" data-name="${escapeHtml(s.name)}"
                        class="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Eliminar plantilla',
        `¿Eliminar "${btn.dataset.name}"? Las determinaciones y sus rangos se conservan en el catálogo.`,
        { danger: true, confirmLabel: 'Eliminar' }
      );
      if (!ok) return;
      try {
        await apiPost('lab_templates/studies_delete', { id: +btn.dataset.del });
        toast('Plantilla eliminada');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

/* ================== Editor de plantilla ================== */
async function renderEditor(root, studyId) {
  let study = { id: 0, name: '', aliases: '', is_active: true, items: [] };
  if (studyId) {
    root.innerHTML = spinner();
    const res = await apiGet('lab_templates/studies_get', { id: studyId });
    study = res.study;
    study.is_active = !!study.is_active;
  }

  const paint = () => {
    root.innerHTML = `
      <div class="mx-auto max-w-4xl space-y-5">
        <a href="#/plantillas_estudios" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ${icon('chevron-left', 'h-4 w-4')} Volver
        </a>
        <h3 class="text-lg font-bold text-slate-900">${study.id ? 'Editar plantilla' : 'Nueva plantilla'}</h3>

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="${labelCls}">Nombre del estudio</label>
              <input id="s-name" type="text" value="${escapeHtml(study.name)}" placeholder="QUIMICA SANGUINEA DE 35 ELEMENTOS" class="${inputCls}">
            </div>
            <div class="flex items-end">
              <label class="flex cursor-pointer items-center gap-2">
                <input id="s-active" type="checkbox" ${study.is_active ? 'checked' : ''}
                       class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                <span class="text-sm font-medium text-slate-700">Activa (aparece al membretar)</span>
              </label>
            </div>
          </div>
          <div>
            <label class="${labelCls}">Nombres alternativos</label>
            <textarea id="s-aliases" rows="2" placeholder="Uno por línea. Sirve para reconocer el estudio en el PDF del laboratorio."
                      class="${inputCls}">${escapeHtml(study.aliases || '')}</textarea>
          </div>
        </section>

        <section class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">
              Determinaciones <span class="ml-1 normal-case text-slate-400">(${study.items.length})</span>
            </h4>
            <div class="flex flex-wrap gap-2">
              <label class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
                ${icon('upload', 'h-4 w-4')} <span id="pdf-label">Proponer desde PDF</span>
                <input id="s-pdf" type="file" accept="application/pdf" class="hidden">
              </label>
              <button id="btn-add" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
                ${icon('plus', 'h-4 w-4')} Agregar
              </button>
            </div>
          </div>
          <div id="items-box"></div>
        </section>

        <div class="flex justify-end gap-2">
          <button id="btn-save" type="button" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            Guardar plantilla
          </button>
        </div>
      </div>`;

    paintItems();
    wire();
  };

  const paintItems = () => {
    const box = root.querySelector('#items-box');
    if (!study.items.length) {
      box.innerHTML = `<p class="px-5 py-8 text-center text-sm text-slate-500">
        Sin determinaciones. Agrégalas una por una o propón la lista completa desde un PDF del laboratorio.</p>`;
      return;
    }
    box.innerHTML = `
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-2 w-10">#</th>
            <th class="px-4 py-2">Determinación</th>
            <th class="px-4 py-2 w-24">Unidad</th>
            <th class="px-4 py-2">Valores de referencia</th>
            <th class="px-4 py-2 w-28"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${study.items.map((it, i) => {
            const refs = (it.ranges || []).map(rangeLabel).filter(Boolean);
            return `
            <tr class="${refs.length ? '' : 'bg-red-50/50'}">
              <td class="px-4 py-2 text-slate-400">${i + 1}</td>
              <td class="px-4 py-2">
                <span class="font-medium text-slate-800">${escapeHtml(it.name)}</span>
                ${it.technique ? `<span class="block text-[11px] text-slate-400">${escapeHtml(it.technique)}</span>` : ''}
              </td>
              <td class="px-4 py-2 text-slate-500">${escapeHtml(it.unit || '—')}</td>
              <td class="px-4 py-2 text-slate-600">
                ${refs.length
                  ? refs.map((r) => `<span class="block">${escapeHtml(r)}</span>`).join('')
                  : '<span class="text-xs font-semibold text-red-600">Sin rangos — captúralos</span>'}
              </td>
              <td class="px-4 py-2 text-right">
                <button type="button" data-edit="${i}" class="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                <button type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">${icon('undo', 'h-4 w-4')}</button>
                <button type="button" data-rm="${i}" class="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      openTestModal(study.items[+b.dataset.edit], (saved) => {
        study.items[+b.dataset.edit] = saved;
        paintItems();
      });
    }));
    box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.up;
      [study.items[i - 1], study.items[i]] = [study.items[i], study.items[i - 1]];
      paintItems();
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      study.items.splice(+b.dataset.rm, 1);
      paintItems();
    }));
  };

  const addTest = (test) => {
    if (study.items.some((it) => it.id && test.id && +it.id === +test.id)) {
      toast('Esa determinación ya está en la plantilla', 'info');
      return false;
    }
    study.items.push(test);
    return true;
  };

  const wire = () => {
    root.querySelector('#s-name').addEventListener('input', (e) => { study.name = e.target.value; });
    root.querySelector('#s-aliases').addEventListener('input', (e) => { study.aliases = e.target.value; });
    root.querySelector('#s-active').addEventListener('change', (e) => { study.is_active = e.target.checked; });

    root.querySelector('#btn-add').addEventListener('click', () => {
      openTestPicker((test) => { if (addTest(test)) paintItems(); });
    });

    root.querySelector('#s-pdf').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const label = root.querySelector('#pdf-label');
      label.textContent = 'Leyendo…';
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('api/index.php?r=lab_templates/propose_from_pdf', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        openProposalModal(json.data.studies, (name, tests) => {
          if (!study.name) {
            study.name = name;
            root.querySelector('#s-name').value = name;
          }
          let added = 0;
          tests.forEach((t) => { if (addTest(t)) added++; });
          paintItems();
          toast(`${added} determinación(es) agregadas. Revisa los rangos antes de guardar.`);
        });
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        label.textContent = 'Proponer desde PDF';
        e.target.value = '';
      }
    });

    root.querySelector('#btn-save').addEventListener('click', async () => {
      if (!study.name.trim()) { toast('Escribe el nombre del estudio', 'error'); return; }
      if (!study.items.length) { toast('Agrega al menos una determinación', 'error'); return; }
      try {
        // Las determinaciones nuevas (sin id) se guardan primero: la plantilla solo
        // apunta a lab_tests, así que necesita el id antes de poder referenciarlas.
        for (const it of study.items) {
          if (!it.id) {
            const res = await apiPost('lab_templates/test_save', {
              name: it.name, unit: it.unit, technique: it.technique, ranges: it.ranges || [],
            });
            it.id = res.test.id;
          }
        }
        const res = await apiPost('lab_templates/studies_save', {
          id: study.id || undefined,
          name: study.name,
          aliases: study.aliases,
          is_active: study.is_active,
          test_ids: study.items.map((it) => it.id),
        });
        study.id = res.id;
        toast('Plantilla guardada');
        window.location.hash = '#/plantillas_estudios';
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  paint();
}

/* ================== Selector de determinación del catálogo ================== */
function openTestPicker(onPick) {
  const m = modal({
    title: 'Agregar determinación',
    size: 'max-w-2xl',
    content: `
      <div class="space-y-3">
        <input id="pick-q" type="text" placeholder="Buscar en el catálogo…" autocomplete="off" class="${inputCls}">
        <div id="pick-results" class="max-h-80 space-y-1 overflow-y-auto"></div>
        <button id="pick-new" type="button" class="w-full rounded-lg px-4 py-2 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
          Crear una determinación nueva
        </button>
      </div>`,
    actions: [{ label: 'Cerrar' }],
  });

  const results = m.el.querySelector('#pick-results');
  const search = async () => {
    const q = m.el.querySelector('#pick-q').value.trim();
    const res = await apiGet('lab_templates/tests_search', { q });
    if (!res.tests.length) {
      results.innerHTML = '<p class="py-6 text-center text-sm text-slate-500">Sin resultados en el catálogo.</p>';
      return;
    }
    results.innerHTML = res.tests.map((t, i) => {
      const refs = (t.ranges || []).map(rangeLabel).filter(Boolean).join(' · ');
      return `
        <button type="button" data-i="${i}" class="w-full rounded-lg px-3 py-2 text-left hover:bg-indigo-50">
          <span class="block text-sm font-medium text-slate-800">${escapeHtml(t.name)}${t.unit ? ` <span class="text-slate-400">(${escapeHtml(t.unit)})</span>` : ''}</span>
          <span class="block text-xs ${refs ? 'text-slate-500' : 'text-red-600 font-semibold'}">${refs ? escapeHtml(refs) : 'Sin rangos'}</span>
        </button>`;
    }).join('');
    results.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      onPick(res.tests[+b.dataset.i]);
      m.close();
    }));
  };

  m.el.querySelector('#pick-q').addEventListener('input', debounce(search, 300));
  m.el.querySelector('#pick-new').addEventListener('click', () => {
    m.close();
    openTestModal({ name: '', unit: '', technique: '', ranges: [] }, onPick);
  });
  search();
}

/* ================== Editor de una determinación y sus rangos ================== */
function openTestModal(test, onSave) {
  const draft = {
    id: test.id || null,
    name: test.name || '',
    unit: test.unit || '',
    technique: test.technique || '',
    ranges: (test.ranges || []).map((r) => ({ ...r })),
  };

  const m = modal({
    title: draft.id ? 'Editar determinación' : 'Nueva determinación',
    size: 'max-w-3xl',
    content: `
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="sm:col-span-2">
            <label class="${labelCls}">Nombre</label>
            <input id="t-name" type="text" value="${escapeHtml(draft.name)}" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Unidad</label>
            <input id="t-unit" type="text" value="${escapeHtml(draft.unit)}" class="${inputCls}">
          </div>
        </div>
        <div>
          <label class="${labelCls}">Técnica</label>
          <input id="t-tech" type="text" value="${escapeHtml(draft.technique)}" class="${inputCls}">
        </div>

        ${test.raw_reference ? `
          <details class="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <summary class="cursor-pointer text-xs font-semibold text-slate-600">Ver el texto original del laboratorio</summary>
            <pre class="mt-2 whitespace-pre-wrap text-[11px] text-slate-500">${escapeHtml(test.raw_reference)}</pre>
          </details>` : ''}

        <div>
          <div class="mb-2 flex items-center justify-between">
            <label class="${labelCls}">Valores de referencia</label>
            <button id="r-add" type="button" class="rounded-lg px-2.5 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
              Agregar rango
            </button>
          </div>
          <div id="r-box" class="space-y-2"></div>
          <p class="mt-2 text-xs text-slate-400">
            Deja mínimo o máximo vacío para "mayor a" / "menor a". Usa la condición para fases
            (folicular, lútea, posmenopáusica…) y sexo/edad para los intervalos que dependen del paciente.
          </p>
        </div>
      </div>`,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar',
        primary: true,
        onClick: (close, btn) => {
          draft.name = m.el.querySelector('#t-name').value.trim();
          draft.unit = m.el.querySelector('#t-unit').value.trim();
          draft.technique = m.el.querySelector('#t-tech').value.trim();
          if (!draft.name) { toast('La determinación necesita nombre', 'error'); return; }
          btn.disabled = true;
          apiPost('lab_templates/test_save', {
            name: draft.name, unit: draft.unit, technique: draft.technique, ranges: draft.ranges,
          })
            .then((res) => { onSave(res.test); close(); })
            .catch((e) => { toast(e.message, 'error'); btn.disabled = false; });
        },
      },
    ],
  });

  const box = m.el.querySelector('#r-box');
  const paintRanges = () => {
    if (!draft.ranges.length) {
      box.innerHTML = '<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Sin rangos: el reporte saldrá con la referencia vacía.</p>';
      return;
    }
    box.innerHTML = draft.ranges.map((r, i) => `
      <div class="grid grid-cols-12 gap-1.5 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <select data-r="${i}.sex" class="col-span-3 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-2">
          ${Object.entries(SEX_LABELS).map(([k, l]) => `<option value="${k}" ${(r.sex || 'A') === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <input data-r="${i}.age_min" type="text" value="${escapeHtml(r.age_min ?? '')}" placeholder="Edad ≥" class="col-span-3 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-2">
        <input data-r="${i}.age_max" type="text" value="${escapeHtml(r.age_max ?? '')}" placeholder="Edad ≤" class="col-span-3 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-2">
        <input data-r="${i}.condition_label" type="text" value="${escapeHtml(r.condition_label ?? '')}" placeholder="Condición" class="col-span-3 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-3">
        <input data-r="${i}.min_value" type="text" value="${escapeHtml(r.min_value ?? '')}" placeholder="Mín" class="col-span-4 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-1">
        <input data-r="${i}.max_value" type="text" value="${escapeHtml(r.max_value ?? '')}" placeholder="Máx" class="col-span-4 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-1">
        <input data-r="${i}.text_value" type="text" value="${escapeHtml(r.text_value ?? '')}" placeholder="Texto (ej. Negativo)" class="col-span-11 rounded border-0 px-2 py-1 text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-400 sm:col-span-2">
        <button type="button" data-rdel="${i}" class="col-span-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('x', 'h-4 w-4 mx-auto')}</button>
      </div>`).join('');

    box.querySelectorAll('[data-r]').forEach((el) => {
      el.addEventListener('input', () => {
        const [i, field] = el.dataset.r.split('.');
        draft.ranges[i][field] = el.value === '' ? null : el.value;
      });
      el.addEventListener('change', () => {
        const [i, field] = el.dataset.r.split('.');
        draft.ranges[i][field] = el.value === '' ? null : el.value;
      });
    });
    box.querySelectorAll('[data-rdel]').forEach((b) => b.addEventListener('click', () => {
      draft.ranges.splice(+b.dataset.rdel, 1);
      paintRanges();
    }));
  };

  m.el.querySelector('#r-add').addEventListener('click', () => {
    draft.ranges.push({ sex: 'A', age_min: null, age_max: null, condition_label: null, min_value: null, max_value: null, text_value: null, unit: null });
    paintRanges();
  });
  paintRanges();
}

/* ================== Propuesta leída de un PDF ================== */
function openProposalModal(studies, onAccept) {
  let si = 0;
  const selected = studies.map((s) => s.items.map(() => true));

  const m = modal({
    title: 'Determinaciones encontradas en el PDF',
    size: 'max-w-3xl',
    content: '<div id="prop-box"></div>',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Agregar seleccionadas',
        primary: true,
        onClick: (close) => {
          const tests = studies[si].items.filter((_, i) => selected[si][i]);
          if (!tests.length) { toast('Selecciona al menos una', 'error'); return; }
          onAccept(studies[si].name, tests);
          close();
        },
      },
    ],
  });

  const box = m.el.querySelector('#prop-box');
  const paint = () => {
    const study = studies[si];
    box.innerHTML = `
      <div class="space-y-3">
        ${studies.length > 1 ? `
          <div>
            <label class="${labelCls}">Estudio del PDF</label>
            <select id="prop-study" class="${inputCls}">
              ${studies.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${escapeHtml(s.name)} (${s.items.length})</option>`).join('')}
            </select>
          </div>` : `<p class="text-sm font-semibold text-slate-800">${escapeHtml(study.name)}</p>`}

        <p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Los rangos son una <b>propuesta</b> leída del PDF. Revísalos y corrígelos antes de guardar:
          es la única vez que hay que hacerlo para este estudio.
        </p>

        <div class="max-h-80 space-y-1 overflow-y-auto">
          ${study.items.map((it, i) => {
            const refs = (it.ranges || []).map(rangeLabel).filter(Boolean).join(' · ');
            return `
              <label class="flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 hover:bg-slate-50">
                <input type="checkbox" data-i="${i}" ${selected[si][i] ? 'checked' : ''}
                       class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-slate-800">
                    ${escapeHtml(it.name)}${it.unit ? ` <span class="text-slate-400">(${escapeHtml(it.unit)})</span>` : ''}
                    ${it.test_id ? '<span class="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">ya en catálogo</span>' : ''}
                  </span>
                  <span class="block text-xs ${refs ? 'text-slate-500' : 'font-semibold text-red-600'}">${refs ? escapeHtml(refs) : 'Sin rangos reconocidos'}</span>
                </span>
              </label>`;
          }).join('')}
        </div>
      </div>`;

    const sel = box.querySelector('#prop-study');
    if (sel) sel.addEventListener('change', () => { si = +sel.value; paint(); });
    box.querySelectorAll('[data-i]').forEach((cb) => cb.addEventListener('change', () => {
      selected[si][+cb.dataset.i] = cb.checked;
    }));
  };
  paint();
}

/* Mismo formato que usa el PDF, para que lo que se ve aquí sea lo que se imprime. */
function rangeLabel(r) {
  const fmt = (n) => String(parseFloat(n)).replace(/\.0+$/, '');
  let label = '';
  if (r.text_value) label = r.text_value;
  else if (r.min_value !== null && r.max_value !== null) label = `${fmt(r.min_value)} - ${fmt(r.max_value)}`;
  else if (r.min_value !== null) label = `Mayor a ${fmt(r.min_value)}`;
  else if (r.max_value !== null) label = `Menor a ${fmt(r.max_value)}`;
  else return '';
  return r.condition_label ? `${r.condition_label}: ${label}` : label;
}
