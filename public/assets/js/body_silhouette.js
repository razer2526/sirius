/**
 * Silueta corporal comparativa (Control de peso): un contorno esquemático tipo
 * maniquí (no fotorrealista) que se deforma según las medidas del paciente, y
 * se superpone la de admisión contra la de una visita elegida para ver el
 * cambio de composición corporal de un vistazo. Incluye vista frontal y vista
 * lateral (perfil), cada una con su propio contorno.
 *
 * La referencia es la propia admisión del paciente, no una tabla poblacional:
 * cada punto con medida asociada escala su distancia al eje central por
 * (medida de la visita / medida de admisión); la estatura escala la Y de todo
 * el contorno. Ver plan: gráfica multicapa + comparación corporal.
 */

import { escapeHtml } from './ui.js';

const CX_FRONT = 150;
const CX_SIDE = 42;

/**
 * VISTA FRONTAL — medio cuerpo (lado derecho), de la cabeza al pie, con el
 * brazo y la pierna como una "ida y vuelta" del mismo trazo — técnica
 * estándar de silueta de una sola pieza (tipo gingerbread): el otro lado se
 * genera reflejando esta misma lista (ver scaledPoints). `x` es la
 * separación respecto al eje central, `y` es absoluta en un viewBox de
 * 300x600. `key` es el campo del catálogo (cp_antro) que mueve ese punto en
 * X; null = punto fijo (no medido, solo ayuda a suavizar la curva).
 */
const MALE_HALF = [
  { n: 'head_top', x: 0, y: 14, key: null },
  { n: 'head_R', x: 24, y: 40, key: null },
  { n: 'jaw_R', x: 18, y: 70, key: null },
  { n: 'neck_R', x: 11, y: 90, key: 'per_cuello' },
  { n: 'shoulder_R', x: 44, y: 108, key: null },
  { n: 'bicep_R', x: 50, y: 155, key: 'per_brazo_rel' },
  { n: 'elbow_out_R', x: 46, y: 210, key: 'per_brazo_rel' },
  { n: 'wrist_out_R', x: 42, y: 270, key: 'per_antebrazo' },
  { n: 'hand_R', x: 40, y: 320, key: 'per_antebrazo' },
  { n: 'hand_tip_R', x: 44, y: 355, key: null },
  { n: 'hand_tip_R2', x: 44, y: 355, key: null },
  { n: 'arm_in_R', x: 30, y: 250, key: 'per_antebrazo' },
  { n: 'armpit_R', x: 24, y: 130, key: null },
  { n: 'armpit_R2', x: 24, y: 130, key: null },
  { n: 'chest_R', x: 38, y: 165, key: 'per_torax' },
  { n: 'midtorso_R', x: 33, y: 195, key: null },
  { n: 'waist_R', x: 28, y: 225, key: 'per_cintura' },
  { n: 'abdomen_R', x: 31, y: 250, key: 'per_abdomen' },
  { n: 'hip_R', x: 38, y: 278, key: 'per_cadera' },
  { n: 'upper_thigh_R', x: 36, y: 312, key: null },
  { n: 'thigh_R', x: 34, y: 345, key: 'per_muslo' },
  { n: 'knee_R', x: 24, y: 435, key: null },
  { n: 'calf_R', x: 27, y: 485, key: 'per_pantorrilla' },
  { n: 'ankle_R', x: 17, y: 558, key: null },
  { n: 'foot_R', x: 34, y: 578, key: null },
  { n: 'toe_R', x: 32, y: 592, key: null },
  { n: 'toe_R2', x: 32, y: 592, key: null },
  { n: 'ankle_in_R', x: 9, y: 555, key: null },
  { n: 'knee_in_R', x: 13, y: 430, key: null },
  { n: 'thigh_in_R', x: 20, y: 320, key: 'per_muslo' },
  { n: 'crotch_R', x: 10, y: 296, key: null },
  { n: 'crotch_R2', x: 10, y: 296, key: null },
];

const FEMALE_HALF = [
  { n: 'head_top', x: 0, y: 14, key: null },
  { n: 'head_R', x: 23, y: 40, key: null },
  { n: 'jaw_R', x: 16, y: 68, key: null },
  { n: 'neck_R', x: 9, y: 90, key: 'per_cuello' },
  { n: 'shoulder_R', x: 38, y: 108, key: null },
  { n: 'bicep_R', x: 43, y: 153, key: 'per_brazo_rel' },
  { n: 'elbow_out_R', x: 39, y: 208, key: 'per_brazo_rel' },
  { n: 'wrist_out_R', x: 36, y: 268, key: 'per_antebrazo' },
  { n: 'hand_R', x: 34, y: 318, key: 'per_antebrazo' },
  { n: 'hand_tip_R', x: 38, y: 352, key: null },
  { n: 'hand_tip_R2', x: 38, y: 352, key: null },
  { n: 'arm_in_R', x: 25, y: 248, key: 'per_antebrazo' },
  { n: 'armpit_R', x: 20, y: 128, key: null },
  { n: 'armpit_R2', x: 20, y: 128, key: null },
  { n: 'chest_R', x: 34, y: 165, key: 'per_torax' },
  { n: 'midtorso_R', x: 27, y: 195, key: null },
  { n: 'waist_R', x: 22, y: 225, key: 'per_cintura' },
  { n: 'abdomen_R', x: 25, y: 250, key: 'per_abdomen' },
  { n: 'hip_R', x: 32, y: 278, key: 'per_cadera' },
  { n: 'upper_thigh_R', x: 30, y: 312, key: null },
  { n: 'thigh_R', x: 27, y: 344, key: 'per_muslo' },
  { n: 'knee_R', x: 22, y: 432, key: null },
  { n: 'calf_R', x: 24, y: 482, key: 'per_pantorrilla' },
  { n: 'ankle_R', x: 15, y: 556, key: null },
  { n: 'foot_R', x: 30, y: 576, key: null },
  { n: 'toe_R', x: 28, y: 590, key: null },
  { n: 'toe_R2', x: 28, y: 590, key: null },
  { n: 'ankle_in_R', x: 8, y: 553, key: null },
  { n: 'knee_in_R', x: 12, y: 428, key: null },
  { n: 'thigh_in_R', x: 22, y: 318, key: 'per_muslo' },
  { n: 'crotch_R', x: 11, y: 296, key: null },
  { n: 'crotch_R2', x: 11, y: 296, key: null },
];

/**
 * VISTA LATERAL (perfil) — a diferencia de la frontal, no es simétrica
 * (el pecho/vientre proyectan hacia el frente, los glúteos hacia atrás), así
 * que es una sola lista ya cerrada, sin reflejo: se recorre el frente de
 * pies a cabeza y se regresa por la espalda. `x` es la separación respecto
 * al eje central (positivo = frente, negativo = espalda). El brazo se omite
 * a propósito: colgado junto al cuerpo, solo taparía el torso en perfil.
 */
const SIDE_MALE = [
  { n: 'head_top', x: 2, y: 14, key: null },
  { n: 'forehead', x: 20, y: 40, key: null },
  { n: 'face', x: 22, y: 60, key: null },
  { n: 'chin', x: 14, y: 80, key: null },
  { n: 'neck_front', x: 10, y: 98, key: 'per_cuello' },
  { n: 'chest_front', x: 22, y: 180, key: 'per_torax' },
  { n: 'waist_front', x: 16, y: 236, key: 'per_cintura' },
  { n: 'abdomen_front', x: 22, y: 260, key: 'per_abdomen' },
  { n: 'hip_front', x: 16, y: 292, key: 'per_cadera' },
  { n: 'thigh_front', x: 14, y: 345, key: 'per_muslo' },
  { n: 'knee_front', x: 10, y: 435, key: null },
  { n: 'calf_front', x: 9, y: 485, key: 'per_pantorrilla' },
  { n: 'ankle_front', x: 6, y: 558, key: null },
  { n: 'toe', x: 34, y: 588, key: null },
  { n: 'heel', x: -14, y: 576, key: null },
  { n: 'ankle_back', x: -7, y: 558, key: null },
  { n: 'calf_back', x: -16, y: 485, key: 'per_pantorrilla' },
  { n: 'knee_back', x: -11, y: 435, key: null },
  { n: 'thigh_back', x: -16, y: 345, key: 'per_muslo' },
  { n: 'glute', x: -24, y: 296, key: 'per_cadera' },
  { n: 'waist_back', x: -15, y: 238, key: 'per_cintura' },
  { n: 'midback', x: -12, y: 206, key: null },
  { n: 'upperback', x: -11, y: 180, key: 'per_torax' },
  { n: 'shoulder_back', x: -16, y: 138, key: null },
  { n: 'neck_back', x: -5, y: 100, key: null },
  { n: 'head_back', x: -16, y: 50, key: null },
];

const SIDE_FEMALE = [
  { n: 'head_top', x: 2, y: 14, key: null },
  { n: 'forehead', x: 19, y: 40, key: null },
  { n: 'face', x: 21, y: 58, key: null },
  { n: 'chin', x: 13, y: 78, key: null },
  { n: 'neck_front', x: 8, y: 98, key: 'per_cuello' },
  { n: 'chest_front', x: 30, y: 178, key: 'per_torax' },
  { n: 'waist_front', x: 14, y: 238, key: 'per_cintura' },
  { n: 'abdomen_front', x: 18, y: 260, key: 'per_abdomen' },
  { n: 'hip_front', x: 15, y: 292, key: 'per_cadera' },
  { n: 'thigh_front', x: 13, y: 344, key: 'per_muslo' },
  { n: 'knee_front', x: 9, y: 432, key: null },
  { n: 'calf_front', x: 8, y: 482, key: 'per_pantorrilla' },
  { n: 'ankle_front', x: 5, y: 556, key: null },
  { n: 'toe', x: 32, y: 586, key: null },
  { n: 'heel', x: -13, y: 574, key: null },
  { n: 'ankle_back', x: -6, y: 556, key: null },
  { n: 'calf_back', x: -15, y: 482, key: 'per_pantorrilla' },
  { n: 'knee_back', x: -10, y: 432, key: null },
  { n: 'thigh_back', x: -15, y: 344, key: 'per_muslo' },
  { n: 'glute', x: -28, y: 294, key: 'per_cadera' },
  { n: 'waist_back', x: -13, y: 240, key: 'per_cintura' },
  { n: 'midback', x: -11, y: 208, key: null },
  { n: 'upperback', x: -10, y: 182, key: 'per_torax' },
  { n: 'shoulder_back', x: -14, y: 140, key: null },
  { n: 'neck_back', x: -4, y: 100, key: null },
  { n: 'head_back', x: -15, y: 50, key: null },
];

const DRIVEN_KEYS = [
  'per_cuello', 'per_torax', 'per_cintura', 'per_abdomen', 'per_cadera',
  'per_brazo_rel', 'per_antebrazo', 'per_muslo', 'per_pantorrilla', 'talla_cm',
];

const numOrNull = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/** Si una visita no trae una medición, usa la última conocida (o la más antigua disponible). */
function forwardFill(visits) {
  const filled = visits.map(() => ({}));
  for (const key of DRIVEN_KEYS) {
    let last = null;
    visits.forEach((v, i) => {
      const n = numOrNull(v.data[key]);
      if (n !== null) last = n;
      filled[i][key] = last;
    });
  }
  return filled;
}

/** Vista frontal: coordenadas absolutas del contorno cerrado, reflejando el medio cuerpo. */
function scaledFrontPoints(half, ratioForKey, heightRatio) {
  const project = (p, mirror) => {
    const rx = p.key ? ratioForKey(p.key) : 1;
    const offset = p.x * rx * (mirror ? -1 : 1);
    return { x: CX_FRONT + offset, y: p.y * heightRatio };
  };
  const right = half.map((p) => project(p, false));
  const left = half.slice(1).reverse().map((p) => project(p, true));
  return [...right, ...left];
}

/** Vista lateral: la lista ya es el contorno cerrado completo, sin reflejo. */
function scaledSidePoints(points, ratioForKey, heightRatio) {
  return points.map((p) => {
    const rx = p.key ? ratioForKey(p.key) : 1;
    return { x: CX_SIDE + p.x * rx, y: p.y * heightRatio };
  });
}

/** Catmull-Rom -> Bézier cúbica, lazo cerrado. Genérica: solo ve {x,y}. */
function catmullRomToBezierPath(pts) {
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d.trim() + ' Z';
}

export function renderBodySilhouette(visits, { sex } = {}) {
  const root = document.createElement('div');
  const half = sex === 'F' ? FEMALE_HALF : MALE_HALF;
  const side = sex === 'F' ? SIDE_FEMALE : SIDE_MALE;

  const compareVisits = visits.slice(1); // todas menos admisión
  if (!compareVisits.length) {
    root.innerHTML = `<p class="py-6 text-center text-xs text-slate-400">
      Todavía no hay una consulta con la que comparar la silueta de admisión.</p>`;
    return root;
  }

  const filled = forwardFill(visits);
  const admissionFilled = filled[0];
  const lastIndex = visits.length - 1;

  const admissionFrontD = catmullRomToBezierPath(scaledFrontPoints(half, () => 1, 1));
  const admissionSideD = catmullRomToBezierPath(scaledSidePoints(side, () => 1, 1));

  const ratiosFor = (visitIndex) => {
    const cf = filled[visitIndex];
    const ratioForKey = (key) => {
      const a = admissionFilled[key];
      const b = cf[key];
      return (a && b) ? b / a : 1;
    };
    const heightRatio = (admissionFilled.talla_cm && cf.talla_cm) ? cf.talla_cm / admissionFilled.talla_cm : 1;
    return { ratioForKey, heightRatio };
  };
  const computeCompareFrontD = (visitIndex) => {
    const { ratioForKey, heightRatio } = ratiosFor(visitIndex);
    return catmullRomToBezierPath(scaledFrontPoints(half, ratioForKey, heightRatio));
  };
  const computeCompareSideD = (visitIndex) => {
    const { ratioForKey, heightRatio } = ratiosFor(visitIndex);
    return catmullRomToBezierPath(scaledSidePoints(side, ratioForKey, heightRatio));
  };

  root.innerHTML = `
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-4 text-xs">
        <span class="flex items-center gap-1.5 text-slate-600"><span class="h-2.5 w-2.5 rounded-full bg-slate-400"></span>Admisión</span>
        <span class="flex items-center gap-1.5 text-slate-600"><span class="h-2.5 w-2.5 rounded-full bg-indigo-500"></span>Comparación</span>
        <label class="ml-auto flex items-center gap-2">
          <span class="text-slate-500">Comparar con:</span>
          <select data-compare-visit class="rounded-lg border-0 bg-white px-2 py-1 text-xs shadow-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-indigo-500">
            ${compareVisits.map((v) => {
              const idx = visits.indexOf(v);
              return `<option value="${idx}" ${idx === lastIndex ? 'selected' : ''}>${escapeHtml(v.label)}</option>`;
            }).join('')}
          </select>
        </label>
      </div>
      <div class="flex flex-wrap items-start justify-center gap-6">
        <div class="w-56 max-w-full">
          <p class="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Frente</p>
          <svg viewBox="0 0 300 600" class="mx-auto h-auto w-full">
            <path data-admission-front d="${admissionFrontD}" fill="#94a3b8" fill-opacity="0.35" stroke="#475569" stroke-width="2" stroke-opacity="0.7"/>
            <path data-compare-front d="${computeCompareFrontD(lastIndex)}" fill="#4f46e5" fill-opacity="0.25" stroke="#4f46e5" stroke-width="2"/>
          </svg>
        </div>
        <div class="w-32 max-w-full">
          <p class="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Perfil</p>
          <svg viewBox="0 0 90 600" class="mx-auto h-auto w-full">
            <path data-admission-side d="${admissionSideD}" fill="#94a3b8" fill-opacity="0.35" stroke="#475569" stroke-width="2" stroke-opacity="0.7"/>
            <path data-compare-side d="${computeCompareSideD(lastIndex)}" fill="#4f46e5" fill-opacity="0.25" stroke="#4f46e5" stroke-width="2"/>
          </svg>
        </div>
      </div>
    </div>`;

  root.querySelector('[data-compare-visit]').addEventListener('change', (ev) => {
    const idx = +ev.target.value;
    root.querySelector('[data-compare-front]').setAttribute('d', computeCompareFrontD(idx));
    root.querySelector('[data-compare-side]').setAttribute('d', computeCompareSideD(idx));
  });

  return root;
}
