/** Configuración: instalar la app, buscar actualizaciones y personalización. Alcanzable desde el menú del avatar. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal } from '../ui.js';
import { isIOS, isStandaloneDisplay, canPromptInstall, promptInstall, onInstallPromptChange } from '../pwa_install.js';

// Mismos colores que las variables --theme-accent de src/tailwind.css — si se
// agrega un tema ahí, se agrega aquí también para que el swatch se vea bien.
const THEMES = [
  { key: '',        label: 'Índigo',    hex: '#4f46e5' },
  { key: 'slate',   label: 'Pizarra',   hex: '#475569' },
  { key: 'emerald', label: 'Esmeralda', hex: '#059669' },
  { key: 'rose',    label: 'Coral',     hex: '#e11d48' },
  { key: 'amber',   label: 'Ámbar',     hex: '#d97706' },
  { key: 'sky',     label: 'Cielo',     hex: '#0284c7' },
  { key: 'pink',    label: 'Rosa',      hex: '#db2777' },
  { key: 'violet',  label: 'Morado',    hex: '#7c3aed' },
];

const BRANDING_SLOTS = ['sidebar', 'login', 'favicon'];

function brandingSlotField(slot, title, spec) {
  return `
    <div>
      <p class="text-sm font-medium text-slate-700">${escapeHtml(title)}</p>
      <p class="mt-0.5 text-xs text-slate-500">${escapeHtml(spec)}</p>
      <div class="mt-2 flex items-center gap-3">
        <div id="logo-preview-${slot}" class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200"></div>
        <div class="flex flex-wrap gap-2">
          <label class="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            Subir
            <input id="logo-file-${slot}" type="file" accept="image/png,image/jpeg,image/gif" class="hidden">
          </label>
          <button id="btn-remove-logo-${slot}" type="button" class="hidden rounded-lg px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">Quitar</button>
        </div>
      </div>
    </div>`;
}

export async function render(root, ctx) {
  const isAdmin = ctx.user.role === 'administrador' || ctx.user.role === 'developper';

  root.innerHTML = `
    <div class="mx-auto max-w-2xl space-y-4">
      <div>
        <h3 class="text-lg font-bold text-slate-900">Configuración</h3>
        <p class="text-sm text-slate-500">Ajustes de esta instalación de Sirius en tu dispositivo.</p>
      </div>

      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">${icon('image', 'h-5 w-5')}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-slate-800">Personalización</p>
            <p class="mt-0.5 text-sm text-slate-500">Elige un tema de color para tu sidebar y tu Dashboard.</p>
            <div id="theme-swatches" class="mt-3 flex flex-wrap gap-2"></div>

            ${isAdmin ? `
            <div class="mt-5 space-y-5 border-t border-slate-100 pt-4">
              <p class="text-sm font-semibold text-slate-800">Logotipos de la aplicación</p>
              <p class="-mt-3 text-sm text-slate-500">Cada uno es independiente — para todos los usuarios.</p>
              ${brandingSlotField('sidebar', 'Logo del sidebar', 'Se muestra en miniatura (36×36 px) junto al nombre "Sirius". Usa una imagen cuadrada o con fondo transparente, de al menos 128×128 px. PNG, JPG o GIF, máx. 4 MB.')}
              ${brandingSlotField('login', 'Logo de inicio de sesión', 'Se muestra más grande (64×64 px) arriba del formulario. Usa una imagen cuadrada o con fondo transparente, de al menos 256×256 px. PNG, JPG o GIF, máx. 4 MB.')}
              ${brandingSlotField('favicon', 'Favicon e ícono de la app', 'Ícono de la pestaña del navegador y de la app instalada (PWA). Debe ser una imagen cuadrada (mismo ancho y alto), de al menos 512×512 px — de ahí se generan solos los tamaños 192×192 y 512×512. PNG, JPG o GIF, máx. 4 MB.')}
            </div>` : ''}
          </div>
        </div>
      </div>

      <div id="cfg-install-card" class="hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">${icon('download', 'h-5 w-5')}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-slate-800">Instalar aplicación</p>
            <p class="mt-0.5 text-sm text-slate-500">Agrega Sirius a tu pantalla de inicio para abrirlo como una app.</p>
            <button id="btn-install-app" type="button" class="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Instalar</button>
          </div>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">${icon('repeat', 'h-5 w-5')}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-slate-800">Buscar actualizaciones</p>
            <p class="mt-0.5 text-sm text-slate-500">Revisa si hay una versión nueva de Sirius disponible.</p>
            <button id="btn-check-update" type="button" class="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Buscar actualizaciones</button>
          </div>
        </div>
      </div>
    </div>`;

  const updateInstallCard = () => {
    const card = document.getElementById('cfg-install-card');
    if (!card) return; // se salió del módulo
    card.classList.toggle('hidden', isStandaloneDisplay());
  };
  onInstallPromptChange(updateInstallCard);
  updateInstallCard();

  root.querySelector('#btn-install-app').addEventListener('click', async () => {
    if (isIOS()) {
      showIOSInstallInstructions();
      return;
    }
    if (!canPromptInstall()) {
      toast('Usa el menú de tu navegador (⋮) y busca "Instalar aplicación".', 'info');
      return;
    }
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast('Sirius instalado');
  });

  root.querySelector('#btn-check-update').addEventListener('click', (e) => checkForUpdates(e.currentTarget));

  await initPersonalizacion(root, isAdmin);
}

/* ================== Personalización ================== */
async function initPersonalizacion(root, isAdmin) {
  let data;
  try {
    data = await apiGet('branding/get');
  } catch (e) {
    toast(e.message, 'error');
    return;
  }

  paintSwatches(root, data.theme);
  if (isAdmin) BRANDING_SLOTS.forEach((slot) => paintLogoSlot(root, slot, data.urls));
}

function paintSwatches(root, currentTheme) {
  const box = root.querySelector('#theme-swatches');
  if (!box) return;
  const paint = () => {
    box.innerHTML = THEMES.map((t) => `
      <button type="button" data-theme-pick="${t.key}" title="${escapeHtml(t.label)}"
              class="flex h-9 w-9 items-center justify-center rounded-full ring-2 ${(currentTheme || '') === t.key ? 'ring-slate-900' : 'ring-transparent hover:ring-slate-300'}">
        <span class="block h-7 w-7 rounded-full ring-1 ring-black/10" style="background:${t.hex}"></span>
      </button>`).join('');
    box.querySelectorAll('[data-theme-pick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.themePick;
        if (theme === (currentTheme || '')) return;
        try {
          await apiPost('branding/save_theme', { theme });
          currentTheme = theme;
          document.documentElement.dataset.theme = theme;
          paint();
          toast('Tema actualizado');
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });
  };
  paint();
}

function paintLogoSlot(root, slot, urls) {
  const preview = root.querySelector(`#logo-preview-${slot}`);
  const removeBtn = root.querySelector(`#btn-remove-logo-${slot}`);
  const fileInput = root.querySelector(`#logo-file-${slot}`);
  if (!preview) return;

  // El favicon se guarda como imagen original + íconos derivados; su vista
  // previa usa el ícono de 192 (ya cuadrado) en vez del archivo crudo.
  const urlFor = (u) => (slot === 'favicon' ? u.icon_192 : u[slot]);

  const paintPreview = (u) => {
    const url = urlFor(u);
    preview.innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="Logotipo actual" class="h-full w-full object-contain">`
      : icon('image', 'h-6 w-6 text-slate-300');
    removeBtn.classList.toggle('hidden', !url);
  };
  paintPreview(urls);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('slot', slot);
    try {
      const res = await fetch('api/index.php?r=branding/upload_logo', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      paintPreview(json.data.urls);
      toast('Logotipo actualizado — todos lo verán al recargar');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  removeBtn.addEventListener('click', async () => {
    try {
      const { urls: fresh } = await apiPost('branding/remove_logo', { slot });
      paintPreview(fresh);
      toast('Logotipo eliminado, volviste al de Sirius');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function showIOSInstallInstructions() {
  modal({
    title: 'Instalar en iPhone o iPad',
    content: `
      <div class="space-y-3 text-sm text-slate-600">
        <p>iOS no deja instalar apps web de forma automática — se hace así, desde Safari:</p>
        <ol class="list-decimal space-y-2 pl-5">
          <li>Toca el botón <b>Compartir</b> (el cuadrito con la flecha hacia arriba, abajo de la pantalla).</li>
          <li>Baja en la lista hasta <b>"Agregar a pantalla de inicio"</b>.</li>
          <li>Confirma tocando <b>"Agregar"</b>, arriba a la derecha.</li>
        </ol>
      </div>`,
    actions: [{ label: 'Entendido', primary: true }],
  });
}

async function checkForUpdates(btn) {
  btn.disabled = true;
  let latest;
  try {
    const res = await fetch('version.php', { cache: 'no-store' });
    ({ version: latest } = await res.json());
  } catch {
    toast('No se pudo comprobar la versión, revisa tu conexión.', 'error');
    btn.disabled = false;
    return;
  }
  btn.disabled = false;

  const current = document.querySelector('meta[name="app-version"]')?.content || 'dev';
  if (latest === current || latest === 'dev') {
    modal({
      title: 'Buscar actualizaciones',
      content: `<p class="text-sm text-slate-600">Estás usando la versión más actualizada de Sirius.</p>`,
      actions: [{ label: 'Cerrar', primary: true }],
    });
    return;
  }

  modal({
    title: 'Actualización disponible',
    content: `<p class="text-sm text-slate-600">Sirius encontró la actualización a la versión <b>${latest}</b>. ¿Deseas instalarla?</p>`,
    actions: [
      { label: 'Ahora no' },
      { label: 'Instalar', primary: true, onClick: (close) => { close(); installUpdate(latest); } },
    ],
  });
}

/** Trabajo real, no una espera artificial: activa el service worker nuevo (si ya
 *  está esperando) y recarga — el modal se queda abierto mientras tanto y solo
 *  cambia a "listo" cuando el navegador confirma que el nuevo SW tomó control. */
async function installUpdate(latest) {
  const progress = modal({
    title: 'Instalando actualización',
    content: `
      <div class="flex flex-col items-center gap-3 py-4">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"></div>
        <p class="text-sm text-slate-500">Actualizando Sirius…</p>
      </div>`,
    actions: [],
  });

  const showDone = () => {
    progress.el.querySelector('h3').textContent = 'Actualización lista';
    const body = progress.el.querySelector('.modal-body');
    body.innerHTML = `<p class="text-sm text-slate-600">Sirius se actualizó a la versión <b>${latest}</b>.</p>`;
    let actions = progress.el.querySelector('.modal-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'modal-actions flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3';
      body.parentElement.appendChild(actions);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500';
    btn.textContent = 'Aceptar';
    btn.addEventListener('click', () => location.reload());
    actions.appendChild(btn);
  };

  if (!('serviceWorker' in navigator)) {
    // Sin service worker en este navegador: no hay nada más que activar, el
    // archivo que se acaba de servir ya es el nuevo.
    showDone();
    return;
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { showDone(); return; }
    await reg.update();

    const waitInstalled = (worker) => new Promise((resolve) => {
      if (worker.state === 'installed') { resolve(); return; }
      worker.addEventListener('statechange', function onChange() {
        if (worker.state === 'installed') {
          worker.removeEventListener('statechange', onChange);
          resolve();
        }
      });
    });

    let worker = reg.installing || reg.waiting;
    if (worker) {
      await waitInstalled(worker);
      worker.postMessage({ type: 'SKIP_WAITING' });
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
    }
    // Sin worker nuevo (ya se había activado antes, o no hubo cambios de verdad):
    // el reload de todas formas trae los archivos ya actualizados del servidor.
  } catch (e) {
    console.warn('Actualización SW:', e.message);
  }
  showDone();
}
