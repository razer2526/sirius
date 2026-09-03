/** Módulo Expedientes: búsqueda, tarjetas, detalle, subsecuentes, edición (admin). */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, field, formValues,
  inputCls, labelCls, debounce, spinner, fmtDate, fmtDateTime, calcAge, fullName, mdLite,
} from '../ui.js';
import { SERVICES, PATIENT_FIELDS, CLINICAL_FIELDS, loadCatalog } from '../services.js';
import { sectionsHtml, initSections, fillSections, collectSections, dataRowsHtml } from '../forms.js';
import { renderProgressChart } from '../progress_chart.js';
import { renderBodySilhouette } from '../body_silhouette.js';

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
      <div class="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-4">
        <div class="sm:col-span-2">
          <label class="${labelCls}">Área</label>
          <select id="f-service" class="${inputCls}">
            <option value="">Todas</option>
            ${Object.entries(SERVICES).map(([key, s]) => `<option value="${escapeHtml(key)}">${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="${labelCls}">Desde</label>
          <input id="f-date-from" type="date" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Hasta</label>
          <input id="f-date-to" type="date" class="${inputCls}">
        </div>
      </div>
      <div id="patients-box">${spinner()}</div>
    </div>`;

  const input = root.querySelector('#patient-q');
  const serviceSel = root.querySelector('#f-service');
  const dateFrom = root.querySelector('#f-date-from');
  const dateTo = root.querySelector('#f-date-to');
  let page = 1;
  const load = async () => {
    const box = root.querySelector('#patients-box');
    const data = await apiGet('patients/list', {
      q: input.value.trim(), page,
      service: serviceSel.value, date_from: dateFrom.value, date_to: dateTo.value,
    });
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
  serviceSel.addEventListener('change', () => { page = 1; load(); });
  dateFrom.addEventListener('change', () => { page = 1; load(); });
  dateTo.addEventListener('change', () => { page = 1; load(); });
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
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Documentos adjuntos</h4>
          <div class="flex flex-wrap gap-2">
            <button id="btn-upload-doc" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${icon('upload', 'h-4 w-4')} Subir archivo
            </button>
            <button id="btn-view-docs" type="button" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${icon('folder-open', 'h-4 w-4')} Archivos adjuntos
              <span id="patient-docs-count" class="rounded-full bg-slate-100 px-1.5 text-xs font-bold text-slate-500"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Visitas en pestañas -->
      <div id="visits-section">${visitsSectionHtml(episodes)}</div>
    </div>`;

  wireVisits(root, p, episodes, patientId);

  root.querySelector('#btn-new-consult').addEventListener('click', () => openConsultModal(p, episodes, patientId));
  refreshPatientDocsCount(root, patientId);
  root.querySelector('#btn-upload-doc').addEventListener('click', () => openUploadDocModal(patientId, () => refreshPatientDocsCount(root, patientId)));
  root.querySelector('#btn-view-docs').addEventListener('click', () => openDocsModal(patientId, () => refreshPatientDocsCount(root, patientId)));

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
const DOC_CATEGORIES = ['Análisis clínicos', 'Estudio de imagen', 'Historial médico previo', 'Nota médica', 'Otro'];

function fmtBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function refreshPatientDocsCount(root, patientId) {
  const badge = root.querySelector('#patient-docs-count');
  if (!badge) return;
  try {
    const { documents } = await apiGet('patients/doc_list', { patient_id: patientId });
    badge.textContent = documents.length || '';
  } catch (e) {
    badge.textContent = '';
  }
}

/** Formulario para adjuntar un archivo nuevo (estudio previo, imagenología…), con a qué corresponde y su fecha. */
function openUploadDocModal(patientId, onSaved) {
  const form = document.createElement('form');
  const today = new Date().toISOString().slice(0, 10);
  form.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="${labelCls}">Archivo *</label>
        <input type="file" name="file" required class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Corresponde a *</label>
        <select name="category" required class="${inputCls}">
          <option value="">—</option>
          ${DOC_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="${labelCls}">Fecha del documento *</label>
        <input type="date" name="document_date" required value="${today}" class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Notas</label>
        <input type="text" name="notes" maxlength="255" class="${inputCls}" placeholder="Opcional">
      </div>
    </div>`;

  modal({
    title: 'Subir archivo al expediente',
    content: form,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Subir', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          const file = form.querySelector('[name=file]').files[0];
          if (!file) return;
          btn.disabled = true;
          const v = formValues(form);
          const fd = new FormData();
          fd.append('file', file);
          fd.append('patient_id', patientId);
          fd.append('category', v.category);
          fd.append('document_date', v.document_date);
          fd.append('notes', v.notes);
          try {
            const res = await fetch('api/index.php?r=episodes/doc_upload', {
              method: 'POST',
              headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
              body: fd,
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            toast('Archivo adjuntado al expediente');
            close();
            onSaved();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

/** Modal con los archivos ya adjuntados al expediente. */
async function openDocsModal(patientId, onChanged) {
  const box = document.createElement('div');
  box.innerHTML = spinner();
  modal({ title: 'Archivos adjuntos', content: box, size: 'max-w-2xl', actions: [{ label: 'Cerrar' }] });

  let documents;
  try {
    ({ documents } = await apiGet('patients/doc_list', { patient_id: patientId }));
  } catch (e) {
    box.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(e.message)}</p>`;
    return;
  }
  paintPatientDocs(box, documents, patientId, onChanged);
}

function paintPatientDocs(box, documents, patientId, onChanged) {
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
              ${d.category ? `<span class="rounded-full bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-600">${escapeHtml(d.category)}</span> · ` : ''}
              ${d.document_date ? fmtDate(d.document_date) + ' · ' : ''}
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
        paintPatientDocs(box, fresh, patientId, onChanged);
        onChanged();
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

/* ================= Visitas en pestañas ================= */
// Qué episodio y qué pestaña se están viendo. Vive en el módulo para que
// sobreviva a los re-render (marcar entrega, guardar una edición…).
let activeEpisodeId = null;
let activeTab = 'admision';

/** Consultas de más antigua a más nueva: "Consulta 1" debe ser la primera visita. */
function consultsAsc(e) {
  return [...(e.consultations || [])].sort((a, b) => a.consult_date.localeCompare(b.consult_date));
}

/** Sólo Control de peso captura antropometría, plicometría y bioimpedancia. */
function hasProgressTab(e) {
  return e.service === 'control_peso';
}

/** Ajusta el estado si el episodio o la pestaña activos ya no existen. */
function normalizeVisitState(episodes) {
  if (!episodes.length) {
    activeEpisodeId = null;
    return null;
  }
  let ep = episodes.find((e) => e.id === activeEpisodeId);
  if (!ep) {
    ep = episodes[0];
    activeEpisodeId = ep.id;
    activeTab = 'admision';
  }
  const valid = ['admision', ...consultsAsc(ep).map((c) => `c:${c.id}`), ...(hasProgressTab(ep) ? ['progreso'] : [])];
  if (!valid.includes(activeTab)) activeTab = 'admision';
  return ep;
}

function visitsSectionHtml(episodes) {
  const ep = normalizeVisitState(episodes);
  if (!ep) {
    return `<div class="rounded-2xl bg-white py-10 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
      Sin visitas registradas.</div>`;
  }
  const svc = SERVICES[ep.service] || { label: ep.service, color: 'bg-slate-100 text-slate-700', icon: 'folder' };

  return `
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Visitas</h4>
        ${episodes.length > 1 ? `
          <select id="episode-select" class="rounded-lg border-0 bg-white px-3 py-1.5 text-sm font-medium shadow-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-indigo-500">
            ${episodes.map((e) => {
              const s = SERVICES[e.service] || { label: e.service };
              return `<option value="${e.id}" ${e.id === ep.id ? 'selected' : ''}>${escapeHtml(s.label)} · ${fmtDate(e.admission_date)}</option>`;
            }).join('')}
          </select>` : ''}
      </div>

      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${svc.color}">${icon(svc.icon, 'h-5 w-5')}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-slate-900">${escapeHtml(svc.label)}
              ${ep.service_folio ? `<span class="ml-1.5 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200">Orden ${escapeHtml(ep.service_folio)}</span>` : ''}
            </p>
          </div>
          <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${ep.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${escapeHtml(ep.status)}</span>
        </div>

        <div class="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-3 pt-2">
          ${tabButtonHtml('admision', 'Admisión', fmtDate(ep.admission_date))}
          ${consultsAsc(ep).map((c, i) => tabButtonHtml(`c:${c.id}`, `Consulta ${i + 1}`, fmtDate(c.consult_date))).join('')}
          ${hasProgressTab(ep) ? tabButtonHtml('progreso', 'Progreso', `${consultsAsc(ep).length + 1} visita(s)`) : ''}
        </div>

        <div id="visit-panel" class="px-5 py-4">${visitPanelHtml(ep)}</div>
      </div>
    </div>`;
}

function tabButtonHtml(id, label, sub) {
  const on = activeTab === id;
  return `
    <button type="button" data-tab="${escapeHtml(id)}"
            class="shrink-0 rounded-t-lg border-b-2 px-3.5 py-2 text-left transition ${on ? 'border-indigo-600 bg-white' : 'border-transparent hover:bg-white/70'}">
      <span class="block text-sm font-semibold ${on ? 'text-indigo-700' : 'text-slate-600'}">${escapeHtml(label)}</span>
      <span class="block text-[11px] ${on ? 'text-indigo-400' : 'text-slate-400'}">${escapeHtml(sub)}</span>
    </button>`;
}

/** Barra de acciones común a todas las pestañas. */
function visitActionsHtml(buttons) {
  return `<div class="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">${buttons.join('')}</div>`;
}

function actionBtn(attrs, iconName, label, cls) {
  const style = cls || 'text-slate-600 ring-slate-300 hover:bg-slate-50';
  return `<button type="button" ${attrs} class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ${style}">
     ${icon(iconName, 'h-4 w-4')} ${escapeHtml(label)}</button>`;
}

function actionLink(href, iconName, label) {
  return `<a href="${href}" target="_blank" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
     ${icon(iconName, 'h-4 w-4')} ${escapeHtml(label)}</a>`;
}

function visitPanelHtml(ep) {
  if (activeTab === 'progreso') return progressPanelHtml(ep);
  if (activeTab.startsWith('c:')) {
    const c = (ep.consultations || []).find((x) => x.id === +activeTab.slice(2));
    return c ? consultPanelHtml(c, ep) : '<p class="text-sm text-slate-500">Consulta no encontrada.</p>';
  }
  return admissionPanelHtml(ep);
}

function admissionPanelHtml(e) {
  const admSections = catalog[e.service]?.admission || [];
  const actions = [
    actionBtn(`data-edit-episode="${e.id}"`, 'edit', 'Editar'),
    actionLink(`print.php?patient_id=${e.patient_id}&episode_id=${e.id}`, 'printer', 'Imprimir'),
    actionLink(`ficha.php?episode_id=${e.id}`, 'file-text', 'Ficha'),
  ];
  if (ctx.features?.mail) {
    actions.push(actionBtn(`data-resend-ficha="${e.id}"`, 'send', 'Reenviar ficha'));
  }

  return `
    ${visitActionsHtml(actions)}
    <div class="space-y-3">
      <p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Admisión:</span> ${fmtDateTime(e.admission_date)}</p>
      ${e.reason ? `<p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Motivo:</span> ${escapeHtml(e.reason)}</p>` : ''}
      ${e.referring_doctor ? `<p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Médico:</span> ${escapeHtml(e.referring_doctor)}</p>` : ''}
      <p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Responsable asignado:</span> ${e.assigned_user_name ? escapeHtml(e.assigned_user_name) : 'General (todos con acceso lo ven)'}</p>
      ${e.service === 'laboratorio' ? deliveryRowHtml(e) : ''}
      ${e.service === 'laboratorio' ? studiesBlockHtml(e) : ''}
      ${dataRowsHtml(admSections, e.service_data)}
    </div>`;
}

function consultPanelHtml(c, e) {
  const sesSections = catalog[e.service]?.session || [];
  const isControlPeso = e.service === 'control_peso';
  // En Control de peso la sección médica se llena al consolidar, no al capturar
  const shown = isControlPeso ? sesSections : sesSections.filter((s) => s.stage !== 'doctor');
  const pending = isControlPeso && c.nurse_closed_at && !c.doctor_closed_at;
  const complete = isControlPeso && !!c.doctor_closed_at;

  const actions = [
    actionBtn(`data-edit-consult="${c.id}"`, 'edit', 'Editar'),
    actionLink(`print.php?patient_id=${e.patient_id}&episode_id=${e.id}&consultation_id=${c.id}`, 'printer', 'Imprimir'),
  ];
  if (pending && canCompleteEpisode(e)) {
    actions.push(actionBtn(`data-complete-consult="${c.id}"`, 'check-square', 'Consolidar',
      'bg-violet-600 text-white ring-violet-600 hover:bg-violet-500'));
  }

  return `
    ${visitActionsHtml(actions)}
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm text-slate-700"><span class="font-semibold text-slate-500">Fecha:</span> ${fmtDateTime(c.consult_date)}</p>
        ${pending ? '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Pendiente médico</span>' : ''}
        ${complete ? '<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Consolidada</span>' : ''}
        ${c.created_by_name ? `<span class="text-xs text-slate-400">· ${escapeHtml(c.created_by_name)}</span>` : ''}
      </div>
      ${c.notes ? `<p class="whitespace-pre-line text-sm text-slate-700">${escapeHtml(c.notes)}</p>` : ''}
      ${dataRowsHtml(shown, c.params)}
    </div>`;
}

/** Cablea el bloque de visitas. Se vuelve a llamar tras cada cambio de pestaña. */
function wireVisits(root, patient, episodes, patientId) {
  const box = root.querySelector('#visits-section');
  if (!box) return;
  const rerender = () => {
    box.innerHTML = visitsSectionHtml(episodes);
    wireVisits(root, patient, episodes, patientId);
  };
  const reload = () => renderDetail(root, patientId);

  box.querySelector('#episode-select')?.addEventListener('change', (ev) => {
    activeEpisodeId = +ev.target.value;
    activeTab = 'admision';
    rerender();
  });
  box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    rerender();
  }));

  const ep = episodes.find((e) => e.id === activeEpisodeId);
  if (!ep) return;

  box.querySelector('[data-edit-episode]')?.addEventListener('click', () => openEpisodeEditModal(ep, patientId));
  box.querySelector('[data-edit-consult]')?.addEventListener('click', (ev) => {
    const c = ep.consultations.find((x) => x.id === +ev.currentTarget.dataset.editConsult);
    if (c) openConsultEditModal(c, ep, patientId);
  });
  box.querySelector('[data-complete-consult]')?.addEventListener('click', (ev) => {
    const c = ep.consultations.find((x) => x.id === +ev.currentTarget.dataset.completeConsult);
    if (c) openCompleteConsultModal(c, ep, patientId);
  });

  box.querySelector('[data-resend-ficha]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
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

  box.querySelector('[data-delivery-date]')?.addEventListener('change', async (ev) => {
    try {
      await apiPost('episodes/set_delivery', {
        episode_id: +ev.target.dataset.deliveryDate,
        expected_delivery_date: ev.target.value,
      });
      toast('Fecha de entrega actualizada');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  box.querySelector('[data-mark-delivered]')?.addEventListener('click', async (ev) => {
    // currentTarget se limpia en cuanto termina el despacho del evento: hay que
    // leer el dataset antes del await de confirmDialog, no después.
    const episodeId = +ev.currentTarget.dataset.markDelivered;
    const ok = await confirmDialog('Marcar como entregado', '¿Confirmas que los resultados de este estudio ya se entregaron?', { confirmLabel: 'Marcar entregado' });
    if (!ok) return;
    try {
      await apiPost('episodes/set_delivery', { episode_id: episodeId, delivered: true });
      toast('Resultados marcados como entregados');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  });
  box.querySelector('[data-undo-delivery]')?.addEventListener('click', async (ev) => {
    const episodeId = +ev.currentTarget.dataset.undoDelivery;
    const ok = await confirmDialog('Deshacer entrega', '¿Quitar la marca de "entregado" de este estudio?', { danger: true, confirmLabel: 'Deshacer' });
    if (!ok) return;
    try {
      await apiPost('episodes/set_delivery', { episode_id: episodeId, delivered: false });
      toast('Entrega deshecha');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  });

  box.querySelector('[data-open-progress-viz]')?.addEventListener('click', () => openProgressVizModal(patient, ep));
}

/* ================= Pestaña de Progreso ================= */

// Los grupos salen del catálogo, así que agregar una medición nueva al JSON
// la incorpora sola a la comparativa.
const PROGRESS_GROUPS = [
  ['cp_antro', 'Antropometría'],
  ['cp_pli', 'Plicometría'],
  ['cp_bio', 'Bioimpedancia'],
];

/** Métricas numéricas de un grupo del catálogo, con su etiqueta. */
function progressMetrics(service, sectionId) {
  const secs = catalog[service]?.session || [];
  const sec = secs.find((s) => s.id === sectionId);
  if (!sec) return [];
  return sec.fields
    .filter((f) => f.t === 'number' || f.t === 'calc')
    .map((f) => [f.k, f.l]);
}

/** Una columna por visita: la admisión y cada consulta, de más antigua a más nueva. */
function progressVisits(e) {
  return [
    { label: 'Admisión', date: e.admission_date, data: e.service_data || {} },
    ...consultsAsc(e).map((c, i) => ({ label: `Consulta ${i + 1}`, date: c.consult_date, data: c.params || {} })),
  ];
}

const numOrNull = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

/** Δ entre el primer y el último valor capturado de una métrica. */
function metricDelta(visits, key) {
  const vals = visits.map((v) => numOrNull(v.data[key])).filter((n) => n !== null);
  if (vals.length < 2) return null;
  return Math.round((vals[vals.length - 1] - vals[0]) * 100) / 100;
}

function progressPanelHtml(e) {
  const visits = progressVisits(e);
  if (visits.length < 2) {
    return `<p class="py-8 text-center text-sm text-slate-500">
      Todavía no hay con qué comparar: se necesita al menos una consulta subsecuente además de la admisión.</p>`;
  }

  return `
    <div class="space-y-5">
      ${PROGRESS_GROUPS.map(([id, title]) => {
        const metrics = progressMetrics(e.service, id)
          // Sólo se listan las métricas con algún dato capturado: una tabla llena
          // de guiones no informa nada
          .filter(([k]) => visits.some((v) => numOrNull(v.data[k]) !== null));
        if (!metrics.length) return '';
        return `
          <div>
            <p class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">${escapeHtml(title)}</p>
            <div class="overflow-x-auto rounded-xl ring-1 ring-slate-200">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-3 py-2">Medición</th>
                    ${visits.map((v) => `<th class="px-3 py-2 text-right whitespace-nowrap">${escapeHtml(v.label)}<span class="block font-normal normal-case text-slate-400">${fmtDate(v.date)}</span></th>`).join('')}
                    <th class="px-3 py-2 text-right">Cambio</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${metrics.map(([k, label]) => {
                    const d = metricDelta(visits, k);
                    // En este contexto bajar es mejorar (peso, grasa, pliegues):
                    // verde para negativo, ámbar para positivo
                    const cls = d === null || d === 0 ? 'text-slate-400' : (d < 0 ? 'text-emerald-600' : 'text-amber-600');
                    const txt = d === null ? '—' : `${d > 0 ? '+' : ''}${d}`;
                    return `
                      <tr>
                        <td class="px-3 py-1.5 text-slate-700">${escapeHtml(label)}</td>
                        ${visits.map((v) => {
                          const n = numOrNull(v.data[k]);
                          return `<td class="px-3 py-1.5 text-right ${n === null ? 'text-slate-300' : 'font-medium text-slate-800'}">${n === null ? '—' : n}</td>`;
                        }).join('')}
                        <td class="px-3 py-1.5 text-right font-bold ${cls}">${txt}</td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      }).join('')}

      <div class="rounded-xl bg-slate-50 px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Gráfica y silueta</p>
          ${actionBtn(`data-open-progress-viz="${e.id}"`, 'activity', 'Ver progreso visual',
            'bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-500')}
        </div>
      </div>
    </div>`;
}

/** Modal con la gráfica multicapa y la silueta comparativa (ver progress_chart.js / body_silhouette.js). */
function openProgressVizModal(patient, e) {
  const visits = progressVisits(e);
  const box = document.createElement('div');
  box.className = 'space-y-6';

  const chartWrap = document.createElement('div');
  chartWrap.innerHTML = '<p class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Gráfica de evolución</p>';
  chartWrap.appendChild(renderProgressChart(visits));

  const siloWrap = document.createElement('div');
  siloWrap.className = 'border-t border-slate-100 pt-5';
  siloWrap.innerHTML = '<p class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Comparación corporal</p>';
  siloWrap.appendChild(renderBodySilhouette(visits, { sex: patient.sex }));

  box.append(chartWrap, siloWrap);
  modal({ title: 'Progreso visual', content: box, size: 'max-w-4xl', actions: [{ label: 'Cerrar' }] });
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

/**
 * Los campos de sesión marcados "readonly" en el catálogo (ej. la talla en
 * control de peso: se captura una vez, en la admisión, y no vuelve a
 * preguntarse en cada consulta) siempre reflejan lo capturado en la admisión,
 * nunca lo que traiga una consulta vieja — se fijan aquí, después de que el
 * formulario ya está en el DOM, y se dispara "input" a mano para que los
 * campos calculados que dependan de ese valor (ej. IMC) se actualicen.
 */
function applyReadonlyFromAdmission(form, sections, episode) {
  for (const sec of sections) {
    for (const f of sec.fields) {
      if (!f.readonly) continue;
      const el = form.querySelector(`[name="${f.k}"]`);
      const v = episode?.service_data?.[f.k];
      if (el && v !== undefined && v !== null && v !== '') {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
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
    applyReadonlyFromAdmission(form, currentSections, ep);
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

/* ================= Edición de visitas ================= */

/** Corrige los datos capturados en la admisión. */
function openEpisodeEditModal(episode, patientId) {
  const sections = catalog[episode.service]?.admission || [];
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="${labelCls}">Motivo de la admisión</label>
        <input type="text" name="__reason" value="${escapeHtml(episode.reason || '')}" class="${inputCls}">
      </div>
      <div>
        <label class="${labelCls}">Médico que refiere</label>
        <input type="text" name="__referring_doctor" value="${escapeHtml(episode.referring_doctor || '')}" class="${inputCls}">
      </div>
      ${sectionsHtml(sections, { compact: true })}
    </div>`;

  modal({
    title: `Editar admisión · ${fmtDate(episode.admission_date)}`,
    content: form,
    size: 'max-w-3xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar cambios',
        primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          try {
            await apiPost('episodes/update', {
              episode_id: episode.id,
              reason: form.querySelector('[name="__reason"]').value.trim(),
              referring_doctor: form.querySelector('[name="__referring_doctor"]').value.trim(),
              // El responsable no se toca desde aquí: se omite para conservarlo
              service_data: collectSections(form, sections),
            });
            toast('Admisión actualizada');
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
  // El orden importa: primero los valores, luego los widgets se autoinicializan
  fillSections(form, sections, episode.service_data);
  initSections(form);
}

/** Corrige una consulta ya registrada, esté consolidada o no. */
function openConsultEditModal(consult, episode, patientId) {
  const all = catalog[episode.service]?.session || [];
  // Se editan todas las secciones, incluida la médica: si ya se consolidó,
  // sus datos también deben poder corregirse.
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="${labelCls}">Notas</label>
        <textarea name="__notes" rows="3" class="${inputCls}">${escapeHtml(consult.notes || '')}</textarea>
      </div>
      ${sectionsHtml(all, { compact: true })}
    </div>`;

  modal({
    title: `Editar consulta · ${fmtDate(consult.consult_date)}`,
    content: form,
    size: 'max-w-3xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar cambios',
        primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          try {
            await apiPost('consultations/update', {
              id: consult.id,
              notes: form.querySelector('[name="__notes"]').value.trim(),
              params: collectSections(form, all),
            });
            toast('Consulta actualizada');
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
  fillSections(form, all, consult.params);
  initSections(form);
  applyReadonlyFromAdmission(form, all, episode);
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
