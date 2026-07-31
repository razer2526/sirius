/** Cliente de la API JSON de Sirius. */

let csrfToken = '';

export function setCsrf(token) {
  csrfToken = token;
  // Las subidas con FormData no pasan por request(): necesitan el token a mano
  window.__siriusCsrf = token;
}

async function request(route, { method = 'GET', body = null, params = null } = {}) {
  let url = `api/index.php?r=${encodeURIComponent(route)}`;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url += `&${k}=${encodeURIComponent(v)}`;
    }
  }
  // Los datos del sistema cambian a cada momento: nunca se sirven desde caché
  const opts = { method, headers: {}, cache: 'no-store' };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-CSRF-Token'] = csrfToken;
    if (body) opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new Error('Respuesta no válida del servidor');
  }
  if (res.status === 401) {
    window.location.href = 'login.php';
    throw new Error('Sesión expirada');
  }
  if (!json.ok) {
    const err = new Error(json.error || 'Error del servidor');
    err.code = json.code || res.status;
    throw err;
  }
  return json.data;
}

export const apiGet = (route, params) => request(route, { params });
export const apiPost = (route, body) => request(route, { method: 'POST', body });
