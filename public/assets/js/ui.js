/** Utilidades de interfaz: iconos, toasts, modales, formularios, formato. */

export const ICONS = {
  'home': '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  'folder': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'flask': '<path d="M9 3h6"/><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.4 2h12.2a1.5 1.5 0 0 0 1.4-2L14 9V3"/>',
  'scale': '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7 3 13a3 3 0 0 0 4 0z"/><path d="M19 7l-2 6a3 3 0 0 0 4 0z"/><path d="M8 21h8"/>',
  'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'footprints': '<path d="M4 16v-2.4c0-2 1.3-3.6 3-3.6s3 1.6 3 3.6V16a2.5 2.5 0 0 1-5 0z"/><path d="M14 10V7.6C14 5.6 15.3 4 17 4s3 1.6 3 3.6V10a2.5 2.5 0 0 1-5 0z"/><path d="M5 20h4"/><path d="M15 14h4"/>',
  'sparkles': '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'printer': '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'chat': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'send': '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'briefcase': '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'repeat': '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  'calendar': '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'flag': '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  'calculator': '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>',
  'list': '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  'folder-open': '<path d="M6 4h5l2 3h7a2 2 0 0 1 2 2v1H4V6a2 2 0 0 1 2-2z"/><path d="M2.5 12h19l-2.2 7.3a2 2 0 0 1-1.9 1.4H6.6a2 2 0 0 1-1.9-1.4z"/>',
  'edit-3': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  'package': '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
  'barcode': '<path d="M4 4v16"/><path d="M8 4v16"/><path d="M12 4v16"/><path d="M13.5 4v16"/><path d="M17 4v16"/><path d="M20 4v16"/>',
  'alert-triangle': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'camera': '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  'clipboard': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/>',
  'move': '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
  'undo': '<polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'scissors': '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  'more-vertical': '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'mic': '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'volume-2': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'paperclip': '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'map-pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
};

export function icon(name, cls = 'h-5 w-5') {
  const path = ICONS[name] || ICONS['folder'];
  return `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * Markdown mínimo para las respuestas del asistente: negritas, cursivas, código,
 * viñetas y saltos de línea. Escapa primero, así que el modelo no puede inyectar HTML.
 */
export function mdLite(str) {
  return escapeHtml(str)
    .replace(/^\s*#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^\s*-{3,}\s*$/gm, '<hr class="my-2 border-slate-200">')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)\*(?!\s)([^*\n]+?)\*(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+?)`/g, '<code class="rounded bg-slate-100 px-1 text-[0.9em]">$1</code>')
    .replaceAll('\n', '<br>');
}

/* ---- Toasts ---- */
export function toast(message, type = 'success') {
  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-800',
  };
  const el = document.createElement('div');
  el.className = `pointer-events-auto rounded-lg ${colors[type] || colors.info} px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity duration-300`;
  el.textContent = message;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); }, 3200);
}

/* ---- Modales ---- */
export function modal({ title, content, actions = [], size = 'max-w-lg' }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4';
  // El pizarrón (y cualquier otra vista con z-index propio, p. ej. "traer al
  // frente" de una nota) puede acumular z-index por encima de 50 con el uso —
  // z-50 de Tailwind ya no basta para garantizar que el modal quede arriba.
  // Se fija por estilo inline (gana siempre, sin depender de qué clase exista
  // ya compilada) un valor que ninguna nota va a alcanzar nunca.
  wrap.style.zIndex = '9999';
  wrap.innerHTML = `
    <div class="flex max-h-[92vh] w-full ${size} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
      <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
        <h3 class="text-base font-semibold text-slate-900">${escapeHtml(title)}</h3>
        <button type="button" data-close class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">${icon('x', 'h-5 w-5')}</button>
      </div>
      <div class="modal-body min-h-0 flex-1 overflow-y-auto px-5 py-4"></div>
      <div class="modal-actions flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3"></div>
    </div>`;
  const body = wrap.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);

  const actionsEl = wrap.querySelector('.modal-actions');
  const close = () => wrap.remove();
  if (!actions.length) actionsEl.remove();
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = a.label;
    btn.className = a.primary
      ? 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50'
      : a.danger
        ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50'
        : 'rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50';
    btn.addEventListener('click', () => a.onClick ? a.onClick(close, btn) : close());
    actionsEl.appendChild(btn);
  }
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  root.appendChild(wrap);
  return { close, el: wrap };
}

export function confirmDialog(title, message, { danger = false, confirmLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      content: `<p class="text-sm text-slate-600">${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancelar', onClick: (close) => { close(); resolve(false); } },
        { label: confirmLabel, primary: !danger, danger, onClick: (close) => { close(); resolve(true); } },
      ],
    });
    m.el.addEventListener('click', (e) => {
      if (e.target === m.el) resolve(false);
    });
  });
}

/** Para pausar un refresco de fondo (polling): hay un modal abierto, o el foco
 *  está en un campo editable (no queremos resetear texto/foco a media escritura). */
export function isUserBusy() {
  if (document.getElementById('modal-root')?.children.length) return true;
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/* ---- Formularios ---- */
export const inputCls = 'w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none';
export const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';

export function field(def, value = '') {
  const v = escapeHtml(value);
  const req = def.required ? 'required' : '';
  let control;
  switch (def.type) {
    case 'textarea':
      control = `<textarea name="${def.key}" rows="${def.rows || 2}" ${req} class="${inputCls}">${v}</textarea>`;
      break;
    case 'select': {
      const opts = ['<option value="">—</option>']
        .concat((def.options || []).map(o => {
          const [val, lab] = Array.isArray(o) ? o : [o, o];
          return `<option value="${escapeHtml(val)}" ${String(value) === String(val) ? 'selected' : ''}>${escapeHtml(lab)}</option>`;
        }));
      control = `<select name="${def.key}" ${req} class="${inputCls}">${opts.join('')}</select>`;
      break;
    }
    case 'checkbox':
      control = `<label class="flex items-center gap-2 py-2 text-sm text-slate-700">
        <input type="checkbox" name="${def.key}" value="1" ${value ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        ${escapeHtml(def.checkboxLabel || 'Sí')}</label>`;
      break;
    default:
      control = `<input type="${def.type || 'text'}" name="${def.key}" value="${v}" ${req} ${def.step ? `step="${def.step}"` : ''} ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} class="${inputCls}">`;
  }
  return `<div class="${def.span || ''}"><label class="${labelCls}">${escapeHtml(def.label)}${def.required ? ' *' : ''}</label>${control}</div>`;
}

export function formValues(formEl) {
  const out = {};
  for (const el of formEl.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  }
  return out;
}

/* ---- Formato ---- */
/** Interpreta fechas SQL como hora local (una fecha sin hora en new Date() sería UTC). */
function parseLocal(str) {
  let s = String(str).replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  return new Date(s);
}

export function fmtDate(str) {
  if (!str) return '—';
  const d = parseLocal(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(str) {
  if (!str) return '—';
  const d = parseLocal(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/** "hace 3 días" / "hoy" / "hace 2 meses" — para avisos de recurrencia, no para fechas exactas. */
export function fmtRelative(str) {
  if (!str) return '';
  const d = parseLocal(str);
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.round(days / 365.25);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

/** Texto del aviso de paciente recurrente, a partir de patient_last_visit() del backend. */
export function recurrenceText(lastVisit) {
  if (!lastVisit) return '';
  const when = fmtRelative(lastVisit.date);
  const previous = lastVisit.visit_count > 1 ? ` · ${lastVisit.visit_count} visitas previas` : '';
  return `Paciente recurrente: última visita de ${lastVisit.service_label}, ${when}${previous}`;
}

export function calcAge(birthDate) {
  if (!birthDate) return null;
  const b = parseLocal(birthDate);
  if (isNaN(b)) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

export function fullName(p) {
  return [p.first_name, p.paternal_surname, p.maternal_surname].filter(Boolean).join(' ');
}

export function spinner() {
  return `<div class="flex justify-center py-12"><div class="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"></div></div>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
