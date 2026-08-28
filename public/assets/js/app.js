/** Bootstrap de la SPA: sesión → sidebar → router → asistente → service worker. */

import { apiGet, apiPost, setCsrf } from './api.js';
import { icon, toast } from './ui.js';
import { initRouter } from './router.js';
import { initAssistant } from './assistant.js';

const state = {
  user: null,
  modules: [],
  registry: [],
  // Capacidades del servidor que la interfaz necesita conocer (p. ej. si el
  // correo saliente está configurado) para no ofrecer acciones inservibles
  features: {},
  activeModule: 'dashboard',
};

async function boot() {
  let session;
  try {
    session = await apiGet('auth/session');
  } catch {
    return; // api.js ya redirigió a login si aplica
  }
  setCsrf(session.csrf);
  state.user = session.user;
  state.modules = session.modules;
  state.registry = session.registry;
  state.features = session.features || {};

  renderTopbar();
  renderSidebar();
  initSidebarToggle();
  lockDesktopScroll();
  initAssistant(state);
  initRouter(state);
  const swReg = await registerServiceWorker();
  if (swReg) initPushNotifications(swReg);
  keepSessionAlive();
}

/**
 * Formularios largos (ej. admisión de Control de peso) a veces tardan más que el
 * tiempo de inactividad de sesión sin hacer ninguna petición al servidor. Este ping
 * periódico mantiene la sesión "tocada" del lado del servidor mientras la pestaña
 * siga abierta, para no perder el trabajo a media captura.
 */
function keepSessionAlive() {
  setInterval(() => {
    apiGet('auth/session').catch(() => {});
  }, 5 * 60 * 1000);
}

function renderTopbar() {
  document.getElementById('topbar-user').textContent = state.user.full_name;
  const roles = { estandar: 'Estandar', administrador: 'Administrador', developper: 'Developper' };
  document.getElementById('topbar-role').textContent = roles[state.user.role] || state.user.role;
  const initials = state.user.full_name.split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  document.getElementById('topbar-avatar').textContent = initials;
}

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const main = state.modules.filter((m) => !m.group);
  const admin = state.modules.filter((m) => m.group === 'admin_tools');

  const link = (m) => `
    <a href="#/${m.key}" data-module="${m.key}"
       class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-slate-800 hover:text-white">
      <span class="shrink-0">${icon(m.icon)}</span>
      <span class="sidebar-label">${m.label}</span>
    </a>`;

  let html = `<div class="space-y-1">${main.map(link).join('')}</div>`;
  if (admin.length) {
    html += `
      <p class="sidebar-label mt-6 px-3 pb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Admin Tools</p>
      <div class="space-y-1">${admin.map(link).join('')}</div>`;
  }
  nav.innerHTML = html;

  // En tablet/móvil, navegar cierra el sidebar off-canvas
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a') && window.innerWidth < 1024) closeSidebar();
  });
}

/* Sidebar: off-canvas en < lg, colapsable a iconos en desktop */
let collapsed = false;

function openSidebar() {
  document.getElementById('sidebar').classList.remove('-translate-x-full');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    if (window.innerWidth >= 1024) {
      collapsed = !collapsed;
      sidebar.classList.toggle('lg:w-64', !collapsed);
      sidebar.classList.toggle('lg:w-[4.5rem]', collapsed);
      sidebar.querySelectorAll('.sidebar-label').forEach((el) => el.classList.toggle('lg:hidden', collapsed));
    } else if (sidebar.classList.contains('-translate-x-full')) {
      openSidebar();
    } else {
      closeSidebar();
    }
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
}

/**
 * El escritorio ocupa exactamente la pantalla y solo hace scroll el panel central.
 * Si el navegador desplaza el documento (por ejemplo al enfocar un control que
 * queda fuera de flujo), el layout entero se sale de vista: lo devolvemos a cero.
 */
function lockDesktopScroll() {
  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: true });
}

/** Devuelve el registro del service worker (o null), para que initPushNotifications()
 *  sepa si hay dónde suscribirse. */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  // En desarrollo (localhost) el cache-first del SW estorba; se activa con ?sw=1.
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return null;
  }
  try {
    return await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('SW:', e.message);
    return null;
  }
}

/**
 * Botón de la campana en la barra superior: solo se muestra cuando tiene sentido
 * ofrecerlo (hay soporte de push, no está ya suscrito, y el permiso no quedó
 * denegado antes — en ese caso solo se arregla desde los ajustes del navegador,
 * insistir aquí no sirve).
 */
async function initPushNotifications(reg) {
  const btn = document.getElementById('btn-notifications');
  if (!btn || !('PushManager' in window) || !('Notification' in window)) return;

  const refresh = async () => {
    const sub = await reg.pushManager.getSubscription();
    btn.classList.toggle('hidden', !!sub || Notification.permission === 'denied');
  };

  btn.addEventListener('click', async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Sin permiso de notificaciones, no se pudieron activar.', 'error');
        await refresh();
        return;
      }
      const { key } = await apiGet('push/vapid_key');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await apiPost('push/subscribe', sub.toJSON());
      toast('Notificaciones activadas');
      await refresh();
    } catch (e) {
      console.error('push subscribe:', e);
      toast('No se pudieron activar las notificaciones', 'error');
    }
  });

  await refresh();
}

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

boot();
