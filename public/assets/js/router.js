/** Router por hash: #/modulo[/args...] → import dinámico de assets/js/modules/<modulo>.js */

import { spinner } from './ui.js';

let appState = null;

export function initRouter(state) {
  appState = state;
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

export function navigate(route) {
  if (window.location.hash === '#/' + route) renderRoute();
  else window.location.hash = '#/' + route;
}

export function currentModuleKey() {
  const hash = window.location.hash.replace(/^#\//, '');
  return hash.split('/')[0] || 'dashboard';
}

async function renderRoute() {
  const root = document.getElementById('module-root');
  const hash = window.location.hash.replace(/^#\//, '');
  const [key, ...args] = hash.split('/');
  const moduleKey = key || 'dashboard';

  const mod = appState.modules.find((m) => m.key === moduleKey);
  if (!mod) {
    // Sin acceso al módulo pedido: ir al primero disponible para el usuario.
    const fallback = appState.modules[0];
    if (!fallback) {
      root.innerHTML = '<div class="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-amber-200">Tu usuario no tiene módulos habilitados. Pide acceso a un administrador.</div>';
      return;
    }
    if (fallback.key !== moduleKey) navigate(fallback.key);
    return;
  }

  document.getElementById('topbar-title').textContent = mod.label;
  document.querySelectorAll('#sidebar-nav [data-module]').forEach((a) => {
    const active = a.dataset.module === moduleKey;
    a.classList.toggle('bg-indigo-600', active);
    a.classList.toggle('text-white', active);
    a.classList.toggle('hover:bg-slate-800', !active);
  });

  root.innerHTML = spinner();
  appState.activeModule = moduleKey;
  try {
    const m = await import(`./modules/${moduleKey}.js`);
    await m.render(root, { ...appState, args, navigate });
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">
      No se pudo cargar el módulo <b>${moduleKey}</b>: ${e.message}</div>`;
  }
}
