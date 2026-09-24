/**
 * Genera los archivos .zeus de prueba para los scripts de verificación.
 *
 * - prueba-b.zeus: archivo v3 con UN objeto (una figura de texto renombrada
 *   "PruebaB") y sin dueño. Es lo que T2 abre "En escena nueva".
 * - holacopy.zeus: copia de un archivo v3 real guardado por el editor
 *   (2 objetos con instantáneas). Lo usa T5 para la carga v3.
 * - viejo.zeus: archivo ANTIGUO (versión 2, sin sceneObjects, figura viva
 *   solo en el panel de Texto). Lo usa T6.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(AQUI, 'fixtures');
mkdirSync(FIXTURES, { recursive: true });

const FUENTE = 'F:\\Archivos Zeus\\Objeto 3D\\HOLA.zeus';

const original = JSON.parse(readFileSync(FUENTE, 'utf-8'));

// --- prueba-b.zeus: solo el primer objeto, renombrado ------------------
const [obj] = original.sceneObjects;
const pruebaB = {
  ...original,
  type: 'editor3d',
  version: 3,
  mode: 'scene',
  sceneObjects: [{ ...obj, name: 'PruebaB' }],
  selectedObjectId: obj.id,
  configObjectId: null,
};
writeFileSync(
  join(FIXTURES, 'prueba-b.zeus'),
  JSON.stringify(pruebaB),
  'utf-8'
);
console.log('fixtures/prueba-b.zeus escrito (1 objeto: PruebaB)');

// --- holacopy.zeus: copia íntegra del v3 real ---------------------------
writeFileSync(
  join(FIXTURES, 'holacopy.zeus'),
  JSON.stringify(original),
  'utf-8'
);
console.log('fixtures/holacopy.zeus escrito (copia v3, 2 objetos)');

// --- viejo.zeus: formato antiguo, figura viva en el panel de Texto ------
// Solo los campos que loadObject lee del panel; sin sceneObjects ni
// configObjectId la rama de archivos antiguos lo convierte en el objeto
// dueño de la pestaña text.
const viejo = {
  type: 'editor3d',
  version: 2,
  mode: 'text',
  text: 'VIEJO',
  fontCss: original.fontCss,
  textDepth: original.textDepth ?? 0.4,
  hollowText: false,
  greedyMesh: true,
  textRes: original.textRes ?? 24,
  textOpacity: 1,
  textMode: 'smooth',
  useFontColor: true,
  baseColor: original.baseColor ?? '#22d3ee',
  figureColor: original.figureColor ?? '#22d3ee',
  resolution: 32,
  meshStyle: 'suave',
  views: { front: [], side: [], top: [] },
  latheProfile: [],
  extrudeDepth: 0.5,
  extrudeHoles: [],
};
writeFileSync(join(FIXTURES, 'viejo.zeus'), JSON.stringify(viejo), 'utf-8');
console.log('fixtures/viejo.zeus escrito (v2, sin sceneObjects, texto VIEJO)');