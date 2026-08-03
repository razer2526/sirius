/** Módulo Admisión: grid de servicios → formulario de admisión (fichas oficiales). */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, field, formValues, inputCls, labelCls, debounce, fullName, fmtDate } from '../ui.js';
import { SERVICES, PATIENT_FIELDS, loadCatalog } from '../services.js';
import { sectionsHtml, initSections, collectSections } from '../forms.js';

let ctx;

function defaultDeliveryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

export async function render(root, context) {
  ctx = context;
  const [serviceKey] = context.args;
  if (serviceKey && SERVICES[serviceKey]) {
    await renderForm(root, serviceKey);
  } else {
    renderGrid(root);
  }
}

/* ---- Grid de servicios ---- */
function renderGrid(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-4xl">
      <p class="mb-5 text-sm text-slate-500">Selecciona el servicio al que ingresa el paciente.</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${Object.entries(SERVICES).map(([key, svc]) => `
          <a href="#/admision/${key}"
             class="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">
            <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${svc.color}">${icon(svc.icon, 'h-7 w-7')}</span>
            <div>
              <p class="text-base font-semibold text-slate-900">${svc.label}</p>
              <p class="text-sm text-slate-500">Nueva admisión</p>
            </div>
            <span class="ml-auto text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
          </a>`).join('')}
      </div>
    </div>`;
}

/* ---- Formulario de admisión ---- */
async function renderForm(root, serviceKey) {
  const svc = SERVICES[serviceKey];
  const [catalog, { users: assignableUsers }] = await Promise.all([
    loadCatalog(),
    apiGet('episodes/assignable_users'),
  ]);
  const sections = catalog[serviceKey]?.admission || [];
  let selectedPatient = null;

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <a href="#/admision" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver a servicios
      </a>

      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 items-center justify-center rounded-2xl ${svc.color}">${icon(svc.icon, 'h-6 w-6')}</span>
        <div>
          <h3 class="text-lg font-bold text-slate-900">Admisión · ${svc.label}</h3>
          <p class="text-sm text-slate-500">${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>

      <form id="admission-form" class="space-y-5">
        <!-- Buscar paciente existente -->
        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <label class="${labelCls}">¿Paciente ya registrado? Búscalo</label>
          <div class="relative">
            <input id="patient-search" type="text" placeholder="Nombre, folio o teléfono…" autocomplete="off" class="${inputCls}">
            <div id="search-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
          </div>
          <div id="selected-patient" class="mt-3 hidden items-center justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-3 ring-1 ring-indigo-200">
            <div>
              <p id="selected-name" class="text-sm font-semibold text-indigo-900"></p>
              <p id="selected-file" class="text-xs text-indigo-600"></p>
            </div>
            <button type="button" id="clear-selected" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Quitar</button>
          </div>
        </section>

        <!-- Datos del paciente -->
        <section id="patient-section" class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">Datos del paciente</h4>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${PATIENT_FIELDS.map((f) => field(f)).join('')}
          </div>
        </section>

        <!-- Motivo y médico -->
        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">Motivo y referencia</h4>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            ${field({ key: '__reason', label: 'Motivo de consulta / estudio', type: 'textarea', rows: 2, span: 'sm:col-span-2' })}
            ${field({ key: '__referring_doctor', label: serviceKey === 'laboratorio' ? 'Nombre del médico' : 'Médico solicitante / responsable', type: 'text', span: 'sm:col-span-2' })}
            <div class="sm:col-span-2">
              <label class="${labelCls}">Responsable asignado</label>
              <select name="__assigned_user_id" class="${inputCls}">
                <option value="">General — todos con acceso a Expedientes lo ven</option>
                ${assignableUsers.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join('')}
              </select>
              <p class="mt-1 text-xs text-slate-400">Controla quién puede ver este expediente en Expedientes: solo la persona asignada (y los administradores), o todos si se deja en "General".</p>
            </div>
            ${serviceKey === 'laboratorio' ? `
            <div>
              <label class="${labelCls}">Fecha de entrega estimada</label>
              <input type="date" name="__expected_delivery_date" value="${defaultDeliveryDate()}" class="${inputCls}">
              <p class="mt-1 text-xs text-slate-400">Por default, 2 días después de hoy. Ajústala si el estudio tarda más (ej. cultivos, laboratorio externo).</p>
            </div>` : ''}
          </div>
        </section>

        <!-- Secciones de la ficha del servicio -->
        ${sectionsHtml(sections)}

        <!-- Documentos adjuntos -->
        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h4 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Documentos adjuntos</h4>
          <p class="mb-3 text-xs text-slate-400">Estudios de laboratorio, historial viejo, estudios de imagen, etc. (opcional). Se suben al expediente al registrar la admisión.</p>
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-100">
            ${icon('upload', 'h-4 w-4')} Seleccionar archivos
            <input type="file" id="doc-files" multiple class="hidden">
          </label>
          <div id="doc-pending" class="mt-3 space-y-1.5"></div>
        </section>

        <div class="flex justify-end">
          <button type="submit" id="btn-submit"
                  class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
            Registrar admisión
          </button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector('#admission-form');
  initSections(form);

  /* ---- Documentos adjuntos: se guardan en memoria y se suben ya creado el expediente ---- */
  let pendingFiles = [];
  const docInput = root.querySelector('#doc-files');
  const docPendingBox = root.querySelector('#doc-pending');
  const fmtSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const paintPending = () => {
    docPendingBox.innerHTML = pendingFiles.map((f, i) => `
      <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml(f.name)}</span>
        <span class="shrink-0 text-xs text-slate-400">${fmtSize(f.size)}</span>
        <button type="button" data-rm-doc="${i}" class="shrink-0 text-slate-400 hover:text-red-600">${icon('x', 'h-4 w-4')}</button>
      </div>`).join('');
    docPendingBox.querySelectorAll('[data-rm-doc]').forEach((b) =>
      b.addEventListener('click', () => { pendingFiles.splice(+b.dataset.rmDoc, 1); paintPending(); }));
  };
  docInput.addEventListener('change', () => {
    pendingFiles.push(...docInput.files);
    docInput.value = '';
    paintPending();
  });

  async function uploadPendingDocs(patientId) {
    let ok = 0;
    let failed = 0;
    for (const file of pendingFiles) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('patient_id', patientId);
      try {
        const res = await fetch('api/index.php?r=episodes/doc_upload', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        ok++;
      } catch (e) {
        failed++;
      }
    }
    if (ok) toast(`${ok} documento(s) adjuntado(s) al expediente`);
    if (failed) toast(`${failed} documento(s) no se pudieron subir`, 'error');
  }

  const searchInput = root.querySelector('#patient-search');
  const resultsBox = root.querySelector('#search-results');
  const patientSection = root.querySelector('#patient-section');

  const selectPatient = (p) => {
    selectedPatient = p;
    root.querySelector('#selected-patient').classList.remove('hidden');
    root.querySelector('#selected-patient').classList.add('flex');
    root.querySelector('#selected-name').textContent = fullName(p);
    root.querySelector('#selected-file').textContent = `${p.file_number}${p.birth_date ? ' · Nac. ' + fmtDate(p.birth_date) : ''}`;
    patientSection.classList.add('hidden');
    // Deshabilitar sus campos para que no bloqueen la validación del formulario
    patientSection.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
    resultsBox.classList.add('hidden');
    searchInput.value = '';
    // El sexo del paciente controla las secciones condicionales (salud femenina/masculina)
    const sexEl = form.querySelector('[name=sex]');
    if (sexEl) {
      sexEl.disabled = false;
      sexEl.value = p.sex || '';
      sexEl.dispatchEvent(new Event('change', { bubbles: true }));
      sexEl.disabled = true;
    }
  };
  const clearPatient = () => {
    selectedPatient = null;
    root.querySelector('#selected-patient').classList.add('hidden');
    root.querySelector('#selected-patient').classList.remove('flex');
    patientSection.classList.remove('hidden');
    patientSection.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = false; });
  };
  root.querySelector('#clear-selected').addEventListener('click', clearPatient);

  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      resultsBox.classList.add('hidden');
      return;
    }
    const { patients } = await apiGet('episodes/search_patient', { q });
    if (!patients.length) {
      resultsBox.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias. Llena los datos para registrarlo como nuevo.</p>';
    } else {
      resultsBox.innerHTML = patients.map((p, i) => `
        <button type="button" data-idx="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-50">
          <span class="text-sm font-medium text-slate-800">${escapeHtml(fullName(p))}</span>
          <span class="shrink-0 text-xs text-slate-500">${escapeHtml(p.file_number)}</span>
        </button>`).join('');
      resultsBox.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => selectPatient(patients[+b.dataset.idx])));
    }
    resultsBox.classList.remove('hidden');
  }, 300));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#patient-search') && !e.target.closest('#search-results')) resultsBox.classList.add('hidden');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(false);
  });

  async function submit(ignoreDuplicate) {
    const btn = root.querySelector('#btn-submit');
    if (!form.reportValidity()) return;
    btn.disabled = true;
    const v = formValues(form);
    const patient = {};
    for (const f of PATIENT_FIELDS) patient[f.key] = v[f.key] ?? '';
    const serviceData = collectSections(form, sections);

    try {
      const data = await apiPost('episodes/create', {
        service: serviceKey,
        patient_id: selectedPatient ? +selectedPatient.id : 0,
        patient,
        reason: v.__reason,
        referring_doctor: v.__referring_doctor,
        assigned_user_id: v.__assigned_user_id || null,
        expected_delivery_date: v.__expected_delivery_date || null,
        service_data: serviceData,
        ignore_duplicate: ignoreDuplicate,
      });

      if (data.duplicate) {
        btn.disabled = false;
        const d = data.duplicate;
        modal({
          title: 'Posible paciente duplicado',
          content: `<p class="text-sm text-slate-600">Ya existe un paciente con el mismo nombre y fecha de nacimiento:</p>
            <div class="mt-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <p class="text-sm font-semibold text-amber-900">${escapeHtml(fullName(d))}</p>
              <p class="text-xs text-amber-700">${escapeHtml(d.file_number)}${d.birth_date ? ' · Nac. ' + fmtDate(d.birth_date) : ''}</p>
            </div>`,
          actions: [
            { label: 'Usar el existente', primary: true, onClick: (close) => { close(); selectPatient(d); submit(false); } },
            { label: 'Registrar como nuevo', onClick: (close) => { close(); submit(true); } },
          ],
        });
        return;
      }

      if (pendingFiles.length) {
        await uploadPendingDocs(data.patient_id);
      }
      showSuccess(data);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  }

  function showSuccess(data) {
    root.innerHTML = `
      <div class="mx-auto flex max-w-md flex-col items-center pt-16 text-center">
        <div class="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3 class="text-xl font-bold text-slate-900">Admisión registrada</h3>
        <p class="mt-2 text-sm text-slate-500">${data.new_patient ? 'Paciente nuevo con folio' : 'Folio del paciente'}</p>
        <p class="mt-1 text-2xl font-bold tracking-wide text-indigo-600">${escapeHtml(data.file_number)}</p>
        ${data.service_folio ? `
        <p class="mt-3 text-sm text-slate-500">Folio de orden de laboratorio</p>
        <p class="mt-0.5 text-xl font-bold tracking-wide text-sky-600">${escapeHtml(data.service_folio)}</p>` : ''}
        <div class="mt-8 flex flex-wrap justify-center gap-3">
          ${ctx.modules.some((m) => m.key === 'expedientes')
            ? `<a href="#/expedientes/${data.patient_id}" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Ver expediente</a>`
            : ''}
          <a href="#/admision" class="rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Nueva admisión</a>
        </div>
      </div>`;
  }
}
