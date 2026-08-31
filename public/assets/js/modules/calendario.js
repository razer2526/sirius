/** Módulo Calendario: citas de todos los servicios (mensual + agenda + invitados externos). */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, inputCls, labelCls, spinner, debounce, fullName } from '../ui.js';

const SERVICE_LABELS = {
  laboratorio: 'Laboratorio',
  control_peso: 'Control de peso',
  fisioterapia: 'Fisioterapia',
  podologia: 'Podología',
  recoleccion: 'Recolección a domicilio',
  otro: 'Otro',
};
const SERVICE_DOT = {
  laboratorio: 'bg-violet-500',
  control_peso: 'bg-emerald-500',
  fisioterapia: 'bg-sky-500',
  podologia: 'bg-amber-500',
  recoleccion: 'bg-rose-500',
  otro: 'bg-slate-400',
};
const STATUS_LABELS = { programada: 'Programada', confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Completada' };
const STATUS_BADGE = {
  programada: 'bg-slate-100 text-slate-600',
  confirmada: 'bg-sky-100 text-sky-700',
  cancelada: 'bg-red-100 text-red-700',
  completada: 'bg-emerald-100 text-emerald-700',
};
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export async function render(root, ctx) {
  const arg = ctx.args[0];
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;
  if (arg && /^\d{4}-\d{2}$/.test(arg)) {
    [year, month] = arg.split('-').map(Number);
  }
  await renderMonth(root, ctx, year, month);
}

async function renderMonth(root, ctx, year, month) {
  root.innerHTML = spinner();

  const from = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad2(month)}-${pad2(lastDay)}`;

  // Las tareas con fecha límite se muestran aquí de solo lectura (Tareas sigue
  // siendo la única fuente de verdad); se omiten en silencio si el usuario no
  // tiene acceso a ese módulo, en vez de tronar todo el Calendario.
  const hasTareas = ctx.modules.some((m) => m.key === 'tareas');
  const [{ appointments, can_manage }, { users: assignableUsers }, dueTasks] = await Promise.all([
    apiGet('appointments/list', { from, to }),
    apiGet('episodes/assignable_users'),
    hasTareas ? apiGet('tasks/due_in_range', { from, to }).then((r) => r.tasks) : Promise.resolve([]),
  ]);

  const byDay = {};
  for (const a of appointments) {
    const day = a.start_at.slice(8, 10);
    (byDay[day] ||= []).push(a);
  }
  for (const day in byDay) byDay[day].sort((a, b) => a.start_at.localeCompare(b.start_at));

  const tasksByDay = {};
  for (const t of dueTasks) {
    const day = t.due_date.slice(8, 10);
    (tasksByDay[day] ||= []).push(t);
  }

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (d) => {
    const t = new Date();
    return d === t.getDate() && month === t.getMonth() + 1 && year === t.getFullYear();
  };

  const dayCellHtml = (d) => {
    if (!d) return `<div class="min-h-[100px] rounded-lg bg-slate-50/60 sm:min-h-[110px]"></div>`;
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
    const appts = byDay[pad2(d)] || [];
    const dayTasks = tasksByDay[pad2(d)] || [];
    const apptChipsHtml = appts.map((a) => `
      <button type="button" data-open-appt="${a.id}" class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight hover:bg-indigo-50">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full ${SERVICE_DOT[a.service] || SERVICE_DOT.otro}"></span>
        <span class="truncate font-medium text-slate-700">${a.start_at.slice(11, 16)} ${escapeHtml(a.title)}</span>
      </button>`);
    const taskChipsHtml = dayTasks.map((t) => `
      <a href="#/tareas" data-task-chip class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight hover:bg-slate-100">
        ${icon('check-square', `h-3 w-3 shrink-0 ${t.status === 'completada' ? 'text-emerald-500' : 'text-slate-400'}`)}
        <span class="truncate ${t.status === 'completada' ? 'text-slate-400 line-through' : 'text-slate-600'}">${escapeHtml(t.title)}</span>
      </a>`);
    const allChips = [...apptChipsHtml, ...taskChipsHtml];
    const chips = allChips.slice(0, 4).join('');
    const overflow = allChips.length > 4 ? `<p class="px-1.5 text-[11px] text-slate-400">+${allChips.length - 4} más</p>` : '';
    return `
      <div data-day-cell="${dateStr}" class="group flex min-h-[100px] flex-col gap-0.5 rounded-lg p-1 ring-1 ring-slate-100 hover:ring-indigo-200 sm:min-h-[110px]">
        <div class="flex items-center justify-between px-0.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday(d) ? 'bg-indigo-600 text-white' : 'text-slate-500'}">${d}</span>
          <button type="button" data-new-appt="${dateStr}" class="hidden h-5 w-5 items-center justify-center rounded text-indigo-500 hover:bg-indigo-100 group-hover:flex">${icon('plus', 'h-3.5 w-3.5')}</button>
        </div>
        <div class="flex-1 space-y-0.5 overflow-y-auto">${chips}${overflow}</div>
      </div>`;
  };

  root.innerHTML = `
    <div class="mx-auto max-w-6xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button id="btn-prev" type="button" class="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">${icon('chevron-left', 'h-4 w-4')}</button>
          <h3 class="w-48 text-center text-lg font-bold text-slate-900 sm:w-56">${MONTH_NAMES[month - 1]} ${year}</h3>
          <button id="btn-next" type="button" class="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button id="btn-today" type="button" class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">Hoy</button>
        </div>
        <button id="btn-new" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nueva cita
        </button>
      </div>

      <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:p-4">
        <div class="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
          ${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-1">
          ${cells.map(dayCellHtml).join('')}
        </div>
      </div>
    </div>`;

  const goTo = (y, m) => {
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    ctx.navigate(`calendario/${y}-${pad2(m)}`);
  };
  root.querySelector('#btn-prev').addEventListener('click', () => goTo(year, month - 1));
  root.querySelector('#btn-next').addEventListener('click', () => goTo(year, month + 1));
  root.querySelector('#btn-today').addEventListener('click', () => {
    const t = new Date();
    goTo(t.getFullYear(), t.getMonth() + 1);
  });

  const reload = () => renderMonth(root, ctx, year, month);
  const meId = ctx.user.id;
  root.querySelector('#btn-new').addEventListener('click', () => openApptModal({ assignableUsers, canManage: can_manage, meId, reload }));
  root.querySelectorAll('[data-new-appt]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openApptModal({ assignableUsers, canManage: can_manage, meId, reload, prefillDate: btn.dataset.newAppt });
    });
  });
  root.querySelectorAll('[data-day-cell]').forEach((cellEl) => {
    cellEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-appt]') || e.target.closest('[data-new-appt]') || e.target.closest('[data-task-chip]')) return;
      openApptModal({ assignableUsers, canManage: can_manage, meId, reload, prefillDate: cellEl.dataset.dayCell });
    });
  });
  root.querySelectorAll('[data-open-appt]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const { appointment } = await apiGet('appointments/get', { id: btn.dataset.openAppt });
        openApptModal({ appt: appointment, assignableUsers, canManage: can_manage, meId, reload });
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function openApptModal({ appt = null, assignableUsers, canManage, meId, reload, prefillDate = null }) {
  const isEdit = !!appt;
  const canEdit = !isEdit || canManage || !appt.assigned_user_id || appt.assigned_user_id === meId;
  const startDate = appt ? appt.start_at.slice(0, 10) : (prefillDate || todayStr());
  const startTime = appt ? appt.start_at.slice(11, 16) : '09:00';
  const endTime = appt ? appt.end_at.slice(11, 16) : '09:30';
  let selectedPatient = appt && appt.patient_id
    ? { id: appt.patient_id, file_number: appt.file_number, name: appt.patient_name }
    : null;
  let attendees = appt ? appt.attendees.map((a) => ({ ...a })) : [];

  const serviceOptions = Object.entries(SERVICE_LABELS)
    .map(([v, l]) => `<option value="${v}" ${appt?.service === v ? 'selected' : ''}>${l}</option>`).join('');
  const userOptions = ['<option value="">General — todos con acceso lo ven</option>']
    .concat(assignableUsers.map((u) => `<option value="${u.id}" ${appt?.assigned_user_id === u.id ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`))
    .join('');

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="${labelCls}">Título / motivo</label>
        <input id="f-title" type="text" value="${escapeHtml(appt?.title || '')}" class="${inputCls}">
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="${labelCls}">Servicio</label>
          <select id="f-service" class="${inputCls}">${serviceOptions}</select>
        </div>
        <div>
          <label class="${labelCls}">Responsable asignado</label>
          <select id="f-assigned" class="${inputCls}">${userOptions}</select>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label class="${labelCls}">Fecha</label>
          <input id="f-date" type="date" value="${startDate}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Hora inicio</label>
          <input id="f-start" type="time" value="${startTime}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Hora fin</label>
          <input id="f-end" type="time" value="${endTime}" class="${inputCls}">
        </div>
      </div>
      <div>
        <label class="${labelCls}">Ubicación</label>
        <input id="f-location" type="text" placeholder="Consultorio, domicilio del paciente…" value="${escapeHtml(appt?.location || '')}" class="${inputCls}">
      </div>

      <div>
        <label class="${labelCls}">Paciente vinculado (opcional)</label>
        <div class="relative">
          <input id="patient-search" type="text" placeholder="Nombre, folio o teléfono…" autocomplete="off" class="${inputCls}">
          <div id="search-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
        </div>
        <div id="selected-patient" class="mt-2 hidden items-center justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-2.5 ring-1 ring-indigo-200">
          <span class="text-sm font-medium text-indigo-900"></span>
          <button type="button" id="clear-patient" class="text-xs font-semibold text-indigo-600 hover:text-indigo-500">Quitar</button>
        </div>
      </div>

      <div>
        <label class="${labelCls}">Invitados externos</label>
        <p class="mb-2 text-xs text-slate-400">Reciben la invitación por correo directo de Google Calendar; no necesitan cuenta en Sirius.</p>
        <div id="attendees-list" class="space-y-2"></div>
        <button type="button" id="add-attendee" class="mt-2 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-500">
          ${icon('plus', 'h-3.5 w-3.5')} Agregar invitado
        </button>
      </div>

      <div>
        <label class="${labelCls}">Notas</label>
        <textarea id="f-notes" rows="3" class="${inputCls}">${escapeHtml(appt?.notes || '')}</textarea>
      </div>

      ${isEdit ? `<div class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Estado: <span class="font-semibold ${STATUS_BADGE[appt.status] || ''} rounded px-1.5 py-0.5">${STATUS_LABELS[appt.status] || appt.status}</span></div>` : ''}
    </div>`;

  const renderAttendees = () => {
    const box = body.querySelector('#attendees-list');
    if (!attendees.length) {
      box.innerHTML = '<p class="text-xs text-slate-400">Sin invitados externos.</p>';
      return;
    }
    box.innerHTML = attendees.map((a, i) => `
      <div class="flex gap-2" data-attendee-row="${i}">
        <input type="email" placeholder="correo@ejemplo.com" value="${escapeHtml(a.email)}" data-att-email class="${inputCls} flex-1">
        <input type="text" placeholder="Nombre (opcional)" value="${escapeHtml(a.name || '')}" data-att-name class="${inputCls} flex-1">
        <button type="button" data-att-remove class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('x', 'h-4 w-4')}</button>
      </div>`).join('');
    box.querySelectorAll('[data-attendee-row]').forEach((row) => {
      const i = Number(row.dataset.attendeeRow);
      row.querySelector('[data-att-email]').addEventListener('input', (e) => { attendees[i].email = e.target.value; });
      row.querySelector('[data-att-name]').addEventListener('input', (e) => { attendees[i].name = e.target.value; });
      row.querySelector('[data-att-remove]').addEventListener('click', () => { attendees.splice(i, 1); renderAttendees(); });
    });
  };

  const actions = [
    { label: 'Cerrar' },
  ];
  if (isEdit && appt.status !== 'cancelada' && canEdit) {
    actions.push({
      label: 'Cancelar cita',
      danger: true,
      onClick: async (close, btn) => {
        const ok = await confirmDialog('Cancelar cita', `¿Cancelar "${appt.title}"? Esta acción no se puede deshacer.`, { danger: true, confirmLabel: 'Cancelar cita' });
        if (!ok) return;
        btn.disabled = true;
        try {
          await apiPost('appointments/cancel', { id: appt.id });
          toast('Cita cancelada');
          close();
          reload();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      },
    });
  }
  if (canEdit) {
    actions.push({
      label: 'Guardar',
      primary: true,
      onClick: async (close, btn) => {
        const title = body.querySelector('#f-title').value.trim();
        const date = body.querySelector('#f-date').value;
        const start = body.querySelector('#f-start').value;
        const end = body.querySelector('#f-end').value;
        if (!title || !date || !start || !end) {
          toast('Completa título, fecha y horario', 'error');
          return;
        }
        const payload = {
          id: appt?.id,
          title,
          service: body.querySelector('#f-service').value,
          assigned_user_id: body.querySelector('#f-assigned').value || null,
          start_at: `${date} ${start}:00`,
          end_at: `${date} ${end}:00`,
          location: body.querySelector('#f-location').value.trim(),
          patient_id: selectedPatient?.id || null,
          attendees: attendees.filter((a) => a.email.trim()),
          notes: body.querySelector('#f-notes').value.trim(),
        };
        btn.disabled = true;
        try {
          await apiPost('appointments/save', payload);
          toast(isEdit ? 'Cita actualizada' : 'Cita creada');
          close();
          reload();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      },
    });
  }

  const m = modal({ title: isEdit ? 'Editar cita' : 'Nueva cita', content: body, actions, size: 'max-w-xl' });

  renderAttendees();
  body.querySelector('#add-attendee').addEventListener('click', () => {
    attendees.push({ email: '', name: '' });
    renderAttendees();
  });

  if (!canEdit) {
    body.querySelectorAll('input, select, textarea, #add-attendee').forEach((el) => { el.disabled = true; });
  }

  const searchInput = body.querySelector('#patient-search');
  const resultsBox = body.querySelector('#search-results');
  const selectedBox = body.querySelector('#selected-patient');
  const showSelectedPatient = () => {
    if (!selectedPatient) { selectedBox.classList.add('hidden'); return; }
    selectedBox.classList.remove('hidden');
    selectedBox.classList.add('flex');
    selectedBox.querySelector('span').textContent = `${selectedPatient.name} · ${selectedPatient.file_number}`;
  };
  showSelectedPatient();
  body.querySelector('#clear-patient').addEventListener('click', () => {
    selectedPatient = null;
    searchInput.value = '';
    showSelectedPatient();
  });
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      resultsBox.classList.add('hidden');
      return;
    }
    const { patients } = await apiGet('episodes/search_patient', { q });
    if (!patients.length) {
      resultsBox.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin coincidencias.</p>';
    } else {
      resultsBox.innerHTML = patients.map((p) => `
        <button type="button" data-pick="${p.id}" data-file="${escapeHtml(p.file_number)}" data-name="${escapeHtml(fullName(p))}"
          class="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50">
          <span class="font-medium text-slate-800">${escapeHtml(fullName(p))}</span>
          <span class="ml-2 text-xs text-slate-400">${escapeHtml(p.file_number)}</span>
        </button>`).join('');
      resultsBox.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedPatient = { id: Number(btn.dataset.pick), file_number: btn.dataset.file, name: btn.dataset.name };
          searchInput.value = '';
          resultsBox.classList.add('hidden');
          showSelectedPatient();
        });
      });
    }
    resultsBox.classList.remove('hidden');
  }, 300));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#patient-search') && !e.target.closest('#search-results')) resultsBox.classList.add('hidden');
  });
}
