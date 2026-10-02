/**
 * Báscula Bluetooth en los formularios de Control de peso (admisión y consulta nueva).
 *
 * Flujo: botón "Conectar báscula" → modal con instrucciones y "Buscar báscula" → al elegirla y
 * empezar a escuchar, el modal se cierra solo y avisa que el paciente ya puede subir → un
 * banner dentro del formulario muestra el peso en vivo → cuando la lectura es estable se
 * llenan los campos.
 *
 * Reglas del llenado (es un expediente clínico):
 *  - nada se escribe hasta que el mismo peso se repite varias lecturas seguidas;
 *  - peso e impedancia fuera de rango se descartan, no se escriben;
 *  - cada campo llenado lleva una etiqueta visible ("báscula" o "estimado") que desaparece si
 *    alguien lo edita a mano;
 *  - no se pisa lo que alguien ya capturó a mano;
 *  - nunca se guarda el formulario: la persona lo revisa y lo guarda como siempre.
 *
 * El decodificador de bytes de cada modelo de báscula vive en scale_decoders.js; sin
 * decodificador esta pantalla solo ofrece el informe técnico para escribir uno.
 * Un solo dispositivo a la vez: la sesión es del módulo, no del formulario, porque la consulta
 * nueva reconstruye su HTML al cambiar de episodio.
 */

import { icon, modal, toast, calcAge, escapeHtml } from './ui.js';
import { estimateFromReading, LIMITS } from './body_composition.js';
import { normalizeAdvertisement, decodeAdvertisement, isKnownScale, hasDecoders, bytesToHex } from './scale_decoders.js';

/** Lecturas seguidas con el mismo peso (±0.1 kg) antes de darlo por bueno. */
export const STABLE_COUNT = 4;
/** Si la báscula marca la lectura como estable por sí misma, basta con menos. */
const STABLE_COUNT_FLAGGED = 2;
/** Anuncios sin poder decodificar antes de avisar que el modelo no se reconoce. */
const UNREADABLE_AFTER = 6;
const WEIGHT_TOLERANCE_KG = 0.1;

/**
 * El navegador solo entrega los datos de fabricante y de servicio de los identificadores que la
 * página declara de antemano; como no sabemos cuál usa la báscula, se declaran todos.
 */
const COMPANY_IDS = Array.from({ length: 0x10000 }, (_, i) => i);
const SERVICES = [
  'generic_access', 'device_information', 'battery_service', 'weight_scale', 'body_composition', 'user_data', 'current_time',
  ...Array.from({ length: 0x100 }, (_, i) => 0xff00 + i),
];

const ESTIMATE_TRIGGERS = ['talla_cm', 'sex', 'birth_date'];

const session = {
  status: 'idle',          // idle | listening | captured
  device: null,
  abort: null,
  form: null,
  bar: null,
  getPatient: null,
  filling: false,
  live: null,              // último peso válido leído
  lastWeight: null,
  runs: 0,
  imp: null,
  reading: null,           // lo capturado: { pesoKg, impedancia }
  fill: null,              // resultado del último llenado
  adv: 0,
  unreadable: 0,
  distinct: new Map(),     // texto del anuncio → veces
  log: [],
  recalcTimer: null,
};

/* ---------- ¿se puede usar aquí? ---------- */

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** { ok:true } o { ok:false, reason } — la razón se le muestra a la persona. */
export function scaleSupport() {
  if (isIOS()) return { ok: false, reason: 'iPhone y iPad no permiten Bluetooth desde el navegador. Usa Chrome o Edge en Android o en Windows.' };
  if (!window.isSecureContext) return { ok: false, reason: 'La báscula solo funciona en una página segura (https).' };
  if (!('bluetooth' in navigator)) return { ok: false, reason: 'Este navegador no tiene Bluetooth web. Usa Chrome o Edge.' };
  if (typeof BluetoothDevice === 'undefined' || !('watchAdvertisements' in BluetoothDevice.prototype)) {
    return { ok: false, reason: 'Este navegador no puede escuchar básculas Bluetooth. Actualiza Chrome o Edge.' };
  }
  return { ok: true };
}

/** Mientras no exista el decodificador de la báscula de la clínica, el botón es solo para administración. */
export function isScaleUser(user) {
  return !!user && (user.role === 'administrador' || user.role === 'developper');
}

/** Copia del estado para pruebas y diagnóstico. */
export function scaleState() {
  return {
    status: session.status, live: session.live, runs: session.runs, reading: session.reading,
    fill: session.fill, adv: session.adv, unreadable: session.unreadable, hasDevice: !!session.device,
  };
}

/* ---------- el botón y el banner ---------- */

/**
 * Pone el botón y el banner dentro de la sección de antropometría del formulario.
 * Se llama después de initSections() y se puede volver a llamar cuando el formulario se
 * reconstruye (cambio de episodio): la sesión de la báscula sobrevive.
 *
 * @param {HTMLFormElement} form
 * @param {{ getPatient?: () => ({sex?:string, birth_date?:string}|null), enabled?: boolean }} opts
 */
export function attachScaleButton(form, { getPatient = null, enabled = true } = {}) {
  if (!enabled) return;
  const sec = form.querySelector('[data-sec="cp_antro"]');
  const title = sec?.querySelector('h4');
  if (!sec || !title) return;

  // Una lectura capturada para otro formulario (otro paciente, otra pantalla) no se hereda.
  if (session.form && session.form !== form && !session.form.isConnected) {
    session.reading = null; session.fill = null;
    if (session.status === 'captured') resetMeasuring('listening');
  }
  form.querySelector('[data-scale-bar]')?.remove();
  const bar = document.createElement('div');
  bar.dataset.scaleBar = '';
  bar.className = 'mb-4 rounded-xl bg-indigo-50 p-3 text-sm ring-1 ring-indigo-100';
  title.after(bar);

  const sameForm = session.form === form;
  session.form = form;
  session.bar = bar;
  session.getPatient = getPatient;
  wireForm(form);
  bar.addEventListener('click', onBarClick);

  // Misma consulta, otro episodio: los campos se reconstruyeron vacíos; se vuelve a llenar.
  if (sameForm && session.status === 'captured' && session.reading) applyFill();
  paint();
}

function wireForm(form) {
  if (form.dataset.scaleWired) return;
  form.dataset.scaleWired = '1';
  const onEdit = (e) => {
    if (session.filling) return;
    const el = e.target;
    // Editar a mano un campo llenado por la báscula le quita la etiqueta: ya es dato de la persona.
    if (el.dataset?.scaleFilled && (e.type === 'input' || e.type === 'change')) clearMark(el);
    if (session.status === 'captured' && ESTIMATE_TRIGGERS.includes(el.name)) {
      clearTimeout(session.recalcTimer);
      session.recalcTimer = setTimeout(() => { if (session.form?.isConnected && session.status === 'captured') { applyFill(); paint(); } }, 400);
    }
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
}

function onBarClick(e) {
  const btn = e.target.closest('[data-scale-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.scaleAct;
  if (act === 'open') openConnectModal();
  else if (act === 'stop') { stopSession(); toast('Báscula desconectada.', 'info'); }
  else if (act === 'again') { resetMeasuring('listening'); paint(); toast('Listo: el paciente puede volver a subir a la báscula.', 'info'); }
  else if (act === 'report') copyReport();
}

const BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold';
const BTN_PRIMARY = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50`;
const BTN_GHOST = `${BTN} text-slate-600 ring-1 ring-slate-300 hover:bg-white`;

function paint() {
  const bar = session.bar;
  if (!bar || !bar.isConnected) return;
  const support = scaleSupport();
  let html;

  if (!support.ok) {
    html = `
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" disabled class="${BTN_PRIMARY}">${icon('bluetooth', 'h-4 w-4')} Conectar báscula</button>
        <p class="min-w-0 flex-1 text-xs text-slate-500">${escapeHtml(support.reason)}</p>
      </div>`;
  } else if (session.status === 'idle') {
    html = `
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" data-scale-act="open" class="${BTN_PRIMARY}">${icon('bluetooth', 'h-4 w-4')} Conectar báscula</button>
        <p class="min-w-0 flex-1 text-xs text-slate-500">Captura el peso y la composición corporal directo de la báscula Bluetooth.</p>
      </div>`;
  } else if (session.status === 'listening') {
    const unreadable = session.unreadable >= UNREADABLE_AFTER && session.live === null;
    const liveLine = session.live !== null
      ? `Leyendo… <b class="text-slate-900">${session.live.toFixed(1)} kg</b> <span class="text-slate-500">(${session.runs}/${STABLE_COUNT} lecturas iguales)</span>`
      : 'Esperando el peso…';
    html = `
      <div role="status" aria-live="polite">
        <p class="flex items-center gap-2 font-semibold text-emerald-700">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span> Báscula conectada: el paciente ya puede subir a la báscula.
        </p>
        ${unreadable ? `
          <p class="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200">
            Se reciben datos de la báscula, pero Sirius todavía no sabe leer este modelo, así que no puede llenar nada.
            ${hasDecoders() ? '' : 'Copia el informe técnico y compártelo para agregar el soporte.'}
          </p>` : `<p class="mt-1 text-slate-600">${liveLine}</p>`}
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" data-scale-act="stop" class="${BTN_GHOST}">Desconectar</button>
          ${session.adv ? `<button type="button" data-scale-act="report" class="${BTN_GHOST}">Copiar informe técnico</button>` : ''}
        </div>
      </div>`;
  } else {
    const r = session.reading;
    const fill = session.fill || { filled: 0, estimated: 0, respected: [], missing: [], notes: [] };
    html = `
      <div role="status" aria-live="polite">
        <p class="font-semibold text-emerald-700">Capturado: ${r.pesoKg.toFixed(1)} kg${r.impedancia ? ` · impedancia ${Math.round(r.impedancia)} Ω` : ''}</p>
        <p class="mt-1 text-xs text-slate-600">
          Se llenaron ${fill.filled} campo(s).${fill.estimated ? ' Los marcados «estimado» los calcula Sirius con ecuaciones publicadas: no son una medición directa y no coincidirán con la app de la báscula.' : ''} Revisa antes de guardar.
        </p>
        ${fill.respected.length ? `<p class="mt-1 text-xs text-slate-600">No se tocó lo que ya habías capturado: ${fill.respected.map(escapeHtml).join(', ')}.</p>` : ''}
        ${fill.missing.length ? `<p class="mt-1 text-xs text-amber-700">Para estimar más, captura: ${fill.missing.map(escapeHtml).join(', ')}. Se calcula solo al llenarlo.</p>` : ''}
        ${fill.notes.map((n) => `<p class="mt-1 text-xs text-amber-700">${escapeHtml(n)}</p>`).join('')}
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" data-scale-act="again" class="${BTN_PRIMARY}">Volver a pesar</button>
          <button type="button" data-scale-act="stop" class="${BTN_GHOST}">Desconectar</button>
        </div>
      </div>`;
  }
  bar.innerHTML = html;
}

/* ---------- modal de conexión ---------- */

/**
 * Abre el selector del navegador. Si el navegador rechaza la lista completa de identificadores
 * de fabricante (TypeError: no hay un límite documentado, pero listas de 65 536 son inusuales),
 * se reintenta solo con los servicios: la báscula se conecta igual, aunque sus datos de
 * fabricante no lleguen y entonces Sirius avisa que no puede leerla.
 */
async function requestScaleDevice() {
  try {
    return await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICES,
      optionalManufacturerData: COMPANY_IDS,
    });
  } catch (e) {
    if (e?.name !== 'TypeError') throw e;
    return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  }
}

function openConnectModal() {
  const support = scaleSupport();
  if (!support.ok) { toast(support.reason, 'error'); return; }
  const content = document.createElement('div');
  content.innerHTML = `
    <ol class="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
      <li>Cierra la app de la báscula en el teléfono (si está abierta, se queda con la conexión).</li>
      <li>Enciende el Bluetooth del equipo y, en Android, la ubicación.</li>
      <li>Despierta la báscula tocándola con el pie.</li>
      <li>Pulsa <b>Buscar báscula</b> y elígela en la ventana del navegador.</li>
    </ol>
    <p data-scale-err class="mt-3 hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"></p>`;
  const errEl = content.querySelector('[data-scale-err]');
  modal({
    title: 'Conectar báscula',
    content,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Buscar báscula', primary: true,
        onClick: async (close, btn) => {
          errEl.classList.add('hidden');
          btn.disabled = true;
          btn.textContent = 'Elige la báscula en la ventana…';
          try {
            const device = await requestScaleDevice();
            await startListening(device);
            close();
            toast('Báscula conectada. El paciente ya puede subir a la báscula.', 'success');
          } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Buscar báscula';
            errEl.textContent = e?.name === 'NotFoundError'
              ? 'No se eligió ninguna báscula. Vuelve a intentarlo.'
              : `No se pudo conectar: ${e?.message || e}`;
            errEl.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* ---------- escucha ---------- */

async function startListening(device) {
  if (typeof device.watchAdvertisements !== 'function') {
    throw new Error('Este navegador no puede escuchar la báscula. Actualiza Chrome o Edge.');
  }
  stopSession();
  const abort = new AbortController();
  session.device = device;
  session.abort = abort;
  session.adv = 0; session.unreadable = 0; session.distinct.clear(); session.log = [];
  resetMeasuring('listening');
  device.addEventListener('advertisementreceived', onAdvertisement);
  try {
    await device.watchAdvertisements({ signal: abort.signal });
  } catch (e) {
    device.removeEventListener('advertisementreceived', onAdvertisement);
    session.device = null; session.abort = null; session.status = 'idle';
    paint();
    throw e;
  }
  logLine(`Escuchando ${device.name || '(sin nombre)'}`);
  paint();
}

function stopSession() {
  try { session.abort?.abort(); } catch { /* ya detenido */ }
  session.device?.removeEventListener?.('advertisementreceived', onAdvertisement);
  session.device = null; session.abort = null;
  resetMeasuring('idle');
  paint();
}

function resetMeasuring(status) {
  session.status = status;
  session.live = null; session.lastWeight = null; session.runs = 0; session.imp = null;
  if (status !== 'captured') { session.reading = null; session.fill = null; }
}

function onAdvertisement(ev) {
  // Formulario cerrado (modal cancelado, otra pantalla): se deja de escuchar.
  if (!session.form || !session.form.isConnected) { stopSession(); return; }
  session.adv++;
  const adv = normalizeAdvertisement(ev);
  recordAdvertisement(adv);
  const decoded = decodeAdvertisement(adv);
  if (!decoded) {
    if (!isKnownScale(adv)) session.unreadable++;
    if (session.unreadable === UNREADABLE_AFTER) paint();
    return;
  }
  handleReading(decoded.reading);
}

/** Procesa una lectura ya decodificada. Exportada para poder probar la estabilidad. */
export function handleReading(r) {
  if (session.status !== 'listening') return;
  const w = r.pesoKg;
  if (!Number.isFinite(w) || w < LIMITS.pesoKg[0] || w > LIMITS.pesoKg[1]) {
    // Báscula sin nadie encima, o una lectura imposible: no cuenta ni se escribe.
    session.live = null; session.lastWeight = null; session.runs = 0; session.imp = null;
    paint();
    return;
  }
  if (session.lastWeight !== null && Math.abs(w - session.lastWeight) <= WEIGHT_TOLERANCE_KG) {
    session.runs++;
    if (r.impedancia != null) session.imp = r.impedancia;
  } else {
    session.runs = 1;
    session.imp = r.impedancia ?? null;
  }
  session.lastWeight = w;
  session.live = w;
  const need = r.estable ? STABLE_COUNT_FLAGGED : STABLE_COUNT;
  if (session.runs >= need) {
    session.reading = { pesoKg: w, impedancia: session.imp };
    session.status = 'captured';
    logLine(`CAPTURA peso=${w} impedancia=${session.imp ?? '—'}`);
    applyFill();
    toast(`Peso capturado: ${w.toFixed(1)} kg`, 'success');
  }
  paint();
}

/* ---------- llenado del formulario ---------- */

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function fieldLabel(el) {
  return (el.closest('div')?.querySelector('label')?.textContent || el.name).replace(/\s*[—(].*$/, '').trim();
}

function markFilled(el, kind) {
  clearMark(el);
  el.dataset.scaleFilled = kind;
  el.style.outline = `2px solid ${kind === 'bascula' ? '#34d399' : '#a5b4fc'}`;
  el.style.outlineOffset = '-1px';
  const badge = document.createElement('p');
  badge.dataset.scaleBadge = '';
  badge.className = `mt-1 text-[11px] font-semibold ${kind === 'bascula' ? 'text-emerald-700' : 'text-indigo-600'}`;
  badge.textContent = kind === 'bascula' ? 'Capturado de la báscula' : 'Estimado por Sirius (no es medición directa)';
  el.after(badge);
}

function clearMark(el) {
  delete el.dataset.scaleFilled;
  el.style.outline = '';
  el.style.outlineOffset = '';
  const next = el.nextElementSibling;
  if (next && 'scaleBadge' in next.dataset) next.remove();
}

function applyFill() {
  const form = session.form;
  const r = session.reading;
  if (!form || !r) return;
  const patient = session.getPatient?.() || {};
  const est = estimateFromReading({
    pesoKg: r.pesoKg,
    impedancia: r.impedancia,
    tallaCm: num(form.querySelector('[name="talla_cm"]')?.value),
    edad: calcAge(patient.birth_date),
    sexo: patient.sex || form.querySelector('[name="sex"]')?.value || null,
  });

  const respected = [];
  let filled = 0;
  let estimated = 0;
  let last = null;
  session.filling = true;
  try {
    for (const [key, { value, kind }] of Object.entries(est.fields)) {
      const el = form.querySelector(`[name="${key}"]`);
      if (!el) continue;
      const manual = el.value.trim() !== '' && !el.dataset.scaleFilled;
      if (manual) { respected.push(fieldLabel(el)); continue; }
      el.value = String(value);
      markFilled(el, kind);
      filled++;
      if (kind === 'estimado') estimated++;
      last = el;
    }
    // Un solo evento al final: el formulario recalcula IMC y demás campos automáticos.
    last?.dispatchEvent(new Event('input', { bubbles: true }));
  } finally {
    session.filling = false;
  }
  session.fill = { filled, estimated, respected, missing: est.missing, notes: est.notes };
}

/* ---------- informe técnico (para escribir el decodificador de un modelo nuevo) ---------- */

function logLine(text) {
  session.log.push(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
  if (session.log.length > 400) session.log.shift();
}

function recordAdvertisement(adv) {
  const parts = [];
  adv.manufacturerData.forEach((u8, id) => parts.push(`fabricante 0x${id.toString(16).padStart(4, '0')}: ${bytesToHex(u8)}`));
  adv.serviceData.forEach((u8, uuid) => parts.push(`servicio ${uuid}: ${bytesToHex(u8)}`));
  const text = parts.length ? parts.join(' | ') : '(anuncio sin datos de fabricante ni de servicio)';
  const n = session.distinct.get(text) || 0;
  if (n === 0 && session.distinct.size < 300) logLine(`ANUNCIO rssi ${adv.rssi} · ${text}`);
  if (n > 0 || session.distinct.size < 300) session.distinct.set(text, n + 1);
}

function buildReport() {
  return [
    '== Informe de báscula (desde Sirius) ==',
    `Fecha: ${new Date().toISOString()}`,
    `Navegador: ${navigator.userAgent}`,
    `Dispositivo: ${session.device?.name || '(sin nombre)'}`,
    `Anuncios recibidos: ${session.adv} (${session.distinct.size} distintos) · sin decodificar: ${session.unreadable}`,
    `Decodificadores registrados: ${hasDecoders() ? 'sí' : 'ninguno'}`,
    '',
    '-- Anuncios distintos --',
    ...[...session.distinct.entries()].map(([text, n], i) => `#${i + 1} x${n} ${text}`),
    '',
    '-- Registro --',
    ...session.log,
  ].join('\n');
}

async function copyReport() {
  const text = buildReport();
  try {
    await navigator.clipboard.writeText(text);
    toast('Informe copiado. Pégalo en el chat.', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.className = 'h-64 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs';
    modal({ title: 'Informe técnico', content: ta, actions: [{ label: 'Cerrar' }] });
    ta.select();
  }
}
