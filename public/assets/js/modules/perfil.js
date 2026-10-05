/**
 * Módulo Perfil (menú del avatar): la ficha del propio empleado, solo lectura.
 * El servidor ya filtró lo que el administrador decidió ocultar (api/handlers/profile.php):
 * aquí solo se pinta lo que llegó, y la ausencia de una clave significa "no se muestra".
 */

import { apiGet } from '../api.js';
import { icon, escapeHtml, fmtDate } from '../ui.js';

const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
const card = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200';
const title = 'mb-3 text-sm font-bold uppercase tracking-wide text-slate-700';
const fmtDays = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export async function render(root) {
  let d;
  try {
    d = await apiGet('profile/get');
  } catch (e) {
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(e.message)}</div>`;
    return;
  }

  // Si el administrador apagó "Nombre completo", tampoco se repite aquí.
  const name = d.full_name || '';
  const initials = name ? name.split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() : '';
  const blocks = [];

  if (d.contact) blocks.push(contactHtml(d.contact));
  if (d.institutional_email || d.start_date || d.tenure) blocks.push(workHtml(d));
  if (d.schedule) blocks.push(scheduleHtml(d.schedule));
  if (d.vacation) blocks.push(vacationHtml(d.vacation));

  let content;
  if (!d.configured) {
    content = emptyHtml('Tu administrador todavía no ha configurado tu perfil.');
  } else if (!blocks.length) {
    content = emptyHtml('Tu administrador no tiene datos para mostrarte por ahora.');
  } else {
    content = `<div class="space-y-4">${blocks.join('')}</div>`;
  }

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-4">
      <section class="${card} flex items-center gap-4">
        <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">${initials ? escapeHtml(initials) : icon('user', 'h-7 w-7')}</div>
        <div class="min-w-0">
          <p class="truncate text-lg font-bold text-slate-900">${name ? escapeHtml(name) : 'Mi perfil'}</p>
          <p class="text-sm text-slate-500">Tu perfil de empleado. Solo lectura: si algo no es correcto, avísale a tu administrador.</p>
        </div>
      </section>
      ${content}
    </div>`;
}

const emptyHtml = (text) => `<div class="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">${escapeHtml(text)}</div>`;

/** Fila etiqueta / valor; sin valor se muestra un guion, no se oculta (la casilla ya decidió si el bloque sale). */
const row = (label, value) => `
  <div class="py-2 sm:flex sm:gap-4">
    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-48 sm:shrink-0 sm:pt-0.5">${escapeHtml(label)}</dt>
    <dd class="text-sm text-slate-800 break-words">${value ? escapeHtml(value) : '<span class="text-slate-400">—</span>'}</dd>
  </div>`;

function contactHtml(c) {
  return `
    <section class="${card}">
      <h4 class="${title}">Datos de contacto personales</h4>
      <dl class="divide-y divide-slate-100">
        ${row('Teléfono', c.phone)}
        ${row('Correo personal', c.email_personal)}
        ${row('Domicilio', c.address)}
        ${row('Contacto de emergencia', [c.emergency_name, c.emergency_phone].filter(Boolean).join(' · '))}
      </dl>
    </section>`;
}

function workHtml(d) {
  return `
    <section class="${card}">
      <h4 class="${title}">Relación laboral</h4>
      <dl class="divide-y divide-slate-100">
        ${'institutional_email' in d ? row('Correo institucional', d.institutional_email) : ''}
        ${'start_date' in d ? row('Fecha de inicio', d.start_date ? fmtDate(d.start_date) : '') : ''}
        ${'tenure' in d ? row('Tiempo con nosotros', d.tenure?.text || '') : ''}
      </dl>
    </section>`;
}

function scheduleHtml(s) {
  const days = DAYS.filter(([k]) => s.days[k].on);
  return `
    <section class="${card}">
      <h4 class="${title}">Jornada laboral</h4>
      ${days.length ? `
        <ul class="divide-y divide-slate-100">
          ${days.map(([k, label]) => `
            <li class="flex items-center justify-between gap-3 py-2 text-sm">
              <span class="font-medium text-slate-700">${label}</span>
              <span class="text-slate-800">${escapeHtml(s.days[k].from)} – ${escapeHtml(s.days[k].to)}</span>
            </li>`).join('')}
        </ul>
        <p class="mt-2 text-xs text-slate-500">${days.length} día(s) por semana · ${fmtDays(s.weekly_hours)} horas semanales</p>`
    : '<p class="text-sm text-slate-400">Aún no se ha registrado tu jornada.</p>'}
      ${s.note ? `<p class="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">${escapeHtml(s.note)}</p>` : ''}
    </section>`;
}

function vacationHtml(v) {
  const tile = (label, value, cls = 'text-slate-900') => `
    <div class="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <p class="text-[10px] font-semibold uppercase tracking-tight text-slate-500">${label}</p>
      <p class="mt-1 text-2xl font-bold ${cls}">${fmtDays(value)}</p>
    </div>`;
  const tiles = [];
  if ('entitled' in v) tiles.push(tile('Corresponden', v.entitled));
  if ('taken' in v) tiles.push(tile('Tomados', v.taken));
  if ('remaining' in v) tiles.push(tile(v.over ? 'Excedidos' : 'Restantes', Math.abs(v.remaining), v.over ? 'text-red-600' : 'text-emerald-600'));

  // La barra solo sale si se muestran ambos datos: con uno solo no tiene con qué compararse.
  let bar = '';
  if ('entitled' in v && 'taken' in v && v.entitled > 0) {
    const pct = Math.min(100, Math.round((v.taken / v.entitled) * 100));
    bar = `
      <div class="mt-3" role="img" aria-label="Has usado ${pct}% de tus vacaciones">
        <div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full ${v.taken > v.entitled ? 'bg-red-500' : 'bg-indigo-500'}" style="width:${pct}%"></div></div>
        <p class="mt-1 text-xs text-slate-500">${pct}% usado</p>
      </div>`;
  }

  let records = '';
  if (v.records) {
    records = v.records.length ? `
      <div class="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th class="px-3 py-2">Periodo</th><th class="px-3 py-2">Días</th><th class="px-3 py-2">Observaciones</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${v.records.map((r) => `
                <tr>
                  <td class="px-3 py-2 text-slate-800">${fmtDate(r.date_from)}${r.date_to !== r.date_from ? ' — ' + fmtDate(r.date_to) : ''}</td>
                  <td class="px-3 py-2 font-semibold text-slate-800">${fmtDays(r.days)}</td>
                  <td class="px-3 py-2 text-slate-500">${escapeHtml(r.notes || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '<p class="mt-4 text-sm text-slate-400">Aún no tienes vacaciones registradas.</p>';
  }

  return `
    <section class="${card}">
      <h4 class="${title}">Vacaciones</h4>
      <div class="grid gap-3 ${tiles.length >= 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}">${tiles.join('')}</div>
      ${bar}
      ${records}
    </section>`;
}
