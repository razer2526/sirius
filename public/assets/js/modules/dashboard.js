/**
 * Módulo Dashboard: compilado de lo más importante de cada módulo — reloj y saludo,
 * franja compacta de KPIs, alertas sin fecha concreta, y la agenda accionable de
 * hoy y mañana (citas, tareas y laboratorio por entregar). No repite la navegación
 * a módulos: para eso está el sidebar, alcanzable en cualquier tamaño de pantalla
 * (en móvil, con el botón de menú).
 */

import { apiGet } from '../api.js';
import { icon, escapeHtml, fmtDate } from '../ui.js';

let clockInterval = null;

export async function render(root, ctx) {
  const stats = await apiGet('dashboard/stats');
  if (clockInterval) clearInterval(clockInterval);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const firstName = ctx.user.full_name.split(' ')[0];

  root.innerHTML = `
    <div class="mx-auto max-w-6xl space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 class="text-2xl font-bold tracking-tight text-slate-900">${greeting}, ${escapeHtml(firstName)} 👋</h2>
          <p class="mt-1 text-sm capitalize text-slate-500">${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div class="text-right">
          <p id="dash-clock" class="text-3xl font-bold tabular-nums tracking-tight text-indigo-600"></p>
        </div>
      </div>

      ${kpiStrip(stats.kpis)}

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        ${agendaCard('¿Qué tenemos para hoy?', stats.today, 'today')}
        ${agendaCard('¿Qué va a pasar mañana?', stats.tomorrow, 'tomorrow')}
      </div>

      ${alertsSection(stats.alerts)}
    </div>`;

  const clockEl = root.querySelector('#dash-clock');
  const tick = () => {
    if (!clockEl.isConnected) { clearInterval(clockInterval); return; }
    clockEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

/* ================= KPIs ================= */
function kpiStrip(kpis) {
  const items = [
    ['Pacientes registrados', kpis.patients_total, 'users', 'text-indigo-600 bg-indigo-50'],
    ['Admisiones hoy', kpis.admissions_today, 'user-plus', 'text-emerald-600 bg-emerald-50'],
    ['Consultas hoy', kpis.consults_today, 'activity', 'text-orange-600 bg-orange-50'],
  ];
  return `
    <div class="grid grid-cols-3 gap-3">
      ${items.map(([label, value, iconName, cls]) => `
        <div class="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:gap-3 sm:p-3.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cls}">${icon(iconName, 'h-4.5 w-4.5')}</span>
          <div class="min-w-0">
            <p class="text-lg font-bold leading-tight text-slate-900">${value}</p>
            <p class="text-[11px] font-medium leading-tight text-slate-500">${label}</p>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ================= Agenda de un día (hoy / mañana) ================= */
function agendaCard(title, agenda, variant) {
  const appts = agenda.appointments || [];
  const tasks = agenda.tasks || [];
  const lab = agenda.lab_pending || [];
  const results = agenda.result_deliveries || [];
  const empty = !appts.length && !tasks.length && !lab.length && !results.length;
  const accent = variant === 'today' ? 'text-indigo-600' : 'text-slate-500';

  return `
    <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 class="mb-4 text-base font-bold ${accent}">${title}</h3>
      ${empty ? `<p class="py-6 text-center text-sm text-slate-400">Nada pendiente por aquí 🎉</p>` : `
      <div class="space-y-4">
        ${appts.length ? agendaGroup('calendar', 'Citas', appts.map((a) => `
          <div class="flex items-center gap-2.5">
            <span class="shrink-0 text-xs font-semibold text-slate-400">${a.start_at.slice(11, 16)}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml(a.title)}</span>
            ${a.assigned_name ? `<span class="shrink-0 text-[11px] text-slate-400">${escapeHtml(a.assigned_name)}</span>` : ''}
          </div>`)) : ''}
        ${tasks.length ? agendaGroup('check-square', 'Tareas', tasks.map((t) => `
          <div class="flex items-center gap-2.5">
            <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml(t.title)}</span>
            ${t.recurrence ? `<span class="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-600">${t.recurrence}</span>`
              : priorityBadge(t.priority)}
          </div>`)) : ''}
        ${lab.length ? agendaGroup('flask', 'Laboratorio por entregar', lab.map((l) => `
          <a href="#/expedientes/${l.patient_id}" class="flex items-center gap-2.5 hover:text-indigo-600">
            <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml([l.first_name, l.paternal_surname, l.maternal_surname].filter(Boolean).join(' '))}</span>
            <span class="shrink-0 text-[11px] text-slate-400">${escapeHtml(l.file_number)}${l.service_folio ? ' · ' + escapeHtml(l.service_folio) : ''}</span>
          </a>`)) : ''}
        ${results.length ? agendaGroup('flask', 'Resultados por enviar', results.map((r) => {
          const st = r.studies || [];
          const done = st.filter((s) => s.done).length;
          return `
          <a href="#/tareas/resultados" class="flex items-center gap-2.5 hover:text-indigo-600">
            <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml(r.patient_name)}</span>
            ${r.needs_invoice ? `<span class="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-600">Factura</span>` : ''}
            ${st.length ? `<span class="shrink-0 text-[11px] text-slate-400">${done}/${st.length}</span>` : ''}
          </a>`;
        })) : ''}
      </div>`}
    </div>`;
}

function agendaGroup(iconName, label, rows) {
  return `
    <div>
      <p class="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        ${icon(iconName, 'h-3.5 w-3.5')} ${label}
      </p>
      <div class="space-y-1.5">${rows.join('')}</div>
    </div>`;
}

function priorityBadge(priority) {
  const cls = { urgente: 'bg-red-50 text-red-600', alta: 'bg-amber-50 text-amber-700' }[priority];
  return cls ? `<span class="shrink-0 rounded-full ${cls} px-2 py-0.5 text-[10px] font-semibold">${priority}</span>` : '';
}

/* ================= Alertas (sin fecha concreta) ================= */
function alertsSection(alerts) {
  const blocks = [];

  if (alerts.inventory) {
    const inv = alerts.inventory;
    const total = inv.low_stock.length + inv.expiring.length + inv.expired.length;
    if (total) {
      blocks.push(alertBlock('package', 'Inventario', 'text-sky-600 bg-sky-50', '#/inventario', [
        ...inv.expired.map((i) => rowText(i.name, 'Caducado', 'text-red-600')),
        ...inv.expiring.map((i) => rowText(i.name, 'Por caducar', 'text-amber-600')),
        ...inv.low_stock.map((i) => rowText(i.name, 'Stock bajo', 'text-amber-600')),
      ]));
    }
  }

  if (alerts.tasks_recurring?.length) {
    blocks.push(alertBlock('repeat', 'Tareas recurrentes pendientes', 'text-violet-600 bg-violet-50', '#/tareas',
      alerts.tasks_recurring.map((t) => rowText(t.title, t.recurrence))));
  }

  if (alerts.tasks_deadline_soon?.length) {
    blocks.push(alertBlock('flag', 'Deadlines próximos', 'text-amber-600 bg-amber-50', '#/tareas',
      alerts.tasks_deadline_soon.map((t) => rowText(t.title, fmtDate(t.due_date)))));
  }

  if (alerts.new_boards?.length) {
    blocks.push(alertBlock('clipboard', 'Nuevo en el pizarrón público', 'text-emerald-600 bg-emerald-50', '#/pizarron',
      alerts.new_boards.map((b) => rowText(b.title || '(sin título)', b.author || ''))));
  }

  if (alerts.new_files?.length) {
    blocks.push(alertBlock('folder-open', 'Archivos compartidos nuevos', 'text-sky-600 bg-sky-50', '#/archivos',
      alerts.new_files.map((f) => rowText(f.name, f.author || ''))));
  }

  if (alerts.birthdays?.length) {
    blocks.push(alertBlock('users', 'Cumpleaños próximos', 'text-rose-600 bg-rose-50', '#/expedientes',
      alerts.birthdays.map((p) => rowText(
        [p.first_name, p.paternal_surname].filter(Boolean).join(' '),
        p.days_until === 0 ? `Hoy · cumple ${p.turns}` : `En ${p.days_until} días · cumple ${p.turns}`
      ))));
  }

  if (alerts.documents_pending_review?.length) {
    // Sin destino único por tipo o categoría (un borrador puede ser de cualquiera),
    // así que enlaza al Membretador y de ahí el usuario entra a revisarlo.
    blocks.push(alertBlock('file-text', 'Estudios por revisar', 'text-amber-600 bg-amber-50', '#/apps/membretador',
      alerts.documents_pending_review.map((d) => rowText(d.patient_name, d.type_label))));
  }

  if (!blocks.length) return '';

  return `
    <div>
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Alertas</h3>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">${blocks.join('')}</div>
    </div>`;
}

function rowText(main, sub, subCls = 'text-slate-400') {
  return `<div class="flex items-center justify-between gap-2">
    <span class="min-w-0 flex-1 truncate text-sm text-slate-700">${escapeHtml(main)}</span>
    ${sub ? `<span class="shrink-0 text-[11px] font-medium ${subCls}">${escapeHtml(String(sub))}</span>` : ''}
  </div>`;
}

function alertBlock(iconName, title, colorCls, href, rows) {
  const shown = rows.slice(0, 5);
  const extra = rows.length - shown.length;
  return `
    <a href="${href}" class="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
      <div class="mb-2.5 flex items-center gap-2.5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${colorCls}">${icon(iconName, 'h-4 w-4')}</span>
        <p class="text-sm font-bold text-slate-800">${title}</p>
      </div>
      <div class="space-y-1.5">${shown.join('')}</div>
      ${extra > 0 ? `<p class="mt-1.5 text-xs text-slate-400">+${extra} más</p>` : ''}
    </a>`;
}
