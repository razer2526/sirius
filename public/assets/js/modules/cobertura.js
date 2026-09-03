/**
 * Módulo Cobertura (Admin Tools): togglea qué municipios/alcaldías de CDMX +
 * Estado de México cubre la unidad móvil. Apps > Cobertura (el buscador de
 * código postal que usa atención a clientes) lee esta misma tabla.
 *
 * La cobertura se administra por municipio (es el nivel al que realmente
 * opera el despacho), pero algunos son demasiado grandes para cubrirse
 * completos — por eso cada municipio se puede expandir a su lista de
 * códigos postales y ponerle una excepción a uno en particular (que deja de
 * heredar la cobertura de su municipio). Jerarquía visual: Estado > Municipio
 * > Código postal — colonia.
 */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, confirmDialog, spinner, inputCls, debounce } from '../ui.js';
import { renderCoverageMap } from '../coverage_map.js';

let zones = [];
let expandedGroups = new Set();     // estados abiertos
let expandedMunicipios = new Set(); // ids de zona (municipio/alcaldía) abiertos
let postalCache = new Map();        // zone id -> códigos postales ya cargados

export async function render(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-lg font-bold text-slate-900">Cobertura</h3>
          <p class="text-sm text-slate-500">Municipios/alcaldías de CDMX y Área Metropolitana que cubre la unidad móvil.</p>
        </div>
        <button id="btn-reimport" type="button" class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          ${icon('repeat', 'h-4 w-4')} Reimportar catálogo
        </button>
      </div>

      <div id="cov-map" class="h-64 w-full overflow-hidden rounded-2xl ring-1 ring-slate-200"></div>

      <input id="f-q" type="text" placeholder="Buscar municipio/alcaldía…" autocomplete="off" class="${inputCls}">

      <div id="zone-list">${spinner()}</div>
    </div>`;

  const load = async () => {
    const res = await apiGet('cobertura/zones_list');
    zones = res.zones;
    paintZones(root);
    paintMap(root);
  };

  root.querySelector('#f-q').addEventListener('input', debounce(() => paintZones(root), 150));
  root.querySelector('#btn-reimport').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Reimportar catálogo',
      'Vuelve a leer el catálogo de códigos postales y a geocodificar lo que falte. No cambia las coberturas ya configuradas.',
      { confirmLabel: 'Reimportar' }
    );
    if (!ok) return;
    try {
      const res = await apiPost('cobertura/reimport', {});
      toast((res.log || []).join(' · ') || 'Catálogo actualizado');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  await load();
}

function stateLabel(hasCoverage, extraCost) {
  if (hasCoverage) return 'Con cobertura';
  if (extraCost) return 'Área extendida (costo extra)';
  return 'Sin cobertura';
}

function railColor(hasCoverage, extraCost) {
  if (hasCoverage) return 'bg-emerald-500';
  if (extraCost) return 'bg-amber-500';
  return 'bg-red-500';
}

function paintMap(root) {
  const markers = zones
    .filter((z) => z.latitude != null)
    .map((z) => ({
      lat: z.latitude,
      lng: z.longitude,
      covered: z.has_coverage,
      extraCost: z.extra_cost,
      label: `${escapeHtml(z.municipio)} — ${stateLabel(z.has_coverage, z.extra_cost)}`,
    }));
  renderCoverageMap(root.querySelector('#cov-map'), markers);
}

/** Ciudad de México primero (la sede), luego el resto de estados alfabético. */
function groupByEstado(list) {
  const map = new Map();
  for (const z of list) {
    if (!map.has(z.estado)) map.set(z.estado, []);
    map.get(z.estado).push(z);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === 'Ciudad de México') return -1;
    if (b === 'Ciudad de México') return 1;
    return a.localeCompare(b);
  });
}

/** Un código postal dentro de un municipio expandido: "CP — colonia(s)", con su propia excepción de cobertura. */
function postalRowHtml(zone, p) {
  const isException = p.coverage_override !== null;
  const effectiveCoverage = isException ? p.coverage_override : zone.has_coverage;
  const effectiveExtra = isException ? p.extra_cost : zone.extra_cost;
  const colonias = p.colonias.map((c) => c.nombre).join(', ') || '—';
  return `
    <div class="flex items-center justify-between gap-3 py-2 pr-4 hover:bg-slate-100">
      <span class="min-w-0 flex-1 text-sm text-slate-700">
        <span class="font-mono text-xs text-slate-500">${escapeHtml(p.cp)}</span> — ${escapeHtml(colonias)}
        ${isException ? '<span class="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-600">Excepción</span>' : ''}
      </span>
      <div class="flex shrink-0 items-center gap-3">
        ${!effectiveCoverage ? `
          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" data-pextra="${p.id}" ${effectiveExtra ? 'checked' : ''}
                   class="h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400">
            Área extendida
          </label>` : ''}
        <label class="relative inline-flex h-5 w-9 cursor-pointer rounded-full transition ${railColor(effectiveCoverage, effectiveExtra)}">
          <input type="checkbox" data-ptoggle="${p.id}" ${effectiveCoverage ? 'checked' : ''}
                 aria-label="Cobertura en CP ${escapeHtml(p.cp)}" class="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0">
          <span class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${effectiveCoverage ? 'translate-x-4' : ''}"></span>
        </label>
      </div>
    </div>`;
}

function postalListHtml(z) {
  const list = postalCache.get(z.id);
  if (!list) return `<div class="py-3 pl-1">${spinner()}</div>`;
  if (!list.length) return '<div class="py-3 text-xs text-slate-400">Sin códigos postales en este municipio.</div>';
  return `<div class="divide-y divide-slate-100">${list.map((p) => postalRowHtml(z, p)).join('')}</div>`;
}

function zoneRowHtml(z) {
  const municipioOpen = expandedMunicipios.has(z.id);
  return `
    <div>
      <div class="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
        <button type="button" data-expand-zone="${z.id}" class="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span class="shrink-0 transition-transform ${municipioOpen ? '-rotate-90' : 'rotate-180'}">${icon('chevron-left', 'h-3.5 w-3.5 text-slate-300')}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-slate-800">${escapeHtml(z.municipio)}</span>
            <span class="block text-xs ${z.latitude == null ? 'text-amber-500' : 'text-slate-400'}">${z.latitude == null ? 'Sin geocodificar todavía' : `${z.postal_count} código(s) postal(es)`}</span>
          </span>
        </button>
        <div class="flex shrink-0 items-center gap-3">
          ${!z.has_coverage ? `
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" data-extra="${z.id}" ${z.extra_cost ? 'checked' : ''}
                     class="h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400">
              Área extendida
            </label>` : ''}
          <label class="relative inline-flex h-6 w-11 cursor-pointer rounded-full transition ${railColor(z.has_coverage, z.extra_cost)}">
            <input type="checkbox" data-toggle="${z.id}" ${z.has_coverage ? 'checked' : ''}
                   aria-label="Cobertura en ${escapeHtml(z.municipio)}" class="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0">
            <span class="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${z.has_coverage ? 'translate-x-5' : ''}"></span>
          </label>
        </div>
      </div>
      <div class="${municipioOpen ? '' : 'hidden'} border-t border-slate-100 bg-slate-50/60 pl-9">
        ${municipioOpen ? postalListHtml(z) : ''}
      </div>
    </div>`;
}

function paintZones(root) {
  const box = root.querySelector('#zone-list');
  const q = root.querySelector('#f-q').value.trim().toLowerCase();
  const filtered = q
    ? zones.filter((z) => z.municipio.toLowerCase().includes(q) || z.estado.toLowerCase().includes(q))
    : zones;

  if (!filtered.length) {
    box.innerHTML = '<div class="rounded-2xl bg-white py-10 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">Sin resultados.</div>';
    return;
  }

  // Mientras se busca, los grupos con coincidencias se abren solos — si no, la
  // búsqueda parecería no encontrar nada dentro de un acordeón cerrado.
  const groups = groupByEstado(filtered);
  box.innerHTML = groups.map(([estado, list]) => {
    const isOpen = q ? true : expandedGroups.has(estado);
    const covered = list.filter((z) => z.has_coverage).length;
    return `
      <div class="mb-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <button type="button" data-group="${escapeHtml(estado)}"
                class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
          <span class="flex items-center gap-2">
            <span class="transition-transform ${isOpen ? '-rotate-90' : 'rotate-180'}">${icon('chevron-left', 'h-4 w-4 text-slate-400')}</span>
            <span class="text-sm font-semibold text-slate-800">${escapeHtml(estado)}</span>
            <span class="text-xs text-slate-400">(${list.length})</span>
          </span>
          <span class="text-xs font-medium text-slate-500">${covered}/${list.length} con cobertura</span>
        </button>
        <div class="${isOpen ? '' : 'hidden'} divide-y divide-slate-100 border-t border-slate-100">
          ${list.map((z) => zoneRowHtml(z)).join('')}
        </div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-group]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.group;
      if (expandedGroups.has(key)) expandedGroups.delete(key);
      else expandedGroups.add(key);
      paintZones(root);
    }));

  box.querySelectorAll('[data-expand-zone]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = +btn.dataset.expandZone;
      if (expandedMunicipios.has(id)) {
        expandedMunicipios.delete(id);
        paintZones(root);
        return;
      }
      expandedMunicipios.add(id);
      paintZones(root);
      if (!postalCache.has(id)) {
        try {
          const res = await apiGet('cobertura/postal_list', { zone_id: id });
          postalCache.set(id, res.postal_codes);
          paintZones(root);
        } catch (e) {
          toast(e.message, 'error');
          expandedMunicipios.delete(id);
          paintZones(root);
        }
      }
    }));

  box.querySelectorAll('[data-toggle]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      const id = +cb.dataset.toggle;
      const zone = zones.find((z) => z.id === id);
      cb.disabled = true;
      try {
        const res = await apiPost('cobertura/zones_toggle', { id });
        zone.has_coverage = res.has_coverage;
        zone.extra_cost = res.extra_cost;
        paintZones(root);
        paintMap(root);
      } catch (e) {
        toast(e.message, 'error');
        cb.disabled = false;
      }
    }));

  box.querySelectorAll('[data-extra]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      const id = +cb.dataset.extra;
      const zone = zones.find((z) => z.id === id);
      cb.disabled = true;
      try {
        const res = await apiPost('cobertura/zones_set_extra_cost', { id, extra_cost: cb.checked });
        zone.extra_cost = res.extra_cost;
        paintZones(root);
        paintMap(root);
      } catch (e) {
        toast(e.message, 'error');
        cb.disabled = false;
      }
    }));

  box.querySelectorAll('[data-ptoggle]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      const id = +cb.dataset.ptoggle;
      cb.disabled = true;
      try {
        const res = await apiPost('cobertura/postal_toggle', { id });
        updatePostalCache(id, res);
        paintZones(root);
      } catch (e) {
        toast(e.message, 'error');
        cb.disabled = false;
      }
    }));

  box.querySelectorAll('[data-pextra]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      const id = +cb.dataset.pextra;
      cb.disabled = true;
      try {
        const res = await apiPost('cobertura/postal_set_extra_cost', { id, extra_cost: cb.checked });
        updatePostalCache(id, res);
        paintZones(root);
      } catch (e) {
        toast(e.message, 'error');
        cb.disabled = false;
      }
    }));
}

/** Refleja en el caché local la respuesta de postal_toggle/postal_set_extra_cost (coverage_override puede volver a null si la excepción dejó de ser necesaria). */
function updatePostalCache(id, res) {
  for (const list of postalCache.values()) {
    const p = list.find((x) => x.id === id);
    if (p) {
      p.coverage_override = res.coverage_override;
      p.extra_cost = res.coverage_override !== null ? res.extra_cost : null;
      break;
    }
  }
}
