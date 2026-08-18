/** Módulo API (Admin Tools): configuración del asistente y del calendario. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, spinner, inputCls, labelCls } from '../ui.js';

export async function render(root, ctx) {
  const [view] = ctx.args;
  if (view === 'ia') return renderAI(root);
  if (view === 'calendario') return renderCalendar(root);
  if (view === 'correo') return renderMail(root);
  return renderGrid(root);
}

function renderGrid(root) {
  const card = (href, label, desc, iconName, color, badge) => `
    <a href="${href}" class="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">
      <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${color}">${icon(iconName, 'h-7 w-7')}</span>
      <span class="min-w-0">
        <span class="block text-base font-semibold text-slate-900">${label}</span>
        <span class="block text-sm text-slate-500">${desc}</span>
      </span>
      ${badge || `<span class="ml-auto shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </span>`}
    </a>`;

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <p class="text-sm text-slate-500">Servicios externos que utiliza Sirius.</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${card('#/api/ia', 'Asistente de IA', 'Gemini, ChatGPT o Claude: proveedor, modelo, instrucciones y llave', 'sparkles', 'bg-violet-100 text-violet-700')}
        ${card('#/api/calendario', 'Calendario', 'Vinculación con Google Calendar', 'calendar', 'bg-sky-100 text-sky-700')}
        ${card('#/api/correo', 'Correo', 'Envío de fichas de identificación a los pacientes', 'send', 'bg-emerald-100 text-emerald-700')}
      </div>
      <div id="api-state" class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 text-sm text-slate-500">${spinner()}</div>
    </div>`;

  apiGet('ai/get').then(({ config }) => {
    const box = root.querySelector('#api-state');
    if (!box) return;
    const pcfg = config.providers[config.provider] || {};
    const on = config.enabled && pcfg.has_key;
    box.innerHTML = `
      <div class="flex flex-wrap items-center gap-3">
        <span class="flex h-2.5 w-2.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
        <span class="text-sm font-semibold text-slate-800">
          Asistente ${on ? 'activo' : (pcfg.has_key ? 'configurado pero desactivado' : 'sin configurar')}
        </span>
        ${on ? `<span class="text-xs text-slate-500">${escapeHtml(AI_PROVIDER_LABELS[config.provider] || config.provider)} · ${escapeHtml(pcfg.model || '(sin modelo)')}</span>` : ''}
      </div>`;
  });
}

const AI_PROVIDER_LABELS = { gemini: 'Google Gemini', openai: 'OpenAI (ChatGPT)', claude: 'Anthropic (Claude)' };
const AI_PROVIDER_META = {
  gemini: { placeholder: 'AIza…', hint: 'Se obtiene en Google AI Studio.' },
  openai: { placeholder: 'sk-…', hint: 'Se obtiene en platform.openai.com.' },
  claude: { placeholder: 'sk-ant-…', hint: 'Se obtiene en console.anthropic.com.' },
};

/* ---------- Asistente de IA ---------- */
async function renderAI(root) {
  root.innerHTML = spinner();
  const { config } = await apiGet('ai/get');

  const providerBlock = (name) => {
    const p = config.providers[name] || {};
    const meta = AI_PROVIDER_META[name];
    return `
      <div data-provider-block="${name}" class="space-y-4 ${config.provider === name ? '' : 'hidden'}">
        <div>
          <label class="${labelCls}">Llave de API${p.has_key ? ` <span class="normal-case text-slate-400">(guardada: ${escapeHtml(p.key_hint)})</span>` : ''}</label>
          <input type="password" data-provider-key="${name}" autocomplete="off" placeholder="${p.has_key ? 'Escribe una nueva para reemplazarla' : meta.placeholder}" class="${inputCls}">
          <p class="mt-1 text-xs text-slate-400">${meta.hint} Déjala vacía para conservar la actual.</p>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">Modelo</label>
            <input type="text" data-provider-model="${name}" value="${escapeHtml(p.model || '')}" class="${inputCls}" list="model-list-${name}">
            <datalist id="model-list-${name}"></datalist>
          </div>
          <div class="flex items-end gap-2">
            <button type="button" data-btn-test="${name}" class="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
              Probar y ver modelos
            </button>
          </div>
        </div>
      </div>`;
  };

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/api" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Asistente de IA</h3>
        <p class="text-sm text-slate-500">Elige el proveedor y modelo a usar. La llave se guarda en el servidor y nunca viaja al navegador.</p>
      </div>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label class="flex cursor-pointer items-start gap-3">
          <input type="checkbox" data-cfg="enabled" ${config.enabled ? 'checked' : ''}
                 class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          <span>
            <span class="block text-sm font-semibold text-slate-800">Asistente activo</span>
            <span class="block text-xs text-slate-500">Habilita la burbuja de chat y el apoyo diagnóstico.</span>
          </span>
        </label>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Conexión</h4>
        <div>
          <label class="${labelCls}">Servicio</label>
          <select id="provider-select" class="${inputCls}">
            ${Object.entries(AI_PROVIDER_LABELS).map(([name, label]) => `<option value="${name}" ${config.provider === name ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
        ${providerBlock('gemini')}
        ${providerBlock('openai')}
        ${providerBlock('claude')}
        <div class="flex items-end gap-2 border-t border-slate-100 pt-4">
          <button id="btn-ping" type="button" class="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
            Enviar prueba
          </button>
        </div>
        <div id="test-result" class="hidden rounded-xl px-4 py-3 text-sm"></div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Comportamiento</h4>
        <div>
          <label class="${labelCls}">Nombre del asistente</label>
          <input type="text" data-cfg="assistant_name" value="${escapeHtml(config.assistant_name)}" class="${inputCls}">
        </div>
        <div>
          <label class="${labelCls}">Instrucciones generales</label>
          <textarea data-cfg="instructions" rows="4" class="${inputCls}">${escapeHtml(config.instructions)}</textarea>
        </div>
        <div>
          <label class="${labelCls}">Instrucciones de Dx Assist</label>
          <textarea data-cfg="dx_instructions" rows="4" class="${inputCls}">${escapeHtml(config.dx_instructions)}</textarea>
          <p class="mt-1 text-xs text-slate-400">Se usan al analizar un expediente desde el módulo Expedientes.</p>
        </div>
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <input type="checkbox" data-cfg="share_patient_data" ${config.share_patient_data ? 'checked' : ''}
                 class="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600">
          <span>
            <span class="block text-sm font-semibold text-amber-900">Permitir enviar datos clínicos al asistente</span>
            <span class="block text-xs text-amber-800">
              Necesario para Dx Assist. Al activarlo, la información del expediente se transmite al proveedor
              del servicio para generar la respuesta.
            </span>
          </span>
        </label>
      </section>

      <div class="flex justify-end">
        <button id="btn-save" type="button" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          Guardar configuración
        </button>
      </div>
    </div>`;

  const activeProvider = () => root.querySelector('#provider-select').value;

  root.querySelector('#provider-select').addEventListener('change', (e) => {
    root.querySelectorAll('[data-provider-block]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.providerBlock !== e.target.value);
    });
  });

  const collect = () => {
    const provider = activeProvider();
    const out = { provider, providers: {} };
    root.querySelectorAll('[data-cfg]').forEach((el) => {
      out[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : el.value;
    });
    out.providers[provider] = {
      api_key: root.querySelector(`[data-provider-key="${provider}"]`).value.trim(),
      model: root.querySelector(`[data-provider-model="${provider}"]`).value.trim(),
    };
    return out;
  };
  const result = root.querySelector('#test-result');
  const showResult = (text, ok) => {
    result.className = `rounded-xl px-4 py-3 text-sm ${ok ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`;
    result.textContent = text;
    result.classList.remove('hidden');
  };

  root.querySelectorAll('[data-btn-test]').forEach((btn) => {
    // btn viene del forEach, no de e.currentTarget: el navegador limpia
    // currentTarget en cuanto termina el despacho del evento, así que tras el
    // await de abajo ya no sirve (el finally lo necesita para reactivar el botón).
    btn.addEventListener('click', async () => {
      const name = btn.dataset.btnTest;
      btn.disabled = true;
      try {
        const data = await apiPost('ai/test', {
          provider: name,
          api_key: root.querySelector(`[data-provider-key="${name}"]`).value.trim(),
        });
        root.querySelector(`#model-list-${name}`).innerHTML =
          data.models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.label)}</option>`).join('');
        showResult(`Conexión correcta. ${data.count} modelo(s) disponibles; elige uno en el campo Modelo.`, true);
      } catch (err) {
        showResult(err.message, false);
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelector('#btn-ping').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiPost('ai/save', collect());
      const data = await apiPost('ai/ping', {});
      showResult(`${AI_PROVIDER_LABELS[data.provider] || data.provider} (${data.model}) respondió: "${data.reply}"`, true);
    } catch (err) {
      showResult(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#btn-save').addEventListener('click', async () => {
    try {
      await apiPost('ai/save', collect());
      toast('Configuración guardada');
      render(root, { args: ['ia'] });
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

/* ---------- Correo saliente ---------- */
async function renderMail(root) {
  root.innerHTML = spinner();
  const { config } = await apiGet('mail/get');

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/api" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Correo saliente</h3>
        <p class="text-sm text-slate-500">
          Se usa para enviar al paciente su ficha de identificación en PDF. La contraseña se guarda
          en el servidor y nunca viaja al navegador.
        </p>
      </div>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label class="flex cursor-pointer items-start gap-3">
          <input type="checkbox" data-cfg="enabled" ${config.enabled ? 'checked' : ''}
                 class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          <span>
            <span class="block text-sm font-semibold text-slate-800">Envío de correo activo</span>
            <span class="block text-xs text-slate-500">Si se desactiva, las admisiones se siguen guardando pero no se envía la ficha.</span>
          </span>
        </label>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Servidor SMTP</h4>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="sm:col-span-2">
            <label class="${labelCls}">Servidor</label>
            <input type="text" data-cfg="host" value="${escapeHtml(config.host)}" placeholder="mail.bosquespolanco.com" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Puerto</label>
            <input type="number" data-cfg="port" value="${escapeHtml(String(config.port))}" class="${inputCls}">
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label class="${labelCls}">Seguridad</label>
            <select data-cfg="secure" class="${inputCls}">
              <option value="ssl" ${config.secure === 'ssl' ? 'selected' : ''}>SSL (puerto 465)</option>
              <option value="tls" ${config.secure === 'tls' ? 'selected' : ''}>TLS (puerto 587)</option>
              <option value="" ${config.secure === '' ? 'selected' : ''}>Sin cifrado</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="${labelCls}">Usuario</label>
            <input type="text" data-cfg="username" value="${escapeHtml(config.username)}" placeholder="id@bosquespolanco.com" class="${inputCls}">
          </div>
        </div>
        <div>
          <label class="${labelCls}">Contraseña${config.has_password ? ' <span class="normal-case text-slate-400">(guardada)</span>' : ''}</label>
          <input type="password" data-cfg="password" autocomplete="off"
                 placeholder="${config.has_password ? 'Escribe una nueva para reemplazarla' : 'Contraseña de la cuenta de correo'}" class="${inputCls}">
          <p class="mt-1 text-xs text-slate-400">Es la contraseña de la cuenta en cPanel. Déjala vacía para conservar la actual.</p>
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Remitente</h4>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">Correo del remitente</label>
            <input type="email" data-cfg="from_email" value="${escapeHtml(config.from_email)}" placeholder="id@bosquespolanco.com" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Nombre visible</label>
            <input type="text" data-cfg="from_name" value="${escapeHtml(config.from_name)}" class="${inputCls}">
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">Responder a</label>
            <input type="email" data-cfg="reply_to" value="${escapeHtml(config.reply_to)}" placeholder="Opcional" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Copia oculta interna</label>
            <input type="email" data-cfg="always_bcc" value="${escapeHtml(config.always_bcc)}" placeholder="id@bosquespolanco.com" class="${inputCls}">
            <p class="mt-1 text-xs text-slate-400">Recibe copia de toda ficha enviada.</p>
          </div>
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-3">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Probar</h4>
        <div class="flex flex-wrap items-end gap-2">
          <div class="min-w-0 flex-1">
            <label class="${labelCls}">Enviar un correo de prueba a</label>
            <input type="email" id="test-to" placeholder="tu@correo.com" class="${inputCls}">
          </div>
          <button id="btn-test" type="button" class="rounded-lg px-4 py-2.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            Enviar prueba
          </button>
        </div>
        <div id="test-result" class="hidden rounded-xl px-4 py-3 text-sm"></div>
        <p class="text-xs text-slate-400">
          Guarda la configuración antes de probar. Si el correo no llega, revisa en cPanel que
          <b>Email Deliverability</b> muestre SPF y DKIM correctos para tu dominio.
        </p>
      </section>

      <div class="flex justify-end">
        <button id="btn-save" type="button" class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          Guardar configuración
        </button>
      </div>
    </div>`;

  const collect = () => {
    const out = {};
    root.querySelectorAll('[data-cfg]').forEach((el) => {
      out[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  };
  const result = root.querySelector('#test-result');
  const showResult = (text, ok) => {
    result.className = `rounded-xl px-4 py-3 text-sm ${ok ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`;
    result.textContent = text;
    result.classList.remove('hidden');
  };

  root.querySelector('#btn-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const to = root.querySelector('#test-to').value.trim();
    if (!to) { showResult('Escribe un correo para la prueba.', false); return; }
    btn.disabled = true;
    try {
      await apiPost('mail/save', collect());
      await apiPost('mail/test', { to });
      showResult(`Correo enviado a ${to}. Revisa la bandeja (y la carpeta de spam).`, true);
    } catch (err) {
      showResult(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#btn-save').addEventListener('click', async () => {
    try {
      await apiPost('mail/save', collect());
      toast('Configuración guardada');
      render(root, { args: ['correo'] });
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

/* ---------- Calendario ---------- */
async function renderCalendar(root) {
  root.innerHTML = spinner();

  // Mensaje de retorno del flujo OAuth (google_oauth.php redirige aquí con ?gcal=...).
  const qs = new URLSearchParams(window.location.search);
  const gcalStatus = qs.get('gcal');
  const gcalMsg = qs.get('msg') || '';
  if (gcalStatus) {
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  const { config } = await apiGet('calendar/get');
  const origin = window.location.origin;

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/api" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Google Calendar</h3>
        <p class="text-sm text-slate-500">
          Una sola cuenta compartida (ej. la del equipo de recolección) se conecta aquí; desde ella se crean
          las citas y se invita a cualquier correo, sin que necesite cuenta en Sirius.
        </p>
      </div>

      <section id="gcal-status" class="rounded-2xl p-4 ring-1 ${config.connected ? 'bg-emerald-50 ring-emerald-200' : 'bg-slate-50 ring-slate-200'}">
        <div class="flex flex-wrap items-center gap-3">
          <span class="flex h-2.5 w-2.5 rounded-full ${config.connected ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
          <span class="text-sm font-semibold ${config.connected ? 'text-emerald-900' : 'text-slate-700'}">
            ${config.connected ? `Conectado como ${escapeHtml(config.connected_email)}` : 'Sin conectar'}
          </span>
          ${config.connected
            ? `<button id="btn-disconnect" type="button" class="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">Desconectar</button>`
            : ''}
        </div>
      </section>

      <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 space-y-4">
        <h4 class="text-sm font-bold uppercase tracking-wide text-slate-700">Credenciales de Google Cloud</h4>
        <p class="text-sm text-slate-600">
          En Google Cloud Console: crea un proyecto, habilita <b>Google Calendar API</b> y genera credenciales
          de tipo <b>ID de cliente de OAuth</b> (aplicación web) con estos datos:
        </p>
        <div>
          <label class="${labelCls}">Origen autorizado de JavaScript</label>
          <input type="text" readonly value="${escapeHtml(origin)}" class="${inputCls} bg-slate-50 font-mono text-xs">
        </div>
        <div>
          <label class="${labelCls}">URI de redirección autorizado</label>
          <input type="text" readonly value="${escapeHtml(config.redirect_uri)}" class="${inputCls} bg-slate-50 font-mono text-xs">
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="${labelCls}">ID de cliente</label>
            <input type="text" data-cfg="client_id" value="${escapeHtml(config.client_id)}" placeholder="xxxxx.apps.googleusercontent.com" class="${inputCls}">
          </div>
          <div>
            <label class="${labelCls}">Calendario</label>
            <input type="text" data-cfg="calendar_id" value="${escapeHtml(config.calendar_id)}" class="${inputCls}">
            <p class="mt-1 text-xs text-slate-400">"primary" usa el calendario principal de la cuenta conectada.</p>
          </div>
        </div>
        <div>
          <label class="${labelCls}">Secreto de cliente${config.has_secret ? ' <span class="normal-case text-slate-400">(guardado)</span>' : ''}</label>
          <input type="password" data-cfg="client_secret" autocomplete="off" placeholder="${config.has_secret ? 'Escribe uno nuevo para reemplazarlo' : 'GOCSPX-…'}" class="${inputCls}">
        </div>
        <p class="text-xs text-slate-400">
          El intercambio de credenciales se hace desde el servidor: el navegador nunca ve el secreto ni el token
          de acceso a la cuenta de Google.
        </p>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button id="btn-save" type="button" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            Guardar credenciales
          </button>
          <button id="btn-connect" type="button" ${config.connected ? 'disabled' : ''}
            class="rounded-lg px-5 py-2.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40">
            Conectar cuenta de Google
          </button>
        </div>
      </section>
    </div>`;

  if (gcalStatus === 'ok') {
    toast('Cuenta de Google Calendar conectada');
  } else if (gcalStatus === 'error') {
    toast(gcalMsg || 'No se pudo conectar la cuenta de Google', 'error');
  }

  const collect = () => {
    const out = {};
    root.querySelectorAll('[data-cfg]').forEach((el) => { out[el.dataset.cfg] = el.value; });
    return out;
  };

  root.querySelector('#btn-save').addEventListener('click', async () => {
    try {
      await apiPost('calendar/save', collect());
      toast('Credenciales guardadas');
      render(root, { args: ['calendario'] });
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  root.querySelector('#btn-connect').addEventListener('click', async () => {
    try {
      await apiPost('calendar/save', collect());
      window.location.href = 'google_oauth.php';
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  const disconnectBtn = root.querySelector('#btn-disconnect');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (!confirm('¿Desconectar la cuenta de Google Calendar? Las citas dejarán de sincronizarse hasta reconectarla.')) return;
      try {
        await apiPost('calendar/disconnect', {});
        toast('Cuenta desconectada');
        render(root, { args: ['calendario'] });
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }
}
