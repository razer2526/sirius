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
        <button id="assistant-mic" type="button" aria-label="Hablar" hidden
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100">${icon('mic', 'h-4 w-4')}</button>
        <button type="submit" aria-label="Enviar"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500">${icon('send', 'h-4 w-4')}</button>
      </form>
    </div>`;

  const fab = root.querySelector('#assistant-fab');
  const panel = root.querySelector('#assistant-panel');
  const messages = root.querySelector('#assistant-messages');
  const form = root.querySelector('#assistant-form');
  const input = root.querySelector('#assistant-input');
  const micBtn = root.querySelector('#assistant-mic');
  const ctxLabel = root.querySelector('#assistant-context');

  // La conversación se conserva para dar continuidad a las respuestas
  const history = [];
  let assistantName = 'Sirius';

  const addMsg = (text, who) => {
    const wrap = document.createElement('div');
    wrap.className = who === 'user' ? 'ml-8 flex justify-end' : 'mr-8 flex items-end gap-1.5';

    const bubble = document.createElement('div');
    bubble.className = who === 'user'
      ? 'rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white'
      : 'min-w-0 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200';
    bubble.innerHTML = who === 'user' ? escapeHtml(text) : mdLite(text);
    bubble.dataset.raw = text;
    wrap.appendChild(bubble);

    // Leer en voz alta es a petición, no automático: en recepción, con gente
    // alrededor, que cada respuesta se lea sola sin pedirlo sería molesto.
    if (who === 'bot' && speechSupported) {
      const speakBtn = document.createElement('button');
      speakBtn.type = 'button';
      speakBtn.setAttribute('aria-label', 'Escuchar respuesta');
      speakBtn.className = 'mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600';
      speakBtn.innerHTML = icon('volume-2', 'h-3.5 w-3.5');
      speakBtn.addEventListener('click', () => speakText(bubble.dataset.raw ?? text));
      wrap.appendChild(speakBtn);
    }

    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  };

  /* ---- Voz: dictar la pregunta y, a petición, escuchar la respuesta ----
     Ambas son APIs nativas del navegador (sin costo, sin servidor propio); si
     el navegador no las trae, el botón de micrófono no aparece y la bocina de
     cada respuesta tampoco -degradan solas, no hace falta detectarlo aparte. */
  const speechSupported = 'speechSynthesis' in window;

  function speakText(raw) {
    if (!speechSupported) return;
    window.speechSynthesis.cancel(); // no encimar una lectura sobre otra
    const plain = String(raw)
      .replace(/[*_`#]/g, '')
      .replace(/^\s*[-•]\s+/gm, '')
      .replace(/\n+/g, '. ');
    const utter = new SpeechSynthesisUtterance(plain);
    utter.lang = 'es-MX';
    window.speechSynthesis.speak(utter);
  }

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor) {
    micBtn.hidden = false;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;

    const setListening = (on) => {
      micBtn.classList.toggle('bg-red-600', on);
      micBtn.classList.toggle('text-white', on);
      micBtn.classList.toggle('ring-red-600', on);
      micBtn.classList.toggle('text-slate-500', !on);
      micBtn.classList.toggle('ring-slate-200', !on);
    };

    recognition.addEventListener('result', (e) => {
      const said = e.results[0]?.[0]?.transcript.trim();
      if (!said) return;
      input.value = said;
      form.requestSubmit();
    });
    recognition.addEventListener('end', () => setListening(false));
    recognition.addEventListener('error', () => setListening(false));

    micBtn.addEventListener('click', () => {
      if (micBtn.classList.contains('bg-red-600')) {
        recognition.stop();
        return;
      }
      setListening(true);
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    });
  }

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
      typing.dataset.raw = data.reply;
      history.push({ role: 'model', text: data.reply });
    } catch (err) {
      typing.innerHTML = `<span class="text-red-600">${escapeHtml(err.message)}</span>`;
      history.pop();
    }
    messages.scrollTop = messages.scrollHeight;
  });
}
