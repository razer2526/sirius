/**
 * Gráfica de evolución del paciente (Control de peso): una métrica a la vez, en
 * su unidad real. Antes todo se normalizaba a "% de cambio" para poder apilar
 * kilos con centímetros en un solo eje; se leía bien para quien ya sabía qué
 * estaba viendo, pero es justo lo que no se le puede explicar a un paciente.
 * Ahora el eje dice kg y el punto dice 86.4.
 *
 * El eje X va proporcional al tiempo real, no al número de consulta: dos visitas
 * separadas por seis meses no pueden dibujar la misma pendiente que dos separadas
 * por una semana.
 *
 * Devuelve HTML (string), no nodos: el módulo Expedientes reconstruye su panel
 * con innerHTML en cada cambio de pestaña, así que un nodo montado a mano se
 * perdería. Quien la usa cablea el <select> con progressChartBodyHtml().
 */

import { escapeHtml, fmtDate, parseLocal } from './ui.js';

/**
 * Cómo se presenta cada métrica. Es una tabla literal a propósito: el catálogo
 * no tiene campo de unidad y la mete dentro de la etiqueta de forma dispareja
 * ("Peso (kg)", "Cintura (cm) — punto más estrecho…", y toda la plicometría sin
 * unidad porque los mm están en el título de la sección). Derivarla por prefijo
 * falla justo donde importa: bio_edad_metabolica son años y bio_grasa_visceral
 * es un índice sin unidad.
 *
 * minSpan = rango mínimo del eje Y. Sin él, una métrica que no se movió (mismo
 * peso en dos visitas, grasa visceral 9 y 9) da rango cero, y un rango cero
 * deja el paso de la cuadrícula en cero: el ciclo que dibuja las líneas no
 * avanzaría nunca y colgaría la pestaña.
 */
const DISPLAY = {
  peso_kg:            { short: 'Peso',                unit: 'kg',    decimals: 1, minSpan: 2 },
  imc:                { short: 'IMC',                 unit: '',      decimals: 1, minSpan: 1 },
  per_cintura:        { short: 'Cintura',             unit: 'cm',    decimals: 1, minSpan: 2 },
  per_cadera:         { short: 'Cadera',              unit: 'cm',    decimals: 1, minSpan: 2 },
  per_cuello:         { short: 'Cuello',              unit: 'cm',    decimals: 1, minSpan: 2 },
  per_torax:          { short: 'Tórax',               unit: 'cm',    decimals: 1, minSpan: 2 },
  per_brazo_rel:      { short: 'Brazo relajado',      unit: 'cm',    decimals: 1, minSpan: 2 },
  per_brazo_con:      { short: 'Brazo contraído',     unit: 'cm',    decimals: 1, minSpan: 2 },
  per_antebrazo:      { short: 'Antebrazo',           unit: 'cm',    decimals: 1, minSpan: 2 },
  per_muneca:         { short: 'Muñeca',              unit: 'cm',    decimals: 1, minSpan: 1 },
  per_abdomen:        { short: 'Abdomen',             unit: 'cm',    decimals: 1, minSpan: 2 },
  per_muslo:          { short: 'Muslo',               unit: 'cm',    decimals: 1, minSpan: 2 },
  per_pantorrilla:    { short: 'Pantorrilla',         unit: 'cm',    decimals: 1, minSpan: 2 },
  icc:                { short: 'ICC cintura-cadera',  unit: '',      decimals: 2, minSpan: 0.1 },
  ice:                { short: 'ICE cintura-estatura', unit: '',     decimals: 2, minSpan: 0.1 },
  pli_triceps:        { short: 'Pliegue tríceps',     unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_biceps:         { short: 'Pliegue bíceps',      unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_subescapular:   { short: 'Pliegue subescapular', unit: 'mm',   decimals: 1, minSpan: 2 },
  pli_suprailiaco:    { short: 'Pliegue suprailiaco', unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_abdominal:      { short: 'Pliegue abdominal',   unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_muslo:          { short: 'Pliegue muslo',       unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_pantorrilla:    { short: 'Pliegue pantorrilla', unit: 'mm',    decimals: 1, minSpan: 2 },
  pli_sumatoria:      { short: 'Sumatoria de pliegues', unit: 'mm',  decimals: 1, minSpan: 5 },
  bio_grasa_pct:      { short: 'Grasa corporal',      unit: '%',     decimals: 1, minSpan: 2 },
  bio_masa_grasa:     { short: 'Masa grasa',          unit: 'kg',    decimals: 1, minSpan: 2 },
  bio_masa_muscular:  { short: 'Masa muscular',       unit: 'kg',    decimals: 1, minSpan: 2 },
  bio_agua:           { short: 'Agua total (TBW)',    unit: '',      decimals: 1, minSpan: 2 },
  bio_grasa_visceral: { short: 'Grasa visceral',      unit: '',      decimals: 0, minSpan: 2 },
  bio_edad_metabolica: { short: 'Edad metabólica',    unit: 'años',  decimals: 0, minSpan: 2 },
  sv_fc:              { short: 'Frecuencia cardiaca', unit: 'lpm',   decimals: 0, minSpan: 5 },
  sv_spo2:            { short: 'SpO2',                unit: '%',     decimals: 0, minSpan: 2 },
  sv_glucosa:         { short: 'Glucosa',             unit: 'mg/dL', decimals: 0, minSpan: 10 },
};

const ACCENT = '#4f46e5';

/** Geometría pensada para móvil: a 375 px quedan ~303 px útiles, y un viewBox
 *  ancho encogería la tipografía hasta volverla ilegible. */
const W = 360;
const H = 230;
const PAD_L = 40;
const PAD_R = 14;
const PAD_T = 26;   // espacio para los valores impresos sobre los puntos
const PAD_B = 30;
const innerW = W - PAD_L - PAD_R;
const innerH = H - PAD_T - PAD_B;

const MS_DAY = 86400000;

const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/** Presentación de una métrica; cae a la etiqueta del catálogo si es una clave nueva. */
function display(key, label) {
  const d = DISPLAY[key];
  if (d) return d;
  // Las etiquetas del catálogo traen la explicación pegada con guion largo.
  const short = String(label || key).split('—')[0].trim();
  return { short, unit: '', decimals: 1, minSpan: 1 };
}

/** Etiqueta corta de una métrica, para el <select> y el encabezado. */
export function metricLabel(key, label) {
  return display(key, label).short;
}

const fmtValue = (n, d) => n.toFixed(d.decimals) + (d.unit ? ' ' + d.unit : '');

/**
 * Un renglón por visita, en orden cronológico real. Las visitas sin fecha usable
 * se apartan: un NaN suelto envenena el mínimo y el máximo del eje y dejaría la
 * gráfica entera en blanco por un solo dato mal capturado.
 */
function chartRows(visits, key) {
  const rows = [];
  let undated = 0;
  visits.forEach((v) => {
    const raw = numOrNull(v.data[key]);
    const parsed = v.date ? parseLocal(v.date) : null;
    const t = parsed && !Number.isNaN(parsed.getTime()) ? Math.round(parsed.getTime() / MS_DAY) : null;
    if (t === null) {
      if (raw !== null) undated++;
      return;
    }
    rows.push({ label: v.label, date: v.date, t, raw });
  });
  // La admisión va primero por construcción, pero nada impide que una consulta
  // quede capturada con fecha anterior: con eje temporal eso cruzaría la línea.
  rows.sort((a, b) => a.t - b.t);
  return { rows, undated };
}

/** Paso de cuadrícula "bonito" (1, 2, 2.5, 5, 10 × potencia de 10) para cualquier unidad. */
function niceStep(range, targetLines) {
  if (!(range > 0)) return 0;
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/** Decimales que hacen falta para que dos líneas de cuadrícula no se vean iguales.
 *  Con paso 2.5, redondear a entero imprimiría "10, 13, 15, 18": se ve mal y miente. */
function axisDecimals(step) {
  let d = 0;
  while (d < 3 && Number(step.toFixed(d)) !== step) d++;
  return d;
}

const emptyState = (msg) => `<p class="py-8 text-center text-xs text-slate-400">${escapeHtml(msg)}</p>`;

/**
 * Bloque completo: selector de métrica + cuerpo de la gráfica. El <select> vive
 * FUERA del contenedor que se repinta — si se destruyera dentro de su propio
 * handler, en Chrome las flechas del teclado dejarían de servir (dispara change
 * en cada pulsación) y en móvil se cerraría el picker nativo.
 *
 * @param {Array} visits  [{label, date, data}] de más antigua a más nueva
 * @param {Array} metrics [{key, label, group}] ya filtradas a las que tienen datos
 * @param {string} activeKey
 */
export function progressChartHtml(visits, metrics, activeKey) {
  if (!metrics.length) {
    return emptyState('Aún no hay una medición repetida que graficar: se necesitan al menos dos capturas del mismo dato.');
  }

  const groups = [];
  metrics.forEach((m) => {
    let g = groups.find((x) => x.title === m.group);
    if (!g) groups.push((g = { title: m.group, items: [] }));
    g.items.push(m);
  });

  const selectCls = 'max-w-full rounded-lg border-0 bg-slate-50 px-3 py-1.5 text-sm font-medium '
    + 'text-slate-700 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none';

  const options = groups.map((g) => `
    <optgroup label="${escapeHtml(g.title)}">
      ${g.items.map((m) => `
        <option value="${escapeHtml(m.key)}" ${m.key === activeKey ? 'selected' : ''}>${escapeHtml(metricLabel(m.key, m.label))}</option>`).join('')}
    </optgroup>`).join('');

  const active = metrics.find((m) => m.key === activeKey) || metrics[0];

  return `
    <div class="rounded-xl bg-slate-50 px-4 py-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Evolución</p>
        <select id="progress-metric" aria-label="Métrica a graficar" class="${selectCls}">${options}</select>
      </div>
      <div id="progress-chart-body">${progressChartBodyHtml(visits, active)}</div>
    </div>`;
}

/** Encabezado numérico + SVG de una sola métrica. Se repinta al cambiar el <select>. */
export function progressChartBodyHtml(visits, metric) {
  const d = display(metric.key, metric.label);
  const { rows, undated } = chartRows(visits, metric.key);
  const withValue = rows.filter((r) => r.raw !== null);

  if (withValue.length < 2) {
    return emptyState(`Falta con qué comparar: ${metricLabel(metric.key, metric.label)} tiene ${withValue.length === 1 ? 'una sola captura' : 'capturas'} con fecha en este episodio.`);
  }

  const first = withValue[0];
  const last = withValue[withValue.length - 1];
  const delta = last.raw - first.raw;
  const deltaRounded = +delta.toFixed(d.decimals);
  // En este contexto bajar es mejorar (peso, grasa, pliegues), igual que en las
  // tablas de comparación del mismo panel.
  const deltaCls = deltaRounded === 0 ? 'text-slate-400' : (deltaRounded < 0 ? 'text-emerald-600' : 'text-amber-600');
  const deltaTxt = deltaRounded === 0
    ? 'Sin cambio desde la admisión'
    : `${deltaRounded > 0 ? '+' : ''}${deltaRounded.toFixed(d.decimals)}${d.unit ? ' ' + d.unit : ''} desde la admisión`;

  // --- Eje Y ---
  const values = withValue.map((r) => r.raw);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const spread = hi - lo;
  if (spread < d.minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - d.minSpan / 2;
    hi = mid + d.minSpan / 2;
  } else {
    const pad = spread * 0.12;
    lo -= pad;
    hi += pad;
  }
  // El cero NO se fuerza dentro del rango: un eje de 0 a 92 kg haría invisible
  // una bajada de seis kilos.
  const domain = hi - lo;
  const step = niceStep(domain, 5);
  if (!(step > 0) || !(domain > 0)) return emptyState('No hay variación suficiente para dibujar una escala.');

  const y = (v) => PAD_T + innerH - ((v - lo) / domain) * innerH;

  // --- Eje X: tiempo real, con caída a espaciado por índice ---
  // Admisión y primera sesión el mismo día es frecuentísimo; sin esta caída el
  // span sería 0 y todas las coordenadas saldrían NaN (SVG en blanco, sin error).
  const tMin = rows[0].t;
  const span = rows[rows.length - 1].t - tMin;
  rows.forEach((r, i) => {
    r.x = span > 0
      ? PAD_L + ((r.t - tMin) / span) * innerW
      : PAD_L + (rows.length > 1 ? i / (rows.length - 1) : 0.5) * innerW;
    r.y = r.raw === null ? null : y(r.raw);
  });

  // --- Cuadrícula ---
  // Las líneas caen en múltiplos del paso DENTRO del rango de los datos; el eje
  // no se estira hasta el múltiplo de afuera, que es lo que arrastraría un eje de
  // 20 a 120 cm hasta empezar en cero y aplanar el cambio.
  const axDec = axisDecimals(step);
  const firstLine = Math.ceil(lo / step);
  const lineCount = Math.min(20, Math.floor(hi / step) - firstLine);
  const grid = [];
  for (let k = 0; k <= lineCount; k++) {
    const g = (firstLine + k) * step;   // desde un entero: acumular con += arrastra error flotante
    const gy = y(g);
    grid.push(`
      <line x1="${PAD_L}" y1="${gy.toFixed(1)}" x2="${W - PAD_R}" y2="${gy.toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>
      <text x="${PAD_L - 5}" y="${(gy + 3.5).toFixed(1)}" font-size="12" fill="#94a3b8" text-anchor="end">${g.toFixed(axDec)}</text>`);
  }

  // --- Línea de referencia: dónde empezó ---
  const baseY = y(first.raw);
  const baseline = `
    <line x1="${PAD_L}" y1="${baseY.toFixed(1)}" x2="${W - PAD_R}" y2="${baseY.toFixed(1)}"
          stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"/>`;

  // --- Trazo ---
  // La línea une mediciones reales; no se inventa un punto en las visitas donde
  // ese dato no se capturó (eso sería rellenar hacia adelante). Como el eje X es
  // tiempo, el tramo entre dos mediciones dice justo lo que dice: de este valor
  // en esta fecha a este otro en esta otra.
  const floorY = (PAD_T + innerH).toFixed(1);
  const line = withValue.map((r, i) => `${i ? 'L' : 'M'}${r.x.toFixed(1)} ${r.y.toFixed(1)}`).join(' ');
  const area = `M${withValue[0].x.toFixed(1)} ${floorY} `
    + withValue.map((r) => `L${r.x.toFixed(1)} ${r.y.toFixed(1)}`).join(' ')
    + ` L${withValue[withValue.length - 1].x.toFixed(1)} ${floorY} Z`;
  const paths = `
      <path d="${area}" fill="${ACCENT}" fill-opacity="0.08"/>
      <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

  // --- Puntos y sus valores impresos ---
  // Imprimir el número es obligatorio, no adorno: los <title> de SVG no existen
  // en pantalla táctil, y esta gráfica ya no vive en un modal de escritorio.
  const minRow = withValue.reduce((a, b) => (b.raw < a.raw ? b : a));
  const maxRow = withValue.reduce((a, b) => (b.raw > a.raw ? b : a));
  const labelled = new Set(withValue.length <= 6 ? withValue : [first, last, minRow, maxRow]);

  const dots = withValue.map((r) => {
    let tag = '';
    if (labelled.has(r)) {
      const anchor = r.x <= PAD_L + 12 ? 'start' : (r.x >= W - PAD_R - 12 ? 'end' : 'middle');
      tag = `
        <text x="${r.x.toFixed(1)}" y="${(r.y - 9).toFixed(1)}" font-size="12.5" font-weight="600"
              fill="#334155" text-anchor="${anchor}">${r.raw.toFixed(d.decimals)}</text>`;
    }
    return `
      <circle cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="3.5" fill="${ACCENT}">
        <title>${escapeHtml(r.label)} · ${fmtDate(r.date)}: ${fmtValue(r.raw, d)}</title>
      </circle>${tag}`;
  }).join('');

  // --- Etiquetas del eje X, sin encimarse ---
  const MIN_GAP = 56;
  const xLabels = [];
  let lastX = -Infinity;
  rows.forEach((r, i) => {
    const isEdge = i === 0 || i === rows.length - 1;
    if (!isEdge && r.x - lastX < MIN_GAP) return;
    if (!isEdge && rows[rows.length - 1].x - r.x < MIN_GAP) return;
    const anchor = i === 0 ? 'start' : (i === rows.length - 1 ? 'end' : 'middle');
    xLabels.push(`
      <text x="${r.x.toFixed(1)}" y="${H - 9}" font-size="12" fill="#94a3b8" text-anchor="${anchor}">${escapeHtml(shortDate(r.date))}</text>`);
    lastX = r.x;
  });

  const aria = `${metricLabel(metric.key, metric.label)}: de ${fmtValue(first.raw, d)} el ${fmtDate(first.date)} a ${fmtValue(last.raw, d)} el ${fmtDate(last.date)}`;

  return `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="text-3xl font-bold leading-none text-slate-900">${last.raw.toFixed(d.decimals)}</span>
      ${d.unit ? `<span class="text-sm font-medium text-slate-400">${escapeHtml(d.unit)}</span>` : ''}
      <span class="text-sm font-bold ${deltaCls}">${escapeHtml(deltaTxt)}</span>
    </div>
    <p class="mt-1 text-xs text-slate-400">${escapeHtml(last.label)} · ${fmtDate(last.date)}</p>
    <svg viewBox="0 0 ${W} ${H}" class="mt-2 block h-auto w-full max-w-md" role="img" aria-label="${escapeHtml(aria)}">
      ${grid.join('')}
      ${baseline}
      ${paths}
      ${dots}
      ${xLabels.join('')}
    </svg>
    ${undated ? `<p class="text-xs text-amber-600">${undated} ${undated === 1 ? 'visita sin fecha válida no se grafica' : 'visitas sin fecha válida no se grafican'}.</p>` : ''}`;
}

/** "28 sep" — en el eje no cabe el año, y el año completo va en el tooltip. */
function shortDate(str) {
  const d = parseLocal(str);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).replace('.', '');
}
