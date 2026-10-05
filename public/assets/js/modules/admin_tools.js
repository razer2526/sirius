/**
 * Panel Admin Tools: una entrada en el sidebar que abre una rejilla de tarjetas, una por herramienta
 * de administración a la que la persona tiene acceso (en lugar de 11 iconos sueltos en el menú).
 *
 * No es un módulo del registro: no tiene permiso propio. Las tarjetas salen de ctx.modules (lo que el
 * servidor ya filtró por permisos) con group 'admin_tools'; el texto de cada una viene de
 * 'description' en includes/modules.php, así que una herramienta nueva aparece sola aquí.
 */

import { icon, escapeHtml } from '../ui.js';

/** Un tono por herramienta (clases literales: Tailwind solo compila lo que ve escrito completo). */
const TONES = {
  usuarios: 'bg-indigo-100 text-indigo-700',
  empleados: 'bg-sky-100 text-sky-700',
  membretes: 'bg-violet-100 text-violet-700',
  log: 'bg-slate-200 text-slate-700',
  backup: 'bg-emerald-100 text-emerald-700',
  api: 'bg-fuchsia-100 text-fuchsia-700',
  catalogo_estudios: 'bg-teal-100 text-teal-700',
  vinculacion: 'bg-amber-100 text-amber-700',
  cobertura: 'bg-rose-100 text-rose-700',
  papelera: 'bg-red-100 text-red-700',
  plantillas_estudios: 'bg-cyan-100 text-cyan-700',
};
const DEFAULT_TONE = 'bg-indigo-100 text-indigo-700';

export function render(root, ctx) {
  const tools = ctx.modules.filter((m) => m.group === 'admin_tools' && !m.hidden);

  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-5">
      <p class="text-sm text-slate-500">Herramientas de administración del sistema. Elige una para abrirla.</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${tools.map((m) => `
          <a href="#/${m.key}"
             class="group flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
            <span class="flex h-11 w-11 items-center justify-center rounded-xl ${TONES[m.key] || DEFAULT_TONE}">${icon(m.icon, 'h-6 w-6')}</span>
            <span>
              <span class="block text-base font-semibold text-slate-900">${escapeHtml(m.label)}</span>
              <span class="mt-1 block text-sm leading-snug text-slate-500">${escapeHtml(m.description || '')}</span>
            </span>
          </a>`).join('')}
      </div>
    </div>`;
}
