/**
 * Módulo Empleados (Admin Tools): ficha de cada usuario de Sirius — datos personales, correo
 * institucional, fecha de inicio, jornada, días de vacaciones y registro de vacaciones tomadas —
 * y qué datos ve el propio empleado en Perfil (menú del avatar).
 *
 * Las cifras calculadas (antigüedad, tomados, restantes) vienen del servidor. Aquí solo hay dos
 * vistas previas mientras se escribe: antigüedad (tenureText, espejo de employee_tenure en
 * includes/employees.php) y restantes = correspondientes − tomados. Al guardar se repinta con
 * lo que devuelve el servidor.
 */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, inputCls, labelCls, fmtDate } from '../ui.js';

const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];

const VISIBLE = [
  ['full_name', 'Nombre completo'],
  ['contact', 'Datos de contacto personales'],
  ['institutional_email', 'Correo institucional'],
  ['start_date', 'Fecha de inicio de la relación laboral'],
  ['tenure', 'Tiempo de trabajo con nosotros'],
  ['vacation_entitled', 'Días de vacaciones correspondientes'],
  ['vacation_remaining', 'Días de vacaciones restantes'],
  ['vacation_taken', 'Días de vacaciones tomados (con desglose)'],
  ['schedule', 'Jornada laboral'],
];

const card = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200';
const h4 = 'mb-4 text-sm font-bold uppercase tracking-wide text-slate-700';

let users = [];
let current = null;     // { userId, data } de la persona abierta
let dirty = false;      // hay cambios sin guardar en la ficha

/* ---------- cálculo de antigüedad (espejo del servidor, solo vista previa) ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "2 años, 3 meses y 12 días". Mismo algoritmo que employee_tenure() en includes/employees.php. */
export function tenureText(start, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start || '');
  if (!m) return '';
  const [sy, sm, sd] = [+m[1], +m[2], +m[3]];
  const check = new Date(sy, sm - 1, sd);
  if (check.getFullYear() !== sy || check.getMonth() !== sm - 1 || check.getDate() !== sd) return '';
  const [ty, tm, td] = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
  if (sy > ty || (sy === ty && (sm > tm || (sm === tm && sd > td)))) {
    return `Aún no inicia (comienza el ${String(sd).padStart(2, '0')}/${String(sm).padStart(2, '0')}/${sy})`;
  }
  // Meses completos: el mayor número de meses que, sumados al inicio, no pasa de hoy (el día se
  // recorta al fin de mes: 31 ene + 1 mes = 28 feb). Los días son los que hay desde esa fecha.
  const addMonths = (months) => {
    const m0 = sm - 1 + months;
    const yy = sy + Math.floor(m0 / 12);
    const mm = ((m0 % 12) + 12) % 12;
    return new Date(yy, mm, Math.min(sd, new Date(yy, mm + 1, 0).getDate()));
  };
  const todayD = new Date(ty, tm - 1, td);
  let total = (ty - sy) * 12 + (tm - sm);
  let anchor = addMonths(total);
  if (anchor > todayD) {
    total--;
    anchor = addMonths(total);
  }
  const y = Math.floor(total / 12);
  const mo = total % 12;
  const d = Math.round((todayD - anchor) / 86400000);
  const parts = [];
  if (y > 0) parts.push(plural(y, 'año', 'años'));
  if (mo > 0) parts.push(plural(mo, 'mes', 'meses'));
  if (d > 0) parts.push(plural(d, 'día', 'días'));
  if (!parts.length) return 'Hoy es su primer día';
  if (parts.length === 1) return parts[0];
  const last = parts.pop();
  return `${parts.join(', ')} y ${last}`;
}

const fmtDays = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ---------- pantalla ---------- */

export async function render(root) {
  current = null;
  dirty = false;
  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-4">
      <section class="${card}">
        <label class="${labelCls}" for="emp-select">Empleado</label>
        <select id="emp-select" class="${inputCls}"><option value="">Cargando…</option></select>
        <p class="mt-2 text-xs text-slate-400">Cada ficha es personal: lo que captures aquí solo aplica a la persona elegida. Los usuarios inactivos también aparecen para conservar su historial.</p>
      </section>
      <div id="emp-body"></div>
    </div>`;
  const select = root.querySelector('#emp-select');
  const body = root.querySelector('#emp-body');

  try {
    ({ users } = await apiGet('employees/users_list'));
  } catch (e) {
    select.innerHTML = '<option value="">No se pudo cargar</option>';
    toast(e.message, 'error');
    return;
  }
  select.innerHTML = '<option value="">— Elige a una persona —</option>' + users.map((u) => {
    const tags = [u.is_active ? '' : 'inactivo', u.has_profile ? '' : 'sin ficha'].filter(Boolean).join(', ');
    return `<option value="${u.id}">${escapeHtml(u.full_name)} (@${escapeHtml(u.username)})${tags ? ' · ' + tags : ''}</option>`;
  }).join('');
  body.innerHTML = emptyHtml();

  let shown = '';
  select.addEventListener('change', async () => {
    const next = select.value;
    if (dirty && !(await confirmDialog('Cambios sin guardar', 'La ficha abierta tiene cambios sin guardar. Si cambias de persona se perderán.', { danger: true, confirmLabel: 'Descartar cambios' }))) {
      select.value = shown;
      return;
    }
    shown = next;
    dirty = false;
    if (!next) { current = null; body.innerHTML = emptyHtml(); return; }
    body.innerHTML = '<p class="py-8 text-center text-sm text-slate-400">Cargando ficha…</p>';
    try {
      const data = await apiGet('employees/get', { user_id: next });
      current = { userId: +next, data };
      paintForm(body);
    } catch (e) {
      body.innerHTML = '';
      toast(e.message, 'error');
    }
  });
}

const emptyHtml = () => `
  <div class="rounded-2xl bg-white p-10 text-center text-sm text-slate-400 ring-1 ring-slate-200">
    Elige a una persona para ver y editar su ficha.
  </div>`;

function paintForm(body) {
  const d = current.data;
  const sch = d.schedule;
  const visible = new Set(d.visible);
  const c = d.contact;

  body.innerHTML = `
    <form id="emp-form" class="space-y-4" novalidate>
      <section class="${card}">
        <h4 class="${h4}">Datos personales</h4>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          ${field({ key: 'full_name', label: 'Nombre completo', type: 'text', required: true, span: 'sm:col-span-2' }, d.full_name)}
          ${field({ key: 'contact_phone', label: 'Teléfono personal', type: 'tel' }, c.phone || '')}
          ${field({ key: 'contact_email_personal', label: 'Correo personal', type: 'email' }, c.email_personal || '')}
          ${field({ key: 'contact_address', label: 'Domicilio', type: 'text', span: 'sm:col-span-2' }, c.address || '')}
          ${field({ key: 'emergency_name', label: 'Contacto de emergencia', type: 'text' }, c.emergency_name || '')}
          ${field({ key: 'emergency_phone', label: 'Teléfono de emergencia', type: 'tel' }, c.emergency_phone || '')}
        </div>
      </section>

      <section class="${card}">
        <h4 class="${h4}">Relación laboral</h4>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          ${field({ key: 'institutional_email', label: 'Correo electrónico institucional', type: 'email', span: 'sm:col-span-2' }, d.institutional_email || '')}
          ${field({ key: 'start_date', label: 'Fecha de inicio', type: 'date' }, d.start_date || '')}
          <div>
            <p class="${labelCls}">Tiempo con nosotros</p>
            <p id="emp-tenure" class="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100"></p>
          </div>
        </div>
      </section>

      <section class="${card}">
        <h4 class="${h4}">Jornada laboral</h4>
        <div class="space-y-2">
          ${DAYS.map(([k, label]) => `
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label class="flex w-28 items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" data-day-on="${k}" ${sch.days[k].on ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600">
                ${label}
              </label>
              <input type="time" data-day-from="${k}" value="${sch.days[k].from || ''}" aria-label="Entrada ${label}" class="${inputCls} !w-40">
              <span class="text-xs text-slate-400">a</span>
              <input type="time" data-day-to="${k}" value="${sch.days[k].to || ''}" aria-label="Salida ${label}" class="${inputCls} !w-40">
            </div>`).join('')}
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <span class="text-xs font-semibold text-slate-500">Mismo horario para los días marcados:</span>
          <input type="time" id="gen-from" aria-label="Entrada general" class="${inputCls} !w-40">
          <span class="text-xs text-slate-400">a</span>
          <input type="time" id="gen-to" aria-label="Salida general" class="${inputCls} !w-40">
          <button type="button" id="gen-apply" class="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">Aplicar</button>
        </div>
        <p id="sched-hours" class="mt-2 text-xs text-slate-500"></p>
        <div class="mt-3">${field({ key: 'sched_note', label: 'Nota de la jornada (opcional)', type: 'text' }, sch.note || '')}</div>
      </section>

      <section class="${card}">
        <h4 class="${h4}">Vacaciones</h4>
        <div class="max-w-xs">${field({ key: 'vacation_days_entitled', label: 'Días de vacaciones que le corresponden', type: 'number', step: '0.5', min: 0, max: 366 }, d.vacation.entitled)}</div>
        <div id="vac-summary" class="mt-4 grid grid-cols-3 gap-3"></div>
        <div class="mt-4 flex items-center justify-between gap-3">
          <p class="${labelCls} !mb-0">Vacaciones tomadas</p>
          <button type="button" id="vac-add" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">${icon('plus', 'h-3.5 w-3.5')} Registrar vacaciones</button>
        </div>
        <div id="vac-list" class="mt-2"></div>
      </section>

      <section class="${card}">
        <h4 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Qué ve el empleado en su Perfil</h4>
        <p class="mb-3 text-xs text-slate-400">Lo que no marques no se le muestra (ni viaja a su pantalla).</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          ${VISIBLE.map(([k, label]) => `
            <label class="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" data-visible="${k}" ${visible.has(k) ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600">
              ${escapeHtml(label)}
            </label>`).join('')}
        </div>
      </section>

      <div class="flex items-center justify-end gap-3">
        <span id="emp-dirty" class="hidden text-xs font-semibold text-amber-600">Cambios sin guardar</span>
        <button type="submit" id="emp-save" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">Guardar ficha</button>
      </div>
    </form>`;

  const form = body.querySelector('#emp-form');
  paintTenure(form, d.tenure?.text);
  paintHours(form);
  paintVacation(form);

  const markDirty = () => { dirty = true; form.querySelector('#emp-dirty').classList.remove('hidden'); };
  form.addEventListener('input', (e) => {
    if (e.target.id === 'gen-from' || e.target.id === 'gen-to') return;
    markDirty();
    if (e.target.name === 'start_date') paintTenure(form, null);
    if (e.target.name === 'vacation_days_entitled') paintVacation(form, { listToo: false });
    if (e.target.matches('[data-day-on],[data-day-from],[data-day-to]')) paintHours(form);
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-day-on]')) markDirty();
  });

  form.querySelector('#gen-apply').addEventListener('click', () => {
    const from = form.querySelector('#gen-from').value;
    const to = form.querySelector('#gen-to').value;
    if (!from || !to) { toast('Indica la entrada y la salida del horario general', 'error'); return; }
    form.querySelectorAll('[data-day-on]:checked').forEach((cb) => {
      form.querySelector(`[data-day-from="${cb.dataset.dayOn}"]`).value = from;
      form.querySelector(`[data-day-to="${cb.dataset.dayOn}"]`).value = to;
    });
    markDirty();
    paintHours(form);
  });

  form.querySelector('#vac-add').addEventListener('click', () => openVacationModal(form, null));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(form); });
}

function paintTenure(form, serverText) {
  const el = form.querySelector('#emp-tenure');
  const start = form.querySelector('[name=start_date]').value;
  el.textContent = start ? (serverText || tenureText(start) || 'Fecha no válida') : 'Captura la fecha de inicio';
}

function readSchedule(form) {
  const days = {};
  for (const [k] of DAYS) {
    days[k] = {
      on: form.querySelector(`[data-day-on="${k}"]`).checked,
      from: form.querySelector(`[data-day-from="${k}"]`).value || null,
      to: form.querySelector(`[data-day-to="${k}"]`).value || null,
    };
  }
  return { days, note: form.querySelector('[name=sched_note]').value.trim() };
}

function paintHours(form) {
  const { days } = readSchedule(form);
  let min = 0;
  let marked = 0;
  for (const d of Object.values(days)) {
    if (!d.on) continue;
    marked++;
    if (d.from && d.to && d.to > d.from) {
      const [fh, fm] = d.from.split(':').map(Number);
      const [th, tm] = d.to.split(':').map(Number);
      min += (th * 60 + tm) - (fh * 60 + fm);
    }
  }
  form.querySelector('#sched-hours').textContent = marked
    ? `${marked} día(s) por semana · ${fmtDays(Math.round(min / 6) / 10)} horas semanales`
    : 'Sin días marcados: las vacaciones se contarán por días naturales hasta que captures la jornada.';
}

/** Resumen (correspondientes / tomados / restantes) y tabla de registros. */
function paintVacation(form, { listToo = true } = {}) {
  const v = current.data.vacation;
  const entitled = parseFloat(form.querySelector('[name=vacation_days_entitled]').value) || 0;
  const remaining = Math.round((entitled - v.taken) * 10) / 10;
  const tile = (label, value, cls = 'text-slate-900') => `
    <div class="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <p class="text-[10px] font-semibold uppercase tracking-tight text-slate-500">${label}</p>
      <p class="mt-1 text-xl font-bold ${cls}">${fmtDays(value)}</p>
    </div>`;
  form.querySelector('#vac-summary').innerHTML =
    tile('Corresponden', entitled)
    + tile('Tomados', v.taken)
    + tile(remaining < 0 ? 'Excedidos' : 'Restantes', Math.abs(remaining), remaining < 0 ? 'text-red-600' : 'text-emerald-600');
  if (!listToo) return;

  const list = form.querySelector('#vac-list');
  if (!v.records.length) {
    list.innerHTML = '<p class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400 ring-1 ring-slate-200">Aún no hay vacaciones registradas.</p>';
    return;
  }
  list.innerHTML = `
    <div class="overflow-hidden rounded-xl ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th class="px-3 py-2">Periodo</th><th class="px-3 py-2">Días</th><th class="hidden px-3 py-2 sm:table-cell">Observaciones</th><th class="px-3 py-2 text-right"></th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${v.records.map((r) => `
              <tr>
                <td class="px-3 py-2 text-slate-800">${fmtDate(r.date_from)}${r.date_to !== r.date_from ? ' — ' + fmtDate(r.date_to) : ''}</td>
                <td class="px-3 py-2 font-semibold text-slate-800">${fmtDays(r.days)}</td>
                <td class="hidden px-3 py-2 text-slate-500 sm:table-cell">${escapeHtml(r.notes || '')}</td>
                <td class="px-3 py-2">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-vac-edit="${r.id}" title="Editar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    <button type="button" data-vac-del="${r.id}" title="Eliminar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  list.querySelectorAll('[data-vac-edit]').forEach((b) => b.addEventListener('click', () =>
    openVacationModal(form, v.records.find((r) => r.id === +b.dataset.vacEdit))));
  list.querySelectorAll('[data-vac-del]').forEach((b) => b.addEventListener('click', async () => {
    const r = v.records.find((x) => x.id === +b.dataset.vacDel);
    const ok = await confirmDialog('Eliminar vacaciones', `¿Eliminar el registro del ${fmtDate(r.date_from)} al ${fmtDate(r.date_to)} (${fmtDays(r.days)} día(s))? Los días se devuelven al saldo.`, { danger: true, confirmLabel: 'Eliminar' });
    if (!ok) return;
    try {
      applyVacationResult(form, await apiPost('employees/vacation_delete', { id: r.id }));
      toast('Registro eliminado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

/** Tras alta/edición/baja de un registro: se actualizan solo las vacaciones, sin tocar lo que haya a medio capturar en el resto de la ficha. */
function applyVacationResult(form, view) {
  current.data.vacation = view.vacation;
  paintVacation(form);
}

/* ---------- registrar / editar vacaciones ---------- */

function openVacationModal(form, record) {
  const editing = !!record;
  const f = document.createElement('form');
  f.noValidate = true;
  f.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'date_from', label: 'Del', type: 'date', required: true }, record?.date_from || '')}
      ${field({ key: 'date_to', label: 'Al', type: 'date', required: true }, record?.date_to || '')}
      <div class="sm:col-span-2">
        <label class="${labelCls}">Días que se descuentan</label>
        <div class="flex flex-wrap items-center gap-2">
          <input name="days" type="number" step="0.5" min="0.5" value="${record ? record.days : ''}" class="${inputCls} sm:!w-40">
          <button type="button" id="vac-recalc" class="rounded-lg px-3 py-2 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">Recalcular según la jornada</button>
        </div>
        <p id="vac-days-hint" class="mt-1 text-xs text-slate-400">Elige las fechas y se calculan solos. Puedes corregir el número (por ejemplo, por un día festivo).</p>
      </div>
      ${field({ key: 'notes', label: 'Motivo u observaciones (opcional)', type: 'textarea', span: 'sm:col-span-2' }, record?.notes || '')}
    </div>
    <p id="vac-error" class="mt-3 hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"></p>`;

  const from = f.querySelector('[name=date_from]');
  const to = f.querySelector('[name=date_to]');
  const days = f.querySelector('[name=days]');
  const hint = f.querySelector('#vac-days-hint');
  const err = f.querySelector('#vac-error');
  let manual = editing;       // al editar, el número guardado manda hasta que se cambien las fechas
  let seq = 0;

  const recalc = async () => {
    if (!from.value || !to.value || to.value < from.value) return;
    const mine = ++seq;
    try {
      // Se cuenta con la jornada que está en pantalla (guardada o no), no con la del servidor.
      const r = await apiPost('employees/vacation_preview', { user_id: current.userId, date_from: from.value, date_to: to.value, work_schedule: readSchedule(form) });
      if (mine !== seq) return;
      days.value = r.days;
      manual = false;
      hint.textContent = r.mode === 'jornada'
        ? `${r.days} día(s) laborables de ${r.span} naturales, según la jornada de la ficha${dirty ? ' (recuerda guardar la ficha para conservar esa jornada)' : ''}. Puedes corregir el número.`
        : `${r.days} día(s) naturales: no hay ningún día marcado en la jornada, así que se cuentan todos. Marca los días laborables en «Jornada laboral» y pulsa «Recalcular según la jornada».`;
    } catch (e) {
      if (mine === seq) hint.textContent = e.message;
    }
  };
  from.addEventListener('change', () => { if (to.value && to.value < from.value) to.value = from.value; recalc(); });
  to.addEventListener('change', recalc);
  f.querySelector('#vac-recalc').addEventListener('click', () => {
    if (!from.value || !to.value) { hint.textContent = 'Elige primero las fechas.'; return; }
    recalc();
  });
  days.addEventListener('input', () => { manual = true; });

  modal({
    title: editing ? 'Editar vacaciones' : 'Registrar vacaciones',
    content: f,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar', primary: true,
        onClick: async (close, btn) => {
          err.classList.add('hidden');
          if (!from.value || !to.value) { err.textContent = 'Indica las fechas de inicio y de fin.'; err.classList.remove('hidden'); return; }
          btn.disabled = true;
          try {
            const view = await apiPost('employees/vacation_save', {
              id: record?.id || 0,
              user_id: current.userId,
              date_from: from.value,
              date_to: to.value,
              days: manual || days.value !== '' ? days.value : null,
              notes: f.querySelector('[name=notes]').value.trim(),
            });
            close();
            applyVacationResult(form, view);
            toast(editing ? 'Vacaciones actualizadas' : 'Vacaciones registradas');
          } catch (e) {
            btn.disabled = false;
            err.textContent = e.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* ---------- guardar la ficha ---------- */

async function save(form) {
  const val = (n) => form.querySelector(`[name="${n}"]`).value.trim();
  const btn = form.querySelector('#emp-save');
  if (!val('full_name')) { toast('El nombre completo es obligatorio', 'error'); return; }
  const payload = {
    user_id: current.userId,
    full_name: val('full_name'),
    contact_phone: val('contact_phone'),
    contact_email_personal: val('contact_email_personal'),
    contact_address: val('contact_address'),
    emergency_name: val('emergency_name'),
    emergency_phone: val('emergency_phone'),
    institutional_email: val('institutional_email'),
    start_date: val('start_date'),
    vacation_days_entitled: val('vacation_days_entitled'),
    work_schedule: readSchedule(form),
    visible_fields: [...form.querySelectorAll('[data-visible]:checked')].map((c) => c.dataset.visible),
  };
  btn.disabled = true;
  try {
    const view = await apiPost('employees/save', payload);
    current.data = view;
    dirty = false;
    form.querySelector('#emp-dirty').classList.add('hidden');
    paintTenure(form, view.tenure?.text);
    paintVacation(form);
    const u = users.find((x) => x.id === current.userId);
    if (u) {
      u.full_name = view.full_name;
      u.has_profile = true;
      const opt = document.querySelector(`#emp-select option[value="${u.id}"]`);
      if (opt) {
        const tags = [u.is_active ? '' : 'inactivo'].filter(Boolean).join(', ');
        opt.textContent = `${u.full_name} (@${u.username})${tags ? ' · ' + tags : ''}`;
      }
    }
    toast('Ficha guardada');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
