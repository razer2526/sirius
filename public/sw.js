/**
 * Service worker de Sirius.
 * - Shell (CSS/JS/fuentes/iconos): cache-first, versionado.
 * - Navegación: network-first con fallback a offline.html.
 * - /api/, login.php, print.php: network-only — datos clínicos JAMÁS se cachean.
 * En cada deploy, subir la versión del cache.
 */
const CACHE = 'sirius-shell-v27';

const SHELL = [
  'offline.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/fonts/fonts.css',
  'assets/fonts/inter-v20-latin-regular.woff2',
  'assets/fonts/inter-v20-latin-500.woff2',
  'assets/fonts/inter-v20-latin-600.woff2',
  'assets/fonts/inter-v20-latin-700.woff2',
  'assets/img/icons/favicon.svg',
  'assets/img/icons/icon-192.png',
  'assets/img/icons/icon-512.png',
  'assets/js/app.js',
  'assets/js/api.js',
  'assets/js/router.js',
  'assets/js/ui.js',
  'assets/js/services.js',
  'assets/js/services_catalog.json',
  'assets/js/forms.js',
  'assets/js/assistant.js',
  'assets/js/modules/dashboard.js',
  'assets/js/modules/admision.js',
  'assets/js/modules/wizard_admision.js',
  'assets/js/modules/expedientes.js',
  'assets/js/modules/usuarios.js',
  'assets/js/modules/tareas.js',
  'assets/js/modules/inventario.js',
  'assets/js/modules/pizarron.js',
  'assets/js/modules/archivos.js',
  'assets/js/modules/calendario.js',
  'assets/js/modules/whatsapp.js',
  'assets/js/modules/whatsapp_config.js',
  'assets/js/modules/apps.js',
  'assets/js/modules/membretes.js',
  'assets/js/modules/log.js',
  'assets/js/modules/backup.js',
  'assets/js/modules/api.js',
  'assets/js/modules/catalogo_estudios.js',
  'assets/js/modules/vinculacion.js',
  'assets/js/modules/plantillas_estudios.js',
  'assets/js/doc_templates.json',
  'assets/js/outbox.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  // Datos y autenticación: siempre red, nunca cache.
  if (path.includes('/api/') || path.endsWith('login.php') || path.endsWith('logout.php')
      || path.endsWith('print.php') || path.endsWith('documento.php') || path.endsWith('cotizacion.php')
      || path.endsWith('comision.php')
      || path.endsWith('documento_expediente.php') || path.endsWith('membrete_prueba.php')
      || path.endsWith('respaldo.php') || path.endsWith('archivo.php')
      || path.endsWith('whatsapp_webhook.php')
      || path.includes('/install/') || path.includes('/uploads/')) {
    return;
  }

  // Navegación (index.php): network-first con fallback offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('offline.html'))
    );
    return;
  }

  // Assets del shell: cache-first.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});

/**
 * Background Sync: refuerzo del outbox del wizard para cuando el sistema
 * operativo recupera señal con la app cerrada. El listener de 'online' en
 * outbox.js (primer plano) sigue siendo la vía principal; esto solo cubre el
 * caso en que nadie tiene la app abierta cuando vuelve la conexión.
 */
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-wizard-outbox') {
    e.waitUntil(flushWizardOutbox());
  }
});

/**
 * Duplica el CRUD de outbox.js en vez de importarlo: este archivo se registra
 * como service worker clásico (sin `type: module`), así que no puede compartir
 * el módulo ES de la página. Debe seguir exactamente el mismo esquema de
 * IndexedDB (sirius-wizard-outbox / pending) que outbox.js.
 */
function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sirius-wizard-outbox', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('pending', { keyPath: 'client_uuid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushWizardOutbox() {
  const db = await openOutboxDb();
  const all = await promisifyRequest(db.transaction('pending', 'readonly').objectStore('pending').getAll());
  const toRetry = all.filter((r) => !r.failed);
  if (!toRetry.length) return;

  // El token CSRF vive en la sesión del servidor, no en una variable de JS que
  // el service worker pudiera heredar de la página; se pide aquí con la cookie
  // de sesión que el navegador ya envía sola en peticiones del mismo origen.
  let csrf;
  try {
    const sessionRes = await fetch('api/index.php?r=auth%2Fsession', { credentials: 'same-origin' });
    const session = await sessionRes.json();
    csrf = session?.data?.csrf;
  } catch {
    return; // sin señal real todavía: se reintenta en el próximo 'sync'
  }
  if (!csrf) return; // sesión expirada: se resuelve cuando alguien abra la app y vuelva a entrar

  for (const rec of toRetry) {
    try {
      const res = await fetch('api/index.php?r=episodes%2Fcreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ ...rec.payload, client_uuid: rec.client_uuid }),
        credentials: 'same-origin',
      });
      const json = await res.json();
      const tx = db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      if (json.ok) {
        await promisifyRequest(store.delete(rec.client_uuid));
      } else {
        // El servidor respondió y rechazó la captura: reintentarla a ciegas no
        // lo arregla. Se marca para que alguien la revise, igual que en outbox.js.
        const fresh = await promisifyRequest(store.get(rec.client_uuid));
        if (fresh) await promisifyRequest(store.put({ ...fresh, failed: true, error: json.error || 'Error del servidor' }));
      }
    } catch {
      // Sigue sin señal real pese a lo que creyó el sistema operativo: se deja
      // en la cola para el próximo 'sync'.
    }
  }
}
