/** Bootstrap de la SPA: sesión → sidebar → router → asistente → service worker. */

import { apiGet, setCsrf } from './api.js';
import { icon, toast } from './ui.js';
import { initRouter, currentModuleKey } from './router.js';
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
  registerServiceWorker();
  keepSessionAlive();
  if (state.modules.some((m) => m.key === 'whatsapp')) {
    initWhatsappNotifier();
  }
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // En desarrollo (localhost) el cache-first del SW estorba; se activa con ?sw=1.
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e.message));
}

/**
 * Aviso sonoro de mensajes nuevos de WhatsApp, sin importar en qué módulo esté
 * el usuario (no solo en el Dashboard o en WhatsApp) — a quien atiende el chat
 * le sirve el aviso mientras trabaja en Admisión o Expedientes, no solo cuando
 * ya está viendo la bandeja. Se sondea el total de no leídos (barato, sin traer
 * conversaciones) y solo suena cuando el número sube respecto a la última vez.
 */
const WA_NOTIFY_POLL_MS = 20000;
let waUnreadPrev = null;

function initWhatsappNotifier() {
  const check = async () => {
    let count;
    try {
      ({ count } = await apiGet('whatsapp/unread_count'));
    } catch {
      return; // red intermitente o sesión expirada: se reintenta en el próximo sondeo
    }
    if (waUnreadPrev !== null && count > waUnreadPrev && currentModuleKey() !== 'whatsapp') {
      playNotificationSound();
      toast('Tienes mensajes nuevos de WhatsApp', 'info');
    }
    waUnreadPrev = count;
  };
  check();
  setInterval(check, WA_NOTIFY_POLL_MS);
}

/**
 * Dos tonos cortos generados con Web Audio — sin archivo de audio que empacar
 * ni descargar. Los navegadores bloquean el audio hasta el primer gesto del
 * usuario en la página; para cuando esto suena ya hubo uno (inició sesión), así
 * que no hace falta gestionar ese desbloqueo aparte.
 */
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const start = now + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // Web Audio no disponible o bloqueado por el navegador: se omite en silencio.
  }
}

boot();
