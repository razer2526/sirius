/**
 * Módulo Apps: herramientas del laboratorio.
 * Navegación por niveles:
 *   #/apps                                    → Membretador | Cotizador
 *   #/apps/membretador                        → Análisis clínicos | Biología Molecular | Documentos
 *   #/apps/membretador/<categoria>            → estudios de la categoría
 *   #/apps/membretador/<categoria>/<tipo>     → panel de estudios membretados
 *   …/<tipo>/nuevo  y  …/<tipo>/<id>          → captura y edición
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, spinner,
  inputCls, labelCls, debounce, fmtDateTime, fullName, calcAge,
} from '../ui.js';

let ctx;
let catalog = null;
let listState = { documents: [], can_review: false, can_delete: false };

const TOOLS = [
  { key: 'membretador', label: 'Membretador', icon: 'file-text', color: 'bg-indigo-100 text-indigo-700', desc: 'Emitir estudios y documentos con membrete' },
  { key: 'cotizador',   label: 'Cotizador',   icon: 'calculator', color: 'bg-emerald-100 text-emerald-700', desc: 'Generar cotizaciones para pacientes' },
  { key: 'comisiones',  label: 'Comisiones',  icon: 'link', color: 'bg-amber-100 text-amber-700', desc: 'Comisiones de médicos y concierge con convenio' },
];

export async function render(root, context) {
  ctx = context;
  if (!catalog) {
    catalog = await fetch('assets/js/doc_templates.json').then((r) => r.json());
  }
  const [tool, category, type, action] = context.args;

  if (!tool) return gridTools(root);
  if (tool === 'cotizador') return renderCotizador(root, category);
  if (tool === 'comisiones') return renderComisiones(root, category);
  if (tool !== 'membretador') return gridTools(root);

  if (!category) return gridCategories(root);
  const cat = catalog.categories[category];
  if (!cat) return gridCategories(root);

  // Las categorías por orden (análisis clínicos) no tienen grid de estudios:
  // se trabaja sobre el PDF que manda el laboratorio de referencia.
  if (cat.flow === 'orders') {
    const docType = cat.doc_type;
    if (!type) return renderOrders(root, category, cat, docType);
    if (type === 'nueva') return renderOrderForm(root, category, cat, docType, null);
    if (/^\d+$/.test(type)) return renderOrderForm(root, category, cat, docType, +type);
    return renderOrders(root, category, cat, docType);
  }

  if (!type) return gridStudies(root, category, cat);
  const tpl = catalog.templates[type];
  if (!tpl) return gridStudies(root, category, cat);
  if (tpl.coming_soon) return comingSoon(root, tpl.label, `#/apps/membretador/${category}`);

  if (action === 'nuevo') return renderForm(root, category, type, null);
  if (action && /^\d+$/.test(action)) return renderForm(root, category, type, +action);
  return renderList(root, category, type);
}

/* ================== Grids de navegación ================== */
function myFlags() {
  return ctx.modules.find((m) => m.key === 'apps')?.flags || {};
}

function gridCard({ href, label, desc, iconName, color, disabled }) {
  const inner = `
    <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${color}">${icon(iconName, 'h-7 w-7')}</span>
    <span class="min-w-0">
      <span class="block text-base font-semibold text-slate-900">${escapeHtml(label)}</span>
      ${desc ? `<span class="block text-sm text-slate-500">${escapeHtml(desc)}</span>` : ''}
    </span>
    ${disabled
      ? '<span class="ml-auto shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Próximamente</span>'
      : `<span class="ml-auto shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500">
           <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
         </span>`}`;
  const cls = 'group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition';
  return disabled
    ? `<div class="${cls} opacity-60">${inner}</div>`
    : `<a href="${href}" class="${cls} hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">${inner}</a>`;
}

function gridShell(root, { title, subtitle, backHref, cards }) {
  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      ${backHref ? `
        <a href="${backHref}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ${icon('chevron-left', 'h-4 w-4')} Volver
        </a>` : ''}
      <div>
        <h3 class="text-lg font-bold text-slate-900">${escapeHtml(title)}</h3>
        <p class="text-sm text-slate-500">${escapeHtml(subtitle)}</p>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">${cards}</div>
    </div>`;
}

function gridTools(root) {
  const flags = myFlags();
  const isAdmin = ['administrador', 'developper'].includes(ctx.user.role);
  const cards = TOOLS
    .filter((t) => isAdmin || flags[t.key])
    .map((t) => gridCard({ href: `#/apps/${t.key}`, label: t.label, desc: t.desc, iconName: t.icon, color: t.color }))
    .join('');
  gridShell(root, {
    title: 'Apps',
    subtitle: 'Herramientas del laboratorio.',
    cards: cards || '<p class="text-sm text-slate-500">No tienes herramientas habilitadas.</p>',
  });
}

function gridCategories(root) {
  const cards = Object.entries(catalog.categories).map(([key, c]) => {
    const total = c.studies.length;
    const listos = c.studies.filter((s) => !catalog.templates[s]?.coming_soon).length;
    return gridCard({
      href: `#/apps/membretador/${key}`,
      label: c.label,
      desc: total ? `${listos} de ${total} estudio(s) disponibles` : 'Sin estudios configurados',
      iconName: c.icon,
      color: c.color,
    });
  }).join('');
  gridShell(root, {
    title: 'Membretador',
    subtitle: 'Elige el tipo de documento que vas a membretar.',
    backHref: '#/apps',
    cards,
  });
}

function gridStudies(root, categoryKey, cat) {
  const cards = cat.studies.map((key) => {
    const t = catalog.templates[key];
    return gridCard({
      href: `#/apps/membretador/${categoryKey}/${key}`,
      label: t.label,
      desc: t.coming_soon ? 'Pendiente de configurar' : t.study_name,
      iconName: cat.icon,
      color: cat.color,
      disabled: !!t.coming_soon,
    });
  }).join('');
  gridShell(root, {
    title: cat.label,
    subtitle: cat.studies.length ? 'Elige el estudio.' : 'Todavía no hay estudios configurados en esta categoría.',
    backHref: '#/apps/membretador',
    cards: cards || '<p class="text-sm text-slate-500">Esta categoría aún no tiene estudios.</p>',
  });
}

function comingSoon(root, label, backHref) {
  root.innerHTML = `
    <div class="mx-auto max-w-2xl space-y-5">
      <a href="${backHref}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div class="rounded-2xl bg-white py-16 text-center shadow-sm ring-1 ring-slate-200">
        <span class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">${icon('file-text', 'h-7 w-7')}</span>
        <p class="text-base font-semibold text-slate-700">${escapeHtml(label)}</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-slate-400">
          Esta herramienta todavía no está configurada. Cuando definamos su formato se habilitará aquí.
        </p>
      </div>
    </div>`;
}

/* ================== Panel de estudios membretados ================== */
async function renderList(root, category, type) {
  const tpl = catalog.templates[type];
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <a href="#/apps/membretador/${category}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver a ${escapeHtml(catalog.categories[category].label)}
      </a>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="relative min-w-0 flex-1 sm:max-w-sm">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
          <input id="doc-q" type="text" placeholder="Buscar por paciente o folio…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-white py-2.5 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <a href="#/apps/membretador/${category}/${type}/nuevo"
           class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo ${escapeHtml(tpl.short)}
        </a>
      </div>
      <div id="doc-list">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#doc-q');
  const load = async () => {
    listState = await apiGet('documents/list', { q: input.value.trim(), type });
    paintList(root.querySelector('#doc-list'), category, type);
  };
  input.addEventListener('input', debounce(load, 300));
  await load();
}

function paintList(box, category, type) {
  const { documents, can_delete } = listState;
  if (!documents.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin estudios membretados</p>
        <p class="mt-1 text-xs text-slate-400">Crea el primero con el botón de arriba.</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Paciente</th>
              <th class="hidden px-4 py-3 sm:table-cell">Estudio</th>
              <th class="px-4 py-3">Estado</th>
              <th class="hidden px-4 py-3 md:table-cell">Responsable</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${documents.map((d) => `
              <tr>
                <td class="px-4 py-3">
                  <p class="font-semibold text-slate-800">${escapeHtml(d.patient_name)}</p>
                  <p class="text-xs text-slate-500">${d.folio ? 'Folio ' + escapeHtml(d.folio) + ' · ' : ''}${fmtDateTime(d.created_at)}</p>
                </td>
                <td class="hidden px-4 py-3 text-slate-600 sm:table-cell">${escapeHtml(d.type_label)}</td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${d.status === 'revisado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                    ${d.status === 'revisado' ? 'Revisado' : 'Borrador'}
                  </span>
                </td>
                <td class="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                  ${escapeHtml(d.created_by_name || '—')}
                  ${d.reviewed_by_name ? `<br><span class="text-emerald-600">Revisó: ${escapeHtml(d.reviewed_by_name)}</span>` : ''}
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <a href="documento.php?id=${d.id}" target="_blank" title="Ver"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('eye', 'h-4 w-4')}</a>
                    <a href="documento.php?id=${d.id}&download=1" title="Guardar PDF"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('download', 'h-4 w-4')}</a>
                    <a href="#/apps/membretador/${category}/${type}/${d.id}" title="Editar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</a>
                    ${can_delete ? `<button type="button" data-del="${d.id}" title="Borrar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const d = documents.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Borrar estudio', `Se eliminará el estudio de ${d.patient_name}. ¿Continuar?`, { danger: true, confirmLabel: 'Borrar' });
      if (!ok) return;
      try {
        await apiPost('documents/delete', { id: d.id });
        toast('Estudio eliminado');
        renderList(document.getElementById('module-root'), category, type);
      } catch (e) {
        toast(e.message, 'error');
      }
    }));
}

/* ================== Órdenes de análisis clínicos ================== */

/** Panel con las órdenes ya membretadas y el acceso para crear una nueva. */
async function renderOrders(root, category, cat, docType) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <a href="#/apps/membretador" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver al Membretador
      </a>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="relative min-w-0 flex-1 sm:max-w-sm">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
          <input id="doc-q" type="text" placeholder="Buscar por paciente o folio…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-white py-2.5 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <a href="#/apps/membretador/${category}/nueva"
           class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nueva orden
        </a>
      </div>
      <div id="doc-list">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#doc-q');
  const load = async () => {
    listState = await apiGet('documents/list', { q: input.value.trim(), type: docType });
    paintList(root.querySelector('#doc-list'), category, docType);
  };
  input.addEventListener('input', debounce(load, 300));
  await load();
}

/**
 * Captura de una orden: se sube el PDF del laboratorio, se revisa la tabla
 * prellenada y se libera el reporte con el membrete de la clínica.
 */
async function renderOrderForm(root, category, cat, docType, docId) {
  const tpl = catalog.templates[docType] || {};
  const backHref = `#/apps/membretador/${category}`;
  let data = { patient: {}, studies: [], clinical: {}, notes: '', folio: '' };
  let currentId = docId || 0;
  let reviewed = false;

  if (docId) {
    const res = await apiGet('documents/get', { id: docId });
    const doc = res.document;
    data = {
      patient: doc.patient_data || {},
      clinical: doc.clinical_data || {},
      studies: Array.isArray(doc.results) ? doc.results : [],
      notes: doc.notes || '',
      folio: doc.folio || '',
      status: doc.status,
    };
    listState.can_review = res.can_review;
  }

  const paint = () => {
    root.innerHTML = `
      <div class="mx-auto max-w-5xl space-y-5">
        <a href="${backHref}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ${icon('chevron-left', 'h-4 w-4')} Volver al panel
        </a>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">${icon('flask', 'h-6 w-6')}</span>
            <div>
              <h3 class="text-lg font-bold text-slate-900">${docId ? 'Editar' : 'Nueva'} orden · Análisis clínicos</h3>
              <p class="text-sm text-slate-500">Sube el PDF del laboratorio de referencia y revisa los datos.</p>
            </div>
          </div>
          ${data.status === 'revisado' ? '<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Revisado</span>' : ''}
        </div>

        ${!data.studies.length ? `
        <section class="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
          <span class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">${icon('upload', 'h-6 w-6')}</span>
          <p class="text-sm font-semibold text-slate-700">Sube el reporte del laboratorio</p>
          <p class="mx-auto mt-1 max-w-sm text-xs text-slate-400">
            Se leen los datos del paciente, las determinaciones y sus valores de referencia.
            Todo queda editable antes de generar el documento.
          </p>
          <label class="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
            ${icon('upload', 'h-4 w-4')} <span id="lab-label">Seleccionar PDF</span>
            <input type="file" id="lab-file" accept="application/pdf" class="hidden">
          </label>
        </section>` : ''}

        <form id="order-form" class="${data.studies.length ? 'space-y-5' : 'hidden'}">
          <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Datos del paciente</h4>
              <label class="cursor-pointer text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                Volver a subir PDF
                <input type="file" id="lab-file-2" accept="application/pdf" class="hidden">
              </label>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              ${[
                ['folio', 'Folio', data.folio],
                ['nombre', 'Paciente', data.patient.nombre || ''],
                ['edad', 'Edad', data.patient.edad || ''],
                ['sexo', 'Sexo', data.patient.sexo || ''],
                ['telefono', 'Teléfono', data.patient.telefono || ''],
                ['fecha_nacimiento', 'Fecha de nacimiento', data.patient.fecha_nacimiento || ''],
              ].map(([k, l, v]) => `
                <div><label class="${labelCls}">${l}</label>
                  <input type="text" name="p_${k}" value="${escapeHtml(v)}" class="${inputCls}"></div>`).join('')}
            </div>
            <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              ${[
                ['fecha_reporte', 'Fecha de reporte', data.clinical.fecha_reporte || new Date().toISOString().slice(0, 10)],
                ['medico', 'Médico solicitante', data.clinical.medico || ''],
                ['toma_muestra', 'Toma de muestra', data.clinical.toma_muestra || ''],
                ['kit', 'Laboratorio de referencia', data.clinical.kit || 'RAPHA Referencia Clínica, S.C.'],
              ].map(([k, l, v]) => `
                <div><label class="${labelCls}">${l}</label>
                  <input type="text" name="c_${k}" value="${escapeHtml(v)}" class="${inputCls}"></div>`).join('')}
            </div>
          </section>

          <div id="studies-box" class="space-y-5"></div>

          <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h4 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Observaciones</h4>
            <textarea name="notes" rows="2" class="${inputCls}"
              placeholder="Notas que aparecerán al final del reporte">${escapeHtml(data.notes)}</textarea>
          </section>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <button type="button" id="btn-catalog" class="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
              ${icon('check-square', 'h-4 w-4')} Guardar rangos al catálogo
            </button>
            <button type="button" id="btn-draft" class="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              Guardar borrador
            </button>
            <button type="button" id="btn-next" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              ${icon('eye', 'h-4 w-4')} Siguiente
            </button>
            <button type="button" id="btn-reviewed" disabled
                    class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
              ${icon('check-square', 'h-4 w-4')} Revisado
            </button>
          </div>
          <p id="review-hint" class="text-right text-xs text-slate-400">Pulsa "Siguiente" para revisar los datos antes de guardar.</p>
        </form>
      </div>`;

    paintStudies(root);
    wireUpload(root, '#lab-file');
    wireUpload(root, '#lab-file-2');
    if (data.studies.length) wireOrderButtons(root);
  };

  /** Tabla editable por estudio. */
  const paintStudies = (root) => {
    const box = root.querySelector('#studies-box');
    if (!box) return;
    box.innerHTML = data.studies.map((study, si) => `
      <section class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <input type="text" data-study="${si}" value="${escapeHtml(study.name)}"
                 class="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-1 py-1 text-sm font-bold text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-50 focus:ring-2 focus:ring-indigo-500">
          <span class="shrink-0 text-xs text-slate-400">${study.items.length} determinación(es)</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2">Determinación</th>
                <th class="px-3 py-2 w-24">Resultado</th>
                <th class="px-3 py-2 w-24">Unidad</th>
                <th class="px-3 py-2">Valor de referencia</th>
                <th class="px-3 py-2 w-16">Origen</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${study.items.map((it, ii) => `
                <tr class="${it.flag ? 'bg-red-50/60' : ''}">
                  <td class="px-3 py-1.5"><input type="text" data-cell="${si}.${ii}.name" value="${escapeHtml(it.name)}" class="w-full rounded border-0 bg-transparent px-1 py-1 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-indigo-400"></td>
                  <td class="px-3 py-1.5"><input type="text" data-cell="${si}.${ii}.value" value="${escapeHtml(it.value)}" class="w-full rounded border-0 bg-transparent px-1 py-1 text-right text-sm font-semibold ${it.flag ? 'text-red-700' : ''} outline-none focus:bg-white focus:ring-2 focus:ring-indigo-400"></td>
                  <td class="px-3 py-1.5"><input type="text" data-cell="${si}.${ii}.unit" value="${escapeHtml(it.unit || '')}" class="w-full rounded border-0 bg-transparent px-1 py-1 text-sm text-slate-500 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-400"></td>
                  <td class="px-3 py-1.5">
                    <input type="text" data-cell="${si}.${ii}.reference" value="${escapeHtml(it.reference || '')}" class="w-full rounded border-0 bg-transparent px-1 py-1 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-indigo-400">
                    ${(it.conditions && it.conditions.length) ? `
                      <select data-cond="${si}.${ii}"
                              class="mt-1 w-full rounded border-0 bg-amber-50 px-1 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 focus:ring-2 focus:ring-indigo-400">
                        <option value="">Mostrar todas las condiciones</option>
                        ${it.conditions.map((c) => `<option value="${escapeHtml(c)}" ${it.condition === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                      </select>` : ''}
                  </td>
                  <td class="px-3 py-1.5 text-center">${originBadge(it.origin)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`).join('');

    box.querySelectorAll('[data-cell]').forEach((el) => {
      el.addEventListener('input', () => {
        const [si, ii, field] = el.dataset.cell.split('.');
        data.studies[si].items[ii][field] = el.value;
      });
    });
    box.querySelectorAll('[data-study]').forEach((el) => {
      el.addEventListener('input', () => { data.studies[el.dataset.study].name = el.value; });
    });

    // Fase del ciclo, menopausia, embarazo…: el sistema no las deduce, se eligen aquí
    box.querySelectorAll('[data-cond]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const [si, ii] = sel.dataset.cond.split('.');
        const item = data.studies[si].items[ii];
        item.condition = sel.value;
        item.reference = referenceFor(item, sel.value);
        const input = box.querySelector(`[data-cell="${si}.${ii}.reference"]`);
        if (input) input.value = item.reference;
      });
    });
  };

  /** Compone el texto de referencia según la condición elegida. */
  const referenceFor = (item, condition) => {
    const ranges = item.ranges || [];
    const sex = (data.patient.sexo || '').charAt(0).toUpperCase();
    const age = parseFloat(String(data.patient.edad || '').replace(/\D+/g, '')) || null;

    const chosen = condition
      ? ranges.filter((r) => (r.condition_label || '') === condition)
      : ranges.filter((r) => {
          if (!(r.condition_label || '')) {
            if (sex && r.sex !== 'A' && r.sex !== sex) return false;
            if (age !== null) {
              if (r.age_min !== null && age < +r.age_min) return false;
              if (r.age_max !== null && age > +r.age_max) return false;
            }
            return true;
          }
          return true;   // sin condición indicada se muestran todas las variantes
        });

    return chosen.map(rangeLabel).filter(Boolean).join(' · ');
  };

  const rangeLabel = (r) => {
    const fmt = (n) => String(parseFloat(n)).replace(/\.0+$/, '');
    let label = '';
    if (r.text_value) label = r.text_value;
    else if (r.min_value !== null && r.max_value !== null) label = `${fmt(r.min_value)} - ${fmt(r.max_value)}`;
    else if (r.min_value !== null) label = `Mayor a ${fmt(r.min_value)}`;
    else if (r.max_value !== null) label = `Menor a ${fmt(r.max_value)}`;
    return r.condition_label ? `${r.condition_label}: ${label}` : label;
  };

  /** Sube el PDF y prellena la tabla. */
  const wireUpload = (root, selector) => {
    const input = root.querySelector(selector);
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const label = root.querySelector('#lab-label');
      if (label) label.textContent = 'Leyendo…';
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('api/index.php?r=labs/parse', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        const d = json.data;
        data.patient = { ...data.patient, ...d.patient };
        data.folio = d.patient.folio || data.folio;
        data.clinical.fecha_reporte = d.patient.fecha_reporte || data.clinical.fecha_reporte;
        data.clinical.medico = d.patient.medico || data.clinical.medico;
        data.studies = d.studies.map((s) => ({
          name: s.name,
          items: s.items.map((it) => ({
            name: it.name,
            value: it.value,
            unit: it.unit,
            technique: it.technique,
            reference: (it.applicable || []).join(' · '),
            flag: it.flag,
            origin: it.origin,
            ranges: it.ranges,
            conditions: it.conditions || [],
            condition: '',
          })),
        }));
        const total = data.studies.reduce((n, s) => n + s.items.length, 0);
        toast(`Leído: ${data.studies.length} estudio(s), ${total} determinaciones`);
        paint();
      } catch (e) {
        if (label) label.textContent = 'Seleccionar PDF';
        toast(e.message, 'error');
      } finally {
        input.value = '';
      }
    });
  };

  const collect = () => {
    const form = root.querySelector('#order-form');
    const fd = new FormData(form);
    const patient = {};
    ['nombre', 'edad', 'sexo', 'telefono', 'fecha_nacimiento'].forEach((k) => {
      patient[k] = (fd.get('p_' + k) || '').toString().trim();
    });
    const clinical = {};
    ['fecha_reporte', 'medico', 'toma_muestra', 'kit'].forEach((k) => {
      clinical[k] = (fd.get('c_' + k) || '').toString().trim();
    });
    return {
      id: currentId || undefined,
      doc_type: docType,
      folio: (fd.get('p_folio') || '').toString().trim(),
      patient_data: patient,
      clinical_data: clinical,
      results: data.studies,
      notes: (fd.get('notes') || '').toString(),
    };
  };

  const save = async () => {
    const payload = collect();
    if (!payload.patient_data.nombre) {
      toast('Escribe el nombre del paciente', 'error');
      return null;
    }
    const res = await apiPost('documents/save', payload);
    currentId = res.id;
    return res.id;
  };

  const wireOrderButtons = (root) => {
    root.querySelector('#btn-draft').addEventListener('click', async () => {
      try {
        const id = await save();
        if (id) { toast('Borrador guardado'); ctx.navigate(`apps/membretador/${category}`); }
      } catch (e) { toast(e.message, 'error'); }
    });

    root.querySelector('#btn-next').addEventListener('click', () => {
      document.getElementById('module-root').scrollTo({ top: 0, behavior: 'smooth' });
      reviewed = true;
      root.querySelector('#btn-reviewed').disabled = false;
      root.querySelector('#review-hint').textContent =
        'Cuando termines de revisar, pulsa "Revisado" para guardar el reporte.';
      modal({
        title: 'Revisa los datos',
        content: `<p class="text-sm text-slate-600">
            Verifica resultados y valores de referencia antes de guardar. Al terminar pulsa
            <b class="text-slate-800">Revisado</b>.</p>`,
        actions: [{ label: 'Aceptar', primary: true }],
      });
    });

    root.querySelector('#btn-reviewed').addEventListener('click', async () => {
      if (!reviewed) return;
      try {
        await save();
        await apiPost('documents/review', { id: currentId });
        toast('Reporte revisado y guardado');
        ctx.navigate(`apps/membretador/${category}`);
      } catch (e) { toast(e.message, 'error'); }
    });

    root.querySelector('#btn-catalog').addEventListener('click', async () => {
      const tests = [];
      data.studies.forEach((s) => s.items.forEach((it) => {
        if (it.ranges && it.ranges.length) {
          tests.push({ name: it.name, unit: it.unit, technique: it.technique, ranges: it.ranges });
        }
      }));
      if (!tests.length) {
        toast('No hay rangos estructurados que guardar', 'info');
        return;
      }
      try {
        const res = await apiPost('labs/catalog_save', { tests });
        toast(`${res.saved} determinación(es) guardadas en el catálogo`);
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  paint();
}

function originBadge(origin) {
  const map = {
    catalogo:  ['Catálogo', 'bg-emerald-100 text-emerald-700'],
    detectado: ['Leído', 'bg-amber-100 text-amber-700'],
    sin_rango: ['Sin rango', 'bg-slate-100 text-slate-500'],
  };
  const [label, cls] = map[origin] || map.sin_rango;
  return `<span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}">${label}</span>`;
}

/* ================== Formulario del estudio ================== */
const PATIENT_FIELDS = [
  { k: 'nombre', l: 'Paciente', span: 2, required: true },
  { k: 'sexo', l: 'Sexo' },
  { k: 'edad', l: 'Edad' },
  { k: 'fecha_nacimiento', l: 'Fecha de nacimiento' },
  { k: 'tipo_id', l: 'Tipo de identificación' },
  { k: 'numero_id', l: 'Número de identificación' },
  { k: 'telefono', l: 'Teléfono' },
  { k: 'email', l: 'Correo electrónico' },
  { k: 'direccion', l: 'Dirección', span: 3 },
];

const CLINICAL_FIELDS = [
  { k: 'fecha_reporte', l: 'Fecha de reporte' },
  { k: 'toma_muestra', l: 'Toma de muestra' },
  { k: 'tipo_muestra', l: 'Tipo de muestra' },
  { k: 'container_temp', l: 'Temperatura del contenedor' },
  { k: 'medico', l: 'Médico solicitante' },
  { k: 'area', l: 'Área' },
  { k: 'kit', l: 'Kit utilizado', span: 3 },
  { k: 'observaciones', l: 'Observaciones clínicas', span: 3, textarea: true },
];

async function renderForm(root, category, type, docId) {
  const tpl = catalog.templates[type];
  const backHref = `#/apps/membretador/${category}/${type}`;
  let doc = null;
  let reviewed = false;

  if (docId) {
    const data = await apiGet('documents/get', { id: docId });
    doc = data.document;
    listState.can_review = data.can_review;
  }
  const patient = doc?.patient_data || {};
  const clinical = doc?.clinical_data || {};
  const results = doc?.results || {};

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <a href="${backHref}" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver al panel
      </a>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">${icon('file-text', 'h-6 w-6')}</span>
          <div>
            <h3 class="text-lg font-bold text-slate-900">${docId ? 'Editar' : 'Nuevo'} · ${escapeHtml(tpl.short)}</h3>
            <p class="text-sm text-slate-500">${escapeHtml(tpl.study_name)}</p>
          </div>
        </div>
        ${doc?.status === 'revisado' ? '<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Revisado</span>' : ''}
      </div>

      <form id="doc-form" class="space-y-5">
        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Datos del paciente</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="${labelCls}">Buscar paciente de Admisión / Laboratorio</label>
              <div class="relative">
                <input id="pat-search" type="text" placeholder="Nombre, folio de paciente o de orden…" autocomplete="off" class="${inputCls}">
                <div id="pat-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
              </div>
            </div>
            <div>
              <label class="${labelCls}">…o subir la ficha de identificación (PDF)</label>
              <label class="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-100">
                ${icon('upload', 'h-4 w-4')} <span id="ficha-label">Seleccionar PDF</span>
                <input type="file" id="ficha-file" accept="application/pdf" class="hidden">
              </label>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div class="sm:col-span-2 lg:col-span-1">
              <label class="${labelCls}">Folio interno</label>
              <input type="text" name="folio" value="${escapeHtml(doc?.folio || '')}" class="${inputCls}">
            </div>
            ${PATIENT_FIELDS.map((f) => fieldHtml(f, patient[f.k] || '', '')).join('')}
          </div>
          <input type="hidden" name="patient_id" value="${doc?.patient_id || ''}">
        </section>

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">Datos clínicos del estudio</h4>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${CLINICAL_FIELDS.map((f) => fieldHtml(f, clinical[f.k] || defaultClinical(f.k, tpl), 'cl_')).join('')}
          </div>
        </section>

        ${tpl.panels.map((panel) => `
          <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">${escapeHtml(panel.group)}</h4>
              <span class="text-xs text-slate-400">${escapeHtml(panel.title)}</span>
            </div>
            <div class="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              ${panel.analytes.map((a) => switchRow(a, !!results[a.k])).join('')}
            </div>
          </section>`).join('')}

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Notas de preanalítica</h4>
          <p class="mb-2 text-xs text-slate-400">Una nota por línea; se numeran automáticamente en el PDF.</p>
          <textarea name="notes" rows="3" class="${inputCls}"
            placeholder="Ej. Biota habitual significativamente escasa">${escapeHtml(doc?.notes || '')}</textarea>
        </section>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <button type="button" id="btn-draft" class="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            Guardar borrador
          </button>
          <button type="button" id="btn-next" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            ${icon('eye', 'h-4 w-4')} Siguiente
          </button>
          <!-- "Revisado" guarda el estudio y genera el PDF definitivo -->

          <button type="button" id="btn-reviewed" disabled
                  class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
            ${icon('check-square', 'h-4 w-4')} Revisado
          </button>
        </div>
        <p id="review-hint" class="text-right text-xs text-slate-400">Pulsa "Siguiente" para revisar el documento antes de guardarlo.</p>
      </form>
    </div>`;

  const form = root.querySelector('#doc-form');
  let currentId = docId || 0;

  wireSwitches(form);
  wirePatientSearch(root, form);
  wireFichaUpload(root, form);

  const collect = () => {
    const fd = new FormData(form);
    const patientData = {};
    PATIENT_FIELDS.forEach((f) => { patientData[f.k] = (fd.get(f.k) || '').toString().trim(); });
    const clinicalData = {};
    CLINICAL_FIELDS.forEach((f) => { clinicalData[f.k] = (fd.get('cl_' + f.k) || '').toString().trim(); });
    const res = {};
    form.querySelectorAll('[data-analyte]').forEach((cb) => { res[cb.dataset.analyte] = cb.checked; });
    return {
      id: currentId || undefined,
      doc_type: type,
      folio: (fd.get('folio') || '').toString().trim(),
      patient_id: (fd.get('patient_id') || '').toString(),
      patient_data: patientData,
      clinical_data: clinicalData,
      results: res,
      notes: (fd.get('notes') || '').toString(),
    };
  };

  const save = async () => {
    const payload = collect();
    if (!payload.patient_data.nombre) {
      toast('Escribe el nombre del paciente', 'error');
      return null;
    }
    const data = await apiPost('documents/save', payload);
    currentId = data.id;
    return data.id;
  };

  root.querySelector('#btn-draft').addEventListener('click', async () => {
    try {
      const id = await save();
      if (id) {
        toast('Borrador guardado');
        ctx.navigate(`apps/membretador/${category}/${type}`);
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Siguiente: sube al inicio del formulario para repasar los datos y habilita "Revisado"
  root.querySelector('#btn-next').addEventListener('click', () => {
    if (!form.querySelector('[name="nombre"]').value.trim()) {
      toast('Escribe el nombre del paciente', 'error');
      return;
    }
    document.getElementById('module-root').scrollTo({ top: 0, behavior: 'smooth' });

    reviewed = true;
    root.querySelector('#btn-reviewed').disabled = false;
    root.querySelector('#review-hint').textContent =
      'Cuando termines de revisar, pulsa "Revisado" para guardar el estudio.';

    modal({
      title: 'Revisa los datos',
      content: `<p class="text-sm text-slate-600">
          Por favor revisa los datos antes de guardar. Al terminar, pulsa el botón
          <b class="text-slate-800">Revisado</b> al final del formulario.
        </p>`,
      actions: [{ label: 'Aceptar', primary: true }],
    });
  });

  root.querySelector('#btn-reviewed').addEventListener('click', async () => {
    if (!reviewed) return;
    try {
      await save();
      await apiPost('documents/review', { id: currentId });
      toast('Estudio revisado y guardado');
      ctx.navigate(`apps/membretador/${category}/${type}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function defaultClinical(key, tpl) {
  return {
    area: tpl.area,
    tipo_muestra: tpl.sample_type,
    container_temp: tpl.container_temp,
    kit: tpl.kit,
    fecha_reporte: new Date().toISOString().slice(0, 10),
  }[key] || '';
}

function fieldHtml(f, value, prefix = '') {
  const span = f.span === 3 ? 'sm:col-span-2 lg:col-span-3' : f.span === 2 ? 'sm:col-span-2' : '';
  const name = prefix + f.k;
  const control = f.textarea
    ? `<textarea name="${name}" rows="2" class="${inputCls}">${escapeHtml(value)}</textarea>`
    : `<input type="text" name="${name}" value="${escapeHtml(value)}" class="${inputCls}">`;
  return `<div class="${span}"><label class="${labelCls}">${escapeHtml(f.l)}${f.required ? ' *' : ''}</label>${control}</div>`;
}

/**
 * Switch positivo/negativo por patógeno.
 * El checkbox se superpone al riel con opacidad 0 (no se usa `sr-only`: un control
 * fuera de flujo desplaza el documento al recibir el foco y saca de vista el escritorio).
 */
function switchRow(analyte, positive) {
  return `
    <label class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
      <span class="min-w-0 flex-1 text-sm text-slate-700">${escapeHtml(analyte.l)}</span>
      <span class="flex shrink-0 items-center gap-2">
        <span data-state="${analyte.k}" class="w-24 text-right text-xs font-bold ${positive ? 'text-red-600' : 'text-slate-400'}">
          ${positive ? 'POSITIVO' : 'NO DETECTABLE'}
        </span>
        <span data-rail="${analyte.k}"
              class="relative inline-flex h-6 w-11 shrink-0 rounded-full transition focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 ${positive ? 'bg-red-500' : 'bg-slate-200'}">
          <input type="checkbox" data-analyte="${analyte.k}" ${positive ? 'checked' : ''}
                 aria-label="${escapeHtml(analyte.l)}"
                 class="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0">
          <span data-knob="${analyte.k}"
                class="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${positive ? 'translate-x-5' : ''}"></span>
        </span>
      </span>
    </label>`;
}

function wireSwitches(form) {
  form.querySelectorAll('[data-analyte]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.analyte;
      const label = form.querySelector(`[data-state="${key}"]`);
      const knob = form.querySelector(`[data-knob="${key}"]`);
      const rail = form.querySelector(`[data-rail="${key}"]`);
      label.textContent = cb.checked ? 'POSITIVO' : 'NO DETECTABLE';
      label.className = `w-24 text-right text-xs font-bold ${cb.checked ? 'text-red-600' : 'text-slate-400'}`;
      knob.classList.toggle('translate-x-5', cb.checked);
      rail.classList.toggle('bg-red-500', cb.checked);
      rail.classList.toggle('bg-slate-200', !cb.checked);
    });
  });
}

/** Autollenado desde un paciente ya admitido en Laboratorio. */
function wirePatientSearch(root, form) {
  const input = root.querySelector('#pat-search');
  const box = root.querySelector('#pat-results');

  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      box.classList.add('hidden');
      return;
    }
    const { episodes } = await apiGet('documents/lab_patients', { q });
    if (!episodes.length) {
      box.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias en Admisión / Laboratorio.</p>';
    } else {
      box.innerHTML = episodes.map((e, i) => `
        <button type="button" data-idx="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-50">
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-slate-800">${escapeHtml(fullName(e))}</span>
            <span class="block text-xs text-slate-500">${escapeHtml(e.file_number)}${e.service_folio ? ' · orden ' + escapeHtml(e.service_folio) : ''}</span>
          </span>
        </button>`).join('');
      box.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          fillFromEpisode(form, episodes[+b.dataset.idx]);
          box.classList.add('hidden');
          input.value = '';
          toast('Datos del paciente cargados');
        }));
    }
    box.classList.remove('hidden');
  }, 300));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pat-search') && !e.target.closest('#pat-results')) box.classList.add('hidden');
  });
}

function fillFromEpisode(form, e) {
  const set = (name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && value != null && value !== '') el.value = value;
  };
  const age = calcAge(e.birth_date);
  set('patient_id', e.patient_id);
  set('nombre', fullName(e));
  set('sexo', { F: 'Femenino', M: 'Masculino', O: 'Otro' }[e.sex] || '');
  set('edad', age !== null ? `${age} años` : '');
  set('fecha_nacimiento', formatISO(e.birth_date));
  set('telefono', e.mobile || e.phone || '');
  set('email', e.email || '');
  set('numero_id', e.curp || '');
  set('direccion', [e.street, e.colonia, e.postal_code, e.city, e.state].filter(Boolean).join(', '));
  set('folio', e.service_folio || '');
  set('cl_medico', e.referring_doctor || '');
  set('cl_observaciones', e.reason || '');
  set('cl_toma_muestra', formatISO(e.admission_date, true));
}

/** El reporte usa fechas ISO (2026-07-24), como el formato oficial del laboratorio. */
function formatISO(str, withTime = false) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

/** Las fichas en PDF traen las fechas como dd/mm/aaaa; el reporte las usa en ISO. */
function dmyToISO(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}${m[4]}` : value;
}

/** Autollenado desde el PDF de la ficha de identificación. */
function wireFichaUpload(root, form) {
  const fileInput = root.querySelector('#ficha-file');
  const label = root.querySelector('#ficha-label');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    label.textContent = 'Leyendo…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=documents/parse_ficha', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const f = json.data.fields;
      const set = (name, v) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && v) el.value = v;
      };
      set('nombre', f.nombre);
      set('sexo', f.sexo);
      set('edad', f.edad);
      set('fecha_nacimiento', dmyToISO(f.fecha_nacimiento));
      set('telefono', f.telefono);
      set('email', f.email);
      set('direccion', f.direccion);
      set('tipo_id', f.tipo_id);
      set('numero_id', f.numero_id);
      set('folio', f.folio);
      set('cl_medico', f.medico);
      set('cl_observaciones', f.sintomas);
      set('cl_toma_muestra', dmyToISO(f.fecha_hora));
      label.textContent = file.name;
      if (json.data.found > 0) {
        toast(`Ficha leída: ${json.data.found} campos reconocidos`);
      } else {
        toast('No se reconocieron campos; captúralos a mano', 'info');
      }
    } catch (e) {
      label.textContent = 'Seleccionar PDF';
      toast(e.message, 'error');
    } finally {
      fileInput.value = '';
    }
  });
}

/* ================== Cotizador ================== */
let quoteListState = { items: [], total: 0, per_page: 25 };
let quoteFilters = { q: '', page: 1 };

function renderCotizador(root, view) {
  if (view === 'nueva') return renderQuoteForm(root);
  return renderQuoteList(root);
}

async function renderQuoteList(root) {
  const isAdmin = ['administrador', 'developper'].includes(ctx.user.role);
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <a href="#/apps" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver a Apps
      </a>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="relative min-w-0 flex-1 sm:max-w-sm">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
          <input id="q-search" type="text" placeholder="Buscar por folio o cliente…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-white py-2.5 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <a href="#/apps/cotizador/nueva"
           class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nueva cotización
        </a>
      </div>
      <div id="q-list">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#q-search');
  const load = async (resetPage = true) => {
    if (resetPage) quoteFilters.page = 1;
    quoteFilters.q = input.value.trim();
    quoteListState = await apiGet('quotes/list', quoteFilters);
    paintQuoteList(root.querySelector('#q-list'), load, isAdmin);
  };
  input.addEventListener('input', debounce(() => load(), 300));
  await load();
}

function paintQuoteList(box, load, isAdmin) {
  const { items, total, page, per_page: perPage } = quoteListState;
  const pages = Math.max(1, Math.ceil(total / perPage));

  if (!items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin cotizaciones guardadas</p>
        <p class="mt-1 text-xs text-slate-400">Crea la primera con el botón de arriba.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Folio</th>
              <th class="px-4 py-3">Cliente</th>
              <th class="hidden px-4 py-3 sm:table-cell">Fecha</th>
              <th class="px-4 py-3 text-right">Total</th>
              <th class="hidden px-4 py-3 md:table-cell">Creó</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${items.map((q) => `
              <tr>
                <td class="px-4 py-3 font-mono text-xs font-semibold text-slate-700">${escapeHtml(q.folio)}</td>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(q.client_name)}</td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml(q.quote_date)}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-700">$${Number(q.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                <td class="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">${escapeHtml(q.created_by_name || '—')}</td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <a href="cotizacion.php?id=${q.id}" target="_blank" title="Ver PDF"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('eye', 'h-4 w-4')}</a>
                    <a href="cotizacion.php?id=${q.id}&download=1" title="Descargar PDF"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('download', 'h-4 w-4')}</a>
                    ${isAdmin ? `<button type="button" data-del="${q.id}" title="Eliminar"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-center gap-3">
      <button id="pg-prev" ${page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
      <span class="text-sm text-slate-500">Página ${page} de ${pages} · ${total} cotización(es)</span>
      <button id="pg-next" ${page >= pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { quoteFilters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { quoteFilters.page++; load(false); });

  box.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const q = items.find((x) => x.id === +b.dataset.del);
      const ok = await confirmDialog('Eliminar cotización', `Se eliminará la cotización ${q.folio} de ${q.client_name}. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('quotes/delete', { id: q.id });
        toast('Cotización eliminada');
        load(false);
      } catch (e) { toast(e.message, 'error'); }
    }));
}

/** Arma una cotización: buscador de estudios, lista editable, cliente y descuento. */
function renderQuoteForm(root) {
  const lines = [];   // { study_id, name, unit_price, quantity }
  let saving = false;

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <a href="#/apps/cotizador" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver al listado
      </a>
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">${icon('calculator', 'h-6 w-6')}</span>
        <div>
          <h3 class="text-lg font-bold text-slate-900">Nueva cotización</h3>
          <p class="text-sm text-slate-500">Busca los estudios, ajusta cantidades y aplica un descuento si aplica.</p>
        </div>
      </div>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Datos del cliente</h4>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="relative">
            <label class="${labelCls}">Buscar paciente registrado (opcional)</label>
            <input id="pat-search" type="text" placeholder="Nombre o folio…" autocomplete="off" class="${inputCls}">
            <div id="pat-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
          </div>
          <div><label class="${labelCls}">Fecha</label><input id="q-date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="${inputCls}"></div>
          <div><label class="${labelCls}">Nombre del cliente</label><input id="q-name" type="text" placeholder="Público en General" class="${inputCls}"></div>
          <div><label class="${labelCls}">Teléfono</label><input id="q-phone" type="text" placeholder="S/N" class="${inputCls}"></div>
          <div class="sm:col-span-2"><label class="${labelCls}">Dirección</label><input id="q-address" type="text" placeholder="S/D" class="${inputCls}"></div>
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h4 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Estudios</h4>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
          <input id="study-search" type="text" placeholder="Buscar estudio del catálogo…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-slate-50 py-2.5 pl-11 pr-4 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
          <div id="study-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden max-h-64 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
        </div>
        <div id="lines-box" class="mt-4"></div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">Descuento (%)</label>
            <input id="q-discount" type="number" min="0" max="100" step="0.01" value="0" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Notas (opcional)</label>
            <input id="q-notes" type="text" class="${inputCls}">
          </div>
        </div>
        <div id="totals-box" class="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm"></div>
      </section>

      <div class="flex justify-end">
        <button id="btn-save" type="button" class="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
          ${icon('check-square', 'h-4 w-4')} Guardar cotización
        </button>
      </div>
    </div>`;

  const paintLines = () => {
    const box = root.querySelector('#lines-box');
    if (!lines.length) {
      box.innerHTML = '<p class="py-4 text-center text-sm text-slate-400">Agrega estudios con el buscador de arriba.</p>';
    } else {
      box.innerHTML = `
        <div class="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2">Estudio</th>
                <th class="px-3 py-2 w-24 text-center">Cantidad</th>
                <th class="px-3 py-2 w-28 text-right">P. Unitario</th>
                <th class="px-3 py-2 w-28 text-right">Importe</th>
                <th class="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${lines.map((l, i) => `
                <tr>
                  <td class="px-3 py-2 text-slate-700">${escapeHtml(l.name)}</td>
                  <td class="px-3 py-2"><input type="number" min="1" step="1" value="${l.quantity}" data-qty="${i}" class="w-full rounded border-0 bg-slate-50 px-2 py-1 text-center text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"></td>
                  <td class="px-3 py-2 text-right text-slate-600">$${l.unit_price.toFixed(2)}</td>
                  <td class="px-3 py-2 text-right font-semibold text-slate-800">$${(l.unit_price * l.quantity).toFixed(2)}</td>
                  <td class="px-3 py-2 text-right">
                    <button type="button" data-rm="${i}" class="text-slate-400 hover:text-red-600">${icon('x', 'h-4 w-4')}</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      box.querySelectorAll('[data-qty]').forEach((inp) =>
        inp.addEventListener('input', () => {
          const i = +inp.dataset.qty;
          lines[i].quantity = Math.max(1, parseFloat(inp.value || '1'));
          paintLines();
          paintTotals();
        }));
      box.querySelectorAll('[data-rm]').forEach((btn) =>
        btn.addEventListener('click', () => {
          lines.splice(+btn.dataset.rm, 1);
          paintLines();
          paintTotals();
        }));
    }
    paintTotals();
  };

  const paintTotals = () => {
    const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
    const pct = Math.max(0, Math.min(100, parseFloat(root.querySelector('#q-discount').value || '0')));
    const discount = subtotal * pct / 100;
    const total = subtotal - discount;
    root.querySelector('#totals-box').innerHTML = `
      <div class="flex justify-between text-slate-500"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="flex justify-between text-slate-500"><span>Descuento (${pct || 0}%)</span><span>-$${discount.toFixed(2)}</span></div>
      <div class="flex justify-between text-base font-bold text-slate-900"><span>Total</span><span>$${total.toFixed(2)}</span></div>`;
  };

  root.querySelector('#q-discount').addEventListener('input', paintTotals);

  /* ---- Buscador de estudios ---- */
  const studyInput = root.querySelector('#study-search');
  const studyBox = root.querySelector('#study-results');
  studyInput.addEventListener('input', debounce(async () => {
    const q = studyInput.value.trim();
    if (q.length < 2) { studyBox.classList.add('hidden'); return; }
    const { items } = await apiGet('quotes/search_studies', { q });
    if (!items.length) {
      studyBox.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias en el catálogo.</p>';
    } else {
      studyBox.innerHTML = items.map((s, i) => `
        <button type="button" data-idx="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-50">
          <span class="min-w-0 truncate text-sm font-medium text-slate-800">${escapeHtml(s.name)}</span>
          <span class="shrink-0 text-xs font-semibold text-slate-500">$${s.public_price.toFixed(2)}</span>
        </button>`).join('');
      studyBox.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          const s = items[+b.dataset.idx];
          const existing = lines.find((l) => l.study_id === s.id);
          if (existing) existing.quantity += 1;
          else lines.push({ study_id: s.id, name: s.name, unit_price: s.public_price, quantity: 1 });
          paintLines();
          studyBox.classList.add('hidden');
          studyInput.value = '';
        }));
    }
    studyBox.classList.remove('hidden');
  }, 250));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#study-search') && !e.target.closest('#study-results')) studyBox.classList.add('hidden');
  });

  /* ---- Buscador de paciente (prellenar datos del cliente) ---- */
  const patInput = root.querySelector('#pat-search');
  const patBox = root.querySelector('#pat-results');
  patInput.addEventListener('input', debounce(async () => {
    const q = patInput.value.trim();
    if (q.length < 2) { patBox.classList.add('hidden'); return; }
    const { patients } = await apiGet('quotes/search_patients', { q });
    if (!patients.length) {
      patBox.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias.</p>';
    } else {
      patBox.innerHTML = patients.map((p, i) => `
        <button type="button" data-idx="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-50">
          <span class="min-w-0 truncate text-sm font-medium text-slate-800">${escapeHtml(fullName(p))}</span>
          <span class="shrink-0 text-xs text-slate-500">${escapeHtml(p.file_number)}</span>
        </button>`).join('');
      patBox.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          const p = patients[+b.dataset.idx];
          root.querySelector('#q-name').value = fullName(p);
          root.querySelector('#q-phone').value = p.mobile || p.phone || '';
          root.querySelector('#q-address').value = [p.street, p.colonia, p.postal_code, p.city, p.state].filter(Boolean).join(', ');
          patBox.classList.add('hidden');
          patInput.value = '';
          toast('Datos del cliente cargados');
        }));
    }
    patBox.classList.remove('hidden');
  }, 300));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pat-search') && !e.target.closest('#pat-results')) patBox.classList.add('hidden');
  });

  root.querySelector('#btn-save').addEventListener('click', async () => {
    if (saving) return;
    if (!lines.length) { toast('Agrega al menos un estudio', 'error'); return; }
    saving = true;
    const btn = root.querySelector('#btn-save');
    btn.disabled = true;
    try {
      const res = await apiPost('quotes/save', {
        client_name: root.querySelector('#q-name').value.trim(),
        client_phone: root.querySelector('#q-phone').value.trim(),
        client_address: root.querySelector('#q-address').value.trim(),
        quote_date: root.querySelector('#q-date').value,
        discount_pct: parseFloat(root.querySelector('#q-discount').value || '0'),
        notes: root.querySelector('#q-notes').value.trim(),
        items: lines.map((l) => ({ study_id: l.study_id, name: l.name, unit_price: l.unit_price, quantity: l.quantity })),
      });
      modal({
        title: 'Cotización guardada',
        content: `<p class="text-sm text-slate-600">Folio <b class="font-mono text-slate-900">${escapeHtml(res.folio)}</b> guardado correctamente.</p>`,
        actions: [
          { label: 'Ver PDF', onClick: (close) => { window.open(`cotizacion.php?id=${res.id}`, '_blank'); close(); ctx.navigate('apps/cotizador'); } },
          { label: 'Volver al listado', primary: true, onClick: (close) => { close(); ctx.navigate('apps/cotizador'); } },
        ],
      });
    } catch (e) {
      toast(e.message, 'error');
      saving = false;
      btn.disabled = false;
    }
  });

  paintLines();
}

/* ================== Comisiones ================== */
let commissionListState = { items: [], total: 0, per_page: 25 };
let commissionFilters = { q: '', page: 1 };

function renderComisiones(root, view) {
  if (view === 'nuevo') return renderCommissionForm(root);
  return renderCommissionList(root);
}

async function renderCommissionList(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <a href="#/apps" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver a Apps
      </a>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="relative min-w-0 flex-1 sm:max-w-sm">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
          <input id="c-search" type="text" placeholder="Buscar por folio…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-white py-2.5 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <a href="#/apps/comisiones/nuevo"
           class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo estado de cuenta
        </a>
      </div>
      <div id="c-list">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#c-search');
  const load = async (resetPage = true) => {
    if (resetPage) commissionFilters.page = 1;
    commissionFilters.q = input.value.trim();
    commissionListState = await apiGet('commissions/list', commissionFilters);
    paintCommissionList(root.querySelector('#c-list'), load);
  };
  input.addEventListener('input', debounce(() => load(), 300));
  await load();
}

function paintCommissionList(box, load) {
  const { items, total, page, per_page: perPage } = commissionListState;
  const pages = Math.max(1, Math.ceil(total / perPage));

  if (!items.length) {
    box.innerHTML = `
      <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm font-medium text-slate-600">Sin estados de cuenta generados</p>
        <p class="mt-1 text-xs text-slate-400">Crea el primero con el botón de arriba.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Folio</th>
              <th class="px-4 py-3">Médico / Concierge</th>
              <th class="hidden px-4 py-3 sm:table-cell">Periodo</th>
              <th class="px-4 py-3 text-right">Comisión</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${items.map((s) => `
              <tr>
                <td class="px-4 py-3 font-mono text-xs font-semibold text-slate-700">${escapeHtml(s.folio)}</td>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(s.party_name)}
                  <span class="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">${s.party_type === 'concierge' ? 'Concierge' : 'Médico'}</span>
                </td>
                <td class="hidden px-4 py-3 text-slate-500 sm:table-cell">${escapeHtml(s.period_start)} — ${escapeHtml(s.period_end)}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-700">$${Number(s.total_commission).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <a href="comision.php?id=${s.id}" target="_blank" title="Ver PDF"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('eye', 'h-4 w-4')}</a>
                    <a href="comision.php?id=${s.id}&download=1" title="Descargar PDF"
                       class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('download', 'h-4 w-4')}</a>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="mt-3 flex items-center justify-center gap-3">
      <button id="pg-prev" ${page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
      <span class="text-sm text-slate-500">Página ${page} de ${pages} · ${total} estado(s) de cuenta</span>
      <button id="pg-next" ${page >= pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
    </div>`;

  box.querySelector('#pg-prev')?.addEventListener('click', () => { commissionFilters.page--; load(false); });
  box.querySelector('#pg-next')?.addEventListener('click', () => { commissionFilters.page++; load(false); });
}

function defaultPeriodStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultPeriodEnd() {
  return new Date().toISOString().slice(0, 10);
}

/** Selector de médico/concierge + rango de fechas → vista previa con incluir/excluir → generar PDF. */
async function renderCommissionForm(root) {
  const { doctors, concierge } = await apiGet('commissions/parties');
  let lines = [];
  let saving = false;

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <a href="#/apps/comisiones" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver al listado
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Nuevo estado de cuenta de comisiones</h3>
        <p class="text-sm text-slate-500">Elige a quién y el periodo; revisa las líneas antes de generar el PDF.</p>
      </div>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label class="${labelCls}">Tipo</label>
            <select id="c-party-type" class="${inputCls}">
              <option value="doctor">Médico</option>
              <option value="concierge">Concierge</option>
            </select>
          </div>
          <div class="sm:col-span-2 lg:col-span-1">
            <label class="${labelCls}">Médico / Concierge</label>
            <select id="c-party-id" class="${inputCls}"></select>
          </div>
          <div>
            <label class="${labelCls}">Desde</label>
            <input type="date" id="c-from" value="${defaultPeriodStart()}" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Hasta</label>
            <input type="date" id="c-to" value="${defaultPeriodEnd()}" class="${inputCls}">
          </div>
        </div>
        <div class="mt-4">
          <button id="btn-preview" type="button" class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Vista previa</button>
        </div>
      </section>

      <div id="c-lines-box"></div>

      <div class="flex justify-end">
        <button id="btn-generate" type="button" disabled
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
          ${icon('check-square', 'h-4 w-4')} Generar estado de cuenta
        </button>
      </div>
    </div>`;

  const typeSel = root.querySelector('#c-party-type');
  const partySel = root.querySelector('#c-party-id');
  const linesBox = root.querySelector('#c-lines-box');
  const genBtn = root.querySelector('#btn-generate');

  const paintPartyOptions = () => {
    const opts = typeSel.value === 'concierge'
      ? concierge.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      : doctors.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}${d.concierge_name ? ' — ' + escapeHtml(d.concierge_name) : ''}</option>`);
    partySel.innerHTML = opts.join('') || '<option value="">— Sin registros —</option>';
  };
  typeSel.addEventListener('change', paintPartyOptions);
  paintPartyOptions();

  const paintLines = () => {
    genBtn.disabled = !lines.length;
    if (!lines.length) {
      linesBox.innerHTML = '<div class="rounded-2xl bg-white py-10 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">Sin vista previa todavía.</div>';
      return;
    }
    const total = lines.reduce((sum, l) => sum + (l.commission_included ? l.commission_amount : 0), 0);
    linesBox.innerHTML = `
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2 w-10"></th>
                <th class="px-3 py-2">Paciente / Estudio</th>
                <th class="px-3 py-2 text-right">Monto</th>
                <th class="px-3 py-2 text-center">%</th>
                <th class="px-3 py-2 text-right">Comisión</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${lines.map((l) => `
                <tr class="${l.commission_included ? '' : 'opacity-40'}">
                  <td class="px-3 py-2"><input type="checkbox" data-toggle="${l.id}" ${l.commission_included ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"></td>
                  <td class="px-3 py-2">
                    <span class="block font-medium text-slate-800">${escapeHtml(l.patient_name)}</span>
                    <span class="block text-xs text-slate-500">${escapeHtml(l.study_name)} · ${escapeHtml(l.file_number)}</span>
                  </td>
                  <td class="px-3 py-2 text-right text-slate-700">$${Number(l.amount_charged).toFixed(2)}</td>
                  <td class="px-3 py-2 text-center text-slate-500">${Number(l.commission_pct).toFixed(1)}%</td>
                  <td class="px-3 py-2 text-right font-semibold text-slate-800">$${Number(l.commission_amount).toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
        <span class="text-sm font-semibold text-slate-600">Total comisión (solo incluidas)</span>
        <span class="text-base font-bold text-slate-800">$${total.toFixed(2)}</span>
      </div>`;

    linesBox.querySelectorAll('[data-toggle]').forEach((cb) =>
      cb.addEventListener('change', async () => {
        const line = lines.find((l) => l.id === +cb.dataset.toggle);
        cb.disabled = true;
        try {
          const res = await apiPost('commissions/toggle_line', { id: line.id });
          line.commission_included = res.commission_included;
          paintLines();
        } catch (e) {
          toast(e.message, 'error');
          cb.disabled = false;
        }
      }));
  };
  paintLines();

  const currentParams = () => ({
    party_type: typeSel.value,
    party_id: +partySel.value || 0,
    period_start: root.querySelector('#c-from').value,
    period_end: root.querySelector('#c-to').value,
  });

  root.querySelector('#btn-preview').addEventListener('click', async () => {
    const p = currentParams();
    if (!p.party_id) { toast('Elige un médico o concierge', 'error'); return; }
    try {
      const res = await apiGet('commissions/preview', p);
      lines = res.lines;
      paintLines();
      if (!lines.length) toast('No hay estudios comisionables en ese periodo', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  genBtn.addEventListener('click', async () => {
    if (saving) return;
    const included = lines.filter((l) => l.commission_included);
    if (!included.length) { toast('No hay líneas incluidas para generar el estado de cuenta', 'error'); return; }
    saving = true;
    genBtn.disabled = true;
    try {
      const res = await apiPost('commissions/save', currentParams());
      modal({
        title: 'Estado de cuenta generado',
        content: `<p class="text-sm text-slate-600">Folio <b class="font-mono text-slate-900">${escapeHtml(res.folio)}</b> guardado correctamente.</p>`,
        actions: [
          { label: 'Ver PDF', onClick: (close) => { window.open(`comision.php?id=${res.id}`, '_blank'); close(); ctx.navigate('apps/comisiones'); } },
          { label: 'Volver al listado', primary: true, onClick: (close) => { close(); ctx.navigate('apps/comisiones'); } },
        ],
      });
    } catch (e) {
      toast(e.message, 'error');
      saving = false;
      genBtn.disabled = false;
    }
  });
}
