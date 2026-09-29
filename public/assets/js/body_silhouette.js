/**
 * La silueta corporal se retiró: era difícil de interpretar y su lugar lo tomó
 * la gráfica de evolución en unidades reales (ver progress_chart.js).
 *
 * Este archivo queda como stub A PROPÓSITO y es temporal. El service worker
 * sirve expedientes.js cache-first, así que un cliente con la PWA instalada
 * sigue ejecutando la versión anterior hasta que actualiza a mano; esa versión
 * importa este archivo de forma estática, y un 404 aquí rompería el grafo de
 * módulos y tumbaría el módulo Expedientes completo, no solo la pestaña.
 *
 * BORRAR en un release posterior, cuando ya no queden clientes con la versión
 * vieja en cache.
 */

export function renderBodySilhouette() {
  return document.createElement('div');
}
