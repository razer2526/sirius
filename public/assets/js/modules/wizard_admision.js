/**
 * Admisión de laboratorio en modo asistido (wizard).
 *
 * Pensado para los recolectores a domicilio: con frecuencia son personas mayores
 * que llenan el formulario de pie, en la puerta de una casa y con el celular en
 * una mano. El formulario completo tiene ~46 campos; aquí se piden sólo los diez
 * que en la práctica se usan, uno por pantalla y con controles grandes.
 *
 * Se envía por el mismo endpoint que la admisión normal (episodes/create), así
 * que no hay una segunda forma de crear admisiones que mantener.
 */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, debounce, fullName, fmtDate, recurrenceText } from '../ui.js';
import { loadCatalog } from '../services.js';
import { outboxEnqueue, outboxCount, outboxFlush } from '../outbox.js';

let ctx;
let catalog = null;

/** Estado de la captura. Vive aquí para sobrevivir al re-render de cada paso. */
let step = 0;
let data = null;

/* ---- Outbox: cuántas admisiones esperan señal, y cuántas se atoraron ---- */
let outboxState = { pending: 0, failed: 0 };
// El listener de 'online' se registra una sola vez aunque el módulo se monte
// varias veces al navegar; #module-root es el mismo nodo durante toda la SPA.
let onlineListenerWired = false;

function blankData() {
  return {
    existingPatient: null,      // paciente ya registrado, si se eligió uno
    patient: { first_name: '', paternal_surname: '', maternal_surname: '', birth_date: '', sex: '', mobile: '', email: '' },
    emailUseOtherDomain: false,   // el modo del selector no se deriva del correo: "Otro" sin dominio tecleado aún se vería como si no estuviera elegido
    doctorOther: '',
    studies: [],                // [{ study_id, name, amount }]
    paymentMethod: '',
    symptoms: {},               // clave del síntoma -> duración
    symptomsOther: '',
    medicamentos: '',
    signature: '',
  };
}

/* Las duraciones son las mismas del formulario normal; se repiten aquí porque
   el wizard las presenta de otra forma (una tarjeta por síntoma a pantalla completa). */
const DURATIONS = ['Hoy o ayer', '2 a 6 días', '1 a 2 semanas', '2 a 4 semanas', 'Más de 1 mes', 'Más de 6 meses'];

const EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.com.mx', 'me.com', 'icloud.com', 'msn.com'];

/** Separa un correo en usuario/dominio para los dos controles del paso de contacto. */
function splitEmail(email) {
  const at = email.indexOf('@');
  return at === -1 ? { local: email, domain: '' } : { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/** Un campo del catálogo de laboratorio por su clave. */
function labField(key) {
  for (const sec of catalog?.laboratorio?.admission || []) {
    const f = (sec.fields || []).find((x) => x.k === key);
    if (f) return f;
  }
  return null;
}

/** Síntomas y formas de pago salen del catálogo, no de una lista aparte:
    si la oficina agrega una opción en services_catalog.json, aquí aparece sola. */
function symptomFields() {
  const sec = (catalog?.laboratorio?.admission || []).find((s) => s.id === 'lab_sintomas');
  return (sec?.fields || []).filter((f) => f.t === 'symptom');
}

function paymentMethods() {
  return labField('pago_metodo')?.o || [];
}

export async function render(root, context) {
  ctx = context;
  catalog = await loadCatalog();
  step = 0;
  data = blankData();
  paint(root);

  outboxState = await outboxCount();
  refreshPendingBanner(root);
  attemptFlush(root); // por si ya hay señal desde antes de entrar al wizard

  if (!onlineListenerWired) {
    onlineListenerWired = true;
    window.addEventListener('online', () => attemptFlush(root));
  }
}

/** Reintenta lo que esté en la cola. No hace nada si sigue sin haber señal. */
async function attemptFlush(root) {
  if (!navigator.onLine) return;
  const synced = await outboxFlush();
  if (synced > 0) {
    toast(`${synced} admisión${synced === 1 ? '' : 'es'} pendiente${synced === 1 ? '' : 's'} enviada${synced === 1 ? '' : 's'}`, 'success');
  }
  outboxState = await outboxCount();
  refreshPendingBanner(root);
}

function pendingBannerHtml() {
  const { pending, failed } = outboxState;
  if (!pending && !failed) return '';
  return `
    <div class="mb-4 space-y-2">
      ${pending ? `
        <div class="flex items-center gap-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          ${icon('upload', 'h-4 w-4 shrink-0')}
          <span>${pending} admisión${pending === 1 ? '' : 'es'} guardada${pending === 1 ? '' : 's'} sin conexión, pendiente${pending === 1 ? '' : 's'} de enviar.</span>
        </div>` : ''}
      ${failed ? `
        <div class="flex items-center gap-2.5 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800 ring-1 ring-red-200">
          ${icon('alert-triangle', 'h-4 w-4 shrink-0')}
          <span>${failed} admisión${failed === 1 ? '' : 'es'} no se pudo${failed === 1 ? '' : 'ieron'} enviar. Avisa a la oficina para revisarla${failed === 1 ? '' : 's'}.</span>
        </div>` : ''}
    </div>`;
}

/** Actualiza solo el aviso, sin repintar el paso completo (perdería el foco del campo activo). */
function refreshPendingBanner(root) {
  const el = root.querySelector('#wz-pending-banner');
  if (el) el.innerHTML = pendingBannerHtml();
}

/* ================== Armazón ================== */

const STEPS = [
  { key: 'nombre',       title: '¿Cómo se llama?' },
  { key: 'nacimiento',   title: 'Fecha de nacimiento y sexo biológico' },
  { key: 'contacto',     title: 'Datos de contacto' },
  { key: 'medico',       title: 'Médico tratante' },
  { key: 'estudios',     title: '¿Qué estudios se le toman?' },
  { key: 'sintomas',     title: '¿Qué molestias tiene?' },
  { key: 'medicamentos', title: '¿Toma algún medicamento?' },
  { key: 'pago',         title: 'Monto y método de pago' },
  { key: 'firma',        title: 'Firma del paciente' },
  { key: 'confirmar',    title: 'Revisa antes de guardar' },
];

function move(root, dir) {
  step = Math.max(0, Math.min(STEPS.length - 1, step + dir));
  paint(root);
}

/**
 * Salida al formulario completo. Sólo para quien entró aquí por decisión propia
 * (el enlace "modo asistido" de la parrilla); al recolector con el privilegio no
 * se le ofrece, porque el asistente es toda su interfaz.
 */
function exitLinkHtml() {
  const isCollector = !!ctx.modules.find((m) => m.key === 'admision')?.flags?.wizard;
  return isCollector ? '' : `
    <a href="#/admision/laboratorio" class="text-sm font-medium text-slate-400 hover:text-slate-600">
      Usar el formulario completo
    </a>`;
}

function paint(root) {
  const s = STEPS[step];
  const pos = step + 1;

  root.innerHTML = `
    <div class="mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col">
      <div id="wz-pending-banner">${pendingBannerHtml()}</div>
      <div class="mb-5">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-500">Paso ${pos} de ${STEPS.length}</span>
          ${step > 0
            ? `<button type="button" id="wz-cancel" class="text-sm font-medium text-slate-400 hover:text-slate-600">Cancelar</button>`
            : exitLinkHtml()}
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div class="h-full rounded-full bg-indigo-600 transition-all" style="width:${Math.round((pos / STEPS.length) * 100)}%"></div>
        </div>
      </div>

      <h2 class="mb-5 text-2xl font-bold leading-tight text-slate-900">${escapeHtml(s.title)}</h2>

      <div id="wz-body" class="flex-1 pb-4">${bodyHtml(s.key)}</div>

      <!-- En el flujo normal, no sticky: el contenedor que scrollea lleva relleno
           inferior para el botón flotante del asistente y una barra fija quedaría
           anclada a media pantalla. Al final de la columna cae siempre bajo la
           última pregunta, que es donde el recolector la busca. -->
      <div class="mt-6 flex gap-3 border-t border-slate-200 pt-4">
        ${step > 0 ? `
          <button type="button" id="wz-back"
                  class="rounded-xl px-5 py-4 text-base font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-white">
            Atrás
          </button>` : ''}
        <button type="button" id="wz-next"
                class="flex-1 rounded-xl bg-indigo-600 px-5 py-4 text-base font-bold text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-300">
          ${step === STEPS.length - 1 ? 'Guardar admisión' : 'Continuar'}
        </button>
      </div>
    </div>`;

  wireBody(root, s.key);

  root.querySelector('#wz-back')?.addEventListener('click', () => move(root, -1));
  root.querySelector('#wz-cancel')?.addEventListener('click', () => {
    if (confirm('¿Salir sin guardar? Se pierde lo capturado.')) {
      step = 0;
      data = blankData();
      paint(root);
    }
  });
  root.querySelector('#wz-next').addEventListener('click', async () => {
    const err = validate(s.key);
    if (err) { toast(err, 'error'); return; }
    if (s.key === 'nacimiento') {
      const wentToAutofill = await checkPossibleDuplicate(root);
      if (wentToAutofill) return;
    }
    if (step === STEPS.length - 1) submit(root);
    else move(root, 1);
  });
}

/* ================== Contenido de cada paso ================== */

const bigInput = 'w-full rounded-xl border-0 bg-white px-4 py-4 text-lg shadow-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-500';
const bigLabel = 'mb-1.5 block text-sm font-semibold text-slate-600';

/** Botón grande de opción, del tamaño mínimo cómodo para el dedo. */
function optionBtn(attrs, label, selected, sub) {
  return `
    <button type="button" ${attrs}
            class="w-full rounded-xl px-4 py-4 text-left text-base font-semibold transition ${
              selected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}">
      ${escapeHtml(label)}
      ${sub ? `<span class="mt-0.5 block text-sm font-normal ${selected ? 'text-indigo-100' : 'text-slate-400'}">${escapeHtml(sub)}</span>` : ''}
    </button>`;
}

function bodyHtml(key) {
  switch (key) {
    case 'nombre':
      return `
        <div class="space-y-4">
          <div><label class="${bigLabel}">Nombre(s)</label>
            <input type="text" id="f-first" value="${escapeHtml(data.patient.first_name)}" class="${bigInput}" autocomplete="given-name"></div>
          <div><label class="${bigLabel}">Apellido paterno</label>
            <input type="text" id="f-pat" value="${escapeHtml(data.patient.paternal_surname)}" class="${bigInput}" autocomplete="family-name"></div>
          <div><label class="${bigLabel}">Apellido materno <span class="font-normal text-slate-400">(opcional)</span></label>
            <input type="text" id="f-mat" value="${escapeHtml(data.patient.maternal_surname)}" class="${bigInput}"></div>
        </div>`;

    case 'nacimiento':
      return `
        <div class="space-y-5">
          <div><label class="${bigLabel}">Fecha de nacimiento</label>
            <input type="date" id="f-birth" value="${escapeHtml(data.patient.birth_date)}" class="${bigInput}"></div>
          <div>
            <label class="${bigLabel}">Sexo</label>
            <div class="grid grid-cols-2 gap-3">
              ${optionBtn('data-sex="F"', 'Femenino', data.patient.sex === 'F')}
              ${optionBtn('data-sex="M"', 'Masculino', data.patient.sex === 'M')}
            </div>
          </div>
          <p class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
            Estos dos datos son obligatorios: el laboratorio los usa para elegir los valores de
            referencia correctos del reporte.
          </p>
        </div>`;

    case 'contacto': {
      const { local, domain } = splitEmail(data.patient.email);
      const isOtroDomain = data.emailUseOtherDomain;
      return `
        <div class="space-y-4">
          <div><label class="${bigLabel}">Celular</label>
            <input type="tel" id="f-mobile" value="${escapeHtml(data.patient.mobile)}" class="${bigInput}" inputmode="tel" autocomplete="tel"></div>
          <div>
            <label class="${bigLabel}">Correo electrónico <span class="font-normal text-slate-400">(opcional)</span></label>
            <div class="flex items-stretch gap-2">
              <input type="text" id="f-email-local" value="${escapeHtml(local)}" placeholder="usuario" class="${bigInput} min-w-0 flex-1" inputmode="email" autocomplete="off">
              <span class="flex items-center text-xl font-bold text-slate-400">@</span>
              <select id="f-email-domain" class="${bigInput} w-40 shrink-0">
                ${EMAIL_DOMAINS.map((d) => `<option value="${d}" ${!isOtroDomain && domain === d ? 'selected' : ''}>${d}</option>`).join('')}
                <option value="__otro" ${isOtroDomain ? 'selected' : ''}>Otro…</option>
              </select>
            </div>
            ${isOtroDomain ? `
            <input type="text" id="f-email-domain-other" value="${escapeHtml(domain)}" placeholder="dominio.com" class="${bigInput} mt-2">` : ''}
            <p class="mt-1.5 text-sm text-slate-500">Aquí le llega su ficha. Revísalo con calma.</p>
          </div>
        </div>`;
    }

    case 'medico':
      return `
        <div>
          <label class="${bigLabel}">Nombre del médico <span class="font-normal text-slate-400">(opcional)</span></label>
          <input type="text" id="f-doc" value="${escapeHtml(data.doctorOther)}" placeholder="A quién corresponda" class="${bigInput}">
        </div>`;

    case 'estudios':
      return `
        <div class="space-y-3">
          <input type="search" id="wz-study-search" placeholder="Buscar estudio…" autocomplete="off" class="${bigInput}">
          <div id="wz-study-results" class="space-y-2"></div>
          <div id="wz-study-picked" class="space-y-2 pt-2">${pickedStudiesHtml()}</div>
        </div>`;

    case 'pago':
      return `
        <div class="space-y-3">
          <div id="wz-pago-lines" class="space-y-2">${pagoLinesHtml()}</div>
          <div class="rounded-xl bg-slate-100 px-4 py-3 text-center">
            <p class="text-sm text-slate-500">Total capturado</p>
            <p class="text-3xl font-bold text-slate-900">$${totalAmount().toFixed(2)}</p>
          </div>
          <label class="${bigLabel}">Forma de pago</label>
          ${paymentMethods().map((m) => optionBtn(`data-pay="${escapeHtml(m)}"`, m, data.paymentMethod === m)).join('')}
        </div>`;

    case 'sintomas':
      // La duración se pide aquí mismo, desplegada bajo la molestia marcada: es
      // el dato que evita el "diarrea" a secas con el que llegaban las fichas.
      return `
        <div class="space-y-2">
          <p class="mb-3 text-base text-slate-500">Toca todas las que apliquen e indica desde cuándo.</p>
          ${symptomFields().map((f) => {
            const on = data.symptoms[f.k] !== undefined;
            return `
              <div class="${on ? 'rounded-xl bg-indigo-50 p-2 ring-1 ring-indigo-200' : ''}">
                ${optionBtn(`data-sym="${escapeHtml(f.k)}"`, f.l, on)}
                ${on ? `
                  <p class="px-1 pb-1 pt-3 text-sm font-semibold text-indigo-900">¿Desde cuándo?</p>
                  <div class="grid grid-cols-2 gap-2">
                    ${DURATIONS.map((d) => `
                      <button type="button" data-dur="${escapeHtml(f.k)}" data-value="${escapeHtml(d)}"
                              class="rounded-lg px-2 py-3 text-sm font-semibold transition ${
                                data.symptoms[f.k] === d
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-white text-slate-700 ring-1 ring-slate-300'}">${escapeHtml(d)}</button>`).join('')}
                  </div>` : ''}
              </div>`;
          }).join('')}
          <div class="pt-3">
            <label class="${bigLabel}">Otra molestia <span class="font-normal text-slate-400">(opcional)</span></label>
            <textarea id="f-sym-other" rows="2" class="${bigInput}">${escapeHtml(data.symptomsOther)}</textarea>
          </div>
        </div>`;

    case 'medicamentos':
      return `
        <div>
          <label class="${bigLabel}">Medicamentos que toma <span class="font-normal text-slate-400">(opcional)</span></label>
          <textarea id="f-meds" rows="4" class="${bigInput}" placeholder="Escribe aquí, o deja vacío si no toma ninguno">${escapeHtml(data.medicamentos)}</textarea>
        </div>`;

    case 'firma':
      return `
        <div>
          <p class="mb-3 text-base text-slate-500">Pide al paciente que firme con el dedo.</p>
          <div class="overflow-hidden rounded-xl bg-white ring-1 ring-slate-300">
            <canvas id="wz-sig" class="block h-64 w-full touch-none" style="touch-action:none"></canvas>
          </div>
          <button type="button" id="wz-sig-clear" class="mt-2 text-base font-semibold text-indigo-600">Borrar y repetir</button>
        </div>`;

    case 'confirmar': {
      const p = data.patient;
      const name = `${p.first_name} ${p.paternal_surname} ${p.maternal_surname}`.trim();
      const syms = Object.entries(data.symptoms).map(([k, v]) => {
        const f = symptomFields().find((x) => x.k === k);
        return `${f ? f.l : k} (${v})`;
      });
      const row = (label, value) => `
        <div class="flex justify-between gap-4 border-b border-slate-100 py-2.5">
          <span class="shrink-0 text-sm text-slate-500">${escapeHtml(label)}</span>
          <span class="text-right text-sm font-semibold text-slate-800">${escapeHtml(value || '—')}</span>
        </div>`;
      return `
        <div class="space-y-4">
          ${data.patient.email ? `
            <div class="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p class="text-sm font-semibold text-amber-900">Su ficha se enviará a este correo:</p>
              <p class="mt-1 break-all text-xl font-bold text-amber-900">${escapeHtml(data.patient.email)}</p>
              <p class="mt-1.5 text-sm text-amber-800">Si está mal escrito, los datos del paciente le llegarán a otra persona. Revísalo.</p>
            </div>` : ''}
          <div class="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            ${row('Paciente', name)}
            ${row('Estudios', data.studies.map((s) => s.name).join(', '))}
            ${row('Total', '$' + totalAmount().toFixed(2))}
            ${row('Pago', data.paymentMethod)}
            ${row('Médico', data.doctorOther.trim() || 'A quién corresponda')}
            ${row('Molestias', [...syms, data.symptomsOther].filter(Boolean).join(', '))}
            ${row('Medicamentos', data.medicamentos)}
            ${row('Firma', data.signature ? 'Capturada' : 'Sin firma')}
          </div>
        </div>`;
    }

    default:
      return '';
  }
}

function pickedStudiesHtml() {
  if (!data.studies.length) {
    return '<p class="text-center text-sm text-slate-400">Todavía no eliges ninguno.</p>';
  }
  return data.studies.map((s, i) => `
    <div class="flex items-center justify-between gap-2 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-200">
      <p class="min-w-0 flex-1 text-base font-semibold text-indigo-900">${escapeHtml(s.name)}</p>
      <button type="button" data-rm-study="${i}" class="shrink-0 text-indigo-400">${icon('x', 'h-5 w-5')}</button>
    </div>`).join('');
}

/** Un renglón por estudio elegido, con el monto que ahora se captura en el paso de pago. */
function pagoLinesHtml() {
  if (!data.studies.length) return '';
  return data.studies.map((s, i) => `
    <div class="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <p class="text-base font-semibold text-slate-800">${escapeHtml(s.name)}</p>
      <label class="mt-2 block text-sm font-semibold text-slate-600">Monto cobrado</label>
      <input type="number" step="0.01" inputmode="decimal" data-amount="${i}" value="${s.amount}"
             class="mt-1 w-full rounded-lg border-0 px-3 py-3 text-lg font-bold shadow-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-500">
    </div>`).join('');
}

function totalAmount() {
  return data.studies.reduce((n, s) => n + (parseFloat(s.amount) || 0), 0);
}

/* ================== Comportamiento de cada paso ================== */

function wireBody(root, key) {
  const $ = (sel) => root.querySelector(sel);

  if (key === 'nombre') {
    $('#f-first').addEventListener('input', (e) => { data.patient.first_name = e.target.value; });
    $('#f-pat').addEventListener('input', (e) => { data.patient.paternal_surname = e.target.value; });
    $('#f-mat').addEventListener('input', (e) => { data.patient.maternal_surname = e.target.value; });
  }

  if (key === 'nacimiento') {
    $('#f-birth').addEventListener('input', (e) => { data.patient.birth_date = e.target.value; });
    root.querySelectorAll('[data-sex]').forEach((b) => b.addEventListener('click', () => {
      data.patient.sex = b.dataset.sex;
      paint(root);
    }));
  }

  if (key === 'contacto') {
    $('#f-mobile').addEventListener('input', (e) => { data.patient.mobile = e.target.value; });
    const updateEmail = () => {
      const local = $('#f-email-local').value.trim();
      const domain = data.emailUseOtherDomain
        ? ($('#f-email-domain-other')?.value.trim() || '')
        : $('#f-email-domain').value;
      data.patient.email = local ? `${local}@${domain}` : '';
    };
    $('#f-email-local').addEventListener('input', updateEmail);
    $('#f-email-domain').addEventListener('change', () => {
      data.emailUseOtherDomain = $('#f-email-domain').value === '__otro';
      updateEmail();
      paint(root);
    });
    $('#f-email-domain-other')?.addEventListener('input', updateEmail);
  }

  if (key === 'medico') {
    $('#f-doc').addEventListener('input', (e) => { data.doctorOther = e.target.value; });
  }

  if (key === 'estudios') {
    const input = $('#wz-study-search');
    input.addEventListener('input', debounce(async () => {
      const q = input.value.trim();
      const box = $('#wz-study-results');
      if (q.length < 2) { box.innerHTML = ''; return; }
      try {
        const res = await apiGet('episodes/search_studies', { q });
        box.innerHTML = res.items.map((s, i) => optionBtn(`data-pick-study="${i}"`, s.name, false)).join('')
          || '<p class="py-2 text-center text-sm text-slate-400">Sin coincidencias.</p>';
        box.querySelectorAll('[data-pick-study]').forEach((b) => b.addEventListener('click', () => {
          const s = res.items[+b.dataset.pickStudy];
          if (!data.studies.some((x) => x.study_id === s.id)) {
            data.studies.push({ study_id: s.id, name: s.name, amount: '' });
          }
          input.value = '';
          paint(root);
        }));
      } catch { box.innerHTML = ''; }
    }, 300));
    root.querySelectorAll('[data-rm-study]').forEach((b) => b.addEventListener('click', () => {
      data.studies.splice(+b.dataset.rmStudy, 1);
      paint(root);
    }));
  }

  if (key === 'pago') {
    root.querySelectorAll('[data-amount]').forEach((i) => i.addEventListener('input', () => {
      data.studies[+i.dataset.amount].amount = i.value;
    }));
    root.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
      data.paymentMethod = b.dataset.pay;
      paint(root);
    }));
  }

  if (key === 'sintomas') {
    root.querySelectorAll('[data-sym]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sym;
      if (data.symptoms[k] === undefined) data.symptoms[k] = '';
      else delete data.symptoms[k];
      paint(root);
    }));
    root.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => {
      data.symptoms[b.dataset.dur] = b.dataset.value;
      paint(root);
    }));
    $('#f-sym-other').addEventListener('input', (e) => { data.symptomsOther = e.target.value; });
  }

  if (key === 'medicamentos') {
    $('#f-meds').addEventListener('input', (e) => { data.medicamentos = e.target.value; });
  }

  if (key === 'firma') {
    setupSignature(root);
  }
}

/** Lienzo de firma. Es una copia deliberadamente simple de la de forms.js:
    aquí ocupa la pantalla completa y no vive dentro de un <form>. */
function setupSignature(root) {
  const canvas = root.querySelector('#wz-sig');
  const c = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 320;
    const h = canvas.offsetHeight || 256;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    c.scale(dpr, dpr);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1e293b';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // Al volver a este paso se repinta lo ya firmado
    if (data.signature) {
      const img = new Image();
      img.onload = () => c.drawImage(img, 0, 0, w, h);
      img.src = data.signature;
      hasInk = true;
    }
  };
  requestAnimationFrame(resize);

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return [t.clientX - r.left, t.clientY - r.top];
  };
  const start = (e) => { e.preventDefault(); drawing = true; const [x, y] = pos(e); c.beginPath(); c.moveTo(x, y); };
  const draw = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const [x, y] = pos(e);
    c.lineTo(x, y);
    c.stroke();
    hasInk = true;
  };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (hasInk) data.signature = canvas.toDataURL('image/png');
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', draw);
  window.addEventListener('pointerup', end);

  root.querySelector('#wz-sig-clear').addEventListener('click', () => {
    data.signature = '';
    hasInk = false;
    resize();
  });
}

/* ================== Validación y envío ================== */

function validate(key) {
  switch (key) {
    case 'nombre':
      if (!data.patient.first_name.trim()) return 'Falta el nombre.';
      if (!data.patient.paternal_surname.trim()) return 'Falta el apellido paterno.';
      return null;
    case 'nacimiento':
      if (!data.patient.birth_date) return 'Falta la fecha de nacimiento.';
      if (!data.patient.sex) return 'Falta indicar el sexo.';
      return null;
    case 'contacto':
      if (data.patient.email && !/^\S+@\S+\.\S+$/.test(data.patient.email)) return 'El correo no parece válido.';
      return null;
    case 'estudios':
      return data.studies.length ? null : 'Agrega al menos un estudio.';
    case 'pago':
      if (data.studies.some((s) => !(parseFloat(s.amount) >= 0))) return 'Falta el monto de algún estudio.';
      return data.paymentMethod ? null : 'Indica la forma de pago.';
    case 'sintomas':
      return Object.values(data.symptoms).every((v) => v) ? null : 'Falta indicar desde cuándo en alguna molestia.';
    default:
      return null;
  }
}

/**
 * Aviso opcional de "quizá ya existe", justo al terminar de capturar nombre y
 * fecha de nacimiento (mismo criterio que ya usa episodes/create al guardar:
 * nombre + apellido paterno + fecha de nacimiento exactos). Si el usuario
 * confirma, se sale del wizard hacia el formulario completo ya autocompletado
 * con ese paciente — nunca se sigue capturando aquí con un existingPatient
 * puesto a medio wizard. Devuelve true solo si se salió del wizard.
 */
async function checkPossibleDuplicate(root) {
  const { first_name, paternal_surname, birth_date } = data.patient;
  if (!first_name.trim() || !paternal_surname.trim() || !birth_date) return false;

  let candidates;
  try {
    const res = await apiGet('episodes/search_patient', { q: `${first_name} ${paternal_surname}`.trim() });
    candidates = res.patients;
  } catch {
    return false;   // sin conexión o error: no bloquea la captura
  }
  const fold = (s) => s.trim().toLowerCase();
  const match = candidates.find((p) =>
    fold(p.first_name) === fold(first_name) &&
    fold(p.paternal_surname) === fold(paternal_surname) &&
    p.birth_date === birth_date
  );
  if (!match) return false;

  return new Promise((resolve) => {
    modal({
      title: 'Es posible que el paciente ya se haya registrado',
      content: `
        <div class="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p class="text-base font-bold text-amber-900">${escapeHtml(fullName(match))}</p>
          <p class="text-sm text-amber-700">${escapeHtml(match.file_number)}${match.birth_date ? ' · Nac. ' + fmtDate(match.birth_date) : ''}</p>
          ${match.last_visit ? `<p class="mt-2 text-sm font-medium text-amber-800">${escapeHtml(recurrenceText(match.last_visit))}</p>` : ''}
        </div>
        <p class="mt-3 text-sm text-slate-600">¿Deseas autocompletar el registro con sus datos, en vez de seguir capturando desde cero?</p>`,
      actions: [
        { label: 'No, es alguien más', onClick: (close) => { close(); resolve(false); } },
        {
          label: 'Sí, autocompletar', primary: true,
          onClick: async (close) => {
            close();
            const mod = await import('./admision.js');
            await mod.renderFormFor(root, ctx, 'laboratorio', match);
            resolve(true);
          },
        },
      ],
    });
  });
}

async function submit(root, ignoreDuplicate = false) {
  const btn = root.querySelector('#wz-next');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const serviceData = {
    ...data.symptoms,
    sintomas: data.symptomsOther.trim(),
    medicamentos: data.medicamentos.trim(),
    pago_metodo: data.paymentMethod,
    firma: data.signature,
  };

  const payload = {
    service: 'laboratorio',
    patient_id: data.existingPatient ? +data.existingPatient.id : 0,
    patient: data.existingPatient ? {} : data.patient,
    linked_doctor_id: null,
    referring_doctor: data.doctorOther.trim() || 'A quién corresponda',
    service_data: serviceData,
    study_lines: data.studies.map((s) => ({ study_id: s.study_id, study_name: s.name, amount_charged: s.amount })),
    ignore_duplicate: ignoreDuplicate,
  };

  try {
    const res = await apiPost('episodes/create', payload);

    if (res.duplicate) {
      btn.disabled = false;
      btn.textContent = 'Guardar admisión';
      const d = res.duplicate;
      modal({
        title: 'Ese paciente quizá ya existe',
        content: `<p class="text-base text-slate-600">Ya hay un paciente con el mismo nombre y fecha de nacimiento:</p>
          <div class="mt-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
            <p class="text-base font-bold text-amber-900">${escapeHtml(fullName(d))}</p>
            <p class="text-sm text-amber-700">${escapeHtml(d.file_number)}</p>
            ${d.last_visit ? `<p class="mt-2 text-sm font-medium text-amber-800">${escapeHtml(recurrenceText(d.last_visit))}</p>` : ''}
          </div>`,
        actions: [
          { label: 'Es el mismo', primary: true, onClick: (close) => { close(); data.existingPatient = d; submit(root, false); } },
          { label: 'Es otra persona', onClick: (close) => { close(); submit(root, true); } },
        ],
      });
      return;
    }

    showDone(root, res);
  } catch (e) {
    // Sin e.code: fetch nunca llegó a obtener respuesta del servidor (sin señal
    // o red intermitente), a diferencia de un rechazo válido (nombre faltante,
    // permiso, etc.), que sí trae código y no se arregla reintentando a ciegas.
    if (e.code === undefined) {
      await queueOffline(root, payload);
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Guardar admisión';
    toast(e.message, 'error');
  }
}

/**
 * Sin conexión no hay forma de preguntar al servidor si el paciente ya existe
 * (el aviso de recurrencia de F1 depende de esa consulta); se guarda como
 * "es otra persona" y, si de verdad era el mismo, el propio detector de
 * recurrencia lo señala en cuanto alguien vuelva a admitir a ese paciente.
 */
async function queueOffline(root, payload) {
  await outboxEnqueue({ ...payload, ignore_duplicate: true });
  registerBackgroundSync();
  outboxState = await outboxCount();
  showQueued(root);
}

async function registerBackgroundSync() {
  try {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('sync-wizard-outbox');
  } catch {
    // Sin soporte de Background Sync: el listener de 'online' en primer plano
    // sigue cubriendo el reintento en cuanto se reabra la app con señal.
  }
}

function showQueued(root) {
  root.innerHTML = `
    <div class="mx-auto flex max-w-xl flex-col items-center pt-12 text-center">
      <div class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-amber-600">
        ${icon('upload', 'h-10 w-10')}
      </div>
      <h2 class="text-2xl font-bold text-slate-900">Guardado sin conexión</h2>
      <p class="mt-3 max-w-sm text-base text-slate-500">
        No hay señal en este momento, pero la captura no se perdió. Se enviará sola
        en cuanto el dispositivo recupere internet.
      </p>
      <p class="mt-4 text-sm font-semibold text-amber-700">
        ${outboxState.pending} admisión${outboxState.pending === 1 ? '' : 'es'} pendiente${outboxState.pending === 1 ? '' : 's'} de enviar
      </p>
      <div class="mt-10 w-full space-y-3">
        <button type="button" id="wz-again"
                class="w-full rounded-xl bg-indigo-600 px-5 py-4 text-base font-bold text-white shadow-sm hover:bg-indigo-500">
          Registrar otro paciente
        </button>
      </div>
    </div>`;

  root.querySelector('#wz-again').addEventListener('click', () => {
    step = 0;
    data = blankData();
    paint(root);
  });
}

function showDone(root, res) {
  root.innerHTML = `
    <div class="mx-auto flex max-w-xl flex-col items-center pt-12 text-center">
      <div class="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <svg viewBox="0 0 24 24" class="h-10 w-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 class="text-2xl font-bold text-slate-900">Admisión registrada</h2>
      <p class="mt-3 text-base text-slate-500">Folio del paciente</p>
      <p class="text-3xl font-bold text-indigo-600">${escapeHtml(res.file_number)}</p>
      ${res.service_folio ? `
        <p class="mt-3 text-base text-slate-500">Folio de la orden</p>
        <p class="text-2xl font-bold text-sky-600">${escapeHtml(res.service_folio)}</p>` : ''}
      ${res.mail?.sent ? `<p class="mt-5 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200">Ficha enviada por correo</p>` : ''}
      <div class="mt-10 w-full space-y-3">
        <a href="ficha.php?episode_id=${res.episode_id}" target="_blank"
           class="block rounded-xl px-5 py-4 text-base font-semibold text-indigo-600 ring-1 ring-indigo-200">Ver la ficha</a>
        <button type="button" id="wz-again"
                class="w-full rounded-xl bg-indigo-600 px-5 py-4 text-base font-bold text-white shadow-sm hover:bg-indigo-500">
          Registrar otro paciente
        </button>
      </div>
    </div>`;

  root.querySelector('#wz-again').addEventListener('click', () => {
    step = 0;
    data = blankData();
    paint(root);
  });
}
