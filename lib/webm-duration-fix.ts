// Normaliza la duración de un webm grabado con MediaRecorder. Estos webm NO
// incluyen el elemento Matroska `Duration` dentro del `Info` del Segmento (o lo
// dejan a 0), por lo que la duración declarada es poco fiable: los reproductores
// externos leen una duración corta o errónea, `<video>.duration` puede salir
// `Infinity`, y el seek por tiempo (que usa en el export el ObjectNode vía
// getDomVideoFrame) falla o se congela. Aquí inyectamos/actualizamos el elemento
// `Duration` (float) con la duración real conocida, para que el contenedor quede
// bien formado.
//
// Si el parseo EBML no encaja con lo esperado, se devuelve el blob INTACTO
// (fallback seguro): nunca estropeamos un webm que no sepamos manejar.

type Vint = { value: number; length: number; unknown: boolean };

/** Nº de bytes de un VInt EBML según el primer byte (posición del bit a 1). */
function detectVintLength(first: number): number {
  if (first === 0) return 1;
  let length = 1;
  let mask = 0x80;
  while (length < 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  return length;
}

/** Lee un ID de elemento EBML en `offset`: valor = bytes completos como
 *  entero big-endian (INCLUYE el bit marcador, convención Matroska: Info=0x1549A966). */
function readElementId(buf: Uint8Array, offset: number): { value: number; length: number } | null {
  if (offset >= buf.length) return null;
  const length = detectVintLength(buf[offset]);
  if (offset + length > buf.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[offset + i];
  return { value, length };
}

/** Lee un tamaño EBML en `offset`: valor = bits de dato (sin el marcador).
 *  `unknown: true` si todos los bytes son 0xFF (streaming en vivo). */
function readVint(buf: Uint8Array, offset: number): Vint | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return { value: 0, length: 1, unknown: false };
  const length = detectVintLength(first);
  const dataBits = (0x80 >> (length - 1)) - 1; // bits de dato del primer byte
  let value = first & dataBits;
  for (let i = 1; i < length; i++) {
    if (offset + i >= buf.length) return null;
    value = value * 256 + buf[offset + i];
  }
  let unknown = false;
  if ((first & dataBits) === dataBits) {
    // Los bits de dato del primer byte están todos a 1: candidato a "unknown".
    // Confirma que los bytes de dato restantes (1..length-1) también lo estén.
    // No comprobamos el byte 0: es el marcador (p.ej. 0x01 en unknown de 8 bytes,
    // 0x1F en 4 bytes) y no es 0xFF.
    unknown = true;
    for (let i = 1; i < length; i++) {
      if (buf[offset + i] !== 0xff) { unknown = false; break; }
    }
  }
  return { value, length, unknown };
}

/** Codifica un tamaño EBML en `length` bytes. */
function writeVintSize(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 1; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  const marker = 0x80 >> (length - 1);
  out[0] = (v & (marker - 1)) | marker;
  return out;
}

/** Menor nº de bytes para codificar `value` como tamaño EBML (excluye unknown). */
function minSizeLength(value: number): number {
  let length = 1;
  let max = (1 << 7) - 2; // 126 para 1 byte
  while (value > max) {
    length++;
    max = (1 << (7 * length)) - 2;
    if (length >= 8) break;
  }
  return Math.min(length, 8);
}

interface ElementInfo {
  id: number;
  idLength: number;
  sizeLength: number;
  unknownSize: boolean;
  size: number;
  dataStart: number;
  dataEnd: number;
}

/** Itera los elementos hijo de un rango [start, end). */
function parseChildren(buf: Uint8Array, start: number, end: number): ElementInfo[] {
  const out: ElementInfo[] = [];
  let offset = start;
  while (offset < end) {
    const idV = readElementId(buf, offset);
    if (!idV) break;
    const idLength = idV.length;
    const sizeV = readVint(buf, offset + idLength);
    if (!sizeV) break;
    const dataStart = offset + idLength + sizeV.length;
    if (dataStart > end) break;
    let dataEnd: number;
    if (sizeV.unknown) {
      // Tamaño unknown: se extiende hasta el final del rango padre.
      dataEnd = end;
      out.push({
        id: idV.value,
        idLength,
        sizeLength: sizeV.length,
        unknownSize: true,
        size: dataEnd - dataStart,
        dataStart,
        dataEnd,
      });
      break; // un elemento unknown absorbe el resto
    }
    dataEnd = dataStart + sizeV.value;
    if (dataEnd > end) break;
    out.push({
      id: idV.value,
      idLength,
      sizeLength: sizeV.length,
      unknownSize: false,
      size: sizeV.value,
      dataStart,
      dataEnd,
    });
    offset = dataEnd;
  }
  return out;
}

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODESCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

/** Lee un uint big-endian de `buf[start, start+len)`. */
function readUint(buf: Uint8Array, start: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[start + i];
  return v;
}

/**
 * Inyecta/actualiza el elemento `Duration` (float64) del `Info` del Segmento
 * con `durationSeconds`. Devuelve un nuevo ArrayBuffer, o `null` si no pudo
 * localizar la estructura esperada (llamador debe usar el blob original).
 */
export function fixWebmDurationArrayBuffer(
  src: ArrayBuffer,
  durationSeconds: number,
): ArrayBuffer | null {
  const buf = new Uint8Array(src);
  if (buf.length < 16) return null;

  // Top-level: EBML header + Segment.
  const top = parseChildren(buf, 0, buf.length);
  const ebml = top.find((e) => e.id === ID_EBML);
  const segment = top.find((e) => e.id === ID_SEGMENT);
  if (!ebml || !segment) return null;
  // Sólo parcheamos Segments de tamaño "unknown" (lo que produce MediaRecorder,
  // streaming en vivo). Si el Segmento tuviera tamaño concreto, insertar bytes
  // en el Info lo dejaría corto y corrompería el contenedor → mejor no tocar.
  if (!segment.unknownSize) return null;
  const segmentDataStart = segment.dataStart;
  const segmentDataEnd = buf.length;
  if (segmentDataEnd > buf.length) return null;

  // Dentro del Segmento, busca el Info (suele ser el primer hijo).
  const segChildren = parseChildren(buf, segmentDataStart, segmentDataEnd);
  const info = segChildren.find((e) => e.id === ID_INFO);
  if (!info || info.unknownSize) return null;

  // Dentro del Info, busca TimecodeScale y Duration.
  const infoChildren = parseChildren(buf, info.dataStart, info.dataEnd);
  const tcs = infoChildren.find((e) => e.id === ID_TIMECODESCALE);
  if (!tcs) return null; // sin TimecodeScale no podemos calcular Duration
  const timecodeScale = readUint(buf, tcs.dataStart, tcs.size) || 1_000_000;
  const existingDuration = infoChildren.find((e) => e.id === ID_DURATION);

  // Duration (float) en unidades de TimecodeScale. Usamos double (8 bytes).
  const durationUnits = (durationSeconds * 1e9) / timecodeScale;
  const durBytes = new Uint8Array(8);
  new DataView(durBytes.buffer).setFloat64(0, durationUnits, false);
  // Elemento Duration = ID(2 bytes 0x4489) + size(0x88 = 8 bytes) + double(8).
  const durElement = new Uint8Array(2 + 1 + 8);
  durElement[0] = 0x44;
  durElement[1] = 0x89;
  durElement[2] = 0x88;
  durElement.set(durBytes, 3);

  // Reconstruye el contenido del Info: todos sus hijos existentes, sustituyendo
  // (o insertando tras TimecodeScale) el elemento Duration.
  const newInfoDataParts: Uint8Array[] = [];
  let placedDuration = false;
  for (const child of infoChildren) {
    if (child.id === ID_DURATION) {
      // Sustituye el Duration existente por el nuevo.
      if (!placedDuration) {
        newInfoDataParts.push(durElement);
        placedDuration = true;
      }
      // No copia el viejo.
      continue;
    }
    newInfoDataParts.push(buf.subarray(child.dataStart - child.idLength - child.sizeLength, child.dataEnd));
    if (child.id === ID_TIMECODESCALE && !placedDuration) {
      // Inserta el Duration justo después del TimecodeScale (orden Matroska).
      newInfoDataParts.push(durElement);
      placedDuration = true;
    }
  }
  if (!placedDuration) {
    // Sin TimecodeScale ya retornamos antes; por seguridad, al inicio.
    newInfoDataParts.unshift(durElement);
  }

  const newInfoData = concatBytes(newInfoDataParts);
  // Re-codifica el tamaño del Info. Reutiliza el nº de bytes original si cabe,
  // si no, usa el mínimo necesario (crece la cabecera y desplaza el resto).
  let newSizeLength = info.sizeLength;
  if (minSizeLength(newInfoData.length) > newSizeLength) {
    newSizeLength = minSizeLength(newInfoData.length);
  }
  const newSizeVint = writeVintSize(newInfoData.length, newSizeLength);
  const infoId = buf.subarray(info.dataStart - info.idLength - info.sizeLength, info.dataStart - info.sizeLength);

  // Empalma: [antes del Info] + Info(id + nuevoSize + nuevosDatos) + [tras el Info].
  const beforeInfo = buf.subarray(0, info.dataStart - info.idLength - info.sizeLength);
  const afterInfo = buf.subarray(info.dataEnd, buf.length);
  const result = concatBytes([beforeInfo, infoId, newSizeVint, newInfoData, afterInfo]);
  // Copia a un ArrayBuffer propio (result.buffer puede ser una vista con offset
  // o, según los tipos de TS, SharedArrayBuffer). Blob acepta el ArrayBuffer tal cual.
  const copy = new Uint8Array(result.byteLength);
  copy.set(result);
  return copy.buffer as ArrayBuffer;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Versión cómoda: toma un Blob webm y devuelve un Blob con la duración
 * normalizada, o el Blob original si no se pudo parchear.
 */
export async function fixWebmDurationBlob(
  blob: Blob,
  durationSeconds: number,
): Promise<Blob> {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return blob;
  }
  try {
    const buf = await blob.arrayBuffer();
    const fixed = fixWebmDurationArrayBuffer(buf, durationSeconds);
    if (!fixed) return blob;
    return new Blob([fixed], { type: blob.type || "video/webm" });
  } catch {
    return blob;
  }
}