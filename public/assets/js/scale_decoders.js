/**
 * Decodificadores de básculas Bluetooth.
 *
 * Una báscula barata no sigue un estándar: manda el peso (y a veces la impedancia) dentro de los
 * bytes de su anuncio, y cada fabricante los acomoda a su manera. Por eso cada modelo tiene su
 * propio decodificador, y este registro está VACÍO hasta que se haya visto el informe real de la
 * báscula de la clínica (public/bascula_prueba.php). Un decodificador adivinado podría meter un
 * peso equivocado en un expediente clínico.
 *
 * Un decodificador es { id, label, match(adv), parse(adv) }:
 *   adv     = { name, rssi, manufacturerData: Map<number, Uint8Array>, serviceData: Map<string, Uint8Array> }
 *   match   → true si ese anuncio es de este modelo de báscula
 *   parse   → { pesoKg, impedancia?, estable? } o null si el anuncio no trae una medición (p. ej.
 *             la báscula apagándose o sin nadie encima)
 */

const decoders = [];

export function registerDecoder(decoder) {
  if (!decoder || typeof decoder.id !== 'string' || typeof decoder.match !== 'function' || typeof decoder.parse !== 'function') {
    throw new Error('Decodificador inválido');
  }
  const i = decoders.findIndex((d) => d.id === decoder.id);
  if (i >= 0) decoders.splice(i, 1);
  decoders.push(decoder);
}

export function unregisterDecoder(id) {
  const i = decoders.findIndex((d) => d.id === id);
  if (i >= 0) decoders.splice(i, 1);
}

export function hasDecoders() {
  return decoders.length > 0;
}

/** Copia un anuncio del navegador (BluetoothAdvertisingEvent) a una forma simple y probable. */
export function normalizeAdvertisement(ev) {
  const manufacturerData = new Map();
  ev.manufacturerData?.forEach((dv, id) => manufacturerData.set(id, new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))));
  const serviceData = new Map();
  ev.serviceData?.forEach((dv, uuid) => serviceData.set(uuid, new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength))));
  return { name: ev.device?.name || ev.name || '', rssi: ev.rssi, manufacturerData, serviceData };
}

/**
 * @returns {{decoder:string, reading:{pesoKg:number, impedancia?:number|null, estable?:boolean}}|null}
 *   null = ningún decodificador reconoce el anuncio, o es de una báscula pero sin medición.
 */
export function decodeAdvertisement(adv) {
  for (const d of decoders) {
    let matched = false;
    try { matched = d.match(adv); } catch { matched = false; }
    if (!matched) continue;
    let reading = null;
    try { reading = d.parse(adv); } catch { reading = null; }
    if (reading && Number.isFinite(reading.pesoKg)) return { decoder: d.id, reading };
    return null;
  }
  return null;
}

/** ¿Algún decodificador reconoce este anuncio como de su báscula (aunque no traiga medición)? */
export function isKnownScale(adv) {
  return decoders.some((d) => { try { return d.match(adv); } catch { return false; } });
}

export function bytesToHex(u8) {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}
