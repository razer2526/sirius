/** Burbuja flotante del asistente IA (persistente entre módulos). */

import { apiGet, apiPost } from './api.js';
import { icon, escapeHtml, mdLite } from './ui.js';

export function initAssistant(state) {
  const root = document.getElementById('assistant-root');
  root.innerHTML = `
    <button id="assistant-fab" type="button" aria-label="Asistente Sirius"
            class="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 transition hover:scale-105 hover:bg-indigo-500">
      ${icon('sparkles', 'h-7 w-7')}
    </button>
    <div id="assistant-panel"
         class="fixed bottom-5 right-5 z-40 hidden h-[28rem] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
      <div class="flex shrink-0 items-center gap-2 bg-indigo-600 px-4 py-3 text-white">
        ${icon('sparkles', 'h-5 w-5')}
        <div class="min-w-0 flex-1">
          <p id="assistant-title" class="text-sm font-semibold leading-tight">Sirius</p>
          <p id="assistant-context" class="truncate text-xs text-indigo-200">Asistente del laboratorio</p>
        </div>
        <button id="assistant-close" type="button" aria-label="Cerrar" class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-indigo-500">${icon('x', 'h-5 w-5')}</button>
      </div>
      <div id="assistant-messages" class="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4"></div>
      <form id="assistant-form" class="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white p-3">
        <input id="assistant-input" type="text" placeholder="Escribe un mensaje…" autocomplete="off"
               class="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-indigo-400">
        <button type="submit" aria-label="Enviar"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500">${icon('send', 'h-4 w-4')}</button>
      </form>
    </div>`;

  const fab = root.querySelector('#assistant-fab');
  const panel = root.querySelector('#assistant-panel');
  const messages = root.querySelector('#assistant-messages');
  const form = root.querySelector('#assistant-form');
  const input = root.querySelector('#assistant-input');
  const ctxLabel = root.querySelector('#assistant-context');

  // La conversación se conserva para dar continuidad a las respuestas
  const history = [];
  let assistantName = 'Sirius';

  const addMsg = (text, who) => {
    const el = document.createElement('div');
    el.className = who === 'user'
      ? 'ml-8 rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white'
      : 'mr-8 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200';
    el.innerHTML = who === 'user' ? escapeHtml(text) : mdLite(text);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  };

  const open = () => {
    fab.classList.add('hidden');
    panel.classList.remove('hidden');
    panel.classList.add('flex');
    const modLabel = state.modules.find((m) => m.key === state.activeModule)?.label;
    ctxLabel.textContent = modLabel ? `Contexto: ${modLabel}` : 'Asistente del laboratorio';
    if (!messages.children.length) {
      addMsg(`Hola ${state.user.full_name.split(' ')[0]}, soy ${assistantName}. ¿En qué te ayudo?`, 'bot');
    }
    input.focus();
  };
  const close = () => {
    panel.classList.add('hidden');
    panel.classList.remove('flex');
    fab.classList.remove('hidden');
  };

  fab.addEventListener('click', open);
  root.querySelector('#assistant-close').addEventListener('click', close);

  // Mientras no haya llave configurada la burbuja no aparece: no tendría nada que responder
  root.classList.add('hidden');
  apiGet('assistant/status').then(({ ready, name }) => {
    if (!ready) return;
    root.classList.remove('hidden');
    if (name) {
      assistantName = name;
      root.querySelector('#assistant-title').textContent = name;
      fab.setAttribute('aria-label', `Asistente ${name}`);
    }
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg(text, 'user');
    const typing = addMsg('…', 'bot');
    const sending = [...history];
    history.push({ role: 'user', text });
    try {
      const data = await apiPost('assistant/chat', {
        message: text,
        module: state.activeModule,
        history: sending,
      });
      typing.innerHTML = mdLite(data.reply);
      history.push({ role: 'model', text: data.reply });
    } catch (err) {
      typing.innerHTML = `<span class="text-red-600">${escapeHtml(err.message)}</span>`;
      history.pop();
    }
    messages.scrollTop = messages.scrollHeight;
  });
}
