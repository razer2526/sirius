/**
 * Composición corporal ESTIMADA a partir del peso y la impedancia que manda la báscula.
 *
 * Lo que sale de aquí son estimaciones de Sirius con ecuaciones publicadas, no las cifras que
 * calcula la app del fabricante (esa usa fórmulas propias, y una báscula de pie a pie mide solo
 * la parte baja del cuerpo, mientras que las ecuaciones se derivaron de mano a pie). Por eso
 * los campos llenados con esto se marcan "estimado" en el formulario.
 *
 * Funciones puras, sin DOM: se prueban solas.
 *
 *  - Masa libre de grasa y agua corporal total: Sun et al., Am J Clin Nutr 2003;77:331-340.
 *      FFM  H: -10.678 + 0.262·P + 0.652·(T²/R) + 0.015·R      M: -9.529 + 0.168·P + 0.696·(T²/R) + 0.016·R
 *      TBW  H:   1.203 + 0.449·(T²/R) + 0.176·P                M:  3.747 + 0.450·(T²/R) + 0.113·P
 *    (P kg, T cm, R Ω)
 *  - Metabolismo basal: Mifflin–St Jeor (1990).
 *
 * "Masa muscular" en Sirius es el peso muscular TOTAL (masa libre de grasa menos hueso), no el
 * músculo esquelético. El hueso se estima como una fracción fija de la masa libre de grasa; en
 * la única lectura de referencia que tenemos de la app (46.48 kg libres de grasa, 3.33 kg de
 * hueso) esa fracción es 7.2 %. Es la parte más débil de la estimación y se reajusta cuando
 * haya más lecturas para comparar.
 *
 * NO se estiman: grasa visceral y edad metabólica. No hay ecuación publicada que las obtenga de
 * la impedancia de una báscula; inventarlas se vería tan autoritativo como un dato real.
 */

export const BONE_FRACTION_OF_FFM = 0.07;

/** Límites de cordura: fuera de ellos la lectura no se escribe en el expediente. */
export const LIMITS = {
  pesoKg: [5, 300],
  impedancia: [100, 2000],
  tallaCm: [50, 250],
  edad: [5, 110],
  grasaPct: [3, 65],
};

const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
const round = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** Normaliza el sexo del paciente a 'M' / 'F' (o null si no hay una ecuación aplicable). */
export function normalizeSex(sex) {
  const s = String(sex || '').trim().toUpperCase();
  if (s === 'M' || s === 'MASCULINO' || s === 'H' || s === 'HOMBRE') return 'M';
  if (s === 'F' || s === 'FEMENINO' || s === 'MUJER') return 'F';
  return null;
}

/** Metabolismo basal (kcal/día), Mifflin–St Jeor. */
export function mifflinStJeor({ pesoKg, tallaCm, edad, sexo }) {
  const sx = normalizeSex(sexo);
  if (!sx) return null;
  const base = 10 * pesoKg + 6.25 * tallaCm - 5 * edad;
  return base + (sx === 'M' ? 5 : -161);
}

/** Masa libre de grasa (kg), Sun et al. 2003. */
export function fatFreeMass({ pesoKg, tallaCm, impedancia, sexo }) {
  const sx = normalizeSex(sexo);
  if (!sx || !(impedancia > 0)) return null;
  const s2r = (tallaCm * tallaCm) / impedancia;
  return sx === 'M'
    ? -10.678 + 0.262 * pesoKg + 0.652 * s2r + 0.015 * impedancia
    : -9.529 + 0.168 * pesoKg + 0.696 * s2r + 0.016 * impedancia;
}

/** Agua corporal total (kg), Sun et al. 2003. */
export function totalBodyWater({ pesoKg, tallaCm, impedancia, sexo }) {
  const sx = normalizeSex(sexo);
  if (!sx || !(impedancia > 0)) return null;
  const s2r = (tallaCm * tallaCm) / impedancia;
  return sx === 'M'
    ? 1.203 + 0.449 * s2r + 0.176 * pesoKg
    : 3.747 + 0.450 * s2r + 0.113 * pesoKg;
}

/**
 * Qué campos del formulario se pueden llenar con una lectura.
 *
 * @param {{pesoKg:number, impedancia?:number|null, tallaCm?:number|null, edad?:number|null, sexo?:string|null}} input
 * @returns {{fields: Object<string,{value:number, kind:'bascula'|'estimado'}>, missing:string[], notes:string[]}}
 *   `missing` son los datos del paciente que faltan para estimar más; `notes` explican por qué algo no se llenó.
 */
export function estimateFromReading(input) {
  const { pesoKg, impedancia = null, tallaCm = null, edad = null, sexo = null } = input;
  const fields = {};
  const missing = [];
  const notes = [];

  if (!inRange(pesoKg, LIMITS.pesoKg)) {
    notes.push(`Peso fuera de rango (${Number.isFinite(pesoKg) ? round(pesoKg, 1) : '—'} kg): no se escribió.`);
    return { fields, missing, notes };
  }
  fields.peso_kg = { value: round(pesoKg, 1), kind: 'bascula' };

  let imp = null;
  if (impedancia !== null && impedancia !== undefined) {
    if (inRange(impedancia, LIMITS.impedancia)) {
      imp = impedancia;
      fields.bio_impedancia = { value: Math.round(impedancia), kind: 'bascula' };
    } else {
      notes.push(`Impedancia fuera de rango (${Math.round(impedancia)} Ω): se descartó.`);
    }
  }

  const sx = normalizeSex(sexo);
  const talla = inRange(tallaCm, LIMITS.tallaCm) ? tallaCm : null;
  const age = inRange(edad, LIMITS.edad) ? edad : null;
  if (!sx) missing.push('sexo (masculino o femenino)');
  if (!talla) missing.push('talla');
  if (!age) missing.push('fecha de nacimiento');

  // Metabolismo basal: no necesita impedancia.
  if (sx && talla && age) {
    fields.bio_tmb = { value: Math.round(mifflinStJeor({ pesoKg, tallaCm: talla, edad: age, sexo: sx })), kind: 'estimado' };
  }

  // Composición: necesita impedancia, talla y sexo (la edad no entra en estas ecuaciones).
  if (imp === null) {
    if (impedancia === null || impedancia === undefined) notes.push('La báscula no mandó impedancia: solo se capturó el peso.');
  } else if (sx && talla) {
    const ffm = fatFreeMass({ pesoKg, tallaCm: talla, impedancia: imp, sexo: sx });
    const tbw = totalBodyWater({ pesoKg, tallaCm: talla, impedancia: imp, sexo: sx });
    const fat = pesoKg - ffm;
    const pct = (fat / pesoKg) * 100;
    if (ffm > 0 && inRange(pct, LIMITS.grasaPct) && tbw > 0 && tbw < pesoKg) {
      fields.bio_masa_grasa = { value: round(fat, 1), kind: 'estimado' };
      fields.bio_grasa_pct = { value: round(pct, 1), kind: 'estimado' };
      fields.bio_agua = { value: round(tbw, 1), kind: 'estimado' };
      fields.bio_masa_muscular = { value: round(ffm * (1 - BONE_FRACTION_OF_FFM), 1), kind: 'estimado' };
    } else {
      notes.push('Con esa impedancia la estimación sale fuera de lo plausible (¿pies secos o mal apoyados?): no se llenó la composición.');
    }
  }
  return { fields, missing, notes };
}
