/**
 * Outbox local del wizard de admisión: cuando episodes/create falla por falta de
 * señal (no porque el servidor rechace los datos), la captura completa se guarda
 * aquí en vez de perderse. IndexedDB porque el dispositivo puede cerrarse entre
 * la captura y el reenvío, y localStorage no da margen cómodo para varias
 * admisiones en cola, cada una con su firma en base64.
 *
 * Cada registro lleva su propio client_uuid, que también viaja al servidor:
 * es la clave que hace que reintentar el mismo envío dos veces (recarga,
 * doble sincronización) actualice/ignore en vez de duplicar al paciente.
 */

import { apiPost } from './api.js';

const DB_NAME = 'sirius-wizard-outbox';
const DB_VERSION = 1;
const STORE = 'pending';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'client_uuid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Guarda una captura que no se pudo enviar. Devuelve su client_uuid. */
export async function outboxEnqueue(payload) {
  const record = {
    client_uuid: crypto.randomUUID(),
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    failed: false,
    error: null,
  };
  const db = await openDb();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).add(record));
  return record.client_uuid;
}

export async function outboxList() {
  const db = await openDb();
  return promisify(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}

/**
 * Cuenta pendientes y fallidas por separado: son cosas distintas para quien
 * captura. "Pendiente" se va a enviar solo en cuanto haya señal; "fallida" ya
 * tuvo señal y el servidor rechazó los datos, así que reintentarla a ciegas no
 * la resuelve — alguien tiene que revisarla.
 */
export async function outboxCount() {
  const list = await outboxList();
  return {
    pending: list.filter((r) => !r.failed).length,
    failed: list.filter((r) => r.failed).length,
  };
}

async function outboxRemove(clientUuid) {
  const db = await openDb();
  await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(clientUuid));
}

async function outboxPatch(clientUuid, patch) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = await promisify(store.get(clientUuid));
  if (rec) {
    await promisify(store.put({ ...rec, ...patch }));
  }
}

/**
 * Reintenta cada admisión pendiente. Sólo se retira de la cola si el servidor
 * la confirma; un fallo de red la deja en su lugar para el próximo intento, pero
 * un rechazo del servidor (datos inválidos) se marca como fallida en vez de
 * reintentarse a ciegas para siempre: eso no lo arregla un reintento, lo tiene
 * que revisar alguien.
 */
export async function outboxFlush() {
  const pending = (await outboxList()).filter((r) => !r.failed);
  let synced = 0;
  for (const rec of pending) {
    try {
      await apiPost('episodes/create', { ...rec.payload, client_uuid: rec.client_uuid });
      await outboxRemove(rec.client_uuid);
      synced++;
    } catch (err) {
      if (err.code === undefined) {
        // Sin .code: fetch nunca llegó a obtener respuesta (sigue sin señal).
        await outboxPatch(rec.client_uuid, { attempts: rec.attempts + 1, error: err.message });
      } else {
        // El servidor sí respondió y rechazó la captura: no es un problema de red.
        await outboxPatch(rec.client_uuid, { failed: true, error: err.message });
      }
    }
  }
  return synced;
}
