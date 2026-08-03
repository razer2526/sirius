/**
 * Service worker de Sirius.
 * - Shell (CSS/JS/fuentes/iconos): cache-first, versionado.
 * - Navegación: network-first con fallback a offline.html.
 * - /api/, login.php, print.php: network-only — datos clínicos JAMÁS se cachean.
 * En cada deploy, subir la versión del cache.
 */
const CACHE = 'sirius-shell-v20';

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
  'assets/js/modules/expedientes.js',
  'assets/js/modules/usuarios.js',
  'assets/js/modules/tareas.js',
  'assets/js/modules/inventario.js',
  'assets/js/modules/pizarron.js',
  'assets/js/modules/archivos.js',
  'assets/js/modules/calendario.js',
  'assets/js/modules/apps.js',
  'assets/js/modules/membretes.js',
  'assets/js/modules/log.js',
  'assets/js/modules/backup.js',
  'assets/js/modules/api.js',
  'assets/js/modules/catalogo_estudios.js',
  'assets/js/doc_templates.json',
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
      || path.endsWith('documento_expediente.php') || path.endsWith('membrete_prueba.php')
      || path.endsWith('respaldo.php') || path.endsWith('archivo.php')
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
