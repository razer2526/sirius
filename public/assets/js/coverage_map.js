/**
 * Envoltura mínima de Leaflet + tiles de OpenStreetMap para Cobertura —
 * primera librería externa de este proyecto (todo lo demás está hecho a
 * mano; se acepta la excepción porque reconstruir un mapa interactivo a mano
 * no tiene sentido). Se carga una sola vez (promesa cacheada a nivel de
 * módulo) sin importar cuántas veces se monte un mapa en la sesión.
 *
 * El contenedor que se le pase a renderCoverageMap() debe tener ya una
 * altura fija por CSS (p. ej. clase `h-64`) — Leaflet no calcula alto propio.
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.js`;
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.css`;

const CDMX_CENTER = [19.4326, -99.1332];
const COLOR_ON = '#16a34a';    // verde: cobertura completa
const COLOR_EXTRA = '#d97706'; // ámbar: área extendida / costo extra
const COLOR_OFF = '#dc2626';   // rojo: sin cobertura

function markerColor(m) {
  if (m.covered) return COLOR_ON;
  if (m.extraCost) return COLOR_EXTRA;
  return COLOR_OFF;
}

let loadPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('No se pudo cargar el mapa.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Crea (o vuelve a pintar) un mapa Leaflet dentro de `container` con un
 * CircleMarker por elemento de `markers`: [{lat, lng, label, covered, extraCost}]
 * (extraCost solo importa cuando covered es false: verde/ámbar/rojo).
 * Reutilizable: si el contenedor ya tenía un mapa, lo destruye primero (evita
 * el error de Leaflet "Map container is already initialized").
 */
export async function renderCoverageMap(container, markers) {
  const L = await loadLeaflet();
  // Leaflet.css pone position:relative en el contenedor pero sin z-index propio,
  // así que sus panes internos (z-index 400+) no quedan contenidos en un nuevo
  // stacking context: escapan y se comparan contra el resto de la página, por
  // encima del sidebar (z-40) o de cualquier modal. Fijar z-index aquí sí crea
  // ese contexto y deja todo lo de Leaflet encerrado dentro del contenedor.
  container.style.position = 'relative';
  container.style.zIndex = '0';
  if (container._coverageMap) {
    container._coverageMap.remove();
    container._coverageMap = null;
  }
  container.innerHTML = '';

  const withCoords = markers.filter((m) => m.lat != null && m.lng != null);
  const center = withCoords.length ? [withCoords[0].lat, withCoords[0].lng] : CDMX_CENTER;
  const map = L.map(container).setView(center, withCoords.length === 1 ? 13 : 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  withCoords.forEach((m) => {
    const color = markerColor(m);
    L.circleMarker([m.lat, m.lng], {
      radius: 10,
      color,
      fillColor: color,
      fillOpacity: 0.6,
      weight: 2,
    }).addTo(map).bindPopup(m.label);
  });

  container._coverageMap = map;
  return map;
}
