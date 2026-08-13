/**
 * Motor de formularios dinámicos basado en services_catalog.json.
 * Soporta: text/number/date/email/tel, textarea, select, checkbox,
 * checkdetail (checkbox que despliega "especificar"), symptom (síntoma con
 * duración), calc (calculado) y signature (canvas de firma).
 * Secciones condicionales por sexo (showIf).
 */

import { escapeHtml, inputCls, labelCls } from './ui.js';

/**
 * Duraciones de un síntoma. Se ofrecen como botones y no como texto libre
 * porque ahí es donde se escribía "mucho tiempo": con opciones fijas el dato
 * queda comparable entre pacientes.
 *
 * Los cortes siguen el criterio clínico habitual (en diarrea, aguda es menos
 * de dos semanas y crónica más de un mes), no una escala arbitraria.
 */
const SYMPTOM_DURATIONS = [
  'Hoy o ayer',
  '2 a 6 días',
  '1 a 2 semanas',
  '2 a 4 semanas',
  'Más de 1 mes',
  'Más de 6 meses',
];

/* ---- Cálculos automáticos ---- */
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const PLIEGUES = ['pli_triceps', 'pli_biceps', 'pli_subescapular', 'pli_suprailiaco', 'pli_abdominal', 'pli_muslo', 'pli_pantorrilla'];

const CALCS = {
  imc: (v) => (v.peso_kg > 0 && v.talla_cm > 0) ? r1(v.peso_kg / ((v.talla_cm / 100) ** 2)) : '',
  icc: (v) => (v.per_cintura > 0 && v.per_cadera > 0) ? r2(v.per_cintura / v.per_cadera) : '',
  ice: (v) => (v.per_cintura > 0 && v.talla_cm > 0) ? r2(v.per_cintura / v.talla_cm) : '',
  pli_sum: (v) => {
    const vals = PLIEGUES.map((k) => v[k]).filter((x) => x > 0);
    return vals.length ? r1(vals.reduce((a, b) => a + b, 0)) : '';
  },
};

/* ---- Render ---- */
export function sectionsHtml(sections, { compact = false } = {}) {
  return sections.map((sec) => {
    const cols = sec.grid === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2';
    const wrap = compact
      ? 'rounded-xl ring-1 ring-slate-200 p-4'
      : 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200';
    return `
      <section data-sec="${sec.id}" data-showif='${sec.showIf ? escapeHtml(JSON.stringify(sec.showIf)) : ''}' class="${wrap}">
        <h4 class="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">${escapeHtml(sec.title)}</h4>
        <div class="grid grid-cols-1 gap-4 ${cols}">
          ${sec.fields.map((f) => fieldHtml(f)).join('')}
        </div>
      </section>`;
  }).join('');
}

function fieldHtml(f) {
  const span = f.span === 3 ? 'sm:col-span-2 lg:col-span-3' : f.span === 2 ? 'sm:col-span-2' : '';
  const label = `<label class="${labelCls}">${escapeHtml(f.l)}</label>`;
  switch (f.t) {
    case 'textarea':
      return `<div class="${span}">${label}<textarea name="${f.k}" rows="2" class="${inputCls}"></textarea></div>`;
    case 'select': {
      const opts = ['<option value="">—</option>']
        .concat((f.o || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`));
      return `<div class="${span}">${label}<select name="${f.k}" class="${inputCls}">${opts.join('')}</select></div>`;
    }
    case 'checkbox':
      return `<div class="${span} flex items-end pb-1">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="${f.k}" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          ${escapeHtml(f.l)}</label></div>`;
    case 'checkdetail':
      return `<div class="${span}">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="${f.k}" data-cd="${f.k}" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          ${escapeHtml(f.l)}</label>
        <input type="text" name="${f.k}_det" placeholder="${escapeHtml(f.d || 'Especificar')}" class="${inputCls} mt-1.5 hidden">
      </div>`;
    case 'symptom':
      // El valor guardado es la duración, así que sigue siendo un escalar y el
      // whitelist del servidor lo acepta sin cambios. Vacío = no presenta el síntoma.
      return `<div class="${span} rounded-xl ring-1 ring-slate-200 p-3" data-symptom="${f.k}">
        <label class="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" data-sym-check="${f.k}"
                 class="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
          <span class="text-sm font-semibold text-slate-800">${escapeHtml(f.l)}</span>
        </label>
        <div data-sym-durations="${f.k}" class="mt-2.5 hidden flex-wrap gap-1.5">
          ${SYMPTOM_DURATIONS.map((d) => `
            <button type="button" data-sym-pick="${f.k}" data-value="${escapeHtml(d)}"
                    class="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${escapeHtml(d)}
            </button>`).join('')}
        </div>
        <p data-sym-hint="${f.k}" class="mt-1.5 hidden text-xs font-semibold text-amber-700">Indica desde cuándo</p>
        <input type="hidden" name="${f.k}">
      </div>`;
    case 'calc':
      return `<div class="${span}">${label}
        <input type="text" name="${f.k}" data-calc="${f.calc}" readonly tabindex="-1"
               class="w-full rounded-lg border-0 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200 outline-none"></div>`;
    case 'signature': {
      if (!f.large) {
        return `<div class="sm:col-span-2 lg:col-span-3">${label}
          <div class="overflow-hidden rounded-xl bg-white ring-1 ring-slate-300">
            <canvas data-sig="${f.k}" class="block h-40 w-full touch-none" style="touch-action:none"></canvas>
          </div>
          <div class="mt-1.5 flex items-center justify-between">
            <p class="text-xs text-slate-400">Firma con el dedo o el mouse</p>
            <button type="button" data-sig-clear="${f.k}" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Limpiar firma</button>
          </div>
          <input type="hidden" name="${f.k}">
        </div>`;
      }
      return `<div class="sm:col-span-2 lg:col-span-3">
        <div class="mx-auto max-w-xl text-center">
          <h5 class="mb-2 text-sm font-bold text-slate-700">${escapeHtml(f.l)}</h5>
          ${f.legend ? `<p class="mb-3 text-xs font-medium text-slate-500">${escapeHtml(f.legend)}</p>` : ''}
          <div class="overflow-hidden rounded-xl bg-white ring-1 ring-slate-300">
            <canvas data-sig="${f.k}" class="block h-56 w-full touch-none" style="touch-action:none"></canvas>
          </div>
          <div class="mt-1.5 flex items-center justify-between">
            <p class="text-xs text-slate-400">Firma con el dedo o el mouse</p>
            <button type="button" data-sig-clear="${f.k}" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Limpiar firma</button>
          </div>
          <input type="hidden" name="${f.k}">
        </div>
      </div>`;
    }
    default: {
      const step = f.step ? `step="${f.step}"` : (f.t === 'number' ? 'step="any"' : '');
      return `<div class="${span}">${label}<input type="${f.t}" name="${f.k}" ${step} class="${inputCls}"></div>`;
    }
  }
}

/**
 * Prellena un formulario del catálogo con datos ya guardados (edición).
 *
 * Se llama ANTES de initSections(): los widgets se autoinicializan a partir
 * del valor que encuentran —el tipo 'symptom' marca su casilla si trae
 * duración, y setupSignature() dibuja la firma existente—, así que basta con
 * dejar los valores puestos y dejar que initSections() haga el resto.
 */
export function fillSections(formEl, sections, data) {
  if (!data) return;
  for (const sec of sections) {
    for (const f of sec.fields) {
      const el = formEl.querySelector(`[name="${f.k}"]`);
      if (!el) continue;
      const v = data[f.k];
      if (v === undefined || v === null) continue;

      if (f.t === 'checkbox' || f.t === 'checkdetail') {
        el.checked = v === true || v === '1' || v === 1;
        if (f.t === 'checkdetail') {
          const det = formEl.querySelector(`[name="${f.k}_det"]`);
          if (det) det.value = data[`${f.k}_det`] ?? '';
        }
        continue;
      }
      // Un síntoma capturado antes del cambio de tipo guardaba true + <clave>_det.
      // Se conserva ese texto tal cual —no se traduce a una de las opciones
      // nuevas, porque sería inventar una precisión que el dato original no tiene.
      if (f.t === 'symptom' && v === true) {
        el.value = String(data[`${f.k}_det`] ?? '').trim();
        if (el.value === '') {
          // Marcado sin duración: se refleja con la casilla, no con un valor falso
          const box = formEl.querySelector(`[data-symptom="${f.k}"] [data-sym-check]`);
          if (box) box.checked = true;
        }
        continue;
      }
      el.value = String(v);
    }
  }
}

/* ---- Comportamiento (llamar con el form YA insertado en el DOM) ---- */
export function initSections(formEl) {
  // checkdetail: mostrar el "especificar" al palomear
  formEl.querySelectorAll('[data-cd]').forEach((cb) => {
    const det = formEl.querySelector(`[name="${cb.dataset.cd}_det"]`);
    if (!det) return;
    cb.addEventListener('change', () => det.classList.toggle('hidden', !cb.checked));
  });

  // síntomas: al marcarlos se pide la duración, que es el valor que se guarda
  formEl.querySelectorAll('[data-symptom]').forEach((box) => {
    const key = box.dataset.symptom;
    const check = box.querySelector('[data-sym-check]');
    const durations = box.querySelector('[data-sym-durations]');
    const hint = box.querySelector('[data-sym-hint]');
    const hidden = box.querySelector(`input[type=hidden][name="${key}"]`);
    const buttons = [...box.querySelectorAll('[data-sym-pick]')];

    const paintPicked = () => {
      buttons.forEach((b) => {
        const on = b.dataset.value === hidden.value;
        b.className = on
          ? 'rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm'
          : 'rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50';
      });
      const known = SYMPTOM_DURATIONS.includes(hidden.value);
      if (check.checked && hidden.value !== '' && !known) {
        // Duración capturada antes de que existieran estas opciones: se muestra
        // tal cual para no perderla ni fingir que equivale a una de las nuevas
        hint.textContent = `Registrado antes como: “${hidden.value}”. Toca una opción para actualizarlo.`;
        hint.className = 'mt-1.5 text-xs font-semibold text-slate-500';
      } else {
        hint.textContent = 'Indica desde cuándo';
        hint.className = 'mt-1.5 text-xs font-semibold text-amber-700';
        // Marcado pero sin duración: se avisa en vez de guardar un dato a medias
        hint.classList.toggle('hidden', !check.checked || hidden.value !== '');
      }
      box.classList.toggle('ring-indigo-300', check.checked);
      box.classList.toggle('bg-indigo-50/40', check.checked);
    };

    const sync = () => {
      durations.classList.toggle('hidden', !check.checked);
      durations.classList.toggle('flex', check.checked);
      if (!check.checked) {
        hidden.value = '';
      }
      paintPicked();
    };

    check.addEventListener('change', sync);
    buttons.forEach((b) => b.addEventListener('click', () => {
      // Volver a tocar la opción elegida la desmarca
      hidden.value = hidden.value === b.dataset.value ? '' : b.dataset.value;
      paintPicked();
    }));

    // Si viene con valor (edición), el síntoma se muestra ya marcado
    if (hidden.value !== '') {
      check.checked = true;
    }
    sync();
  });

  // cálculos automáticos
  const recalc = () => {
    const nums = {};
    formEl.querySelectorAll('input[type=number]').forEach((i) => { nums[i.name] = parseFloat(i.value); });
    formEl.querySelectorAll('[data-calc]').forEach((out) => {
      const fn = CALCS[out.dataset.calc];
      if (fn) out.value = fn(nums);
    });
  };
  formEl.addEventListener('input', recalc);
  recalc();

  // secciones condicionales por sexo
  const syncShowIf = () => {
    const sexEl = formEl.querySelector('[name=sex]');
    const sex = sexEl ? sexEl.value : '';
    formEl.querySelectorAll('[data-showif]').forEach((sec) => {
      const raw = sec.dataset.showif;
      if (!raw) return;
      const cond = JSON.parse(raw);
      const show = !cond || !sex ? !cond : (cond.in || []).includes(sex);
      // Sin sexo elegido: ocultar las condicionales para no abrumar
      sec.classList.toggle('hidden', !(cond && sex && (cond.in || []).includes(sex)));
    });
  };
  const sexEl = formEl.querySelector('[name=sex]');
  if (sexEl) sexEl.addEventListener('change', syncShowIf);
  syncShowIf();

  // canvas de firma
  formEl.querySelectorAll('canvas[data-sig]').forEach((canvas) => setupSignature(formEl, canvas));
}

function setupSignature(formEl, canvas) {
  const key = canvas.dataset.sig;
  const hidden = formEl.querySelector(`input[type=hidden][name="${key}"]`);
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 600;
    const h = canvas.offsetHeight || 160;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  resize();

  // Al editar, la firma ya capturada se dibuja en el lienzo. Sin esto se vería
  // en blanco aunque el dato exista, y parecería que se perdió.
  if (hidden && hidden.value) {
    const img = new Image();
    img.onload = () => {
      const w = canvas.offsetWidth || 600;
      const h = canvas.offsetHeight || 160;
      ctx.drawImage(img, 0, 0, w, h);
      hasInk = true;
    };
    img.src = hidden.value;
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk = true;
  });
  const stop = () => {
    if (!drawing) return;
    drawing = false;
    if (hasInk && hidden) hidden.value = canvas.toDataURL('image/png');
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);

  const clearBtn = formEl.querySelector(`[data-sig-clear="${key}"]`);
  if (clearBtn) clearBtn.addEventListener('click', () => {
    hasInk = false;
    if (hidden) hidden.value = '';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resize();
  });
}

/* ---- Recolección ---- */
export function collectSections(formEl, sections) {
  const out = {};
  for (const sec of sections) {
    const secEl = formEl.querySelector(`[data-sec="${sec.id}"]`);
    if (!secEl || secEl.classList.contains('hidden')) continue;
    for (const f of sec.fields) {
      const el = formEl.querySelector(`[name="${f.k}"]`);
      if (!el) continue;
      if (f.t === 'checkbox' || f.t === 'checkdetail') {
        if (el.checked) {
          out[f.k] = true;
          if (f.t === 'checkdetail') {
            const det = formEl.querySelector(`[name="${f.k}_det"]`);
            if (det && det.value.trim()) out[f.k + '_det'] = det.value.trim();
          }
        }
      } else {
        const v = el.value.trim();
        if (v !== '') out[f.k] = v;
      }
    }
  }
  return out;
}

/* ---- Visualización de datos capturados (expediente) ---- */
export function dataRowsHtml(sections, data) {
  if (!data) return '';
  const blocks = [];
  for (const sec of sections) {
    const rows = [];
    let firma = null;
    let firmaField = null;
    for (const f of sec.fields) {
      const v = data[f.k];
      if (v === undefined || v === '' || v === null || v === false) continue;
      if (f.t === 'signature') {
        firma = v;
        firmaField = f;
        continue;
      }
      let display;
      if (f.t === 'checkbox') display = 'Sí';
      else if (f.t === 'checkdetail') {
        const det = data[f.k + '_det'];
        display = det ? `Sí — ${escapeHtml(String(det))}` : 'Sí';
      } else if (f.t === 'symptom' && v === true) {
        // Episodios anteriores al cambio: el síntoma era una casilla y la duración
        // iba en <clave>_det. Se sigue mostrando para no perder el historial.
        const det = data[f.k + '_det'];
        display = det ? `Sí — ${escapeHtml(String(det))}` : 'Sí';
      } else display = escapeHtml(String(v));
      rows.push(`<div class="flex justify-between gap-4 text-sm">
        <span class="text-slate-500">${escapeHtml(f.l)}</span>
        <span class="text-right font-medium text-slate-800">${display}</span></div>`);
    }
    if (!rows.length && !firma) continue;
    const firmaHtml = !firma ? '' : (firmaField && firmaField.large
      ? `<div class="mt-3 flex flex-col items-center text-center">
          ${firmaField.legend ? `<p class="mb-2 max-w-md text-xs font-medium text-slate-500">${escapeHtml(firmaField.legend)}</p>` : ''}
          <img src="${firma}" alt="Firma" class="h-28 rounded-lg bg-white ring-1 ring-slate-200">
        </div>`
      : `<img src="${firma}" alt="Firma" class="mt-2 h-16 rounded-lg bg-white ring-1 ring-slate-200">`);
    blocks.push(`
      <div class="rounded-xl bg-slate-50 px-4 py-3">
        <p class="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">${escapeHtml(sec.title)}</p>
        ${rows.length ? `<div class="space-y-1.5">${rows.join('')}</div>` : ''}
        ${firmaHtml}
      </div>`);
  }
  return blocks.join('');
}
