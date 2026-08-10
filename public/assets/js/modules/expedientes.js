/** Módulo Expedientes: búsqueda, tarjetas, detalle, subsecuentes, edición (admin). */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, field, formValues,
  inputCls, labelCls, debounce, spinner, fmtDate, fmtDateTime, calcAge, fullName, mdLite,
} from '../ui.js';
import { SERVICES, PATIENT_FIELDS, CLINICAL_FIELDS, loadCatalog } from '../services.js';
import { sectionsHtml, initSections, collectSections, dataRowsHtml } from '../forms.js';

let ctx;
let catalog = null;

function myFlags() {
  return ctx.modules.find((m) => m.key === 'expedientes')?.flags || {};
}

function isAdminUser() {
  return ctx.user.role === 'administrador' || ctx.user.role === 'developper';
}

/** ¿Puedo completar la etapa médica de este episodio? Admin o el responsable asignado. */
function canCompleteEpisode(e) {
  return isAdminUser() || (e.assigned_user_id !== null && Number(e.assigned_user_id) === Number(ctx.user.id));
}

/* ================= Gráfica de progreso (Control de peso) ================= */
const CHART_METRICS = [
  ['peso_kg', 'Peso (kg)'],
  ['imc', 'IMC'],
  ['per_cintura', 'Cintura (cm)'],
  ['bio_grasa_pct', '% Grasa corporal'],
];

function chartPoints(e, metricKey) {
  const pts = [];
  const admVal = parseFloat(e.service_data?.[metricKey]);
  if (!isNaN(admVal)) pts.push({ date: e.admission_date, value: admVal });
  const sorted = [...e.consultations].sort((a, b) => a.consult_date.localeCompare(b.consult_date));
  for (const c of sorted) {
    const v = parseFloat(c.params?.[metricKey]);
    if (!isNaN(v)) pts.push({ date: c.consult_date, value: v });
  }
  return pts;
}

function renderChartSvg(points) {
  if (points.length < 2) {
    return `<p class="py-6 text-center text-xs text-slate-400">Aún no hay suficientes registros para graficar (mínimo 2 visitas con este dato).</p>`;
  }
  const W = 560;
  const H = 170;
  const PAD = 28;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const x = (i) => PAD + i * stepX;
  const y = (v) => H - PAD - ((v - min) / range) * (H - PAD * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="#4f46e5">
      <title>${fmtDate(p.date)}: ${p.value}</title>
    </circle>`).join('');
  const labels = points.map((p, i) => `
    <text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="9" fill="#94a3b8" text-anchor="middle">${fmtDate(p.date).replace(/ de \d+$/, '')}</text>`).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="h-40 w-full">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#e2e8f0" stroke-width="1"/>
      <path d="${path}" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      ${labels}
    </svg>`;
}

function progressChartHtml(e) {
  return `
    <div class="rounded-xl bg-slate-50 px-4 py-3">
      <div class="mb-1 flex items-center justify-between">
        <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Progreso</p>
        <select data-chart-metric="${e.id}" class="rounded-lg border-0 bg-white px-2 py-1 text-xs shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
          ${CHART_METRICS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
      </div>
      <div data-chart-box="${e.id}">${renderChartSvg(chartPoints(e, CHART_METRICS[0][0]))}</div>
    </div>`;
}

export async function render(root, context) {
  ctx = context;
  catalog = await loadCatalog();
  const [patientId] = context.args;
  if (patientId && /^\d+$/.test(patientId)) {
    await renderDetail(root, +patientId);
  } else {
    renderList(root);
  }
}

/* ================= Lista ================= */
function renderList(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div class="relative">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-5 w-5')}</span>
        <input id="patient-q" type="text" placeholder="Buscar por nombre, folio o teléfono…" autocomplete="off"
               class="w-full rounded-xl border-0 bg-white py-3 pl-11 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
      </div>
      <div id="patients-box">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#patient-q');
  let page = 1;
  const load = async () => {
    const box = root.querySelector('#patients-box');
    const data = await apiGet('patients/list', { q: input.value.trim(), page });
    box.innerHTML = data.patients.length ? `
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        ${data.patients.map((p) => cardHtml(p)).join('')}
      </div>
      ${data.pages > 1 ? `
      <div class="mt-4 flex items-center justify-center gap-3">
        <button id="pg-prev" ${page <= 1 ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Anterior</button>
        <span class="text-sm text-slate-500">Página ${data.page} de ${data.pages}</span>
        <button id="pg-next" ${page >= data.pages ? 'disabled' : ''} class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 disabled:opacity-40">Siguiente</button>
      </div>` : ''}
      <p class="mt-3 text-center text-xs text-slate-400">${data.total} paciente(s)</p>`
      : `<div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
          <p class="text-sm font-medium text-slate-600">Sin resultados</p>
          <p class="mt-1 text-xs text-slate-400">Los pacientes se registran desde el módulo Admisión.</p>
        </div>`;
    box.querySelector('#pg-prev')?.addEventListener('click', () => { page--; load(); });
    box.querySelector('#pg-next')?.addEventListener('click', () => { page++; load(); });
  };
  input.addEventListener('input', debounce(() => { page = 1; load(); }, 300));
  load();
}

function cardHtml(p) {
  const age = calcAge(p.birth_date);
  const services = Object.keys(p.services || {});
  return `
    <a href="#/expedientes/${p.id}" class="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-slate-900">${escapeHtml(fullName(p))}</p>
          <p class="mt-0.5 text-xs text-slate-500">
            ${escapeHtml(p.file_number)}${age !== null ? ` · ${age} años` : ''}${p.sex ? ` · ${p.sex}` : ''}
          </p>
        </div>
        <span class="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-600">${escapeHtml(p.file_number.split('-').pop())}</span>
      </div>
      ${services.length ? `
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${services.map((s) => {
          const svc = SERVICES[s] || { label: s, color: 'bg-slate-100 text-slate-600' };
          return `<span class="rounded-full ${svc.color} px-2 py-0.5 text-[11px] font-semibold">${svc.label}</span>`;
        }).join('')}
      </div>` : ''}
    </a>`;
}

/* ================= Detalle ================= */
async function renderDetail(root, patientId) {
  root.innerHTML = spinner();
  let data;
  try {
    data = await apiGet('patients/get', { id: patientId });
  } catch (e) {
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
    return;
  }
  const { patient: p, episodes } = data;
  const flags = myFlags();
  const age = calcAge(p.birth_date);

  const infoRow = (label, value) => value
    ? `<div><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">${label}</dt><dd class="mt-0.5 text-sm text-slate-800">${escapeHtml(value)}</dd></div>`
    : '';

  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-5">
      <a href="#/expedientes" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver a expedientes
      </a>

      <!-- Encabezado -->
      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-lg font-bold text-indigo-700">
              ${escapeHtml((p.first_name[0] || '') + (p.paternal_surname[0] || ''))}
            </div>
            <div>
              <h3 class="text-lg font-bold text-slate-900">${escapeHtml(fullName(p))}</h3>
              <p class="text-sm text-slate-500">${escapeHtml(p.file_number)}${age !== null ? ` · ${age} años` : ''}${p.sex ? ` · ${p.sex === 'F' ? 'Femenino' : p.sex === 'M' ? 'Masculino' : 'Otro'}` : ''}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="btn-new-consult" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              ${icon('plus', 'h-4 w-4')} Nuevo
            </button>
            <a href="print.php?patient_id=${p.id}" target="_blank" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${icon('printer', 'h-4 w-4')} PDF
            </a>
            ${flags.edit ? `
            <button id="btn-edit" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${icon('edit', 'h-4 w-4')} Editar
            </button>` : ''}
            ${flags.delete ? `
            <button id="btn-delete" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">
              ${icon('trash', 'h-4 w-4')} Eliminar
            </button>` : ''}
            ${flags.dx_assist ? `
            <button id="btn-dx" type="button"
                    class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-500">
              ${icon('sparkles', 'h-4 w-4')} Dx Assist
            </button>` : ''}
          </div>
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:grid-cols-4">
          ${infoRow('Nacimiento', p.birth_date ? fmtDate(p.birth_date) : '')}
          ${infoRow('Grupo sanguíneo', p.blood_type)}
          ${infoRow('Estado civil', p.marital_status)}
          ${infoRow('Ocupación', p.occupation)}
          ${infoRow('Nacionalidad', p.nationality)}
          ${infoRow('Religión', p.religion)}
          ${infoRow('Celular', p.mobile)}
          ${infoRow('Teléfono', p.phone)}
          ${infoRow('Email', p.email)}
          ${infoRow('Dirección', [p.street, p.colonia, p.postal_code, p.city].filter(Boolean).join(', '))}
          ${infoRow('Emergencia', [p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(' · '))}
          ${infoRow('Titular / a cargo', [p.guardian_name, p.guardian_phone, p.guardian_relationship].filter(Boolean).join(' · '))}
        </dl>

        ${(p.allergies || p.chronic_conditions || p.family_history || p.current_medications || p.notes) ? `
        <div class="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
          ${p.allergies ? clinicalBox('Alergias', p.allergies, 'bg-red-50 text-red-800 ring-red-200') : ''}
          ${p.chronic_conditions ? clinicalBox('Antecedentes patológicos', p.chronic_conditions, 'bg-amber-50 text-amber-800 ring-amber-200') : ''}
          ${p.family_history ? clinicalBox('Heredofamiliares', p.family_history, 'bg-slate-50 text-slate-700 ring-slate-200') : ''}
          ${p.current_medications ? clinicalBox('Medicamentos', p.current_medications, 'bg-sky-50 text-sky-800 ring-sky-200') : ''}
          ${p.notes ? clinicalBox('Notas', p.notes, 'bg-slate-50 text-slate-700 ring-slate-200') : ''}
        </div>` : ''}
      </div>

      <!-- Documentos adjuntos -->
      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h4 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Documentos adjuntos</h4>
        <div id="patient-docs">${spinner()}</div>
      </div>

      <!-- Timeline de episodios -->
      <div>
        <h4 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Historial por servicio</h4>
        ${episodes.length ? `<div class="space-y-4">${episodes.map((e) => episodeHtml(e)).join('')}</div>`
          : '<div class="rounded-2xl bg-white py-10 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">Sin episodios registrados.</div>'}
      </div>
    </div>`;

  root.querySelector('#btn-new-consult').addEventListener('click', () => openConsultModal(p, episodes, patientId));
  loadPatientDocs(root, patientId);

  root.querySelectorAll('[data-chart-metric]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const ep = episodes.find((x) => x.id === +sel.dataset.chartMetric);
      const box = root.querySelector(`[data-chart-box="${ep.id}"]`);
      box.innerHTML = renderChartSvg(chartPoints(ep, sel.value));
    });
  });
  root.querySelectorAll('[data-complete-consult]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const consultId = +btn.dataset.completeConsult;
      const ep = episodes.find((x) => x.consultations.some((c) => c.id === consultId));
      const consult = ep.consultations.find((c) => c.id === consultId);
      openCompleteConsultModal(consult, ep, patientId);
    });
  });

  root.querySelectorAll('[data-resend-ficha]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Reenviar ficha',
        'Se enviará de nuevo la ficha de identificación al correo del paciente. ¿Continuar?',
        { confirmLabel: 'Enviar' }
      );
      if (!ok) return;
      btn.disabled = true;
      try {
        const res = await apiPost('episodes/resend_ficha', { episode_id: +btn.dataset.resendFicha });
        toast(res.to ? `Ficha enviada a ${res.to}` : 'Ficha enviada (solo copia interna)');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-delivery-date]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await apiPost('episodes/set_delivery', {
          episode_id: +input.dataset.deliveryDate,
          expected_delivery_date: input.value,
        });
        toast('Fecha de entrega actualizada');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
  root.querySelectorAll('[data-mark-delivered]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('Marcar como entregado', '¿Confirmas que los resultados de este estudio ya se entregaron?', { confirmLabel: 'Marcar entregado' });
      if (!ok) return;
      try {
        await apiPost('episodes/set_delivery', { episode_id: +btn.dataset.markDelivered, delivered: true });
        toast('Resultados marcados como entregados');
        renderDetail(root, patientId);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
  root.querySelectorAll('[data-undo-delivery]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('Deshacer entrega', '¿Quitar la marca de "entregado" de este estudio?', { danger: true, confirmLabel: 'Deshacer' });
      if (!ok) return;
      try {
        await apiPost('episodes/set_delivery', { episode_id: +btn.dataset.undoDelivery, delivered: false });
        toast('Entrega deshecha');
        renderDetail(root, patientId);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });

  const dxBtn = root.querySelector('#btn-dx');
  if (dxBtn) {
    // Sin asistente configurado el botón no sirve de nada: se muestra solo si está listo
    dxBtn.classList.add('hidden');
    dxBtn.addEventListener('click', () => openDxAssist(p));
    assistantReady().then((ready) => ready && dxBtn.classList.remove('hidden'));
  }

  root.querySelector('#btn-edit')?.addEventListener('click', () => openEditModal(p, patientId));
  root.querySelector('#btn-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Eliminar expediente',
      `Se eliminará el expediente completo de ${fullName(p)} (${p.file_number}). ¿Continuar?`,
      { danger: true, confirmLabel: 'Eliminar' }
    );
    if (!ok) return;
    try {
      await apiPost('patients/delete', { id: p.id });
      toast('Expediente eliminado');
      ctx.navigate('expedientes');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

/* ================= Documentos adjuntos ================= */
function fmtBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadPatientDocs(root, patientId) {
  const box = root.querySelector('#patient-docs');
  if (!box) return;
  let documents;
  try {
    ({ documents } = await apiGet('patients/doc_list', { patient_id: patientId }));
  } catch (e) {
    box.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(e.message)}</p>`;
    return;
  }
  paintPatientDocs(box, documents, patientId);
}

function paintPatientDocs(box, documents, patientId) {
  const isAdmin = isAdminUser();
  if (!documents.length) {
    box.innerHTML = '<p class="text-sm text-slate-400">Sin documentos adjuntos.</p>';
    return;
  }
  box.innerHTML = `
    <div class="space-y-2">
      ${documents.map((d) => `
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-800">${escapeHtml(d.name)}</p>
            <p class="text-xs text-slate-400">
              ${fmtBytes(d.size)} · ${fmtDateTime(d.created_at)}${d.created_by_name ? ' · ' + escapeHtml(d.created_by_name) : ''}
              ${d.notes ? ' · ' + escapeHtml(d.notes) : ''}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <a href="documento_expediente.php?id=${d.id}" target="_blank" title="Ver"
               class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('eye', 'h-4 w-4')}</a>
            <a href="documento_expediente.php?id=${d.id}&download=1" title="Descargar"
               class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('download', 'h-4 w-4')}</a>
            ${isAdmin ? `<button type="button" data-del-doc="${d.id}" title="Eliminar"
               class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
          </div>
        </div>`).join('')}
    </div>`;

  box.querySelectorAll('[data-del-doc]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const d = documents.find((x) => x.id === +btn.dataset.delDoc);
      const ok = await confirmDialog('Eliminar documento', `Se eliminará "${d.name}" del expediente. ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('patients/doc_delete', { id: d.id });
        toast('Documento eliminado');
        const { documents: fresh } = await apiGet('patients/doc_list', { patient_id: patientId });
        paintPatientDocs(box, fresh, patientId);
      } catch (e) {
        toast(e.message, 'error');
      }
    }));
}

function clinicalBox(label, text, cls) {
  return `<div class="rounded-xl px-3.5 py-2.5 ring-1 ${cls}">
    <p class="text-[11px] font-bold uppercase tracking-wide opacity-70">${label}</p>
    <p class="mt-0.5 whitespace-pre-line text-sm">${escapeHtml(text)}</p>
  </div>`;
}

/** Fecha de entrega estimada de resultados (Laboratorio): editable, con botón para marcar entregado. */
function studiesBlockHtml(e) {
  if (!e.studies || !e.studies.length) return '';
  const total = e.studies.reduce((sum, s) => sum + Number(s.amount_charged), 0);
  return `
    <div class="rounded-xl bg-slate-50 px-4 py-3">
      <p class="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Estudios realizados</p>
      <div class="space-y-1.5">
        ${e.studies.map((s) => `
          <div class="flex justify-between gap-4 text-sm">
            <span class="text-slate-500">${escapeHtml(s.study_name)}</span>
            <span class="text-right font-medium text-slate-800">$${Number(s.amount_charged).toFixed(2)}</span>
          </div>`).join('')}
        <div class="flex justify-between gap-4 border-t border-slate-200 pt-1.5 text-sm font-semibold">
          <span class="text-slate-600">Total cobrado</span>
          <span class="text-slate-900">$${total.toFixed(2)}</span>
        </div>
      </div>
    </div>`;
}

function deliveryRowHtml(e) {
  if (e.results_delivered_at) {
    return `
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          ${icon('check-square', 'h-3.5 w-3.5')} Resultados entregados · ${fmtDateTime(e.results_delivered_at)}
        </span>
        <button type="button" data-undo-delivery="${e.id}" class="text-xs font-semibold text-slate-400 hover:text-slate-600">Deshacer</button>
      </div>`;
  }
  return `
    <div class="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <span class="font-semibold text-slate-500">Entrega estimada:</span>
      <input type="date" data-delivery-date="${e.id}" value="${e.expected_delivery_date || ''}"
             class="rounded-lg border-0 bg-slate-50 px-2 py-1 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
      <button type="button" data-mark-delivered="${e.id}" class="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
        Marcar como entregado
      </button>
    </div>`;
}

function episodeHtml(e) {
  const svc = SERVICES[e.service] || { label: e.service, color: 'bg-slate-100 text-slate-700', icon: 'folder' };
  const admSections = catalog[e.service]?.admission || [];
  const sesSections = catalog[e.service]?.session || [];
  const isControlPeso = e.service === 'control_peso';
  // En Control de peso, la sección del médico se oculta al capturar (la llena después, aparte)
  const nurseSesSections = isControlPeso ? sesSections.filter((s) => s.stage !== 'doctor') : sesSections;

  return `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${svc.color}">${icon(svc.icon, 'h-5 w-5')}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-bold text-slate-900">${svc.label}
            ${e.service_folio ? `<span class="ml-2 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200">Orden ${escapeHtml(e.service_folio)}</span>` : ''}
          </p>
          <p class="text-xs text-slate-500">Admisión: ${fmtDateTime(e.admission_date)}</p>
        </div>
        <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${e.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${e.status}</span>
        <div class="flex shrink-0 items-center gap-1">
          <a href="ficha.php?episode_id=${e.id}" target="_blank" title="Ver la ficha de identificación"
             class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('file-text', 'h-4 w-4')}</a>
          <button type="button" data-resend-ficha="${e.id}" title="Reenviar la ficha por correo"
                  class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('send', 'h-4 w-4')}</button>
        </div>
      </div>
      <div class="space-y-3 px-5 py-4">
        ${e.reason ? `<p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Motivo:</span> ${escapeHtml(e.reason)}</p>` : ''}
        ${e.referring_doctor ? `<p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Médico:</span> ${escapeHtml(e.referring_doctor)}</p>` : ''}
        <p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Responsable asignado:</span> ${e.assigned_user_name ? escapeHtml(e.assigned_user_name) : 'General (todos con acceso lo ven)'}</p>
        ${e.service === 'laboratorio' ? deliveryRowHtml(e) : ''}
        ${e.service === 'laboratorio' ? studiesBlockHtml(e) : ''}
        ${dataRowsHtml(admSections, e.service_data)}
        ${isControlPeso ? progressChartHtml(e) : ''}
        ${e.consultations.length ? `
        <div>
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Consultas subsecuentes (${e.consultations.length})</p>
          <div class="space-y-2">
            ${e.consultations.map((c) => {
              const pending = isControlPeso && c.nurse_closed_at && !c.doctor_closed_at;
              const complete = isControlPeso && !!c.doctor_closed_at;
              return `
              <div class="rounded-xl bg-slate-50 px-4 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <p class="text-xs font-semibold text-slate-500">${fmtDateTime(c.consult_date)}</p>
                    ${pending ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Pendiente médico</span>' : ''}
                    ${complete ? '<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Completa</span>' : ''}
                  </div>
                  ${c.created_by_name ? `<p class="text-xs text-slate-400">${escapeHtml(c.created_by_name)}</p>` : ''}
                </div>
                ${c.notes ? `<p class="mt-1 whitespace-pre-line text-sm text-slate-700">${escapeHtml(c.notes)}</p>` : ''}
                <div class="mt-2 space-y-2">${dataRowsHtml(isControlPeso ? sesSections : nurseSesSections, c.params)}</div>
                ${pending && canCompleteEpisode(e) ? `
                <button type="button" data-complete-consult="${c.id}"
                        class="mt-3 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-500">
                  ${icon('edit', 'h-3.5 w-3.5')} Completar consulta (médico)
                </button>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>`;
}

/* ================= Dx Assist ================= */

/** ¿Hay asistente configurado? Se consulta una sola vez por carga de la app. */
let readyPromise = null;
function assistantReady() {
  readyPromise ??= apiGet('assistant/status').then((d) => !!d.ready).catch(() => false);
  return readyPromise;
}

/** Chat de apoyo diagnóstico: el servidor manda el expediente al asistente. */
function openDxAssist(patient) {
  const box = document.createElement('div');
  box.innerHTML = `
    <div class="mb-3 rounded-xl bg-violet-50 px-4 py-3 ring-1 ring-violet-200">
      <p class="text-sm font-semibold text-violet-900">${escapeHtml(fullName(patient))} · ${escapeHtml(patient.file_number)}</p>
      <p class="mt-0.5 text-xs text-violet-700">
        Apoyo diagnóstico generado por IA a partir del expediente. La decisión clínica corresponde al médico tratante.
      </p>
    </div>
    <div id="dx-messages" class="max-h-[46vh] min-h-[12rem] space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3"></div>
    <form id="dx-form" class="mt-3 flex items-center gap-2">
      <input id="dx-input" type="text" autocomplete="off" placeholder="Pregunta algo sobre este expediente…"
             class="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-indigo-400">
      <button type="submit" aria-label="Enviar"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500">
        ${icon('send', 'h-4 w-4')}
      </button>
    </form>`;

  modal({ title: 'Dx Assist', content: box, size: 'max-w-2xl', actions: [{ label: 'Cerrar' }] });

  const messages = box.querySelector('#dx-messages');
  const input = box.querySelector('#dx-input');
  const history = [];

  const addMsg = (text, who) => {
    const el = document.createElement('div');
    el.className = who === 'user'
      ? 'ml-8 rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white'
      : 'mr-8 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200';
    el.innerHTML = who === 'user' ? escapeHtml(text) : mdLite(text);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  };

  const ask = async (text) => {
    const typing = addMsg('Analizando el expediente…', 'bot');
    const sending = [...history];
    if (text) history.push({ role: 'user', text });
    try {
      const data = await apiPost('assistant/dx', {
        patient_id: patient.id,
        message: text,
        history: sending,
      });
      typing.innerHTML = mdLite(data.reply);
      history.push({ role: 'model', text: data.reply });
    } catch (e) {
      typing.textContent = e.message;
      typing.className = 'mr-8 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200';
      if (text) history.pop();
    }
  };

  box.querySelector('#dx-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'user');
    ask(text);
  });

  // Primer análisis automático al abrir
  ask('');
}

/* ================= Consulta subsecuente ================= */
function openConsultModal(patient, episodes, patientId) {
  if (!episodes.length) {
    toast('Este paciente no tiene episodios. Regístralo primero en Admisión.', 'info');
    return;
  }
  const form = document.createElement('form');
  const options = episodes.map((e) => {
    const svc = SERVICES[e.service] || { label: e.service };
    return `<option value="${e.id}">${svc.label} · admisión ${fmtDate(e.admission_date)}${e.status !== 'activo' ? ' (cerrado)' : ''}</option>`;
  }).join('');
  form.innerHTML = `
    <div class="space-y-4">
      <div><label class="${labelCls}">Episodio *</label>
        <select name="episode_id" required class="${inputCls}">${options}</select></div>
      <div id="consult-params" class="space-y-4"></div>
      <div><label class="${labelCls}">Notas de evolución</label>
        <textarea name="notes" rows="3" class="${inputCls}" placeholder="Observaciones de la consulta, exploración o sesión…"></textarea></div>
    </div>`;

  const select = form.querySelector('[name=episode_id]');
  const paramsBox = form.querySelector('#consult-params');
  let currentSections = [];
  const renderParams = () => {
    const ep = episodes.find((e) => e.id === +select.value);
    const sesSections = catalog[ep?.service]?.session || [];
    // La sección del médico se llena después, aparte (ver "Completar consulta")
    currentSections = ep?.service === 'control_peso' ? sesSections.filter((s) => s.stage !== 'doctor') : sesSections;
    paramsBox.innerHTML = sectionsHtml(currentSections, { compact: true });
    initSections(form);
    // Número de sesión sugerido: consultas previas del episodio + 1
    const num = form.querySelector('[name=numero_sesion]');
    if (num && ep) num.value = (ep.consultations?.length || 0) + 1;
  };
  select.addEventListener('change', renderParams);

  modal({
    title: 'Nueva consulta subsecuente',
    content: form,
    size: 'max-w-3xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar consulta', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          const params = collectSections(form, currentSections);
          try {
            await apiPost('consultations/create', { episode_id: +v.episode_id, notes: v.notes, params });
            toast('Consulta registrada');
            close();
            renderDetail(document.getElementById('module-root'), patientId);
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });

  // Renderizar después de que el modal esté en el DOM (la firma mide el canvas)
  renderParams();
}

/** El responsable asignado (o admin) completa la parte médica y consolida la sesión. */
function openCompleteConsultModal(consult, episode, patientId) {
  const doctorSections = (catalog[episode.service]?.session || []).filter((s) => s.stage === 'doctor');
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-800 ring-1 ring-violet-200">
        Visita del ${fmtDateTime(consult.consult_date)}. Al cerrar, esta consulta queda consolidada como completa.
      </div>
      ${sectionsHtml(doctorSections, { compact: true })}
    </div>`;

  modal({
    title: 'Completar consulta (médico)',
    content: form,
    size: 'max-w-2xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Cerrar consulta completa', primary: true,
        onClick: async (close, btn) => {
          btn.disabled = true;
          const params = collectSections(form, doctorSections);
          try {
            await apiPost('consultations/complete_doctor', { id: consult.id, params });
            toast('Consulta completada');
            close();
            renderDetail(document.getElementById('module-root'), patientId);
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
  initSections(form);
}

/* ================= Edición (solo admin) ================= */
function openEditModal(p, patientId) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${PATIENT_FIELDS.map((f) => field(f, p[f.key] || '')).join('')}
    </div>
    <p class="mb-3 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500">Antecedentes</p>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${CLINICAL_FIELDS.map((f) => field(f, p[f.key] || '')).join('')}
    </div>`;

  modal({
    title: `Editar expediente · ${p.file_number}`,
    content: form,
    size: 'max-w-2xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar cambios', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('patients/update', { id: p.id, ...v });
            toast('Expediente actualizado');
            close();
            renderDetail(document.getElementById('module-root'), patientId);
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}
