/**
 * Asistente "Crear plantilla" del Membretador (análisis clínicos).
 *
 * Pregunta el nombre del estudio, la técnica y sus determinaciones con sus valores de referencia, y
 * guarda una plantilla igual a las de Admin Tools › Plantillas de Estudios (labs/template_create), así
 * que el reporte sale con el formato de siempre. Las determinaciones que ya están en el catálogo se
 * pueden agregar tal cual (sus referencias no se modifican desde aquí).
 */

import { apiGet, apiPost } from './api.js';
import { icon, escapeHtml, toast, spinner, inputCls, labelCls, debounce } from './ui.js';

const SEX_LABELS = { A: 'Ambos sexos', F: 'Femenino', M: 'Masculino' };

const newRange = () => ({ sex: 'A', age_min: '', age_max: '', min_value: '', max_value: '', text_value: '', condition_label: '' });
const newTest = () => ({ kind: 'new', name: '', unit: '', technique: '', ranges: [newRange()] });

/** Texto corto de una referencia ya guardada (para determinaciones del catálogo). */
function refText(r) {
  const parts = [];
  parts.push(SEX_LABELS[r.sex] || 'Ambos sexos');
  if (r.age_min !== null && r.age_min !== '' && r.age_min !== undefined || r.age_max !== null && r.age_max !== '' && r.age_max !== undefined) {
    parts.push(`${r.age_min ?? 0}–${r.age_max ?? '+'} años`);
  }
  if (r.condition_label) parts.push(r.condition_label);
  const val = r.text_value
    ? r.text_value
    : [r.min_value, r.max_value].every((v) => v !== null && v !== undefined && v !== '')
      ? `${+r.min_value} – ${+r.max_value}`
      : r.min_value !== null && r.min_value !== undefined && r.min_value !== '' ? `≥ ${+r.min_value}`
        : r.max_value !== null && r.max_value !== undefined && r.max_value !== '' ? `≤ ${+r.max_value}` : '';
  return `${parts.join(' · ')}: ${val}`;
}

/** "Ambos sexos" también se muestra a mujeres y hombres: mezclarlo con una fila por sexo duplica la referencia. */
function sexWarning(t) {
  const sexes = new Set(t.ranges.filter((r) => r.min_value !== '' || r.max_value !== '' || r.text_value !== '').map((r) => r.sex));
  return sexes.has('A') && (sexes.has('F') || sexes.has('M'))
    ? '«Ambos sexos» se muestra también a mujeres y a hombres. Si los valores cambian por sexo, usa una fila para Femenino y otra para Masculino, sin «Ambos sexos».'
    : '';
}

/**
 * @param {HTMLElement} root
 * @param {{backHref:string, onDone:(res:{id:number,name:string,reused:string[]})=>void}} opts
 */
export function renderTemplateWizard(root, { backHref, onDone }) {
  const state = { name: '', technique: '', items: [newTest()] };
  let saving = false;

  const rangeRowHtml = (i, j, r) => `
    <div class="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-12" data-range-row>
      <div class="col-span-2 sm:col-span-3">
        <label class="${labelCls}">Aplica a</label>
        <select data-t="${i}" data-r="${j}" data-f="sex" class="${inputCls}">
          ${Object.entries(SEX_LABELS).map(([k, l]) => `<option value="${k}" ${r.sex === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="sm:col-span-2">
        <label class="${labelCls}">Edad desde</label>
        <input type="number" step="any" min="0" data-t="${i}" data-r="${j}" data-f="age_min" value="${escapeHtml(r.age_min)}" placeholder="años" class="${inputCls}">
      </div>
      <div class="sm:col-span-2">
        <label class="${labelCls}">Edad hasta</label>
        <input type="number" step="any" min="0" data-t="${i}" data-r="${j}" data-f="age_max" value="${escapeHtml(r.age_max)}" placeholder="años" class="${inputCls}">
      </div>
      <div class="sm:col-span-2">
        <label class="${labelCls}">Mínimo</label>
        <input type="number" step="any" data-t="${i}" data-r="${j}" data-f="min_value" value="${escapeHtml(r.min_value)}" class="${inputCls}">
      </div>
      <div class="sm:col-span-2">
        <label class="${labelCls}">Máximo</label>
        <input type="number" step="any" data-t="${i}" data-r="${j}" data-f="max_value" value="${escapeHtml(r.max_value)}" class="${inputCls}">
      </div>
      <div class="col-span-2 flex items-end justify-end sm:col-span-1">
        <button type="button" data-del-range="${i}:${j}" class="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar referencia">${icon('trash', 'h-4 w-4')}</button>
      </div>
      <div class="col-span-2 sm:col-span-6">
        <label class="${labelCls}">O un texto en vez de números</label>
        <input type="text" maxlength="120" data-t="${i}" data-r="${j}" data-f="text_value" value="${escapeHtml(r.text_value)}" placeholder="Ej. Negativo, No reactivo" class="${inputCls}">
      </div>
      <div class="col-span-2 sm:col-span-6">
        <label class="${labelCls}">Condición (opcional)</label>
        <input type="text" maxlength="80" data-t="${i}" data-r="${j}" data-f="condition_label" value="${escapeHtml(r.condition_label)}" placeholder="Ej. Embarazo, ayuno" class="${inputCls}">
      </div>
    </div>`;

  const testCardHtml = (t, i) => {
    const controls = `
      <div class="flex shrink-0 items-center gap-1">
        <button type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Subir">${icon('chevron-up', 'h-4 w-4')}</button>
        <button type="button" data-down="${i}" ${i === state.items.length - 1 ? 'disabled' : ''} class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Bajar">${icon('chevron-down', 'h-4 w-4')}</button>
        <button type="button" data-del-test="${i}" class="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar determinación">${icon('trash', 'h-4 w-4')}</button>
      </div>`;
    if (t.kind === 'existing') {
      return `
        <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-200" data-test-card="${i}">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-slate-900">${escapeHtml(t.name)}${t.unit ? ` <span class="font-normal text-slate-500">(${escapeHtml(t.unit)})</span>` : ''}</p>
              <p class="mt-0.5 text-xs text-sky-700">Del catálogo${t.technique ? ` · Técnica: ${escapeHtml(t.technique)}` : ''} — se usa tal cual; sus referencias se editan en Admin Tools.</p>
              <ul class="mt-2 space-y-0.5 text-xs text-slate-500">
                ${t.ranges.length ? t.ranges.map((r) => `<li>${escapeHtml(refText(r))}</li>`).join('') : '<li>Sin valores de referencia capturados</li>'}
              </ul>
            </div>
            ${controls}
          </div>
        </div>`;
    }
    return `
      <div class="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-test-card="${i}">
        <div class="flex items-start justify-between gap-3">
          <p class="pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Determinación ${i + 1}</p>
          ${controls}
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div class="sm:col-span-6">
            <label class="${labelCls}">Nombre *</label>
            <input type="text" maxlength="150" data-t="${i}" data-f="name" value="${escapeHtml(t.name)}" placeholder="Ej. Hemoglobina" class="${inputCls}">
          </div>
          <div class="sm:col-span-2">
            <label class="${labelCls}">Unidad</label>
            <input type="text" maxlength="40" data-t="${i}" data-f="unit" value="${escapeHtml(t.unit)}" placeholder="g/dL" class="${inputCls}">
          </div>
          <div class="sm:col-span-4">
            <label class="${labelCls}">Técnica de esta determinación</label>
            <input type="text" maxlength="80" data-t="${i}" data-f="technique" value="${escapeHtml(t.technique)}" placeholder="${escapeHtml(state.technique || 'La del estudio')}" class="${inputCls}">
          </div>
        </div>
        <div class="space-y-2">
          <p class="text-xs font-semibold text-slate-600">Valores de referencia</p>
          ${sexWarning(t) ? `<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">${escapeHtml(sexWarning(t))}</p>` : ''}
          ${t.ranges.map((r, j) => rangeRowHtml(i, j, r)).join('')}
          <button type="button" data-add-range="${i}" class="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-500">
            ${icon('plus', 'h-4 w-4')} Agregar otra referencia (otro sexo, edad o condición)
          </button>
        </div>
      </div>`;
  };

  const paint = () => {
    root.innerHTML = `
      <div class="mx-auto max-w-4xl space-y-5">
        <a href="${backHref}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ${icon('chevron-left', 'h-4 w-4')} Volver
        </a>
        <div>
          <h3 class="text-lg font-bold text-slate-900">Crear plantilla de estudio</h3>
          <p class="text-sm text-slate-500">
            Defines una sola vez el estudio, su técnica y sus valores de referencia. Después se elige al membretar una orden,
            y el reporte sale con el formato de siempre.
          </p>
        </div>

        <section class="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">Nombre del estudio *</label>
            <input id="tw-name" type="text" maxlength="150" value="${escapeHtml(state.name)}" placeholder="Ej. Biometría hemática" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Técnica</label>
            <input id="tw-tech" type="text" maxlength="80" value="${escapeHtml(state.technique)}" placeholder="Ej. Citometría de flujo" class="${inputCls}">
            <p class="mt-1 text-xs text-slate-400">Se aplica a todas las determinaciones; puedes cambiarla en cada una.</p>
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Determinaciones (${state.items.length})</h4>
            <button id="tw-add" type="button" class="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-50">
              ${icon('plus', 'h-4 w-4')} Nueva determinación
            </button>
          </div>

          <div class="rounded-2xl bg-sky-50 p-3 ring-1 ring-sky-200">
            <label class="${labelCls}">¿Ya existe en el catálogo? Búscala y agrégala</label>
            <input id="tw-q" type="text" autocomplete="off" placeholder="Buscar determinación del catálogo…" class="${inputCls}">
            <div id="tw-results" class="mt-2 space-y-1"></div>
          </div>

          <div class="space-y-3">${state.items.map(testCardHtml).join('')}</div>
        </section>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <a href="${backHref}" class="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">Cancelar</a>
          <button id="tw-save" type="button" ${saving ? 'disabled' : ''}
                  class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
            ${saving ? 'Guardando…' : 'Guardar plantilla'}
          </button>
        </div>
      </div>`;
    wire();
  };

  /** Los campos escriben directo en el estado (sin repintar, para no perder el foco). */
  const wire = () => {
    root.querySelector('#tw-name').addEventListener('input', (e) => { state.name = e.target.value; });
    root.querySelector('#tw-tech').addEventListener('input', (e) => {
      state.technique = e.target.value;
      root.querySelectorAll('[data-f="technique"]').forEach((el) => { el.placeholder = state.technique || 'La del estudio'; });
    });
    root.querySelectorAll('[data-t][data-f]').forEach((el) => {
      const handler = () => {
        const t = state.items[+el.dataset.t];
        if (el.dataset.r !== undefined) t.ranges[+el.dataset.r][el.dataset.f] = el.value;
        else t[el.dataset.f] = el.value;
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', () => {
        handler();
        if (el.dataset.f === 'sex') paint();   // actualiza el aviso de «Ambos sexos»
      });
    });

    root.querySelector('#tw-add').addEventListener('click', () => { state.items.push(newTest()); paint(); });
    root.querySelectorAll('[data-del-test]').forEach((b) => b.addEventListener('click', () => {
      state.items.splice(+b.dataset.delTest, 1);
      if (!state.items.length) state.items.push(newTest());
      paint();
    }));
    root.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, -1)));
    root.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, 1)));
    root.querySelectorAll('[data-add-range]').forEach((b) => b.addEventListener('click', () => {
      state.items[+b.dataset.addRange].ranges.push(newRange());
      paint();
    }));
    root.querySelectorAll('[data-del-range]').forEach((b) => b.addEventListener('click', () => {
      const [i, j] = b.dataset.delRange.split(':').map(Number);
      state.items[i].ranges.splice(j, 1);
      paint();
    }));

    const q = root.querySelector('#tw-q');
    q.addEventListener('input', debounce(() => searchCatalog(q.value.trim()), 300));
    root.querySelector('#tw-save').addEventListener('click', save);
  };

  const move = (i, delta) => {
    const k = i + delta;
    if (k < 0 || k >= state.items.length) return;
    [state.items[i], state.items[k]] = [state.items[k], state.items[i]];
    paint();
  };

  const searchCatalog = async (text) => {
    const box = root.querySelector('#tw-results');
    if (!box) return;
    if (text.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = spinner();
    let tests = [];
    try {
      tests = (await apiGet('labs/catalog_list', { q: text })).tests.slice(0, 8);
    } catch (e) {
      box.innerHTML = `<p class="text-xs text-red-600">${escapeHtml(e.message)}</p>`;
      return;
    }
    if (!root.querySelector('#tw-results')) return;
    const already = new Set(state.items.filter((t) => t.kind === 'existing').map((t) => t.id));
    box.innerHTML = tests.length
      ? tests.map((t) => `
          <button type="button" data-pick-test="${t.id}" ${already.has(+t.id) ? 'disabled' : ''}
                  class="flex w-full items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:ring-indigo-300 disabled:opacity-50">
            <span class="min-w-0 truncate font-medium text-slate-800">${escapeHtml(t.name)}${t.unit ? ` <span class="font-normal text-slate-500">(${escapeHtml(t.unit)})</span>` : ''}</span>
            <span class="shrink-0 text-xs text-slate-400">${already.has(+t.id) ? 'Ya agregada' : `${t.ranges.length} referencia(s)`}</span>
          </button>`).join('')
      : '<p class="text-xs text-slate-500">No hay coincidencias. Usa «Nueva determinación».</p>';
    box.querySelectorAll('[data-pick-test]').forEach((b) => b.addEventListener('click', () => {
      const t = tests.find((x) => +x.id === +b.dataset.pickTest);
      // Si la primera tarjeta es una determinación nueva sin llenar, el catálogo la sustituye
      const first = state.items[0];
      if (state.items.length === 1 && first.kind === 'new' && !first.name.trim()) state.items = [];
      state.items.push({ kind: 'existing', id: +t.id, name: t.name, unit: t.unit || '', technique: t.technique || '', ranges: t.ranges || [] });
      paint();
    }));
  };

  /** Valida lo mismo que el servidor, para avisar antes de enviar. */
  const validate = () => {
    if (!state.name.trim()) return 'Escribe el nombre del estudio';
    if (!state.items.length) return 'Agrega al menos una determinación';
    for (const [i, t] of state.items.entries()) {
      if (t.kind !== 'new') continue;
      if (!t.name.trim()) return `La determinación ${i + 1} necesita nombre`;
      for (const r of t.ranges) {
        const min = r.min_value === '' ? null : +r.min_value;
        const max = r.max_value === '' ? null : +r.max_value;
        if (min !== null && max !== null && min > max) return `«${t.name}»: el mínimo es mayor que el máximo`;
        const a = r.age_min === '' ? null : +r.age_min;
        const b = r.age_max === '' ? null : +r.age_max;
        if (a !== null && b !== null && a > b) return `«${t.name}»: la edad inicial es mayor que la final`;
      }
    }
    return '';
  };

  const save = async () => {
    const problem = validate();
    if (problem) { toast(problem, 'error'); return; }
    saving = true;
    root.querySelector('#tw-save').disabled = true;
    try {
      const res = await apiPost('labs/template_create', {
        name: state.name.trim(),
        technique: state.technique.trim(),
        tests: state.items.map((t) => (t.kind === 'existing'
          ? { id: t.id }
          : { name: t.name.trim(), unit: t.unit.trim(), technique: t.technique.trim(), ranges: t.ranges })),
      });
      toast(`Plantilla «${res.name}» creada`, 'success');
      if (res.reused?.length) {
        toast(`Ya existían en el catálogo y se usaron tal cual: ${res.reused.join(', ')}`, 'info');
      }
      onDone(res);
    } catch (e) {
      saving = false;
      toast(e.message, 'error');
      const btn = root.querySelector('#tw-save');
      if (btn) btn.disabled = false;
    }
  };

  paint();
}
