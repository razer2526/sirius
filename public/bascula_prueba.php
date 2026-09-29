<?php
/**
 * Prueba de báscula Bluetooth (herramienta de diagnóstico, solo administradores).
 *
 * No guarda nada ni toca la base de datos: escucha lo que la báscula transmite y lo muestra en
 * bytes, para poder ver cómo cambian al pesarse y así descifrar el formato de ESA báscula.
 * Las básculas genéricas (las que usan la app OKOK, por ejemplo) casi nunca siguen el estándar
 * Bluetooth de peso: suelen mandar el peso y la impedancia dentro del "anuncio" de Bluetooth, sin
 * conexión, en un formato propio. Sin ver los bytes reales no hay forma de saberlo.
 *
 * Web Bluetooth solo funciona en Chrome/Edge (Windows, Android, ChromeOS, macOS) y con HTTPS.
 * No existe en ningún navegador de iPhone/iPad.
 */

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/permissions.php';

session_boot();
$me = current_user();
if (!$me) {
    header('Location: login.php');
    exit;
}
if (!is_admin_role($me)) {
    http_response_code(403);
    exit('Esta herramienta es solo para administradores.');
}
header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Prueba de báscula</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; --ok:#047857; --bad:#b91c1c; --accent:#4f46e5; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); }
  main { max-width:760px; margin:0 auto; padding:16px; }
  h1 { font-size:20px; margin:4px 0 2px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:22px 0 8px; }
  p { margin:6px 0; }
  .muted { color:var(--muted); font-size:13px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font-size:12px; padding:3px 9px; border-radius:99px; border:1px solid var(--line); background:#fff; }
  .chip.ok { color:var(--ok); border-color:#a7f3d0; background:#ecfdf5; }
  .chip.bad { color:var(--bad); border-color:#fecaca; background:#fef2f2; }
  ol { margin:6px 0 0; padding-left:20px; }
  li { margin:3px 0; }
  .row { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }
  button { font:inherit; font-weight:600; padding:9px 14px; border-radius:10px; border:1px solid #cbd5e1; background:#fff; color:var(--ink); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .log { font:12px/1.45 ui-monospace,Consolas,Menlo,monospace; background:#0f172a; color:#e2e8f0; border-radius:12px; padding:10px 12px; max-height:340px; overflow:auto; white-space:pre-wrap; word-break:break-all; }
  .log .t { color:#94a3b8; } .log .k { color:#7dd3fc; } .log .chg { background:#854d0e; color:#fef08a; border-radius:3px; }
  .log .err { color:#fca5a5; } .log .good { color:#86efac; }
  table { width:100%; border-collapse:collapse; font:12px/1.4 ui-monospace,Consolas,Menlo,monospace; }
  td, th { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); word-break:break-all; vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  .big { font-size:26px; font-weight:700; }
</style>
</head>
<body>
<main>
  <h1>Prueba de báscula Bluetooth</h1>
  <p class="muted">Herramienta de diagnóstico: no guarda nada. Sirve para ver qué transmite tu báscula y poder leerla desde Sirius.</p>

  <h2>Este equipo</h2>
  <div class="card"><div class="chips" id="chips"></div><p class="muted" id="cap-note" style="margin-top:8px"></p></div>

  <h2>Cómo hacer la prueba</h2>
  <div class="card">
    <ol>
      <li>Enciende la báscula (súbete un momento para despertarla) y ten el Bluetooth del equipo encendido.</li>
      <li>Pulsa <b>Buscar báscula</b> y elige la tuya en la lista (suele tener un nombre raro; si dudas, la que aparezca al despertarla).</li>
      <li>Súbete <b>descalzo</b> y espera a que marque un peso fijo. Baja, espera unos segundos y <b>vuelve a subir</b>, idealmente con otro peso (por ejemplo cargando algo).</li>
      <li>Pulsa <b>Copiar informe</b> y pégamelo en el chat.</li>
    </ol>
  </div>

  <div class="row">
    <button class="primary" id="btn-scan">Buscar báscula</button>
    <button id="btn-gatt" disabled>Explorar conexión (GATT)</button>
    <button id="btn-copy" disabled>Copiar informe</button>
    <button id="btn-clear" disabled>Limpiar</button>
  </div>

  <div class="card" id="dev-card" hidden>
    <p><b id="dev-name">—</b> <span class="muted" id="dev-id"></span></p>
    <p class="muted" id="dev-state"></p>
  </div>

  <h2>Datos en vivo</h2>
  <div class="log" id="log" aria-live="polite">Aún no hay datos. Pulsa “Buscar báscula”.</div>

  <h2>Anuncios distintos <span class="muted" id="adv-count"></span></h2>
  <div class="card" style="padding:6px"><table>
    <thead><tr><th>#</th><th>Datos</th><th>Veces</th></tr></thead>
    <tbody id="adv-rows"><tr><td colspan="3" class="muted">Sin datos todavía.</td></tr></tbody>
  </table></div>
</main>

<script>
(() => {
  'use strict';

  /* ---------- utilidades ---------- */
  const $ = (id) => document.getElementById(id);
  const hex = (dv) => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const t0 = performance.now();
  const stamp = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(6, ' ') + 's';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /** Marca en amarillo los bytes que cambiaron respecto al mensaje anterior del mismo origen. */
  function diffHex(prev, cur) {
    if (!prev) return esc(cur);
    const a = prev.split(' ');
    return cur.split(' ').map((b, i) => (a[i] !== b ? `<span class="chg">${b}</span>` : b)).join(' ');
  }

  /* ---------- estado ---------- */
  const state = {
    device: null,
    reportLines: [],          // texto plano, para "Copiar informe"
    adv: new Map(),           // payload -> { n, first, last, idx }
    lastByKey: new Map(),     // origen (mfg:xxxx / svc:xxxx) -> último hex
    advTotal: 0,
    gatt: [],                 // líneas de la exploración GATT
    notifs: 0,
  };

  function logHtml(cls, html) {
    const el = $('log');
    if (el.dataset.empty !== 'no') { el.innerHTML = ''; el.dataset.empty = 'no'; }
    const line = document.createElement('div');
    line.innerHTML = `<span class="t">${stamp()}</span> ${cls ? `<span class="${cls}">${html}</span>` : html}`;
    el.appendChild(line);
    while (el.childElementCount > 400) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  const say = (cls, text) => { logHtml(cls, esc(text)); state.reportLines.push(`[${stamp().trim()}] ${text}`); };

  /* ---------- Weight Scale estándar (0x2A9D), por si la báscula lo usa ---------- */
  function decodeStandardWeight(dv) {
    if (dv.byteLength < 3) return null;
    const flags = dv.getUint8(0);
    const raw = dv.getUint16(1, true);
    const imperial = !!(flags & 1);
    return imperial ? { valor: raw * 0.01, unidad: 'lb' } : { valor: raw * 0.005, unidad: 'kg' };
  }

  /* ---------- anuncios Bluetooth ---------- */
  function onAdvertisement(ev) {
    state.advTotal++;
    const parts = [];
    const sources = [];
    ev.manufacturerData.forEach((dv, id) => sources.push({ key: 'mfg:0x' + id.toString(16).padStart(4, '0'), label: 'fabricante 0x' + id.toString(16).padStart(4, '0'), hex: hex(dv) }));
    ev.serviceData.forEach((dv, uuid) => sources.push({ key: 'svc:' + uuid, label: 'servicio ' + uuid, hex: hex(dv) }));
    if (!sources.length) {
      // Algunas básculas no llevan datos en el anuncio: se anota una sola vez para saberlo.
      const k = 'sin-datos';
      if (!state.adv.has(k)) { state.adv.set(k, { n: 0, first: stamp().trim(), idx: state.adv.size + 1, texto: '(anuncio sin datos de fabricante ni de servicio)' }); say('', `anuncio sin datos (rssi ${ev.rssi}, uuids: ${[...(ev.uuids || [])].join(',') || 'ninguno'})`); }
      state.adv.get(k).n++;
      renderTable();
      return;
    }
    let changed = false;
    sources.forEach((s) => {
      const prev = state.lastByKey.get(s.key);
      parts.push(`<span class="k">${esc(s.label)}</span> ${diffHex(prev, s.hex)}`);
      if (prev !== s.hex) changed = true;
      state.lastByKey.set(s.key, s.hex);
    });
    const payload = sources.map((s) => `${s.label}: ${s.hex}`).join(' | ');
    let rec = state.adv.get(payload);
    if (!rec) {
      rec = { n: 0, first: stamp().trim(), idx: state.adv.size + 1, texto: payload };
      state.adv.set(payload, rec);
    }
    rec.n++;
    rec.last = stamp().trim();
    // Solo se escribe en el registro cuando algo CAMBIA: una báscula manda el mismo anuncio
    // varias veces por segundo, y lo interesante es cuándo cambian los bytes.
    if (changed) {
      logHtml('', `rssi ${ev.rssi} · ${parts.join(' · ')}`);
      state.reportLines.push(`[${stamp().trim()}] ANUNCIO rssi ${ev.rssi} · ${payload}`);
    }
    renderTable();
  }

  function renderTable() {
    const rows = [...state.adv.values()];
    $('adv-count').textContent = `(${rows.length} distintos de ${state.advTotal} recibidos)`;
    $('adv-rows').innerHTML = rows.slice(0, 120).map((r) => `<tr><td>${r.idx}</td><td>${esc(r.texto)}</td><td>${r.n}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin datos todavía.</td></tr>';
  }

  /* ---------- exploración GATT ---------- */
  async function exploreGatt() {
    const dev = state.device;
    if (!dev) return;
    $('btn-gatt').disabled = true;
    say('', 'Conectando por GATT… (muchas básculas no aceptan conexión mientras pesan; si falla, no es un error tuyo)');
    let server;
    try {
      server = await dev.gatt.connect();
    } catch (e) {
      say('err', `No se pudo conectar: ${e.name}: ${e.message}`);
      $('btn-gatt').disabled = false;
      return;
    }
    say('good', 'Conectado.');
    try {
      const services = await server.getPrimaryServices();
      say('', `Servicios visibles: ${services.length}`);
      for (const s of services) {
        say('k', `Servicio ${s.uuid}`);
        state.gatt.push(`SERVICIO ${s.uuid}`);
        let chars = [];
        try { chars = await s.getCharacteristics(); } catch (e) { say('err', `  no se pudieron listar características: ${e.message}`); }
        for (const c of chars) {
          const p = c.properties;
          const props = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => p[k]).join(',');
          say('', `  característica ${c.uuid} [${props}]`);
          state.gatt.push(`  CARACTERISTICA ${c.uuid} [${props}]`);
          if (p.read) {
            try { const v = await c.readValue(); say('', `    lectura: ${hex(v)}`); } catch (e) { say('err', `    lectura falló: ${e.message}`); }
          }
          if (p.notify || p.indicate) {
            try {
              await c.startNotifications();
              c.addEventListener('characteristicvaluechanged', (e) => {
                state.notifs++;
                const dv = e.target.value;
                let extra = '';
                if (c.uuid.startsWith('00002a9d')) {
                  const w = decodeStandardWeight(dv);
                  if (w) extra = `  → peso estándar: ${w.valor.toFixed(2)} ${w.unidad}`;
                }
                logHtml('good', `NOTIFICACIÓN ${c.uuid.slice(4, 8)}: ${diffHex(state.lastByKey.get('n:' + c.uuid), hex(dv))}${extra}`);
                state.reportLines.push(`[${stamp().trim()}] NOTIFICACION ${c.uuid}: ${hex(dv)}${extra}`);
                state.lastByKey.set('n:' + c.uuid, hex(dv));
              });
              say('good', `    suscrito a notificaciones; súbete a la báscula`);
            } catch (e) { say('err', `    no se pudo suscribir: ${e.message}`); }
          }
        }
      }
    } catch (e) {
      say('err', `Exploración interrumpida: ${e.name}: ${e.message}`);
    }
    $('btn-gatt').disabled = false;
  }

  /* ---------- buscar y escuchar ---------- */
  // Chrome solo deja leer los servicios que se declaran de antemano. Como no sé cuáles usa una
  // báscula genérica, se piden todos los de 16 bits del rango que usan los fabricantes (FF00-FFFF)
  // más los estándar de salud/báscula.
  const known = [0x1800, 0x1801, 0x180a, 0x180f, 0x181b, 0x181d, 0x1805, 0xfee0, 0xfee7, 0xfe95, 0xfd00];
  const vendor = Array.from({ length: 256 }, (_, i) => 0xff00 + i);
  const optionalServices = [...known, ...vendor];

  async function scan() {
    try {
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices });
      state.device = dev;
      $('dev-card').hidden = false;
      $('dev-name').textContent = dev.name || '(sin nombre)';
      $('dev-id').textContent = 'id ' + String(dev.id).slice(0, 10) + '…';
      say('good', `Dispositivo elegido: ${dev.name || '(sin nombre)'}`);
      $('btn-gatt').disabled = false;
      $('btn-copy').disabled = false;
      $('btn-clear').disabled = false;

      if (typeof dev.watchAdvertisements !== 'function') {
        $('dev-state').textContent = 'Este navegador no puede escuchar anuncios (watchAdvertisements). Prueba con “Explorar conexión (GATT)”.';
        say('err', 'watchAdvertisements no está disponible en este navegador.');
        return;
      }
      dev.addEventListener('advertisementreceived', onAdvertisement);
      await dev.watchAdvertisements();
      $('dev-state').textContent = 'Escuchando anuncios. Ahora súbete a la báscula.';
      say('good', 'Escuchando anuncios. Súbete a la báscula y espera a que marque un peso fijo.');
    } catch (e) {
      if (e.name === 'NotFoundError') say('', 'No elegiste ningún dispositivo.');
      else say('err', `${e.name}: ${e.message}`);
    }
  }

  /* ---------- informe ---------- */
  function buildReport() {
    const head = [
      '== Informe de báscula ==',
      `Fecha: ${new Date().toISOString()}`,
      `Navegador: ${navigator.userAgent}`,
      `Conexión segura: ${window.isSecureContext}`,
      `navigator.bluetooth: ${'bluetooth' in navigator}`,
      `Dispositivo: ${state.device ? (state.device.name || '(sin nombre)') : 'ninguno'}`,
      `watchAdvertisements: ${state.device ? typeof state.device.watchAdvertisements : 'n/a'}`,
      `Anuncios recibidos: ${state.advTotal} (${state.adv.size} distintos) · notificaciones: ${state.notifs}`,
      '',
      '-- Anuncios distintos (en orden de aparición) --',
      ...[...state.adv.values()].map((r) => `#${r.idx} x${r.n} (primero ${r.first}) ${r.texto}`),
      '',
      '-- GATT --',
      ...(state.gatt.length ? state.gatt : ['(no explorado)']),
      '',
      '-- Registro --',
      ...state.reportLines,
    ];
    return head.join('\n');
  }

  async function copyReport() {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      say('good', `Informe copiado (${text.length} caracteres). Pégalo en el chat.`);
    } catch {
      // Sin permiso de portapapeles: se muestra para copiarlo a mano.
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'width:100%;height:240px;margin-top:8px;font:12px monospace';
      $('log').after(ta); ta.select();
      say('', 'No se pudo copiar automáticamente: el informe está en el cuadro de abajo; selecciónalo y cópialo.');
    }
  }

  function clearAll() {
    state.reportLines = []; state.adv.clear(); state.lastByKey.clear(); state.advTotal = 0; state.gatt = []; state.notifs = 0;
    $('log').innerHTML = ''; $('log').dataset.empty = 'no';
    renderTable();
  }

  /* ---------- capacidades del equipo ---------- */
  function chips() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const items = [
      [window.isSecureContext, 'Conexión segura (HTTPS)', 'Sin HTTPS'],
      ['bluetooth' in navigator, 'Bluetooth del navegador disponible', 'Este navegador no tiene Bluetooth web'],
    ];
    $('chips').innerHTML = items.map(([ok, yes, no]) => `<span class="chip ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`).join('')
      + `<span class="chip">${/Android/.test(ua) ? 'Android' : ios ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : 'Otro equipo'}</span>`;
    let note = '';
    if (ios) note = 'En iPhone y iPad ningún navegador admite Bluetooth web (Apple no lo permite): desde este equipo no se puede leer la báscula. Usa un Android o una PC con Windows.';
    else if (!('bluetooth' in navigator)) note = 'Abre esta página en Chrome o Edge (Windows/Android). Firefox y Safari no tienen Bluetooth web.';
    else if (!window.isSecureContext) note = 'Bluetooth web solo funciona con HTTPS.';
    $('cap-note').textContent = note;
    $('btn-scan').disabled = !('bluetooth' in navigator) || !window.isSecureContext;
  }

  $('btn-scan').addEventListener('click', scan);
  $('btn-gatt').addEventListener('click', exploreGatt);
  $('btn-copy').addEventListener('click', copyReport);
  $('btn-clear').addEventListener('click', clearAll);
  chips();

  // Solo para pruebas automáticas de esta página (no hay báscula en un entorno de desarrollo).
  window.__bascula = { onAdvertisement, decodeStandardWeight, buildReport, state, diffHex, hex };
})();
</script>
</body>
</html>
