/**
 * Estado compartido de "instalar como app": captura del evento beforeinstallprompt
 * (solo puede escucharse una vez y en cualquier momento de la sesión, así que se
 * registra desde el arranque de app.js, no desde el módulo de Configuración) más
 * los helpers que usa la interfaz para decidir qué mostrar.
 */

let deferredPrompt = null;
let onChangeCb = null;

export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    onChangeCb?.();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onChangeCb?.();
  });
}

/** Configuración se suscribe para repintar su sección si el evento llega mientras está abierta. */
export function onInstallPromptChange(cb) {
  onChangeCb = cb;
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
export const isStandaloneDisplay = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const canPromptInstall = () => deferredPrompt !== null;

export async function promptInstall() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  onChangeCb?.();
  return outcome;
}
