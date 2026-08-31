/** Módulo WhatsApp: Configuración (Admin Tools) — credenciales, mensajes automáticos, respuestas rápidas y estatus. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, spinner, inputCls, labelCls } from '../ui.js';

const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
const COLORS = ['slate', 'amber', 'blue', 'emerald', 'red', 'indigo'];
// Tailwind genera las clases escaneando literales en el código fuente: una plantilla
// como `bg-${color}-500` nunca aparece armada tal cual, así que se pierde en el build.
const COLOR_DOT = {
  slate: 'bg-slate-500', amber: 'bg-amber-500', blue: 'bg-blue-500',
  emerald: 'bg-emerald-500', red: 'bg-red-500', indigo: 'bg-indigo-500',
};

let tab = 'credentials';

export async function render(root, ctx) {
  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-4">
      <div>
        <h3 class="text-lg font-bold text-slate-900">WhatsApp: Configuración</h3>
        <p class="text-sm text-slate-500">Credenciales de WhatsApp Cloud API, mensajes automáticos, respuestas rápidas y catálogo de estatus.</p>
      </div>
      <div class="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        ${tabBtn('credentials', 'Credenciales')}
        ${tabBtn('auto', 'Mensajes automáticos')}
        ${tabBtn('quick', 'Respuestas rápidas')}
        ${tabBtn('statuses', 'Estatus')}
      </div>
      <div id="wac-view">${spinner()}</div>
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(root, ctx); }));
  const view = root.querySelector('#wac-view');
  if (tab === 'credentials') await paintCredentials(view);
  else if (tab === 'auto') await paintAutoMessages(view);
  else if (tab === 'quick') await paintQuickReplies(view);
  else await paintStatuses(view);
}

function tabBtn(key, label) {
  return `<button type="button" data-tab="${key}" class="rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label}</button>`;
}

/* ================== Credenciales ================== */
async function paintCredentials(view) {
  const { config: cfg } = await apiGet('whatsapp_config/get_config');
  const webhookUrl = new URL('whatsapp_webhook.php', location.href).href;

  view.innerHTML = `
    <div class="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div class="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 ring-1 ring-slate-200">
        <p class="font-semibold text-slate-700">URL del webhook (regístrala en Meta > WhatsApp > Configuración):</p>
        <p class="mt-1 select-all break-all font-mono">${escapeHtml(webhookUrl)}</p>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label class="${labelCls}">Business ID</label><input id="c-business" type="text" value="${escapeHtml(cfg.business_id)}" class="${inputCls}"></div>
        <div><label class="${labelCls}">WABA ID</label><input id="c-waba" type="text" value="${escapeHtml(cfg.waba_id)}" class="${inputCls}"></div>
        <div><label class="${labelCls}">Phone Number ID</label><input id="c-phone" type="text" value="${escapeHtml(cfg.phone_number_id)}" class="${inputCls}"></div>
        <div><label class="${labelCls}">Versión de la API</label><input id="c-version" type="text" value="${escapeHtml(cfg.api_version)}" class="${inputCls}"></div>
        <div>
          <label class="${labelCls}">Token de acceso${cfg.has_access_token ? ` <span class="normal-case text-slate-400">(guardado: ${escapeHtml(cfg.access_token_hint)})</span>` : ''}</label>
          <input id="c-token" type="password" autocomplete="off" placeholder="${cfg.has_access_token ? 'Escribe uno nuevo para reemplazarlo' : 'Token permanente del usuario del sistema'}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">App Secret${cfg.has_app_secret ? ` <span class="normal-case text-slate-400">(guardado: ${escapeHtml(cfg.app_secret_hint)})</span>` : ''}</label>
          <input id="c-secret" type="password" autocomplete="off" placeholder="${cfg.has_app_secret ? 'Escribe uno nuevo para reemplazarlo' : 'Para validar la firma del webhook (opcional)'}" class="${inputCls}">
        </div>
        <div class="sm:col-span-2">
          <label class="${labelCls}">Verify Token del webhook</label>
          <input id="c-verify" type="text" value="${escapeHtml(cfg.verify_token)}" placeholder="Cadena que tú eliges y capturas también en Meta" class="${inputCls}">
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button id="btn-save-creds" type="button" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Guardar</button>
        <button id="btn-test" type="button" class="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Probar conexión</button>
        <span id="test-result" class="text-sm"></span>
      </div>
    </div>`;

  view.querySelector('#btn-save-creds').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiPost('whatsapp_config/save_config', {
        business_id: view.querySelector('#c-business').value.trim(),
        waba_id: view.querySelector('#c-waba').value.trim(),
        phone_number_id: view.querySelector('#c-phone').value.trim(),
        api_version: view.querySelector('#c-version').value.trim(),
        access_token: view.querySelector('#c-token').value.trim(),
        app_secret: view.querySelector('#c-secret').value.trim(),
        verify_token: view.querySelector('#c-verify').value.trim(),
      });
      toast('Configuración guardada');
      await paintCredentials(view);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  view.querySelector('#btn-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const result = view.querySelector('#test-result');
    btn.disabled = true;
    result.textContent = '';
    try {
      await apiPost('whatsapp_config/test_connection', {});
      result.className = 'text-sm text-emerald-600';
      result.textContent = 'Conexión correcta.';
    } catch (err) {
      result.className = 'text-sm text-red-600';
      result.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ================== Mensajes automáticos ================== */
async function paintAutoMessages(view) {
  const { auto_messages } = await apiGet('whatsapp_config/auto_messages_list');
  const welcome = auto_messages.find((m) => m.type === 'welcome') || { is_active: false, body: '' };
  const away = auto_messages.find((m) => m.type === 'away') || { is_active: false, body: '', schedule: null };
  const days = away.schedule?.days || {};

  view.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input id="w-active" type="checkbox" ${welcome.is_active ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          Mensaje de bienvenida (se envía en el primer mensaje de un contacto nuevo)
        </label>
        <textarea id="w-body" rows="3" class="mt-3 ${inputCls}">${escapeHtml(welcome.body || '')}</textarea>
        <button id="btn-save-welcome" type="button" class="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Guardar</button>
      </div>

      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input id="a-active" type="checkbox" ${away.is_active ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          Mensaje de ausencia (fuera del horario de atención)
        </label>
        <textarea id="a-body" rows="3" class="mt-3 ${inputCls}">${escapeHtml(away.body || '')}</textarea>
        <p class="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Horario de atención</p>
        <div class="space-y-1.5">
          ${DAYS.map(([key, label]) => {
            const d = days[key] || { enabled: false, from: '09:00', to: '18:00' };
            return `
            <div class="flex items-center gap-2 text-sm">
              <label class="flex w-28 items-center gap-2"><input type="checkbox" data-day="${key}" data-field="enabled" ${d.enabled ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"> ${label}</label>
              <input type="time" data-day="${key}" data-field="from" value="${d.from || '09:00'}" class="rounded-lg border-0 bg-slate-50 px-2 py-1 text-sm ring-1 ring-inset ring-slate-300">
              <span class="text-slate-400">a</span>
              <input type="time" data-day="${key}" data-field="to" value="${d.to || '18:00'}" class="rounded-lg border-0 bg-slate-50 px-2 py-1 text-sm ring-1 ring-inset ring-slate-300">
            </div>`;
          }).join('')}
        </div>
        <button id="btn-save-away" type="button" class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Guardar</button>
      </div>
    </div>`;

  view.querySelector('#btn-save-welcome').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiPost('whatsapp_config/auto_messages_save', {
        type: 'welcome',
        is_active: view.querySelector('#w-active').checked,
        body: view.querySelector('#w-body').value.trim(),
      });
      toast('Mensaje de bienvenida guardado');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  view.querySelector('#btn-save-away').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const schedule = { days: {} };
    for (const [key] of DAYS) {
      schedule.days[key] = {
        enabled: view.querySelector(`[data-day="${key}"][data-field="enabled"]`).checked,
        from: view.querySelector(`[data-day="${key}"][data-field="from"]`).value,
        to: view.querySelector(`[data-day="${key}"][data-field="to"]`).value,
      };
    }
    try {
      await apiPost('whatsapp_config/auto_messages_save', {
        type: 'away',
        is_active: view.querySelector('#a-active').checked,
        body: view.querySelector('#a-body').value.trim(),
        schedule,
      });
      toast('Mensaje de ausencia guardado');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ================== Respuestas rápidas ================== */
async function paintQuickReplies(view) {
  const { quick_replies } = await apiGet('whatsapp_config/quick_replies_list');

  view.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-end">
        <button id="btn-new-qr" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nueva respuesta rápida
        </button>
      </div>
      ${quick_replies.length ? `
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th class="px-4 py-3">Título</th><th class="px-4 py-3">Texto</th><th class="px-4 py-3 text-center">Estado</th><th class="px-4 py-3 text-right">Acciones</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${quick_replies.map((q) => `
              <tr>
                <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(q.title)}</td>
                <td class="px-4 py-3 text-slate-500">${escapeHtml(q.body.slice(0, 80))}${q.body.length > 80 ? '…' : ''}</td>
                <td class="px-4 py-3 text-center"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${q.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${q.is_active ? 'Activa' : 'Inactiva'}</span></td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-edit="${q.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    <button type="button" data-del="${q.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200"><p class="text-sm text-slate-500">Sin respuestas rápidas.</p></div>`}
    </div>`;

  view.querySelector('#btn-new-qr').addEventListener('click', () => openQuickReplyModal(null, view));
  view.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    openQuickReplyModal(quick_replies.find((q) => q.id === Number(b.dataset.edit)), view)));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Eliminar respuesta rápida', '¿Eliminar esta respuesta rápida?', { danger: true, confirmLabel: 'Eliminar' }))) return;
    await apiPost('whatsapp_config/quick_replies_delete', { id: Number(b.dataset.del) });
    toast('Respuesta rápida eliminada');
    await paintQuickReplies(view);
  }));
}

function openQuickReplyModal(qr, view) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div><label class="${labelCls}">Título</label><input id="qr-title" type="text" value="${escapeHtml(qr?.title || '')}" class="${inputCls}"></div>
      <div><label class="${labelCls}">Texto</label><textarea id="qr-body" rows="4" class="${inputCls}">${escapeHtml(qr?.body || '')}</textarea></div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="qr-active" ${qr ? (qr.is_active ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activa
      </label>
    </div>`;
  modal({
    title: qr ? 'Editar respuesta rápida' : 'Nueva respuesta rápida',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      { label: 'Guardar', primary: true, onClick: async (close, btn) => {
        const title = wrap.querySelector('#qr-title').value.trim();
        const body = wrap.querySelector('#qr-body').value.trim();
        if (!title || !body) { toast('Captura título y texto', 'error'); return; }
        btn.disabled = true;
        try {
          await apiPost('whatsapp_config/quick_replies_save', {
            id: qr?.id, title, body, is_active: wrap.querySelector('#qr-active').checked,
          });
          toast('Respuesta rápida guardada');
          close();
          await paintQuickReplies(view);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      } },
    ],
  });
}

/* ================== Estatus ================== */
async function paintStatuses(view) {
  const { statuses } = await apiGet('whatsapp_config/statuses_list');

  view.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-end">
        <button id="btn-new-status" type="button" class="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo estatus
        </button>
      </div>
      <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th class="px-4 py-3">Orden</th><th class="px-4 py-3">Etiqueta</th><th class="px-4 py-3">Clave</th><th class="px-4 py-3 text-center">Estado</th><th class="px-4 py-3 text-right">Acciones</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${statuses.map((s) => `
              <tr>
                <td class="px-4 py-3 text-slate-500">${s.sort_order}</td>
                <td class="px-4 py-3 font-medium text-slate-800"><span class="mr-2 inline-block h-2.5 w-2.5 rounded-full ${COLOR_DOT[s.color] || COLOR_DOT.slate}"></span>${escapeHtml(s.label)}${s.is_default ? ' <span class="text-xs text-slate-400">(por defecto)</span>' : ''}</td>
                <td class="px-4 py-3 text-slate-500">${escapeHtml(s.skey)}</td>
                <td class="px-4 py-3 text-center"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${Number(s.is_active) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${Number(s.is_active) ? 'Activo' : 'Inactivo'}</span></td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" data-edit="${s.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
                    ${Number(s.is_default) ? '' : `<button type="button" data-del="${s.id}" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>`}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  view.querySelector('#btn-new-status').addEventListener('click', () => openStatusModal(null, view));
  view.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    openStatusModal(statuses.find((s) => s.id === Number(b.dataset.edit)), view)));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Eliminar estatus', '¿Eliminar este estatus?', { danger: true, confirmLabel: 'Eliminar' }))) return;
    try {
      await apiPost('whatsapp_config/statuses_delete', { id: Number(b.dataset.del) });
      toast('Estatus eliminado');
      await paintStatuses(view);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

function openStatusModal(s, view) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="space-y-3">
      <div><label class="${labelCls}">Etiqueta</label><input id="s-label" type="text" value="${escapeHtml(s?.label || '')}" class="${inputCls}"></div>
      <div><label class="${labelCls}">Clave (sin espacios)</label><input id="s-key" type="text" value="${escapeHtml(s?.skey || '')}" class="${inputCls}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="${labelCls}">Color</label>
          <select id="s-color" class="${inputCls}">${COLORS.map((c) => `<option value="${c}" ${s?.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div><label class="${labelCls}">Orden</label><input id="s-order" type="number" value="${s?.sort_order ?? 0}" class="${inputCls}"></div>
      </div>
      <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
        <input type="checkbox" id="s-active" ${s ? (Number(s.is_active) ? 'checked' : '') : 'checked'} class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Activo
      </label>
    </div>`;
  modal({
    title: s ? 'Editar estatus' : 'Nuevo estatus',
    content: wrap,
    actions: [
      { label: 'Cancelar' },
      { label: 'Guardar', primary: true, onClick: async (close, btn) => {
        const label = wrap.querySelector('#s-label').value.trim();
        const skey = wrap.querySelector('#s-key').value.trim();
        if (!label || !skey) { toast('Captura la clave y la etiqueta', 'error'); return; }
        btn.disabled = true;
        try {
          await apiPost('whatsapp_config/statuses_save', {
            id: s?.id, skey, label,
            color: wrap.querySelector('#s-color').value,
            sort_order: Number(wrap.querySelector('#s-order').value) || 0,
            is_active: wrap.querySelector('#s-active').checked,
          });
          toast('Estatus guardado');
          close();
          await paintStatuses(view);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      } },
    ],
  });
}
