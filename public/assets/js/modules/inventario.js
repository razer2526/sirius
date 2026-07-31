/**
 * Módulo Inventario: catálogo con código de barras, lotes con PEPS
 * (primeras entradas, primeras salidas) y alertas de stock bajo / caducidad.
 */

import { apiGet, apiPost } from '../api.js';
import {
  icon, escapeHtml, toast, modal, confirmDialog, field, formValues,
  inputCls, labelCls, debounce, spinner, fmtDate, fmtDateTime,
} from '../ui.js';

const REASONS = ['Uso clínico', 'Merma', 'Caducado', 'Ajuste de conteo'];
const UNITS = ['pieza', 'caja', 'par', 'paquete', 'kit', 'frasco', 'mL', 'L', 'g', 'mg'];

// Filtros de la lista: viven fuera de render() para sobrevivir a los repintados parciales.
const listState = { search: '', category: '', showInactive: false, alertFilter: null };
// Categorías conocidas, para el datalist del modal de artículo (se alimenta al cargar la lista).
let categoriesCache = [];

export async function render(root, context) {
  const [rawId] = context.args;
  if (rawId && /^\d+$/.test(rawId)) {
    await renderDetail(root, +rawId);
  } else {
    await renderList(root);
  }
}

/* ================= Lista ================= */
async function renderList(root) {
  root.innerHTML = spinner();
  let data;
  try {
    data = await apiGet('inventory/list');
  } catch (e) {
    root.innerHTML = errorBox(e.message);
    return;
  }
  paintList(root, data);
}

function paintList(root, data) {
  categoriesCache = data.categories;
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div id="inv-alerts"></div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-[220px] flex-1">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">${icon('search', 'h-4 w-4')}</span>
          <input id="inv-q" type="text" value="${escapeHtml(listState.search)}" placeholder="Buscar por nombre o código de barras…" autocomplete="off"
                 class="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>
        <select id="inv-cat" class="rounded-xl border-0 bg-white px-3 py-2.5 text-sm shadow-sm ring-1 ring-slate-200 outline-none">
          <option value="">Todas las categorías</option>
          ${data.categories.map((c) => `<option value="${escapeHtml(c)}" ${listState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <button id="btn-scan" type="button" class="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
          ${icon('barcode', 'h-4 w-4')} Escanear
        </button>
        <button id="btn-salida-scan" type="button" class="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500">
          ${icon('upload', 'h-4 w-4')} Salida de artículo
        </button>
        <button id="btn-entrada-scan" type="button" class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
          ${icon('download', 'h-4 w-4')} Añadir artículo
        </button>
        ${data.can_manage ? `
        <button id="btn-new-item" type="button" class="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo artículo
        </button>` : ''}
      </div>
      ${data.can_manage ? `
      <label class="flex items-center gap-2 text-xs font-medium text-slate-500">
        <input type="checkbox" id="inv-show-inactive" ${listState.showInactive ? 'checked' : ''} class="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
        Mostrar artículos inactivos
      </label>` : ''}
      <div id="inv-grid"></div>
    </div>`;

  renderAlerts(root, data);
  renderGrid(root, data);

  // El área de resultados se repinta sola: así el foco del buscador nunca se pierde.
  root.querySelector('#inv-q').addEventListener('input', debounce((e) => {
    listState.search = e.target.value;
    renderGrid(root, data);
  }, 250));
  root.querySelector('#inv-cat').addEventListener('change', (e) => {
    listState.category = e.target.value;
    renderGrid(root, data);
  });
  root.querySelector('#inv-show-inactive')?.addEventListener('change', (e) => {
    listState.showInactive = e.target.checked;
    renderGrid(root, data);
  });
  root.querySelector('#btn-scan').addEventListener('click', () => scanForItem(data.can_manage));
  root.querySelector('#btn-new-item')?.addEventListener('click', () => openItemModal(null, {}, () => renderList(root)));
  root.querySelector('#btn-salida-scan').addEventListener('click', () =>
    openScanSessionModal({ mode: 'salida', items: data.items, reload: () => renderList(root) }));
  root.querySelector('#btn-entrada-scan').addEventListener('click', () =>
    openScanSessionModal({ mode: 'entrada', items: data.items, reload: () => renderList(root) }));
}

function renderAlerts(root, data) {
  const box = root.querySelector('#inv-alerts');
  const { expired, expiring, low_stock: lowStock } = data.alerts;
  if (!expired.length && !expiring.length && !lowStock.length) {
    box.innerHTML = '';
    return;
  }
  const chip = (key, count, label, cls) => count ? `
    <button type="button" data-alert="${key}"
            class="flex items-center gap-1.5 rounded-xl ${cls} px-3.5 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset transition hover:brightness-95 ${listState.alertFilter === key ? 'ring-2 ring-offset-1' : ''}">
      ${icon('alert-triangle', 'h-4 w-4')} ${count} ${label}
    </button>` : '';

  box.innerHTML = `
    <div class="flex flex-wrap gap-2">
      ${chip('expired', expired.length, expired.length === 1 ? 'lote caducado' : 'lotes caducados', 'bg-red-50 text-red-700 ring-red-200')}
      ${chip('expiring', expiring.length, expiring.length === 1 ? 'lote por caducar' : 'lotes por caducar', 'bg-amber-50 text-amber-700 ring-amber-200')}
      ${chip('low_stock', lowStock.length, lowStock.length === 1 ? 'artículo con stock bajo' : 'artículos con stock bajo', 'bg-sky-50 text-sky-700 ring-sky-200')}
      ${listState.alertFilter ? `
      <button type="button" data-alert="" class="rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">
        Quitar filtro
      </button>` : ''}
    </div>`;
  box.querySelectorAll('[data-alert]').forEach((b) => b.addEventListener('click', () => {
    listState.alertFilter = b.dataset.alert || null;
    renderAlerts(root, data);
    renderGrid(root, data);
  }));
}

function renderGrid(root, data) {
  const { alerts } = data;
  const inAlert = (it) => {
    if (listState.alertFilter === 'low_stock') return alerts.low_stock.some((a) => a.id === it.id);
    if (listState.alertFilter === 'expiring') return alerts.expiring.some((a) => a.item_id === it.id);
    if (listState.alertFilter === 'expired') return alerts.expired.some((a) => a.item_id === it.id);
    return true;
  };
  const q = listState.search.trim().toLowerCase();
  const items = data.items.filter((it) => {
    if (!listState.showInactive && !it.is_active) return false;
    if (listState.category && it.category !== listState.category) return false;
    if (q && !it.name.toLowerCase().includes(q) && !(it.barcode || '').toLowerCase().includes(q)) return false;
    return inAlert(it);
  });

  const grid = root.querySelector('#inv-grid');
  grid.innerHTML = items.length
    ? `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${items.map(itemCard).join('')}</div>`
    : emptyState('Sin artículos', data.items.length ? 'Nada coincide con el filtro actual.' : 'Registra el primero con "Nuevo artículo" o escaneando su código.');
}

function itemCard(it) {
  const low = it.min_stock > 0 && it.stock < it.min_stock;
  const expiryBadge = expiryBadgeFor(it.next_expiry);
  return `
    <a href="#/inventario/${it.id}" class="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300 ${!it.is_active ? 'opacity-60' : ''}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-slate-900">${escapeHtml(it.name)}</p>
          <p class="mt-0.5 truncate text-xs text-slate-500">${it.category ? escapeHtml(it.category) + ' · ' : ''}${escapeHtml(it.unit)}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-base font-bold ${low ? 'text-amber-600' : 'text-slate-900'}">${fmtQty(it.stock)}</p>
          ${it.min_stock > 0 ? `<p class="text-[11px] text-slate-400">mín. ${fmtQty(it.min_stock)}</p>` : ''}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${low ? badge('Stock bajo', 'bg-amber-100 text-amber-700') : ''}
        ${expiryBadge}
        ${!it.is_active ? badge('Inactivo', 'bg-slate-100 text-slate-500') : ''}
      </div>
    </a>`;
}

function expiryBadgeFor(dateStr) {
  if (!dateStr) return '';
  const days = daysUntil(dateStr);
  if (days < 0) return badge('Caducado', 'bg-red-100 text-red-700');
  if (days <= 30) return badge(`Caduca en ${days} d`, 'bg-amber-100 text-amber-700');
  return badge(`Caduca ${fmtDate(dateStr)}`, 'bg-slate-100 text-slate-500');
}

/* ================= Detalle ================= */
async function renderDetail(root, id) {
  root.innerHTML = spinner();
  let data;
  try {
    data = await apiGet('inventory/item_get', { id });
  } catch (e) {
    root.innerHTML = errorBox(e.message);
    return;
  }
  paintDetail(root, data);
}

function paintDetail(root, data) {
  const { item, lots, movements, can_manage } = data;
  const stock = lots.reduce((s, l) => s + l.quantity_remaining, 0);
  const activeLots = lots.filter((l) => l.quantity_remaining > 0);
  const nextExpiry = activeLots
    .map((l) => l.expiry_date)
    .filter(Boolean)
    .sort()[0] || null;

  const reload = () => renderDetail(root, item.id);

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-4">
      <a href="#/inventario" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>

      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg font-bold text-slate-900">${escapeHtml(item.name)}</h3>
              ${!item.is_active ? badge('Inactivo', 'bg-slate-100 text-slate-500') : ''}
            </div>
            <p class="mt-0.5 text-sm text-slate-500">
              ${item.category ? escapeHtml(item.category) + ' · ' : ''}${escapeHtml(item.unit)}
              ${item.barcode ? ` · ${escapeHtml(item.barcode)}` : ''}
            </p>
            ${item.notes ? `<p class="mt-2 text-sm text-slate-600">${escapeHtml(item.notes)}</p>` : ''}
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="btn-entrada" type="button" class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
              ${icon('download', 'h-4 w-4')} Entrada
            </button>
            <button id="btn-salida" type="button" ${!stock ? 'disabled' : ''}
                    class="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-40">
              ${icon('upload', 'h-4 w-4')} Salida
            </button>
            ${can_manage ? `
            <button id="btn-edit-item" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${icon('edit', 'h-4 w-4')} Editar
            </button>
            <button id="btn-toggle-active" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              ${item.is_active ? 'Desactivar' : 'Reactivar'}
            </button>` : ''}
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          ${statTile('Existencia', `${fmtQty(stock)} ${escapeHtml(item.unit)}`)}
          ${statTile('Mínimo', item.min_stock > 0 ? `${fmtQty(item.min_stock)} ${escapeHtml(item.unit)}` : '—')}
          ${statTile('Próxima caducidad', nextExpiry ? fmtDate(nextExpiry) : '—')}
          ${statTile('Lotes activos', String(activeLots.length))}
        </div>
      </div>

      <div>
        <h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Lotes (orden PEPS)</h4>
        ${lots.length ? `
        <div class="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-4 py-2.5">Lote</th>
                <th class="px-4 py-2.5">Recibido</th>
                <th class="px-4 py-2.5">Caduca</th>
                <th class="px-4 py-2.5 text-right">Recibido (cant.)</th>
                <th class="px-4 py-2.5 text-right">Restante</th>
                ${can_manage ? '<th class="px-4 py-2.5"></th>' : ''}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${lots.map((l) => lotRow(l, item, can_manage)).join('')}
            </tbody>
          </table>
        </div>` : emptyState('Sin lotes', 'Registra la primera entrada.')}
      </div>

      <div>
        <h4 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Movimientos recientes</h4>
        ${movements.length ? `
        <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          ${movements.map((m) => movementRow(m, item)).join('')}
        </div>` : emptyState('Sin movimientos', '')}
      </div>
    </div>`;

  root.querySelector('#btn-entrada').addEventListener('click', () => openEntradaModal(item, reload));
  root.querySelector('#btn-salida').addEventListener('click', () => openSalidaModal(item, stock, reload));
  root.querySelector('#btn-edit-item')?.addEventListener('click', () => openItemModal(item, {}, reload));
  root.querySelector('#btn-toggle-active')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      item.is_active ? 'Desactivar artículo' : 'Reactivar artículo',
      item.is_active
        ? `"${item.name}" dejará de aparecer en el catálogo activo. Su historial se conserva.`
        : `"${item.name}" volverá a aparecer en el catálogo activo.`,
      { confirmLabel: item.is_active ? 'Desactivar' : 'Reactivar', danger: item.is_active }
    );
    if (!ok) return;
    try {
      await apiPost('inventory/item_toggle_active', { id: item.id });
      reload();
    } catch (e) { toast(e.message, 'error'); }
  });
  root.querySelectorAll('[data-adjust-lot]').forEach((b) =>
    b.addEventListener('click', () => openAdjustModal(lots.find((l) => l.id === +b.dataset.adjustLot), item, reload)));
  root.querySelectorAll('[data-delete-lot]').forEach((b) =>
    b.addEventListener('click', async () => {
      const lot = lots.find((l) => l.id === +b.dataset.deleteLot);
      const ok = await confirmDialog('Eliminar lote', `Se eliminará el lote ${lot.lot_code || '#' + lot.id} (captura errónea). ¿Continuar?`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('inventory/lot_delete', { id: lot.id });
        toast('Lote eliminado');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function lotRow(l, item, canManage) {
  const untouched = l.quantity_received === l.quantity_remaining;
  return `
    <tr class="${l.quantity_remaining <= 0 ? 'opacity-50' : ''}">
      <td class="px-4 py-2.5 font-medium text-slate-800">${escapeHtml(l.lot_code || '#' + l.id)}</td>
      <td class="px-4 py-2.5 text-slate-500">${fmtDate(l.received_date)}</td>
      <td class="px-4 py-2.5">${l.expiry_date ? expiryBadgeFor(l.quantity_remaining > 0 ? l.expiry_date : null) || fmtDate(l.expiry_date) : '—'}</td>
      <td class="px-4 py-2.5 text-right text-slate-500">${fmtQty(l.quantity_received)}</td>
      <td class="px-4 py-2.5 text-right font-semibold text-slate-800">${fmtQty(l.quantity_remaining)}</td>
      ${canManage ? `
      <td class="whitespace-nowrap px-4 py-2.5 text-right">
        <button type="button" data-adjust-lot="${l.id}" title="Ajustar cantidad" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600">${icon('edit-3', 'h-4 w-4')}</button>
        ${untouched ? `<button type="button" data-delete-lot="${l.id}" title="Eliminar (captura errónea)" class="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>` : ''}
      </td>` : ''}
    </tr>`;
}

function movementRow(m, item) {
  const cfg = {
    entrada: { icon: 'download', cls: 'bg-emerald-50 text-emerald-600', sign: '+' },
    salida:  { icon: 'upload',   cls: 'bg-red-50 text-red-600',       sign: '−' },
    ajuste:  { icon: 'edit-3',   cls: 'bg-slate-100 text-slate-500',  sign: m.quantity >= 0 ? '+' : '−' },
  }[m.type] || { icon: 'package', cls: 'bg-slate-100 text-slate-500', sign: '' };
  return `
    <div class="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.cls}">${icon(cfg.icon, 'h-4 w-4')}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-slate-700">${cfg.sign}${fmtQty(Math.abs(m.quantity))} ${escapeHtml(item.unit)}${m.lot_code ? ` · lote ${escapeHtml(m.lot_code)}` : ''}</p>
        <p class="text-xs text-slate-400">${escapeHtml(m.reason || '')}${m.reason ? ' · ' : ''}${escapeHtml(m.user_name || '—')} · ${fmtDateTime(m.created_at)}</p>
      </div>
    </div>`;
}

/* ================= Escaneo ================= */
function scanForItem(canManage) {
  openScanModal(async (code) => {
    try {
      const { item } = await apiGet('inventory/barcode_lookup', { code });
      if (item) {
        location.hash = '#/inventario/' + item.id;
        return;
      }
      if (!canManage) {
        toast(`Ningún artículo tiene el código ${code}`, 'error');
        return;
      }
      const ok = await confirmDialog(
        'Artículo no encontrado',
        `Ningún artículo tiene el código "${code}". ¿Quieres crear uno nuevo con este código?`,
        { confirmLabel: 'Crear artículo' }
      );
      if (ok) openItemModal(null, { barcode: code }, (id) => { location.hash = '#/inventario/' + id; });
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

/** Modal de escaneo: lector USB (teclado + Enter) o cámara vía BarcodeDetector nativo. */
function openScanModal(onCode) {
  const box = document.createElement('div');
  box.innerHTML = `
    <div class="space-y-4">
      <div id="scan-camera-wrap" class="hidden overflow-hidden rounded-xl bg-slate-900">
        <video id="scan-video" class="w-full" playsinline muted></video>
      </div>
      <div>
        <label class="${labelCls}">Código de barras</label>
        <input id="scan-input" type="text" autocomplete="off" placeholder="Escanea o captura el código y presiona Enter"
               class="${inputCls}">
        <p class="mt-1 text-xs text-slate-400">Un lector USB escribe el código y presiona Enter automáticamente.</p>
      </div>
      ${'BarcodeDetector' in window ? `
      <button id="btn-camera" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
        ${icon('camera', 'h-4 w-4')} Usar cámara
      </button>` : `
      <p class="text-xs text-slate-400">Tu navegador no soporta escaneo por cámara; usa un lector USB o captura el código manualmente.</p>`}
      <div id="scan-error" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"></div>
    </div>`;

  let stream = null;
  let stopLoop = false;
  const cleanup = () => {
    stopLoop = true;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };

  const m = modal({
    title: 'Escanear artículo',
    content: box,
    size: 'max-w-md',
    actions: [{ label: 'Cerrar', onClick: (close) => { cleanup(); close(); } }],
  });
  m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('[data-close]')) cleanup(); });

  const input = box.querySelector('#scan-input');
  const submit = (code) => {
    code = code.trim();
    if (!code) return;
    cleanup();
    m.close();
    onCode(code);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(input.value); }
  });
  setTimeout(() => input.focus(), 50);

  box.querySelector('#btn-camera')?.addEventListener('click', async () => {
    const errBox = box.querySelector('#scan-error');
    box.querySelector('#scan-camera-wrap').classList.remove('hidden');
    const video = box.querySelector('#scan-video');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetector();
      const tick = async () => {
        if (stopLoop) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) { submit(codes[0].rawValue); return; }
        } catch { /* fotograma sin código: se reintenta */ }
        if (!stopLoop) setTimeout(tick, 300);
      };
      tick();
    } catch (e) {
      errBox.textContent = 'No se pudo acceder a la cámara: ' + e.message;
      errBox.classList.remove('hidden');
    }
  });
}

/** Tono corto (agudo=éxito, grave=error) para el escaneo continuo, sin archivos de audio. */
function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch { /* audio no disponible en este navegador: sigue funcionando en silencio */ }
}

/**
 * Ventana de escaneo continuo — "un beep, un movimiento", sin botón aceptar.
 * mode 'salida': cada lectura descuenta 1 unidad (PEPS) con el motivo fijado arriba.
 * mode 'entrada': cada lectura suma 1 unidad al lote de hoy con la caducidad fijada arriba
 * (agrupa lecturas repetidas del mismo artículo en un solo lote en vez de fragmentar).
 * Además del lector USB/cámara, un cuadro de búsqueda permite elegir el artículo a mano
 * (necesario si no tiene código de barras) sin romper el flujo continuo.
 */
function openScanSessionModal({ mode, items, reload }) {
  const isEntrada = mode === 'entrada';
  const box = document.createElement('div');
  box.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-xl bg-slate-50 p-3">
        ${isEntrada ? `
        <label class="${labelCls}">Fecha de caducidad de este lote</label>
        <input id="session-expiry" type="date" class="${inputCls}">
        <p class="mt-1 text-xs text-slate-400">
          Se aplica a partir de este momento; cámbiala entre remesas con distinta caducidad sin dejar de escanear.
          Déjala vacía si no aplica.
        </p>` : `
        <label class="${labelCls}">Motivo</label>
        <select id="session-reason" class="${inputCls}">
          ${REASONS.map((r) => `<option value="${escapeHtml(r)}" ${r === 'Uso clínico' ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
        </select>
        <p class="mt-1 text-xs text-slate-400">Se aplica a partir de este momento; cámbialo cuando cambie la razón de salida.</p>`}
      </div>

      <div>
        <label class="${labelCls}">Escanear</label>
        <input id="scan-input" type="text" autocomplete="off" placeholder="Escanea, o escribe el código y presiona Enter" class="${inputCls}">
        <p class="mt-1 text-xs text-slate-400">Un lector USB escribe el código y presiona Enter — no hace falta aceptar nada.</p>
      </div>

      <div class="relative">
        <label class="${labelCls}">Buscar manualmente</label>
        <input id="manual-search" type="text" autocomplete="off" placeholder="Nombre o código…" class="${inputCls}">
        <div id="manual-results" class="absolute inset-x-0 top-full z-10 mt-1 hidden max-h-48 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-slate-200"></div>
      </div>

      <div id="scan-camera-wrap" class="hidden overflow-hidden rounded-xl bg-slate-900">
        <video id="scan-video" class="w-full" playsinline muted></video>
      </div>
      ${'BarcodeDetector' in window ? `
      <button id="btn-camera" type="button" class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
        ${icon('camera', 'h-4 w-4')} Usar cámara
      </button>` : `
      <p class="text-xs text-slate-400">Tu navegador no soporta escaneo por cámara; usa un lector USB o la búsqueda manual.</p>`}

      <div>
        <h4 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Escaneado en esta sesión</h4>
        <div id="session-log" class="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-2">
          <p class="px-2 py-1 text-xs text-slate-400">Nada todavía — empieza a escanear.</p>
        </div>
      </div>
    </div>`;

  const tally = new Map(); // item_id -> { name, unit, count }
  const paintLog = () => {
    const logBox = box.querySelector('#session-log');
    if (!tally.size) {
      logBox.innerHTML = '<p class="px-2 py-1 text-xs text-slate-400">Nada todavía — empieza a escanear.</p>';
      return;
    }
    logBox.innerHTML = [...tally.values()].reverse().map((t) => `
      <div class="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-slate-100">
        <span class="truncate font-medium text-slate-700">${escapeHtml(t.name)}</span>
        <span class="shrink-0 font-bold ${isEntrada ? 'text-emerald-600' : 'text-red-600'}">${isEntrada ? '+' : '−'}${t.count} ${escapeHtml(t.unit)}</span>
      </div>`).join('');
  };

  let stream = null;
  let stopLoop = false;
  const cleanup = () => {
    stopLoop = true;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };

  const m = modal({
    title: isEntrada ? 'Añadir artículo — escaneo continuo' : 'Salida de artículo — escaneo continuo',
    content: box,
    size: 'max-w-lg',
    actions: [{ label: 'Cerrar', onClick: (close) => { cleanup(); reload?.(); close(); } }],
  });
  m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('[data-close]')) { cleanup(); reload?.(); } });

  let busy = false;
  const submitScan = async (payload) => {
    if (busy) return;
    busy = true;
    try {
      let data;
      if (isEntrada) {
        const expiry = box.querySelector('#session-expiry').value || null;
        data = await apiPost('inventory/scan_restock', { ...payload, expiry_date: expiry });
      } else {
        const reason = box.querySelector('#session-reason').value;
        data = await apiPost('inventory/scan_consume', { ...payload, reason });
      }
      const cur = tally.get(data.item.id) || { name: data.item.name, unit: data.item.unit, count: 0 };
      cur.count += 1;
      tally.set(data.item.id, cur);
      paintLog();
      beep(true);
    } catch (e) {
      beep(false);
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  };

  const scanInput = box.querySelector('#scan-input');
  scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = scanInput.value.trim();
      scanInput.value = '';
      if (code) submitScan({ code });
    }
  });
  setTimeout(() => scanInput.focus(), 50);

  const searchInput = box.querySelector('#manual-search');
  const resultsBox = box.querySelector('#manual-results');
  searchInput.addEventListener('input', debounce(() => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { resultsBox.classList.add('hidden'); return; }
    const matches = items.filter((it) => it.is_active
      && (it.name.toLowerCase().includes(q) || (it.barcode || '').toLowerCase().includes(q))).slice(0, 8);
    resultsBox.innerHTML = matches.length
      ? matches.map((it) => `
        <button type="button" data-id="${it.id}" class="block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50">
          <span class="font-medium text-slate-800">${escapeHtml(it.name)}</span>
          ${it.barcode ? `<span class="ml-2 text-xs text-slate-400">${escapeHtml(it.barcode)}</span>` : ''}
        </button>`).join('')
      : '<p class="px-4 py-2.5 text-sm text-slate-500">Sin coincidencias.</p>';
    resultsBox.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        searchInput.value = '';
        resultsBox.classList.add('hidden');
        submitScan({ item_id: Number(btn.dataset.id) });
      });
    });
    resultsBox.classList.remove('hidden');
  }, 250));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#manual-search') && !e.target.closest('#manual-results')) resultsBox.classList.add('hidden');
  });

  box.querySelector('#btn-camera')?.addEventListener('click', async () => {
    box.querySelector('#scan-camera-wrap').classList.remove('hidden');
    const video = box.querySelector('#scan-video');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetector();
      const tick = async () => {
        if (stopLoop) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            await submitScan({ code: codes[0].rawValue });
            if (!stopLoop) setTimeout(tick, 1200); // pausa breve: evita relecturas del mismo código en cámara
            return;
          }
        } catch { /* fotograma sin código: se reintenta */ }
        if (!stopLoop) setTimeout(tick, 300);
      };
      tick();
    } catch (e) {
      toast('No se pudo acceder a la cámara: ' + e.message, 'error');
    }
  });
}

/* ================= Modales de catálogo y movimientos ================= */
function openItemModal(item, presets, onSaved) {
  const isNew = !item;
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'name', label: 'Nombre', type: 'text', required: true, span: 'sm:col-span-2' }, item?.name || '')}
      <div class="sm:col-span-2">
        <label class="${labelCls}">Código de barras</label>
        <div class="flex gap-2">
          <input name="barcode" type="text" autocomplete="off" value="${escapeHtml(item?.barcode || presets.barcode || '')}" class="${inputCls}">
          <button type="button" id="btn-scan-field" title="Escanear con cámara"
                  class="flex shrink-0 items-center justify-center rounded-lg px-3 text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">${icon('camera', 'h-4 w-4')}</button>
        </div>
      </div>
      <div>
        <label class="${labelCls}">Categoría</label>
        <input name="category" list="inv-cat-list" autocomplete="off" value="${escapeHtml(item?.category || '')}" class="${inputCls}">
        <datalist id="inv-cat-list">${categoriesCache.map((c) => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
      </div>
      <div>
        <label class="${labelCls}">Unidad</label>
        <input name="unit" list="inv-unit-list" autocomplete="off" value="${escapeHtml(item?.unit || 'pieza')}" class="${inputCls}">
        <datalist id="inv-unit-list">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      </div>
      ${field({ key: 'min_stock', label: 'Stock mínimo (dispara alerta)', type: 'number', step: '0.01', min: 0 }, item?.min_stock ?? 0)}
      ${field({ key: 'notes', label: 'Notas', type: 'textarea', rows: 2, span: 'sm:col-span-2' }, item?.notes || '')}
      ${isNew ? `
      <div class="sm:col-span-2 rounded-xl bg-slate-50 p-3">
        <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Stock inicial (opcional)</p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          ${field({ key: 'initial_qty', label: 'Cantidad inicial', type: 'number', step: '0.01', min: 0 }, '')}
          ${field({ key: 'expiry_date', label: 'Fecha de caducidad', type: 'date' }, '')}
          <div>
            <label class="${labelCls}">Fecha de inclusión</label>
            <input type="text" value="${fmtDate(new Date().toISOString().slice(0, 10))}" disabled
                   class="${inputCls} bg-slate-100 text-slate-500">
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400">
          Si capturas cantidad, se registra como el primer lote (para control PEPS). Para reabastecer
          artículos ya existentes, usa "Añadir artículo" en la lista.
        </p>
      </div>` : ''}
    </div>`;

  modal({
    title: item ? 'Editar artículo' : 'Nuevo artículo',
    content: form,
    size: 'max-w-xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: item ? 'Guardar cambios' : 'Crear artículo', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            const { id } = await apiPost('inventory/item_save', { ...(item ? { id: item.id } : {}), ...v });
            toast(item ? 'Artículo actualizado' : 'Artículo creado');
            close();
            onSaved?.(id);
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });

  form.querySelector('#btn-scan-field').addEventListener('click', () => {
    openScanModal((code) => { form.querySelector('[name=barcode]').value = code; });
  });
}

function openEntradaModal(item, onSaved) {
  const form = document.createElement('form');
  const today = new Date().toISOString().slice(0, 10);
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ key: 'quantity', label: `Cantidad (${item.unit})`, type: 'number', step: '0.01', min: '0.01', required: true }, '')}
      ${field({ key: 'lot_code', label: 'Lote / clave del proveedor', type: 'text' }, '')}
      ${field({ key: 'received_date', label: 'Fecha de recepción', type: 'date', required: true }, today)}
      ${field({ key: 'expiry_date', label: 'Fecha de caducidad', type: 'date' }, '')}
      ${field({ key: 'supplier', label: 'Proveedor', type: 'text' }, '')}
      ${field({ key: 'unit_cost', label: 'Costo unitario (opcional)', type: 'number', step: '0.01', min: '0' }, '')}
      ${field({ key: 'notes', label: 'Notas', type: 'textarea', rows: 2, span: 'sm:col-span-2' }, '')}
    </div>`;

  modal({
    title: `Registrar entrada · ${item.name}`,
    content: form,
    size: 'max-w-xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Registrar entrada', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          try {
            await apiPost('inventory/lot_add', { item_id: item.id, ...formValues(form) });
            toast('Entrada registrada');
            close();
            onSaved?.();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function openSalidaModal(item, stock, onSaved) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="space-y-4">
      <p class="text-sm text-slate-500">Existencia disponible: <b>${fmtQty(stock)} ${escapeHtml(item.unit)}</b>. Se descuenta del lote más antiguo primero (PEPS).</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${field({ key: 'quantity', label: `Cantidad a retirar (${item.unit})`, type: 'number', step: '0.01', min: '0.01', max: String(stock), required: true }, '')}
        <div>
          <label class="${labelCls}">Motivo</label>
          <input name="reason" list="inv-reason-list" autocomplete="off" placeholder="Uso clínico" class="${inputCls}">
          <datalist id="inv-reason-list">${REASONS.map((r) => `<option value="${r}">`).join('')}</datalist>
        </div>
      </div>
    </div>`;

  modal({
    title: `Registrar salida · ${item.name}`,
    content: form,
    size: 'max-w-lg',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Registrar salida', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('inventory/lot_consume', { item_id: item.id, quantity: v.quantity, reason: v.reason });
            toast('Salida registrada');
            close();
            onSaved?.();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function openAdjustModal(lot, item, onSaved) {
  const form = document.createElement('form');
  form.innerHTML = `
    <div class="space-y-4">
      <p class="text-sm text-slate-500">Restante registrado: <b>${fmtQty(lot.quantity_remaining)} ${escapeHtml(item.unit)}</b></p>
      ${field({ key: 'quantity_remaining', label: 'Cantidad real restante', type: 'number', step: '0.01', min: '0', required: true }, lot.quantity_remaining)}
      ${field({ key: 'reason', label: 'Motivo del ajuste', type: 'text', required: true }, '')}
    </div>`;

  modal({
    title: `Ajustar lote ${lot.lot_code || '#' + lot.id}`,
    content: form,
    size: 'max-w-md',
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar ajuste', primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          try {
            await apiPost('inventory/lot_adjust', { lot_id: lot.id, quantity_remaining: v.quantity_remaining, reason: v.reason });
            toast('Lote ajustado');
            close();
            onSaved?.();
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

/* ================= Utilidades ================= */
function statTile(label, value) {
  return `
    <div class="rounded-xl bg-slate-50 p-3">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">${label}</p>
      <p class="mt-0.5 text-sm font-bold text-slate-800">${value}</p>
    </div>`;
}

function badge(text, cls) {
  return `<span class="rounded-full ${cls} px-2 py-0.5 text-[11px] font-semibold">${text}</span>`;
}

function fmtQty(n) {
  return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function emptyState(title, subtitle) {
  return `
    <div class="rounded-2xl bg-white py-14 text-center shadow-sm ring-1 ring-slate-200">
      <p class="text-sm font-medium text-slate-600">${escapeHtml(title)}</p>
      ${subtitle ? `<p class="mt-1 text-xs text-slate-400">${escapeHtml(subtitle)}</p>` : ''}
    </div>`;
}

function errorBox(message) {
  return `<div class="rounded-xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">${escapeHtml(message)}</div>`;
}
