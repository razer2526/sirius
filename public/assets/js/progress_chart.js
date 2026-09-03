/**
 * Gráfica multicapa de progreso (Control de peso): Peso, IMC, Cintura, Cadera
 * y Abdomen en un solo eje. Cada capa se normaliza a % de cambio desde su
 * primer valor disponible — así conviven kg, cm e IMC sin unidad sin pelearse
 * por escalas incompatibles. El valor real (con su unidad) se ve al pasar el
 * cursor sobre cada punto. Ver plan: gráfica multicapa + comparación corporal.
 */

import { escapeHtml, fmtDate } from './ui.js';

/** Serie -> color. Los rieles de los switches son clases literales (no
 *  interpoladas) para que el escaneo de Tailwind las encuentre en el build. */
const SERIES = [
  { key: 'peso_kg', label: 'Peso', unit: 'kg', hex: '#4f46e5', rail: 'bg-indigo-500' },
  { key: 'imc', label: 'IMC', unit: '', hex: '#7c3aed', rail: 'bg-violet-500' },
  { key: 'per_cintura', label: 'Cintura', unit: 'cm', hex: '#0284c7', rail: 'bg-sky-500' },
  { key: 'per_cadera', label: 'Cadera', unit: 'cm', hex: '#059669', rail: 'bg-emerald-500' },
  { key: 'per_abdomen', label: 'Abdomen', unit: 'cm', hex: '#ea580c', rail: 'bg-orange-500' },
];

const DEFAULT_ON = 'peso_kg';

const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/** Puntos {i, label, date, raw, pct} de una serie; baseline = su primer valor no nulo.
 *  Devuelve null si la serie no tiene datos suficientes para trazar una tendencia. */
function seriesPoints(visits, key) {
  const raws = visits.map((v) => numOrNull(v.data[key]));
  if (raws.filter((n) => n !== null).length < 2) return null;
  const baseline = raws.find((n) => n !== null);
  return visits.map((v, i) => {
    const raw = raws[i];
    const pct = raw === null ? null : ((raw - baseline) / baseline) * 100;
    return { i, label: v.label, date: v.date, raw, pct };
  });
}

/** "Bonito" paso de cuadrícula (5/10/20/25/50/100/200/500) según el rango de %. */
function niceStep(range) {
  const candidates = [5, 10, 20, 25, 50, 100, 200, 500];
  return candidates.find((step) => range / step <= 5) || candidates[candidates.length - 1];
}

export function renderProgressChart(visits) {
  const root = document.createElement('div');

  const seriesData = SERIES.map((s) => ({ ...s, points: seriesPoints(visits, s.key) }));
  const available = seriesData.filter((s) => s.points);

  if (!available.length) {
    root.innerHTML = `<p class="py-6 text-center text-xs text-slate-400">
      Aún no hay suficientes registros para graficar (mínimo 2 visitas con este dato).</p>`;
    return root;
  }

  const W = 640;
  const H = 260;
  const PAD_L = 42;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const allPct = available.flatMap((s) => s.points.map((p) => p.pct).filter((p) => p !== null));
  let min = Math.min(...allPct, 0);
  let max = Math.max(...allPct, 0);
  if (min === max) { min -= 5; max += 5; }
  const padPct = (max - min) * 0.1 || 5;
  min -= padPct;
  max += padPct;
  const step = niceStep(max - min);
  const gridMin = Math.floor(min / step) * step;
  const gridMax = Math.ceil(max / step) * step;

  const n = visits.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const x = (i) => PAD_L + i * stepX;
  const y = (pct) => PAD_T + innerH - ((pct - min) / (max - min)) * innerH;

  const gridLines = [];
  for (let g = gridMin; g <= gridMax + step / 2; g += step) {
    const gy = y(g);
    if (gy < PAD_T - 1 || gy > PAD_T + innerH + 1) continue;
    const isZero = Math.abs(g) < step / 1000;
    gridLines.push(`
      <line x1="${PAD_L}" y1="${gy.toFixed(1)}" x2="${W - PAD_R}" y2="${gy.toFixed(1)}"
            stroke="${isZero ? '#cbd5e1' : '#f1f5f9'}" stroke-width="1"/>
      <text x="${PAD_L - 6}" y="${(gy + 3).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="end">${g > 0 ? '+' : ''}${Math.round(g)}%</text>`);
  }

  const xLabels = visits.map((v, i) => `
    <text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#94a3b8" text-anchor="middle">${escapeHtml(v.label)}</text>`);

  const seriesGroups = available.map((s) => {
    let d = '';
    let started = false;
    s.points.forEach((p) => {
      if (p.pct === null) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.pct).toFixed(1)} `;
      started = true;
    });
    const dots = s.points.filter((p) => p.pct !== null).map((p) => `
      <circle cx="${x(p.i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="3.5" fill="${s.hex}">
        <title>${fmtDate(p.date)}: ${p.raw}${s.unit ? ' ' + s.unit : ''}</title>
      </circle>`).join('');
    return `
      <g data-series-group="${s.key}" class="${s.key === DEFAULT_ON ? '' : 'hidden'}">
        <path d="${d.trim()}" fill="none" stroke="${s.hex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </g>`;
  }).join('');

  root.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="h-56 w-full">
      ${gridLines.join('')}
      ${seriesGroups}
      ${xLabels.join('')}
    </svg>
    <div class="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
      ${seriesData.map((s) => switchRowHtml(s)).join('')}
    </div>`;

  wireSwitches(root, seriesData);
  return root;
}

function switchRowHtml(s) {
  if (!s.points) {
    return `
      <div class="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 opacity-40">
        <span class="min-w-0 flex-1 text-sm text-slate-700">${escapeHtml(s.label)}</span>
        <span class="text-xs text-slate-400">Sin datos suficientes</span>
      </div>`;
  }
  const on = s.key === DEFAULT_ON;
  return `
    <label class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <span class="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-700">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:${s.hex}"></span>
        ${escapeHtml(s.label)}
      </span>
      <span data-rail="${s.key}" class="relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${on ? s.rail : 'bg-slate-200'}">
        <input type="checkbox" data-series-toggle="${s.key}" ${on ? 'checked' : ''}
               aria-label="${escapeHtml(s.label)}" class="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0">
        <span data-knob="${s.key}" class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}"></span>
      </span>
    </label>`;
}

function wireSwitches(root, seriesData) {
  root.querySelectorAll('[data-series-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.seriesToggle;
      const s = seriesData.find((x) => x.key === key);
      root.querySelector(`[data-series-group="${key}"]`)?.classList.toggle('hidden', !cb.checked);
      root.querySelector(`[data-knob="${key}"]`)?.classList.toggle('translate-x-4', cb.checked);
      const rail = root.querySelector(`[data-rail="${key}"]`);
      rail?.classList.toggle(s.rail, cb.checked);
      rail?.classList.toggle('bg-slate-200', !cb.checked);
    });
  });
}
