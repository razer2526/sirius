/** Módulo Usuarios (Admin Tools): CRUD + matriz de permisos por módulo. */

import { apiGet, apiPost } from '../api.js';
import { icon, escapeHtml, toast, modal, confirmDialog, field, formValues, inputCls, labelCls, fmtDate } from '../ui.js';

const ROLES = [['estandar', 'Estandar'], ['administrador', 'Administrador'], ['developper', 'Developper']];
const ROLE_BADGE = {
  estandar: 'bg-slate-100 text-slate-700',
  administrador: 'bg-indigo-100 text-indigo-700',
  developper: 'bg-violet-100 text-violet-700',
};

let ctx;

export async function render(root, context) {
  ctx = context;
  root.innerHTML = `
    <div class="mx-auto max-w-5xl space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-slate-500">Crea usuarios y controla a qué módulos y herramientas tiene acceso cada uno.</p>
        <button id="btn-new-user" type="button"
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
          ${icon('plus', 'h-4 w-4')} Nuevo usuario
        </button>
      </div>
      <div id="users-list"></div>
    </div>`;
  root.querySelector('#btn-new-user').addEventListener('click', () => openUserModal(null));
  await loadUsers(root);
}

async function loadUsers(root) {
  const { users } = await apiGet('users/list');
  const list = root.querySelector('#users-list');
  list.innerHTML = `
    <div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Usuario</th>
              <th class="px-4 py-3">Rol</th>
              <th class="hidden px-4 py-3 sm:table-cell">Módulos</th>
              <th class="hidden px-4 py-3 md:table-cell">Alta</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${users.map((u) => rowHtml(u)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  list.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => openUserModal(users.find((u) => u.id === +btn.dataset.edit))));
  list.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const u = users.find((x) => x.id === +btn.dataset.del);
      const ok = await confirmDialog('Eliminar usuario', `¿Eliminar a "${u.username}"? Esta acción no se puede deshacer.`, { danger: true, confirmLabel: 'Eliminar' });
      if (!ok) return;
      try {
        await apiPost('users/delete', { id: u.id });
        toast('Usuario eliminado');
        loadUsers(document.getElementById('module-root'));
      } catch (e) {
        toast(e.message, 'error');
      }
    }));
}

function rowHtml(u) {
  const isAdmin = u.role !== 'estandar';
  const modCount = isAdmin ? 'Todos' : Object.keys(u.permissions || {}).length;
  return `
    <tr class="${u.is_active ? '' : 'opacity-50'}">
      <td class="px-4 py-3">
        <p class="font-semibold text-slate-800">${escapeHtml(u.full_name)}</p>
        <p class="text-xs text-slate-500">@${escapeHtml(u.username)}${u.is_active ? '' : ' · inactivo'}</p>
      </td>
      <td class="px-4 py-3">
        <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_BADGE[u.role] || ROLE_BADGE.estandar}">${escapeHtml(u.role)}</span>
        ${u.assignable ? '<span class="ml-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">Asignable</span>' : ''}
      </td>
      <td class="hidden px-4 py-3 text-slate-600 sm:table-cell">${modCount}</td>
      <td class="hidden px-4 py-3 text-slate-500 md:table-cell">${fmtDate(u.created_at)}</td>
      <td class="px-4 py-3">
        <div class="flex justify-end gap-1">
          <button type="button" data-edit="${u.id}" title="Editar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600">${icon('edit', 'h-4 w-4')}</button>
          <button type="button" data-del="${u.id}" title="Eliminar" class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">${icon('trash', 'h-4 w-4')}</button>
        </div>
      </td>
    </tr>`;
}

function openUserModal(user) {
  const isNew = !user;
  const perms = user?.permissions || {};

  const form = document.createElement('form');
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div><label class="${labelCls}">Usuario *</label>
        <input name="username" type="text" value="${escapeHtml(user?.username || '')}" ${isNew ? 'required' : 'disabled'}
               class="${inputCls} ${isNew ? '' : 'opacity-60'}"></div>
      ${field({ key: 'full_name', label: 'Nombre completo', type: 'text', required: true }, user?.full_name || '')}
      ${field({ key: 'role', label: 'Rol', type: 'select', options: ROLES, required: true }, user?.role || 'estandar')}
      <div><label class="${labelCls}">Contraseña ${isNew ? '*' : '(dejar vacío para no cambiar)'}</label>
        <input name="password" type="password" ${isNew ? 'required' : ''} minlength="6" autocomplete="new-password" class="${inputCls}"></div>
      ${isNew ? '' : `<div class="sm:col-span-2"><label class="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="is_active" ${user.is_active ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600"> Usuario activo</label></div>`}
      <div class="sm:col-span-2">
        <label class="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="assignable" ${user?.assignable ? 'checked' : ''} class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600">
          <span>
            Puede ser asignado como responsable de pacientes
            <span class="block text-xs text-slate-400">Aparece en el desplegable "Responsable asignado" de Admisión (médicos, podólogos, fisioterapeutas, etc.)</span>
          </span>
        </label>
      </div>
    </div>

    <div id="perm-matrix" class="mt-5">
      <p class="${labelCls}">Permisos por módulo</p>
      <p class="mb-2 text-xs text-slate-400">Solo aplica a usuarios con rol Estandar. Administradores y Developpers tienen acceso total.</p>
      <div class="overflow-hidden rounded-xl ring-1 ring-slate-200">
        ${ctx.registry.map((m) => {
          const has = !!perms[m.key];
          const flags = Object.entries(m.flags || {});
          return `
          <div class="border-b border-slate-100 px-4 py-3 last:border-0">
            <label class="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" data-perm-module="${m.key}" ${has ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600">
              ${escapeHtml(m.label)}${m.group === 'admin_tools' ? ' <span class="text-xs font-normal text-slate-400">(Admin Tools)</span>' : ''}
            </label>
            ${flags.length ? `
            <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-6">
              ${flags.map(([fk, fl]) => `
                <label class="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" data-perm-flag="${m.key}:${fk}" ${perms[m.key]?.[fk] ? 'checked' : ''} class="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600">
                  ${escapeHtml(fl)}
                </label>`).join('')}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;

  const roleSelect = form.querySelector('[name=role]');
  const matrix = form.querySelector('#perm-matrix');
  const syncMatrix = () => matrix.classList.toggle('hidden', roleSelect.value !== 'estandar');
  roleSelect.addEventListener('change', syncMatrix);
  syncMatrix();

  modal({
    title: isNew ? 'Nuevo usuario' : `Editar: ${user.username}`,
    content: form,
    size: 'max-w-2xl',
    actions: [
      { label: 'Cancelar' },
      {
        label: isNew ? 'Crear usuario' : 'Guardar cambios',
        primary: true,
        onClick: async (close, btn) => {
          if (!form.reportValidity()) return;
          btn.disabled = true;
          const v = formValues(form);
          const permissions = {};
          form.querySelectorAll('[data-perm-module]').forEach((cb) => {
            if (!cb.checked) return;
            const key = cb.dataset.permModule;
            permissions[key] = {};
            form.querySelectorAll(`[data-perm-flag^="${key}:"]`).forEach((f) => {
              if (f.checked) permissions[key][f.dataset.permFlag.split(':')[1]] = true;
            });
          });
          const payload = {
            full_name: v.full_name, role: v.role, permissions, assignable: v.assignable,
            ...(v.password ? { password: v.password } : {}),
          };
          try {
            if (isNew) {
              await apiPost('users/create', { ...payload, username: v.username, password: v.password });
              toast('Usuario creado');
            } else {
              await apiPost('users/update', { ...payload, id: user.id, is_active: v.is_active });
              toast('Cambios guardados');
            }
            close();
            loadUsers(document.getElementById('module-root'));
          } catch (e) {
            btn.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}
