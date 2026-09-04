/** Configuración: instalar la app y buscar actualizaciones. Alcanzable desde el menú del avatar. */

import { icon, toast, modal } from '../ui.js';
import { isIOS, isStandaloneDisplay, canPromptInstall, promptInstall, onInstallPromptChange } from '../pwa_install.js';

export async function render(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-2xl space-y-4">
      <div>
        <h3 class="text-lg font-bold text-slate-900">Configuración</h3>
        <p class="text-sm text-slate-500">Ajustes de esta instalación de Sirius en tu dispositivo.</p>
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
