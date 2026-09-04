/**
 * Módulo Dashboard: compilado de lo más importante de cada módulo — reloj y saludo,
 * franja compacta de KPIs, alertas descartables, y la agenda accionable de hoy y
 * mañana (citas, tareas y laboratorio por entregar), cada una en tarjetas
 * individuales con el ícono y la etiqueta del módulo de origen. No repite la
 * navegación a módulos: para eso está el sidebar, alcanzable en cualquier tamaño de
 * pantalla (en móvil, con el botón de menú).
 */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, fmtDate, toast } from '../ui.js';

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

      ${kpiStrip(stats.kpis, stats.alerts.whatsapp)}

      ${alertsSection(stats.alerts)}
      ${agendaSection('¿Qué tenemos para hoy?', stats.today)}
      ${agendaSection('¿Qué va a pasar mañana?', stats.tomorrow)}
    </div>`;

  wireDismissButtons(root);

  const clockEl = root.querySelector('#dash-clock');
  const tick = () => {
    if (!clockEl.isConnected) { clearInterval(clockInterval); return; }
    clockEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

/* ================= KPIs ================= */
function kpiStrip(kpis, waUnread) {
  const items = [
    ['Pacientes registrados', kpis.patients_total, 'users', 'text-indigo-600 bg-indigo-50'],
    ['Admisiones hoy', kpis.admissions_today, 'user-plus', 'text-emerald-600 bg-emerald-50'],
    ['Consultas hoy', kpis.consults_today, 'activity', 'text-orange-600 bg-orange-50'],
  ];
  if (waUnread) {
    items.push(['WhatsApp sin leer', waUnread.total, 'chat', 'text-teal-600 bg-teal-50']);
  }
  return `
    <div class="grid grid-cols-2 gap-3 ${items.length > 3 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}">
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

/**
 * Tarjeta compartida por Alertas y por la agenda de Hoy/Mañana: ícono a la izquierda
 * (la campanita fija para una alerta; el ícono propio del tipo — calendario/tareas/
 * matraz — para un elemento de agenda, ahí identifica mejor qué es la tarjeta que un
 * aviso genérico), etiqueta de módulo, título/subtítulo, y si se pasa `alertKey` un
 * botón "-" para descartarla (exclusivo de Alertas — la agenda no se descarta).
 */
function dashCard({ iconName, moduleLabel, colorCls, main, sub, href, alertKey }) {
  return `
    <a href="${href}" class="relative block rounded-2xl bg-white p-3.5 ${alertKey ? 'pr-9' : ''} shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
      ${alertKey ? `
      <button type="button" data-dismiss-alert="${escapeHtml(alertKey)}" title="Descartar"
              class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
        ${icon('x', 'h-3.5 w-3.5')}
      </button>` : ''}
      <div class="flex items-start gap-2.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${colorCls}">${icon(iconName, 'h-4 w-4')}</span>
        <div class="min-w-0 flex-1">
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(moduleLabel)}</span>
          <p class="mt-1 truncate text-sm font-semibold text-slate-800">${escapeHtml(main)}</p>
          ${sub ? `<p class="truncate text-xs text-slate-500">${escapeHtml(String(sub))}</p>` : ''}
        </div>
      </div>
    </a>`;
}

function cardGrid(cards) {
  return `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${cards.join('')}</div>`;
}

/* ================= Alertas (sin fecha concreta, descartables) ================= */
function alertsSection(alerts) {
  const cards = [];
  const push = (moduleLabel, colorCls, href, items, mapItem) => {
    for (const it of items) {
      const [main, sub] = mapItem(it);
      cards.push(dashCard({ iconName: 'bell', moduleLabel, colorCls, main, sub, href, alertKey: it.alert_key }));
    }
  };

  if (alerts.inventory) {
    push('Inventario', 'text-red-600 bg-red-50', '#/inventario', alerts.inventory.expired, (i) => [i.name, 'Caducado']);
    push('Inventario', 'text-amber-600 bg-amber-50', '#/inventario', alerts.inventory.expiring, (i) => [i.name, 'Por caducar']);
    push('Inventario', 'text-amber-600 bg-amber-50', '#/inventario', alerts.inventory.low_stock, (i) => [i.name, 'Stock bajo']);
  }
  if (alerts.tasks_recurring) {
    push('Tareas', 'text-violet-600 bg-violet-50', '#/tareas', alerts.tasks_recurring, (t) => [t.title, t.recurrence]);
  }
  if (alerts.tasks_deadline_soon) {
    push('Tareas', 'text-amber-600 bg-amber-50', '#/tareas', alerts.tasks_deadline_soon, (t) => [t.title, fmtDate(t.due_date)]);
  }
  if (alerts.new_boards) {
    push('Pizarrón', 'text-emerald-600 bg-emerald-50', '#/pizarron', alerts.new_boards, (b) => [b.title || '(sin título)', b.author || '']);
  }
  if (alerts.new_files) {
    push('Archivos', 'text-sky-600 bg-sky-50', '#/archivos', alerts.new_files, (f) => [f.name, f.author || '']);
  }
  if (alerts.birthdays) {
    push('Expedientes', 'text-rose-600 bg-rose-50', '#/expedientes', alerts.birthdays, (p) => [
      [p.first_name, p.paternal_surname].filter(Boolean).join(' '),
      p.days_until === 0 ? `Hoy · cumple ${p.turns}` : `En ${p.days_until} días · cumple ${p.turns}`,
    ]);
  }
  if (alerts.whatsapp?.conversations) {
    for (const c of alerts.whatsapp.conversations) {
      cards.push(dashCard({
        iconName: 'bell', moduleLabel: 'WhatsApp', colorCls: 'text-teal-600 bg-teal-50',
        main: c.contact_name || c.wa_id, sub: `${c.unread_count} sin leer`,
        href: `#/whatsapp/${c.id}`, alertKey: c.alert_key,
      }));
    }
  }
  if (alerts.documents_pending_review) {
    push('Apps', 'text-amber-600 bg-amber-50', '#/apps/membretador', alerts.documents_pending_review, (d) => [d.patient_name, d.type_label]);
  }

  if (!cards.length) return '';
  return `
    <div>
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Alertas</h3>
      ${cardGrid(cards)}
    </div>`;
}

/* ================= Agenda de un día (hoy / mañana) ================= */
function agendaSection(title, agenda) {
  const cards = [];

  for (const a of agenda.appointments || []) {
    cards.push(dashCard({
      iconName: 'calendar', moduleLabel: 'Calendario', colorCls: 'text-indigo-600 bg-indigo-50',
      main: a.title, sub: `${a.start_at.slice(11, 16)}${a.assigned_name ? ' · ' + a.assigned_name : ''}`,
      href: '#/calendario',
    }));
  }
  for (const t of agenda.tasks || []) {
    cards.push(dashCard({
      iconName: 'check-square', moduleLabel: 'Tareas', colorCls: 'text-violet-600 bg-violet-50',
      main: t.title, sub: t.recurrence || (t.priority === 'urgente' || t.priority === 'alta' ? t.priority : ''),
      href: '#/tareas',
    }));
  }
  for (const l of agenda.lab_pending || []) {
    cards.push(dashCard({
      iconName: 'flask', moduleLabel: 'Expedientes', colorCls: 'text-sky-600 bg-sky-50',
      main: [l.first_name, l.paternal_surname, l.maternal_surname].filter(Boolean).join(' '),
      sub: `${l.file_number}${l.service_folio ? ' · ' + l.service_folio : ''}`,
      href: `#/expedientes/${l.patient_id}`,
    }));
  }
  for (const r of agenda.result_deliveries || []) {
    const st = r.studies || [];
    const done = st.filter((s) => s.done).length;
    cards.push(dashCard({
      iconName: 'flask', moduleLabel: 'Tareas', colorCls: 'text-teal-600 bg-teal-50',
      main: r.patient_name, sub: `${r.needs_invoice ? 'Factura · ' : ''}${st.length ? `${done}/${st.length}` : ''}`,
      href: '#/tareas/resultados',
    }));
  }

  return `
    <div>
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(title)}</h3>
      ${cards.length ? cardGrid(cards) : `
      <div class="rounded-2xl bg-white py-8 text-center shadow-sm ring-1 ring-slate-200">
        <p class="text-sm text-slate-400">Nada pendiente por aquí 🎉</p>
      </div>`}
    </div>`;
}

function wireDismissButtons(root) {
  root.querySelectorAll('[data-dismiss-alert]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const alertKey = btn.dataset.dismissAlert;
      const card = btn.closest('a');
      btn.disabled = true;
      try {
        await apiPost('dashboard/dismiss_alert', { alert_key: alertKey });
        card?.remove();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}
