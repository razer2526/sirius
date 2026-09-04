/** Bootstrap de la SPA: sesión → sidebar → router → asistente → service worker. */

import { apiGet, apiPost, setCsrf } from './api.js';
import { icon, toast, escapeHtml, fmtRelative } from './ui.js';
import { initRouter, currentModuleKey } from './router.js';
import { initAssistant } from './assistant.js';
import { initInstallCapture } from './pwa_install.js';

/**
 * El navegador puede disparar "beforeinstallprompt" en cualquier momento después
 * de cargar la página (según su propio criterio de "qué tan instalable" ve el
 * sitio) — hay que estar escuchando desde ya, antes de boot(), para no perdérselo
 * aunque el usuario nunca visite Configuración en esta sesión.
 */
initInstallCapture();

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
  initUserMenu();
  initRefreshButton();
  lockDesktopScroll();
  initAssistant(state);
  initRouter(state);
  const swReg = await registerServiceWorker();
  keepSessionAlive();
  initNotificationBell(swReg);
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
  // "hidden": el módulo sigue siendo accesible por URL directa y cuenta para permisos,
  // solo no aparece como entrada propia del sidebar (ej. WhatsApp: Configuración, que
  // se alcanza desde una tarjeta dentro de Admin Tools > API).
  const main = state.modules.filter((m) => !m.group && !m.hidden);
  const admin = state.modules.filter((m) => m.group === 'admin_tools' && !m.hidden);

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

/** Menú de cuenta: clic/tap en el nombre o avatar de la barra superior. */
function initUserMenu() {
  const wrap = document.getElementById('user-menu-wrap');
  const btn = document.getElementById('user-menu-btn');
  const panel = document.getElementById('user-menu-panel');
  let open = false;

  const openMenu = () => { open = true; panel.classList.remove('hidden'); };
  const closeMenu = () => { open = false; panel.classList.add('hidden'); };
  btn.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  document.addEventListener('click', (e) => {
    if (open && !wrap.contains(e.target)) closeMenu();
  });
  panel.querySelectorAll('[data-close-menu]').forEach((a) => a.addEventListener('click', closeMenu));
}

function initRefreshButton() {
  document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
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

/** Devuelve el registro del service worker (o null), para que initNotificationBell()
 *  sepa si hay dónde suscribirse a notificaciones push. */
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

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const NOTIF_TYPE_META = {
  '#/tareas':     { icon: 'check-square', cls: 'bg-indigo-50 text-indigo-600' },
  '#/calendario': { icon: 'calendar',     cls: 'bg-sky-50 text-sky-600' },
  '#/pizarron':   { icon: 'clipboard',    cls: 'bg-violet-50 text-violet-600' },
};

/**
 * Campanita unificada de la barra superior: mensajes de WhatsApp sin leer +
 * notificaciones generales (tarea completada, cita asignada/cancelada, nuevo en
 * el pizarrón público — ver includes/webpush.php), sin importar en qué módulo
 * esté el usuario. Se sondea el total de no leídos (barato, sin traer el detalle)
 * y solo suena/avisa cuando el número sube respecto a la última vez; la campanita
 * en cambio siempre refleja el total actual, suba o baje. También ofrece activar
 * las notificaciones push del navegador desde el propio panel, en vez de un botón
 * aparte en la barra superior.
 */
const NOTIF_POLL_MS = 20000;
let waUnreadPrev = null;
let notifUnreadPrev = null;
let notifPanelOpen = false;

function initNotificationBell(swReg) {
  const wrap = document.getElementById('notif-bell-wrap');
  const btn = document.getElementById('notif-bell-btn');
  const badge = document.getElementById('notif-bell-badge');
  const panel = document.getElementById('notif-bell-panel');
  const hasWhatsapp = state.modules.some((m) => m.key === 'whatsapp');
  wrap.classList.remove('hidden');

  const renderBadge = (total) => {
    badge.textContent = total > 9 ? '9+' : String(total);
    badge.classList.toggle('hidden', total === 0);
    badge.classList.toggle('flex', total > 0);
  };

  /** Aviso para activar push, solo cuando de verdad tiene sentido ofrecerlo (hay
   *  soporte, no está ya suscrito, y el permiso no quedó denegado antes — en ese
   *  caso solo se arregla desde los ajustes del navegador, insistir aquí no sirve). */
  const pushBannerHtml = async () => {
    if (!swReg || !('PushManager' in window) || !('Notification' in window)) return '';
    const sub = await swReg.pushManager.getSubscription();
    if (sub || Notification.permission === 'denied') return '';
    return `
      <button id="notif-enable-push" type="button"
              class="mb-1 flex w-full items-center gap-2.5 rounded-lg bg-indigo-50 px-3 py-2.5 text-left hover:bg-indigo-100">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">${icon('send', 'h-4 w-4')}</span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-indigo-900">Activar notificaciones</span>
          <span class="block text-xs text-indigo-600">Avisa aunque Sirius esté cerrado</span>
        </span>
      </button>`;
  };

  const enablePush = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Sin permiso de notificaciones, no se pudieron activar.', 'error');
        return;
      }
      const { key } = await apiGet('push/vapid_key');
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await apiPost('push/subscribe', sub.toJSON());
      toast('Notificaciones activadas');
      await renderPanel();
    } catch (e) {
      console.error('push subscribe:', e);
      toast('No se pudieron activar las notificaciones', 'error');
    }
  };

  const waSectionHtml = (conversations) => !conversations.length ? '' : `
      <div class="flex items-center gap-2 border-b border-slate-100 px-3 pb-2 pt-1">
        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">${icon('chat', 'h-3.5 w-3.5')}</span>
        <div class="min-w-0">
          <p class="text-xs font-bold uppercase tracking-wide text-slate-400">WhatsApp</p>
          <p class="text-sm font-semibold text-slate-800">Mensajes sin leer</p>
        </div>
      </div>
      <div class="mb-1">
        ${conversations.map((c) => `
        <a href="#/whatsapp/${c.id}" data-bell-close class="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(c.contact_name || c.wa_id)}</p>
              <span class="shrink-0 text-[11px] text-slate-400">${fmtRelative(c.last_message_at)}</span>
            </div>
            <div class="mt-0.5 flex items-center justify-between gap-2">
              <p class="min-w-0 flex-1 truncate text-xs text-slate-500">${escapeHtml(c.preview)}</p>
              <span class="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">${c.unread_count}</span>
            </div>
          </div>
        </a>`).join('')}
      </div>`;

  const notifRowHtml = (n) => {
    const key = Object.keys(NOTIF_TYPE_META).find((k) => (n.url || '').startsWith(k));
    const meta = NOTIF_TYPE_META[key] || { icon: 'file-text', cls: 'bg-slate-100 text-slate-500' };
    const unread = !n.read_at;
    return `
      <a href="${n.url || '#/dashboard'}" data-notif-id="${n.id}" data-bell-close
         class="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 ${unread ? '' : 'opacity-60'}">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.cls}">${icon(meta.icon, 'h-4 w-4')}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(n.title)}</p>
            ${unread ? '<span class="h-2 w-2 shrink-0 rounded-full bg-indigo-600"></span>' : ''}
          </div>
          ${n.body ? `<p class="mt-0.5 truncate text-xs text-slate-500">${escapeHtml(n.body)}</p>` : ''}
          <p class="mt-0.5 text-[11px] text-slate-400">${fmtRelative(n.created_at)}</p>
        </div>
      </a>`;
  };

  const renderPanel = async () => {
    panel.innerHTML = `<p class="p-3 text-center text-sm text-slate-400">Cargando…</p>`;
    let conversations = [];
    let notifs = [];
    try {
      const calls = [apiGet('push/list')];
      if (hasWhatsapp) calls.push(apiGet('whatsapp/unread_list'));
      const results = await Promise.all(calls);
      notifs = results[0].items;
      if (hasWhatsapp) conversations = results[1].conversations;
    } catch {
      panel.innerHTML = `<p class="p-3 text-center text-sm text-slate-400">No se pudo cargar</p>`;
      return;
    }
    const banner = await pushBannerHtml();
    const empty = !conversations.length && !notifs.length;
    panel.innerHTML = banner
      + (empty ? `<p class="p-3 text-center text-sm text-slate-400">Sin notificaciones</p>` : '')
      + `<div class="max-h-80 overflow-y-auto">${waSectionHtml(conversations)}${notifs.map(notifRowHtml).join('')}</div>`;

    panel.querySelector('#notif-enable-push')?.addEventListener('click', enablePush);
    panel.querySelectorAll('[data-notif-id]').forEach((a) => {
      a.addEventListener('click', () => apiPost('push/mark_read', { id: Number(a.dataset.notifId) }).catch(() => {}));
    });
    panel.querySelectorAll('[data-bell-close]').forEach((a) => a.addEventListener('click', closePanel));
  };

  const openPanel = async () => {
    notifPanelOpen = true;
    panel.classList.remove('hidden');
    // Al abrir la campanita se dan por vistas las notificaciones push (no los mensajes
    // de WhatsApp sin leer — esos siguen su propio criterio de leído, el mismo que ya
    // usa el módulo de WhatsApp, para no desincronizarlo con solo pasar por aquí).
    if ((notifUnreadPrev ?? 0) > 0) {
      try { await apiPost('push/mark_all_read', {}); } catch { /* red intermitente: el próximo sondeo lo corrige */ }
      notifUnreadPrev = 0;
      renderBadge((waUnreadPrev ?? 0) + notifUnreadPrev);
    }
    renderPanel();
  };
  const closePanel = () => {
    notifPanelOpen = false;
    panel.classList.add('hidden');
  };

  btn.addEventListener('click', () => (notifPanelOpen ? closePanel() : openPanel()));
  document.addEventListener('click', (e) => {
    if (notifPanelOpen && !wrap.contains(e.target)) closePanel();
  });

  const check = async () => {
    let waCount = 0;
    let notifCount = 0;
    try {
      const calls = [apiGet('push/unread_count')];
      if (hasWhatsapp) calls.push(apiGet('whatsapp/unread_count'));
      const results = await Promise.all(calls);
      notifCount = results[0].count;
      if (hasWhatsapp) waCount = results[1].count;
    } catch {
      return; // red intermitente o sesión expirada: se reintenta en el próximo sondeo
    }
    renderBadge(waCount + notifCount);

    const waGrew = waUnreadPrev !== null && waCount > waUnreadPrev;
    const notifGrew = notifUnreadPrev !== null && notifCount > notifUnreadPrev;
    if ((waGrew && currentModuleKey() !== 'whatsapp') || notifGrew) {
      playNotificationSound();
      toast(notifGrew ? 'Tienes notificaciones nuevas' : 'Tienes mensajes nuevos de WhatsApp', 'info');
    }
    if (notifPanelOpen && (waGrew || notifGrew)) renderPanel();
    waUnreadPrev = waCount;
    notifUnreadPrev = notifCount;
  };
  check();
  setInterval(check, NOTIF_POLL_MS);
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
