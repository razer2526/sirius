/** Módulo Backup (Admin Tools): respaldo y restauración de la base de datos. */

import { apiGet } from '../api.js';
import { icon, escapeHtml, toast, modal, spinner, inputCls, labelCls } from '../ui.js';

let info = null;

export async function render(root, ctx) {
  const [view] = ctx.args;
  if (view === 'exportar') return renderExport(root);
  if (view === 'importar') return renderImport(root);
  return renderGrid(root);
}

/* ---------- Grid de opciones ---------- */
function renderGrid(root) {
  const card = (href, label, desc, iconName, color) => `
    <a href="${href}" class="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-300">
      <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${color}">${icon(iconName, 'h-7 w-7')}</span>
      <span class="min-w-0">
        <span class="block text-base font-semibold text-slate-900">${label}</span>
        <span class="block text-sm text-slate-500">${desc}</span>
      </span>
      <span class="ml-auto shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-500">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </span>
    </a>`;

  root.innerHTML = `
    <div class="mx-auto max-w-4xl space-y-5">
      <p class="text-sm text-slate-500">
        Respalda la información de Sirius o recupérala desde un archivo previo.
        El respaldo es un archivo único que funciona igual en el servidor y en desarrollo.
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${card('#/backup/exportar', 'Exportar', 'Descargar un respaldo de la base', 'download', 'bg-emerald-100 text-emerald-700')}
        ${card('#/backup/importar', 'Importar', 'Recuperar desde un archivo de respaldo', 'upload', 'bg-amber-100 text-amber-700')}
      </div>
      <div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h4 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Qué incluye</h4>
        <div id="grid-counts" class="text-sm text-slate-500">${spinner()}</div>
      </div>
    </div>`;

  apiGet('backups/info').then((data) => {
    info = data;
    const box = root.querySelector('#grid-counts');
    if (!box) return;
    box.innerHTML = `
      <ul class="divide-y divide-slate-100">
        ${Object.entries(data.groups).map(([, g]) => `
          <li class="flex items-center justify-between gap-3 py-2">
            <span class="text-slate-700">${escapeHtml(g.label)}</span>
            <span class="text-xs font-semibold text-slate-500">${g.total} registro(s)</span>
          </li>`).join('')}
      </ul>
      <p class="mt-3 text-xs text-slate-400">
        Las imágenes de membrete y los PDF archivados no van en este respaldo: se copian
        aparte desde la carpeta <b>uploads</b> del servidor.
      </p>`;
  });
}

/* ---------- Exportar ---------- */
function renderExport(root) {
  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/backup" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Exportar respaldo</h3>
        <p class="text-sm text-slate-500">Elige qué incluir. Se descargará un archivo con la fecha del día.</p>
      </div>
      <section id="export-groups" class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">${spinner()}</section>
      <div class="flex justify-end">
        <button id="btn-export" type="button" disabled
                class="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400">
          ${icon('download', 'h-4 w-4')} Descargar respaldo
        </button>
      </div>
    </div>`;

  apiGet('backups/info').then((data) => {
    info = data;
    const box = root.querySelector('#export-groups');
    box.innerHTML = `
      <div class="space-y-2">
        ${Object.entries(data.groups).map(([key, g]) => `
          <label class="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
            <span class="flex items-center gap-3">
              <input type="checkbox" data-group="${key}" checked class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
              <span class="text-sm font-medium text-slate-700">${escapeHtml(g.label)}</span>
            </span>
            <span class="shrink-0 text-xs font-semibold text-slate-500">${g.total}</span>
          </label>`).join('')}
      </div>`;
    root.querySelector('#btn-export').disabled = false;
  });

  root.querySelector('#btn-export').addEventListener('click', () => {
    const groups = [...root.querySelectorAll('[data-group]')].filter((c) => c.checked).map((c) => c.dataset.group);
    if (!groups.length) {
      toast('Selecciona al menos un grupo', 'error');
      return;
    }
    // La descarga va por su propio endpoint para que el navegador reciba el archivo
    window.location.href = 'respaldo.php?grupos=' + encodeURIComponent(groups.join(','));
    toast('Generando respaldo…');
  });
}

/* ---------- Importar ---------- */
function renderImport(root) {
  let file = null;
  let inspected = null;

  root.innerHTML = `
    <div class="mx-auto max-w-3xl space-y-5">
      <a href="#/backup" class="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        ${icon('chevron-left', 'h-4 w-4')} Volver
      </a>
      <div>
        <h3 class="text-lg font-bold text-slate-900">Importar respaldo</h3>
        <p class="text-sm text-slate-500">Selecciona un archivo de respaldo de Sirius para revisarlo antes de aplicarlo.</p>
      </div>

      <div class="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p class="text-sm font-semibold text-amber-900">Antes de continuar</p>
        <p class="mt-1 text-sm text-amber-800">
          Recuperar información modifica la base de datos. Te recomendamos
          <a href="respaldo.php" class="font-semibold underline">descargar un respaldo del estado actual</a>
          antes de importar, por si necesitas volver atrás.
        </p>
      </div>

      <section class="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
        <span class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">${icon('upload', 'h-6 w-6')}</span>
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
          ${icon('upload', 'h-4 w-4')} <span id="imp-label">Seleccionar archivo</span>
          <input type="file" id="imp-file" accept="application/json,.json" class="hidden">
        </label>
      </section>

      <section id="imp-detail" class="hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"></section>
    </div>`;

  root.querySelector('#imp-file').addEventListener('change', async (e) => {
    file = e.target.files[0];
    if (!file) return;
    root.querySelector('#imp-label').textContent = 'Revisando…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('api/index.php?r=backups/inspect', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      inspected = json.data;
      root.querySelector('#imp-label').textContent = file.name;
      paintDetail(root, file, inspected);
    } catch (err) {
      root.querySelector('#imp-label').textContent = 'Seleccionar archivo';
      toast(err.message, 'error');
    }
  });

  function paintDetail(root, file, d) {
    const box = root.querySelector('#imp-detail');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h4 class="mb-1 text-sm font-bold uppercase tracking-wide text-slate-700">Contenido del respaldo</h4>
      <p class="mb-4 text-xs text-slate-400">
        ${escapeHtml(file.name)} · generado el ${escapeHtml(d.created_at || '—')} · ${d.total} registro(s)
      </p>
      <ul class="divide-y divide-slate-100">
        ${Object.entries(d.tables).map(([t, n]) => `
          <li class="flex items-center justify-between gap-3 py-1.5">
            <span class="font-mono text-xs text-slate-600">${escapeHtml(t)}</span>
            <span class="text-xs font-semibold text-slate-500">${n}</span>
          </li>`).join('')}
      </ul>

      <div class="mt-5 space-y-3">
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <input type="radio" name="mode" value="merge" checked class="mt-1 h-4 w-4 border-slate-300 text-indigo-600">
          <span>
            <span class="block text-sm font-semibold text-slate-800">Agregar lo que falte</span>
            <span class="block text-xs text-slate-500">Conserva la información actual y solo incorpora los registros que no existan.</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
          <input type="radio" name="mode" value="replace" class="mt-1 h-4 w-4 border-red-300 text-red-600">
          <span>
            <span class="block text-sm font-semibold text-red-900">Reemplazar por completo</span>
            <span class="block text-xs text-red-700">Borra la información actual de esas tablas y deja solo la del respaldo.</span>
          </span>
        </label>
      </div>

      <div class="mt-5 flex justify-end">
        <button id="btn-restore" type="button"
                class="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          Restaurar
        </button>
      </div>`;

    box.querySelector('#btn-restore').addEventListener('click', () => {
      const replace = box.querySelector('input[name=mode]:checked').value === 'replace';
      replace ? confirmReplace(file) : doRestore(file, false, '');
    });
  }

  /** El reemplazo exige escribir la palabra completa: no basta un clic. */
  function confirmReplace(file) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="text-sm text-slate-600">
        Se <b class="text-red-700">borrará</b> la información actual de las tablas incluidas en el respaldo
        y quedará únicamente la del archivo. Esta acción no se puede deshacer.
      </p>
      <label class="${labelCls} mt-4">Escribe REEMPLAZAR para confirmar</label>
      <input type="text" id="confirm-word" autocomplete="off" class="${inputCls}" placeholder="REEMPLAZAR">`;

    modal({
      title: 'Confirmar reemplazo',
      content: wrap,
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Reemplazar datos',
          danger: true,
          onClick: (close, btn) => {
            const word = wrap.querySelector('#confirm-word').value.trim().toUpperCase();
            if (word !== 'REEMPLAZAR') {
              toast('Escribe REEMPLAZAR para confirmar', 'error');
              return;
            }
            btn.disabled = true;
            close();
            doRestore(file, true, 'REEMPLAZAR');
          },
        },
      ],
    });
  }

  async function doRestore(file, replace, confirmWord) {
    const fd = new FormData();
    fd.append('file', file);
    if (replace) {
      fd.append('replace', '1');
      fd.append('confirm', confirmWord);
    }
    toast('Restaurando…');
    try {
      const res = await fetch('api/index.php?r=backups/restore', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__siriusCsrf || '' },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const d = json.data;
      modal({
        title: 'Restauración completada',
        content: `
          <p class="text-sm text-slate-600">Se restauraron <b>${d.total}</b> registro(s) en modo
            <b>${d.replace ? 'reemplazo' : 'agregar'}</b>.</p>
          <ul class="mt-3 divide-y divide-slate-100 text-sm">
            ${Object.entries(d.restored).map(([t, n]) => `
              <li class="flex justify-between py-1"><span class="font-mono text-xs text-slate-600">${escapeHtml(t)}</span><span class="text-xs font-semibold text-slate-500">${n}</span></li>`).join('')}
          </ul>
          <p class="mt-3 text-xs text-slate-400">Vuelve a entrar si algún dato de tu sesión cambió.</p>`,
        actions: [{ label: 'Entendido', primary: true }],
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }
}
