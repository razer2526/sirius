/**
 * Suscripción push de este dispositivo. Vive aparte de app.js para poder probarse con un
 * service worker simulado: la entrega real a un teléfono o a Windows no se puede reproducir
 * desde un entorno de desarrollo, pero esta lógica de cliente sí.
 */

import { apiGet, apiPost } from './api.js';
import { escapeHtml } from './ui.js';

export function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Mantiene sana la suscripción push de ESTE dispositivo. Antes solo se creaba al pulsar
 * "Activar notificaciones", y esa opción desaparece en cuanto el navegador ya tiene una, así
 * que nada la reparaba nunca. Se ejecuta en cada inicio, y solo con el permiso ya concedido
 * (nunca pregunta): suscribir de nuevo con el permiso dado no muestra ningún aviso.
 *
 *  - Reenvía la suscripción a push/subscribe (es un upsert): repone la fila si el servidor la
 *    borró, y en un equipo compartido la pasa a quien tiene la sesión ahora, para que los
 *    avisos del turno siguiente sí despierten el equipo.
 *  - Si la suscripción caducó (permiso concedido pero sin suscripción), crea otra.
 *  - Si la llave VAPID del servidor ya no es la de la suscripción, la da de baja y crea otra:
 *    sin eso subscribe() lanza InvalidStateError con una llave distinta.
 *
 * `deps` existe para las pruebas; en la app real se usan los valores por defecto.
 */
export async function syncPushSubscription(swReg, deps = {}) {
  const get = deps.apiGet || apiGet;
  const post = deps.apiPost || apiPost;
  const permission = deps.permission || (() => ('Notification' in window ? Notification.permission : 'denied'));
  if (!swReg || !swReg.pushManager) return 'sin-soporte';
  if (permission() !== 'granted') return 'sin-permiso';
  try {
    const { key } = await get('push/vapid_key');
    const serverKey = urlBase64ToUint8Array(key);
    let sub = await swReg.pushManager.getSubscription();
    let accion = 'reenviada';
    const current = sub && sub.options && sub.options.applicationServerKey;
    if (sub && current) {
      const bytes = new Uint8Array(current);
      const same = bytes.length === serverKey.length && bytes.every((v, i) => v === serverKey[i]);
      if (!same) {
        await sub.unsubscribe();
        sub = null;
        accion = 'llave-cambiada';
      }
    }
    if (!sub) {
      sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
      if (accion === 'reenviada') accion = 'recreada';
    }
    await post('push/subscribe', sub.toJSON());
    return accion;
  } catch (e) {
    // Sin red o sesión a medias: se reintenta en el próximo inicio.
    console.warn('push sync:', e.message || e);
    return 'error';
  }
}

const PUSH_SERVICES = [
  ['fcm.googleapis', 'Google (Chrome / Android)'],
  ['windows.com', 'Microsoft (Edge / Windows)'],
  ['mozilla', 'Firefox'],
  ['apple', 'Apple'],
];

/** Qué significa el código con que respondió el servicio de push, dicho para quien lo lee. */
export function pushVerdict(code) {
  if (code >= 200 && code < 300) return { ok: true, text: 'entregada al servicio de push' };
  if (code === 404 || code === 410) return { ok: false, text: 'suscripción vencida; se crea de nuevo al abrir Sirius' };
  if (code === 403) return { ok: false, text: 'llave rechazada; se crea de nuevo al abrir Sirius' };
  if (code === 0) return { ok: false, text: 'sin conexión con el servicio de push' };
  return { ok: false, text: `error ${code}` };
}

/** HTML del resultado de push/test: una línea por dispositivo, con el veredicto de cada uno. */
export function pushTestResultHtml(r) {
  const service = (host) => (PUSH_SERVICES.find(([needle]) => host.includes(needle)) || [null, host])[1];
  const rows = r.devices.map((d) => {
    const v = pushVerdict(d.code);
    return `<p class="${v.ok ? 'text-emerald-700' : 'text-red-600'}"><span class="font-semibold">${d.mine ? 'Este dispositivo' : 'Otro dispositivo'}</span> · ${escapeHtml(service(d.host))}: ${v.text}</p>`;
  });
  if (!r.this_device_registered) {
    rows.unshift('<p class="text-red-600"><span class="font-semibold">Este navegador no está registrado en el servidor.</span> Recarga Sirius e inténtalo de nuevo.</p>');
  }
  if (!r.devices.length) rows.push('<p class="text-slate-500">No hay dispositivos registrados.</p>');
  rows.push('<p class="pt-1 text-slate-400">Si dice "entregada" y el aviso no aparece en unos segundos, revisa el ahorro de batería, el asistente de concentración de Windows o que el navegador pueda seguir en segundo plano.</p>');
  return rows.join('');
}

/**
 * Al cerrar sesión se da de baja en el servidor la fila de ESTE dispositivo, para que quien
 * use el equipo después no herede los avisos del anterior (el service worker igual no le
 * mostraría su contenido, pero el equipo seguiría despertándose por los de otra persona).
 * La suscripción del navegador se conserva: el próximo inicio de sesión la registra a nombre
 * de quien entre. Si algo falla o tarda, la sesión se cierra igual (máx. 1.5 s de espera).
 */
export function initLogoutUnsubscribe(swReg, deps = {}) {
  const post = deps.apiPost || apiPost;
  const navigate = deps.navigate || ((href) => { window.location.href = href; });
  const link = (deps.root || document).querySelector('a[href="logout.php"]');
  if (!link || !swReg || !swReg.pushManager) return;
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const sub = await swReg.pushManager.getSubscription();
      if (sub) {
        await Promise.race([
          post('push/unsubscribe', { endpoint: sub.endpoint }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    } catch { /* se cierra la sesión de todos modos */ }
    navigate(link.href);
  });
}
