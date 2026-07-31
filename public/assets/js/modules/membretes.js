/** Módulo Membretes (Admin Tools): header, footer, marca de agua y firma de los PDF. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, confirmDialog, spinner, inputCls, labelCls } from '../ui.js';

const SLOTS = [
  { key: 'header',    label: 'Encabezado',    hint: 'Se coloca arriba de cada página. Ideal: imagen apaisada de ~1600 px de ancho.' },
  { key: 'footer',    label: 'Pie de página', hint: 'Se coloca al fondo de cada página (dirección, contacto, registro sanitario).' },
  { key: 'watermark', label: 'Marca de agua', hint: 'Se dibuja centrada y atenuada detrás del contenido.' },
];

const NUMBERS = [
  { key: 'margin_left',      label: 'Margen izquierdo (mm)' },
  { key: 'margin_right',     label: 'Margen derecho (mm)' },
  { key: 'header_top',       label: 'Encabezado: distancia superior (mm)' },
  { key: 'header_height',    label: 'Encabezado: alto reservado (mm)' },
  { key: 'footer_height',    label: 'Pie: alto reservado (mm)' },
  { key: 'footer_bottom',    label: 'Pie: distancia inferior (mm)' },
  { key: 'watermark_width',  label: 'Marca de agua: ancho (mm)' },
  { key: 'watermark_opacity', label: 'Marca de agua: opacidad (%)' },
  { key: 'signature_width',  label: 'Firma: ancho (mm)' },
];

const SIGNER_FIELDS = [
  { key: 'name',    label: 'Responsable sanitario', placeholder: 'Dr. Marcos Rodríguez Cota' },
  { key: 'license', label: 'Cédula profesional',    placeholder: 'Ced. Prof. 1141159 U.N.A.M.' },
  { key: 'role',    label: 'Cargo',                 placeholder: 'Responsable Sanitario' },
];

let state = null;

export async function render(root) {
  root.innerHTML = spinner();
  state = await apiGet('letterhead/get');
  paint(root);
}

function paint(root) {
  const { config: cfg, urls } = state;
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-5">
      <p class="text-sm text-slate-500">
        Estas imágenes se aplican a todos los documentos que genera el Membretador.
        Los valores en milímetros posicionan cada elemento sobre la hoja tamaño carta.
      </p>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${SLOTS.map((s) => slotCard(s, urls[s.key])).join('')}
      </div>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h4 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Firmas por área</h4>
        <p class="mb-4 text-xs text-slate-400">
          Cada estudio se firma con la del área que lo valida. Si un área no tiene firma propia, se usa la general.
        </p>
        <div class="space-y-4">
          ${Object.entries(state.signatures).map(([area, sig]) => signatureCard(area, sig)).join('')}
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h4 class="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">Posición y tamaño</h4>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          ${NUMBERS.map((n) => `
            <div><label class="${labelCls}">${escapeHtml(n.label)}</label>
              <input type="number" step="0.5" data-cfg="${n.key}" value="${escapeHtml(cfg[n.key])}" class="${inputCls}"></div>`).join('')}
        </div>
        <label class="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" data-cfg="show_page_numbers" ${cfg.show_page_numbers ? 'checked' : ''}
                 class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          Numerar las páginas (Pag. 1/3)
        </label>
      </section>

      <div class="flex flex-wrap justify-end gap-2">
        <button id="btn-preview" type="button" class="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          ${icon('eye', 'h-4 w-4')} Ver hoja de prueba
        </button>
        <button id="btn-save" type="button" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          Guardar configuración
        </button>
      </div>
    </div>`;

  SLOTS.forEach((s) => wireSlot(root, s));
  Object.keys(state.signatures).forEach((area) => wireSignature(root, area));
  root.querySelector('#btn-save').addEventListener('click', () => save(root));
  root.querySelector('#btn-preview').addEventListener('click', async () => {
    await save(root, true);
    window.open('membrete_prueba.php', '_blank');
  });
}

function signatureCard(area, sig) {
  return `
    <div class="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div class="flex flex-col gap-4 sm:flex-row">
        <div class="sm:w-56 sm:shrink-0">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-sm font-bold text-slate-800">${escapeHtml(sig.label)}</p>
            <div class="flex gap-1">
              <label class="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
                ${sig.url ? 'Cambiar' : 'Subir'}
                <input type="file" accept="image/png,image/jpeg,image/gif" data-sig-upload="${area}" class="hidden">
              </label>
              ${sig.url ? `<button type="button" data-sig-remove="${area}" class="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">Quitar</button>` : ''}
            </div>
          </div>
          <div class="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-white p-2 ring-1 ring-slate-200">
            ${sig.url
              ? `<img src="${escapeHtml(sig.url)}?v=${Date.now()}" alt="Firma ${escapeHtml(sig.label)}" class="max-h-20 max-w-full object-contain">`
              : '<span class="text-xs text-slate-400">Sin firma</span>'}
          </div>
        </div>
        <div class="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          ${SIGNER_FIELDS.map((f) => `
            <div><label class="${labelCls}">${escapeHtml(f.label)}</label>
              <input type="text" data-sig="${area}.${f.key}" value="${escapeHtml(sig[f.key] || '')}"
                     placeholder="${escapeHtml(f.placeholder)}" class="${inputCls}"></div>`).join('')}
        </div>
      </div>
    </div>`;
}

function wireSignature(root, area) {
  root.querySelector(`[data-sig-upload="${area}"]`)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('slot', 'signature');
    fd.append('area', area);
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=letterhead/upload', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast('Firma actualizada');
      await render(document.getElementById('module-root'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector(`[data-sig-remove="${area}"]`)?.addEventListener('click', async () => {
    const ok = await confirmDialog('Quitar firma', '¿Quitar la imagen de esta firma?', { danger: true, confirmLabel: 'Quitar' });
    if (!ok) return;
    try {
      await apiPost('letterhead/remove', { slot: 'signature', area });
      toast('Firma eliminada');
      await render(document.getElementById('module-root'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function slotCard(slot, url) {
  return `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h4 class="text-sm font-bold text-slate-800">${escapeHtml(slot.label)}</h4>
        <div class="flex gap-1">
          <label class="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            ${url ? 'Reemplazar' : 'Subir'}
            <input type="file" accept="image/png,image/jpeg,image/gif" data-upload="${slot.key}" class="hidden">
          </label>
          ${url ? `<button type="button" data-remove="${slot.key}" class="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">Quitar</button>` : ''}
        </div>
      </div>
      <div class="flex min-h-[6rem] items-center justify-center overflow-hidden rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
        ${url
          ? `<img src="${escapeHtml(url)}?v=${Date.now()}" alt="${escapeHtml(slot.label)}" class="max-h-28 max-w-full object-contain">`
          : `<span class="text-xs text-slate-400">Sin imagen</span>`}
      </div>
      <p class="mt-2 text-xs text-slate-400">${escapeHtml(slot.hint)}</p>
    </div>`;
}

function wireSlot(root, slot) {
  root.querySelector(`[data-upload="${slot.key}"]`)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('slot', slot.key);
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=letterhead/upload', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast(`${slot.label} actualizado`);
      await render(document.getElementById('module-root'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector(`[data-remove="${slot.key}"]`)?.addEventListener('click', async () => {
    const ok = await confirmDialog('Quitar imagen', `¿Quitar la imagen de ${slot.label.toLowerCase()}?`, { danger: true, confirmLabel: 'Quitar' });
    if (!ok) return;
    try {
      await apiPost('letterhead/remove', { slot: slot.key });
      toast('Imagen eliminada');
      await render(document.getElementById('module-root'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function save(root, silent = false) {
  const payload = { signatures: {} };
  root.querySelectorAll('[data-cfg]').forEach((el) => {
    payload[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : el.value;
  });
  root.querySelectorAll('[data-sig]').forEach((el) => {
    const [area, field] = el.dataset.sig.split('.');
    (payload.signatures[area] ||= {})[field] = el.value;
  });
  try {
    const data = await apiPost('letterhead/save', payload);
    state.config = data.config;
    state.signatures = data.signatures;
    if (!silent) toast('Configuración guardada');
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}
