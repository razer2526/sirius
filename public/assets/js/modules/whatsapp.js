/** Módulo WhatsApp: bandeja de conversaciones del equipo (WhatsApp Cloud API). */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, fmtDateTime, fmtRelative, spinner, debounce } from '../ui.js';

const PRIORITY = {
  baja:   { label: 'Baja',   cls: 'bg-slate-100 text-slate-600' },
  normal: { label: 'Normal', cls: 'bg-sky-100 text-sky-700' },
  alta:   { label: 'Alta',   cls: 'bg-amber-100 text-amber-700' },
};
const STATUS_COLOR = {
  slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-700', blue: 'bg-blue-100 text-blue-700',
  emerald: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700', indigo: 'bg-indigo-100 text-indigo-700',
};
const POLL_MS = 15000;
// Emojis de reacción y de captura rápida: WhatsApp Cloud API no permite consultar la
// foto de perfil de un contacto (restricción de la plataforma, no de Sirius) — por
// eso el chat muestra un avatar con iniciales en su lugar.
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJI_PICKER = [
  '😀', '😁', '😂', '🤣', '😊', '😉', '😍', '😘', '🙂', '🙃', '😇', '🤔',
  '😐', '😑', '😴', '😪', '😢', '😭', '😡', '😱', '😳', '🥳', '🤗', '🤝',
  '👍', '👎', '👏', '🙏', '💪', '🤞', '✌️', '👌', '👋', '🤙', '❤️', '💙',
  '💚', '💛', '🧡', '💜', '🖤', '🤍', '💯', '🔥', '✨', '🎉', '⚠️', '✅',
  '❌', '❓', '❗', '⏰', '📅', '📍', '📌', '💊', '🩺', '🏥', '🧪', '📄',
];

function contactAvatarHtml(c, size = 'h-10 w-10 text-sm') {
  const name = c.contact_name || c.patient_name || c.wa_id || '?';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  return `<div class="flex ${size} shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">${escapeHtml(initials)}</div>`;
}

let ctx;
let moduleRoot = null;
let data = null;
let quickReplies = [];
let filters = { status_id: '', priority: '', assigned_user_id: '', q: '' };
let activeId = null;
let activeConv = null;
let messages = [];
let pollTimer = null;
// El refresco periódico repinta el panel de chat entero (incluido el textarea);
// sin esto, un borrador sin enviar se perdería solo por dejarlo un rato sin mandar.
let drafts = {};
let pendingFiles = {}; // conversation id -> File elegido para adjuntar, sin enviar todavía

export async function render(root, context) {
  ctx = context;
  moduleRoot = root;
  root.innerHTML = spinner();
  await load();
  const tick = async () => {
    // #module-root es un contenedor persistente que el router solo reescribe (nunca lo
    // reemplaza), así que "moduleRoot.isConnected" seguiría siendo true en cualquier otro
    // módulo; se comprueba en cambio un nodo propio de esta pantalla, que sí desaparece
    // en cuanto el router pinta encima otro módulo.
    if (!document.getElementById('wa-list')?.isConnected) { clearInterval(pollTimer); return; }
    try { await refresh(); } catch { /* red intermitente: se reintenta en el próximo tick */ }
  };
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_MS);
}

async function load() {
  const [list, qr] = await Promise.all([
    apiGet('whatsapp/list', cleanFilters()),
    apiGet('whatsapp/quick_replies'),
  ]);
  data = list;
  quickReplies = qr.quick_replies;
  paint();
}

async function refresh() {
  const list = await apiGet('whatsapp/list', cleanFilters());
  data = list;
  if (activeId && !data.conversations.some((c) => c.id === activeId)) {
    activeId = null; activeConv = null; messages = [];
  }
  paint();
  if (activeId) await loadMessages(true);
}

function cleanFilters() {
  const out = {};
  for (const [k, v] of Object.entries(filters)) if (v !== '') out[k] = v;
  return out;
}

function paint() {
  moduleRoot.innerHTML = `
    <div class="flex h-[calc(100vh-8.5rem)] gap-4">
      <div class="flex w-full max-w-sm shrink-0 flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        ${filterBarHtml()}
        <div id="wa-list" class="flex-1 space-y-1 overflow-y-auto p-2"></div>
      </div>
      <div id="wa-chat" class="flex flex-1 flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200"></div>
    </div>`;

  wireFilterBar();
  paintList(moduleRoot.querySelector('#wa-list'));
  paintChat(moduleRoot.querySelector('#wa-chat'));
}

function filterBarHtml() {
  const statusOpts = data.statuses.map((s) => `<option value="${s.id}" ${String(filters.status_id) === String(s.id) ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  const userOpts = data.users.map((u) => `<option value="${u.id}" ${String(filters.assigned_user_id) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`).join('');
  return `
    <div class="space-y-2 border-b border-slate-200 p-3">
      <input id="wa-search" type="search" placeholder="Buscar por nombre o teléfono…" value="${escapeHtml(filters.q)}"
             class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
      <div class="flex flex-wrap gap-2">
        <select id="wa-f-status" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300"><option value="">Estatus</option>${statusOpts}</select>
        <select id="wa-f-priority" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300">
          <option value="">Prioridad</option>
          ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${filters.priority === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${data.can_manage ? `<select id="wa-f-user" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300"><option value="">Asignado a</option>${userOpts}</select>` : ''}
      </div>
    </div>`;
}

function wireFilterBar() {
  moduleRoot.querySelector('#wa-search').addEventListener('input', debounce((e) => {
    filters.q = e.target.value.trim();
    load();
  }, 350));
  moduleRoot.querySelector('#wa-f-status').addEventListener('change', (e) => { filters.status_id = e.target.value; load(); });
  moduleRoot.querySelector('#wa-f-priority').addEventListener('change', (e) => { filters.priority = e.target.value; load(); });
  moduleRoot.querySelector('#wa-f-user')?.addEventListener('change', (e) => { filters.assigned_user_id = e.target.value; load(); });
}

function paintList(el) {
  if (!data.conversations.length) {
    el.innerHTML = `<p class="p-4 text-center text-sm text-slate-400">Sin conversaciones.</p>`;
    return;
  }
  el.innerHTML = data.conversations.map((c) => {
    const name = c.contact_name || c.patient_name || c.wa_id;
    const active = c.id === activeId;
    return `
      <button type="button" data-conv="${c.id}"
              class="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition ${active ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}">
        ${contactAvatarHtml(c, 'h-9 w-9 text-xs mt-0.5')}
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(name)}</p>
            ${c.unread_count > 0 ? `<span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[11px] font-bold text-white">${c.unread_count}</span>` : ''}
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[c.status_color] || STATUS_COLOR.slate}">${escapeHtml(c.status_label || '—')}</span>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY[c.priority]?.cls || PRIORITY.normal.cls}">${PRIORITY[c.priority]?.label || c.priority}</span>
          </div>
          <p class="mt-1 text-xs text-slate-400">${c.assigned_name ? escapeHtml(c.assigned_name) : 'Sin asignar'} · ${fmtRelative(c.last_message_at)}</p>
        </div>
      </button>`;
  }).join('');
  el.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => openConversation(Number(b.dataset.conv))));
}

async function openConversation(id) {
  activeId = id;
  const row = data.conversations.find((c) => c.id === id);
  if (row) row.unread_count = 0; // el servidor lo marca leído en whatsapp/get; se refleja aquí sin esperar al próximo refresh
  paintList(moduleRoot.querySelector('#wa-list'));
  moduleRoot.querySelector('#wa-chat').innerHTML = spinner();
  const res = await apiGet('whatsapp/get', { id });
  activeConv = res.conversation;
  await loadMessages(false);
}

async function loadMessages(silent) {
  if (!activeId) return;
  const res = await apiGet('whatsapp/messages', { conversation_id: activeId });
  messages = res.messages;
  if (!silent) {
    const fresh = await apiGet('whatsapp/get', { id: activeId });
    activeConv = fresh.conversation;
  }
  paintChat(moduleRoot.querySelector('#wa-chat'));
}

function paintChat(el) {
  if (!activeConv) {
    el.innerHTML = `<div class="flex flex-1 items-center justify-center text-sm text-slate-400">Elige una conversación</div>`;
    return;
  }
  const c = activeConv;
  const statusOpts = data.statuses.map((s) => `<option value="${s.id}" ${s.id === c.status_id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  const userOpts = ['<option value="">Sin asignar</option>']
    .concat(data.users.map((u) => `<option value="${u.id}" ${u.id === c.assigned_user_id ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`))
    .join('');

  el.innerHTML = `
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        ${contactAvatarHtml(c)}
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(c.contact_name || c.wa_id)}</p>
          <p class="text-xs text-slate-400">${escapeHtml(c.wa_id)}${c.patient_id ? ` · <a href="#/expedientes/${c.patient_id}" class="text-indigo-600 hover:underline">Ver expediente${c.file_number ? ' ' + escapeHtml(c.file_number) : ''}</a>` : ''}</p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select id="wa-status" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300">${statusOpts}</select>
        <select id="wa-priority" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300">
          ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${c.priority === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${data.can_manage ? `<select id="wa-assign" class="rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-300">${userOpts}</select>` : ''}
        <button id="wa-link" type="button" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          ${icon('link', 'h-3.5 w-3.5')} ${c.patient_id ? 'Cambiar paciente' : 'Vincular paciente'}
        </button>
      </div>
    </div>
    <div id="wa-messages" class="flex-1 space-y-2 overflow-y-auto px-4 py-3"></div>
    <div class="shrink-0 border-t border-slate-200 p-3">
      ${c.within_session_window ? composerHtml() : windowClosedHtml()}
    </div>`;

  paintMessages(el.querySelector('#wa-messages'));

  el.querySelector('#wa-status').addEventListener('change', async (e) => {
    await apiPost('whatsapp/set_status', { id: c.id, status_id: Number(e.target.value) });
    await afterAction();
  });
  el.querySelector('#wa-priority').addEventListener('change', async (e) => {
    await apiPost('whatsapp/set_priority', { id: c.id, priority: e.target.value });
    await afterAction();
  });
  el.querySelector('#wa-assign')?.addEventListener('change', async (e) => {
    await apiPost('whatsapp/assign', { id: c.id, assigned_user_id: e.target.value || null });
    await afterAction();
  });
  el.querySelector('#wa-link').addEventListener('click', () => openLinkPatientModal(c));

  if (c.within_session_window) wireComposer(el);
}

async function afterAction() {
  await refresh();
}

function composerHtml() {
  return `
    <div class="relative">
      <div id="wa-qr-panel" class="absolute bottom-full left-0 mb-2 hidden max-h-56 w-full overflow-y-auto rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200"></div>
      <div id="wa-emoji-panel" class="absolute bottom-full left-0 mb-2 hidden grid-cols-8 gap-0.5 rounded-lg bg-white p-2 shadow-lg ring-1 ring-slate-200">
        ${EMOJI_PICKER.map((e) => `<button type="button" data-emoji="${e}" class="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-slate-100">${e}</button>`).join('')}
      </div>
      <div id="wa-attach-preview"></div>
      <div class="flex items-end gap-2">
        <button id="wa-qr-toggle" type="button" title="Respuestas rápidas" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">${icon('flag', 'h-4 w-4')}</button>
        <button id="wa-emoji-toggle" type="button" title="Emojis" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">😊</button>
        <button id="wa-attach-btn" type="button" title="Adjuntar archivo" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">${icon('paperclip', 'h-4 w-4')}</button>
        <input id="wa-file" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" class="hidden">
        <textarea id="wa-body" rows="2" placeholder="Escribe un mensaje…" class="flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"></textarea>
        <button id="wa-send" type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">${icon('send', 'h-4 w-4')}</button>
      </div>
    </div>`;
}

function attachPreviewHtml(file) {
  const isImage = file.type.startsWith('image/');
  const thumb = isImage
    ? `<img src="${URL.createObjectURL(file)}" class="h-10 w-10 rounded object-cover">`
    : `<span class="flex h-10 w-10 items-center justify-center rounded bg-slate-200 text-slate-500">${icon('file-text', 'h-5 w-5')}</span>`;
  return `
    <div class="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-inset ring-slate-200">
      ${thumb}
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium text-slate-700">${escapeHtml(file.name)}</p>
        <p class="text-slate-400">${fmtBytes(file.size)}</p>
      </div>
      <button id="wa-attach-remove" type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600">${icon('x', 'h-3.5 w-3.5')}</button>
    </div>`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function windowClosedHtml() {
  return `
    <div class="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
      Han pasado más de 24h desde el último mensaje del cliente. Solo se pueden enviar plantillas aprobadas por Meta;
      usa Meta Business Manager o espera a que el cliente vuelva a escribir.
    </div>`;
}

function wireComposer(el) {
  const textarea = el.querySelector('#wa-body');
  textarea.value = drafts[activeConv.id] || '';
  textarea.addEventListener('input', () => { drafts[activeConv.id] = textarea.value; });
  const qrPanel = el.querySelector('#wa-qr-panel');
  qrPanel.innerHTML = quickReplies.length
    ? quickReplies.map((q) => `<button type="button" data-qr="${q.id}" class="block w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"><b>${escapeHtml(q.title)}</b><br><span class="text-slate-400">${escapeHtml(q.body.slice(0, 60))}${q.body.length > 60 ? '…' : ''}</span></button>`).join('')
    : `<p class="px-2 py-1.5 text-xs text-slate-400">Sin respuestas rápidas configuradas.</p>`;
  qrPanel.querySelectorAll('[data-qr]').forEach((b) => b.addEventListener('click', () => {
    const q = quickReplies.find((x) => x.id === Number(b.dataset.qr));
    textarea.value = q.body;
    drafts[activeConv.id] = q.body;
    qrPanel.classList.add('hidden');
    textarea.focus();
  }));
  el.querySelector('#wa-qr-toggle').addEventListener('click', () => {
    emojiPanel.classList.add('hidden');
    qrPanel.classList.toggle('hidden');
  });

  const emojiPanel = el.querySelector('#wa-emoji-panel');
  emojiPanel.querySelectorAll('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + b.dataset.emoji + textarea.value.slice(end);
    const cursor = start + b.dataset.emoji.length;
    textarea.setSelectionRange(cursor, cursor);
    drafts[activeConv.id] = textarea.value;
    textarea.focus();
  }));
  el.querySelector('#wa-emoji-toggle').addEventListener('click', () => {
    qrPanel.classList.add('hidden');
    const willShow = emojiPanel.classList.contains('hidden');
    emojiPanel.classList.toggle('hidden', !willShow);
    emojiPanel.classList.toggle('grid', willShow);
  });

  const previewBox = el.querySelector('#wa-attach-preview');
  const fileInput = el.querySelector('#wa-file');
  const renderPreview = () => {
    const f = pendingFiles[activeConv.id];
    previewBox.innerHTML = f ? attachPreviewHtml(f) : '';
    previewBox.querySelector('#wa-attach-remove')?.addEventListener('click', () => {
      delete pendingFiles[activeConv.id];
      fileInput.value = '';
      renderPreview();
    });
  };
  renderPreview();
  el.querySelector('#wa-attach-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      pendingFiles[activeConv.id] = fileInput.files[0];
      renderPreview();
    }
  });

  const send = async () => {
    const body = textarea.value.trim();
    const file = pendingFiles[activeConv.id];
    if (!body && !file) return;
    const btn = el.querySelector('#wa-send');
    btn.disabled = true;
    try {
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('conversation_id', activeConv.id);
        fd.append('caption', body);
        const res = await fetch('api/index.php?r=whatsapp/send_media', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        delete pendingFiles[activeConv.id];
        fileInput.value = '';
      } else {
        await apiPost('whatsapp/send', { conversation_id: activeConv.id, body });
      }
      delete drafts[activeConv.id];
      await loadMessages(false);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  el.querySelector('#wa-send').addEventListener('click', send);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function paintMessages(el) {
  if (!messages.length) {
    el.innerHTML = `<p class="py-8 text-center text-sm text-slate-400">Sin mensajes todavía.</p>`;
    return;
  }
  el.innerHTML = messages.map((m) => {
    const out = m.direction === 'out';
    const auto = out && !m.sent_by;
    const reactBtn = m.wa_message_id
      ? `<button type="button" data-react="${m.id}" title="Reaccionar" class="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 opacity-60 hover:opacity-100 hover:bg-slate-100">🙂</button>`
      : '<div class="w-6"></div>';
    return `
      <div class="flex items-end gap-1 ${out ? 'justify-end' : 'justify-start'}">
        ${out ? '' : reactBtn}
        <div class="max-w-[75%] rounded-2xl px-3 py-2 text-sm ${out ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'}">
          ${mediaBubbleHtml(m)}
          <p class="mt-1 text-[11px] opacity-70">${fmtDateTime(m.created_at)}${auto ? ' · automático' : (out && m.sent_by_name ? ' · ' + escapeHtml(m.sent_by_name) : '')}${out ? ' · ' + statusLabel(m.status) : ''}</p>
          ${reactionChipsHtml(m)}
        </div>
        ${out ? reactBtn : ''}
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
  el.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', () => openReactionPicker(Number(b.dataset.react))));
}

function reactionChipsHtml(m) {
  const chips = [];
  if (m.reaction_contact) chips.push(`<span title="Reacción del paciente">${m.reaction_contact}</span>`);
  if (m.reaction_agent) chips.push(`<span title="Tu reacción">${m.reaction_agent}</span>`);
  if (!chips.length) return '';
  return `<div class="mt-1 flex w-fit gap-1 rounded-full bg-white px-1.5 py-0.5 text-sm ring-1 ring-slate-200">${chips.join('')}</div>`;
}

function openReactionPicker(messageId) {
  const m = messages.find((x) => x.id === messageId);
  if (!m || !activeConv) return;
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-wrap items-center gap-2';
  wrap.innerHTML = REACTION_EMOJIS.map((e) => `
    <button type="button" data-pick="${e}"
            class="flex h-11 w-11 items-center justify-center rounded-full text-2xl hover:bg-slate-100 ${m.reaction_agent === e ? 'bg-indigo-50 ring-2 ring-indigo-400' : ''}">${e}</button>`).join('');

  const send = async (emoji, close) => {
    try {
      await apiPost('whatsapp/react', { conversation_id: activeConv.id, message_id: messageId, emoji });
      close();
      await loadMessages(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const actions = [{ label: 'Cerrar' }];
  if (m.reaction_agent) {
    actions.unshift({ label: 'Quitar mi reacción', danger: true, onClick: (close) => send('', close) });
  }
  const dlg = modal({ title: 'Reaccionar al mensaje', content: wrap, actions });
  wrap.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => send(b.dataset.pick, dlg.close)));
}

const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

function mediaBubbleHtml(m) {
  const caption = m.body
    ? `<p class="${MEDIA_TYPES.includes(m.msg_type) ? 'mt-1' : ''} whitespace-pre-wrap">${escapeHtml(m.body)}</p>`
    : (MEDIA_TYPES.includes(m.msg_type) ? '' : `<p class="whitespace-pre-wrap">(sin texto)</p>`);

  if (!MEDIA_TYPES.includes(m.msg_type)) {
    // Tipos que Sirius no compone en pantalla (sticker, ubicación, botones…):
    // se guardan igual en la bandeja, solo no hay una vista especial para ellos.
    if (m.msg_type !== 'text') {
      return `<p class="mb-1 text-[11px] uppercase tracking-wide opacity-70">${escapeHtml(m.msg_type)}</p>${caption}`;
    }
    return caption;
  }

  if (!m.media_url) {
    return `<p class="text-xs italic opacity-70">No se pudo descargar el adjunto (${escapeHtml(m.msg_type)}).</p>${caption}`;
  }

  let media;
  if (m.msg_type === 'image') {
    media = `<a href="${m.media_url}" target="_blank" rel="noopener"><img src="${m.media_url}" class="max-h-64 max-w-full rounded-lg object-cover"></a>`;
  } else if (m.msg_type === 'video') {
    media = `<video controls class="max-h-64 max-w-full rounded-lg" src="${m.media_url}"></video>`;
  } else if (m.msg_type === 'audio') {
    media = `<audio controls class="max-w-full" src="${m.media_url}"></audio>`;
  } else {
    media = `
      <a href="${m.media_url}&download=1" target="_blank" rel="noopener"
         class="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 hover:bg-black/10">
        ${icon('file-text', 'h-5 w-5 shrink-0')}
        <span class="min-w-0 flex-1 truncate text-sm font-medium">${escapeHtml(m.media_filename || 'Documento')}</span>
        ${m.media_size ? `<span class="shrink-0 text-xs opacity-70">${fmtBytes(m.media_size)}</span>` : ''}
      </a>`;
  }
  return media + caption;
}

function statusLabel(s) {
  return { sent: 'enviado', delivered: 'entregado', read: 'leído', failed: 'falló' }[s] || s;
}

function openLinkPatientModal(conv) {
  const content = document.createElement('div');
  content.innerHTML = `
    <input id="wa-patient-q" type="search" placeholder="Buscar por nombre, folio o teléfono…"
           class="w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
    <div id="wa-patient-results" class="mt-3 max-h-64 space-y-1 overflow-y-auto"></div>`;
  const m = modal({
    title: 'Vincular a paciente',
    content,
    actions: conv.patient_id
      ? [{ label: 'Quitar vínculo', danger: true, onClick: async (close) => {
          await apiPost('whatsapp/unlink_patient', { id: conv.id });
          close(); await afterAction();
        } }]
      : [],
  });
  const input = content.querySelector('#wa-patient-q');
  const results = content.querySelector('#wa-patient-results');
  const search = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    const res = await apiGet('patients/list', { q });
    results.innerHTML = res.patients.map((p) => `
      <button type="button" data-patient="${p.id}" class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
        <b>${escapeHtml([p.first_name, p.paternal_surname, p.maternal_surname].filter(Boolean).join(' '))}</b>
        <span class="text-slate-400"> · ${escapeHtml(p.file_number)}${p.mobile ? ' · ' + escapeHtml(p.mobile) : ''}</span>
      </button>`).join('') || `<p class="px-3 py-2 text-sm text-slate-400">Sin resultados.</p>`;
    results.querySelectorAll('[data-patient]').forEach((b) => b.addEventListener('click', async () => {
      await apiPost('whatsapp/link_patient', { id: conv.id, patient_id: Number(b.dataset.patient) });
      m.close();
      await afterAction();
    }));
  }, 350);
  input.addEventListener('input', search);
  input.focus();
}
