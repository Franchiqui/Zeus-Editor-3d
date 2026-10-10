// Comprobación numérica de evaluateDeformadorTrack (lib/animation.ts) con
// THREE no requerido — solo la interpolación: lerp numérico con easing,
// strings/booleans sostenidos, warp de loop, límites y null con keyframes
// vacíos.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const anim = require('./anim-bundle.cjs');

let fallos = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fallos++;
    console.log('MAL', msg);
  } else {
    console.log('OK ', msg);
  }
};

// Pista de Doblar: angulo 0 → 180 (º como número crudo).
const track = {
  id: 'dtrack-test',
  objectId: 'obj1',
  deformadorId: 'doblar',
  duration: 10,
  looping: false,
  keyframes: [
    { time: 0, values: { angulo: 0, diametro: 50 }, easing: 'linear' },
    { time: 10, values: { angulo: 180, diametro: 20 }, easing: 'linear' },
  ],
};

ok(anim.evaluateDeformadorTrack(track, -1) !== null, 'antes del inicio: hold del primer kf');
const a0 = anim.evaluateDeformadorTrack(track, -1);
ok(a0.angulo === 0, 't<0 → primer valor (angulo 0)');

const a5 = anim.evaluateDeformadorTrack(track, 5);
ok(Math.abs(a5.angulo - 90) < 1e-9, 'lerp medio (angulo 90)');
ok(Math.abs(a5.diametro - 35) < 1e-9, 'lerp medio (diametro 35)');

const a10 = anim.evaluateDeformadorTrack(track, 10);
ok(a10.angulo === 180, 't=duration → 180');
ok(a10.diametro === 20, 't=duration → 20');

const a12 = anim.evaluateDeformadorTrack(track, 12);
ok(a12.angulo === 180, 'después del final: hold del último kf');

// Easing del keyframe FINAL (patrón de la pista: el easing del end manda).
const trackEase = {
  ...track,
  keyframes: [
    { time: 0, values: { angulo: 0 }, easing: 'linear' },
    { time: 10, values: { angulo: 180 }, easing: 'ease-out' },
  ],
};
const q = anim.evaluateDeformadorTrack(trackEase, 5);
// ease-out NO es lineal: en el medio va por delante (>90).
const qVal = Math.abs(q.angulo - 90);
ok(qVal > 1, `easing del kf final aplicado (desvío ${qVal.toFixed(2)})`);

// Números se interpolan SIEMPRE (hasta la semilla); los booleans/strings
// se SOSTIENEN del fotograma de origen del segmento.
const trackMix = {
  id: 'dtrack-mix',
  objectId: 'obj1',
  deformadorId: 'romper',
  duration: 10,
  looping: false,
  keyframes: [
    { time: 0, values: { semilla: 7, aleatoriedad: 0, extra: false, eje: 'x' }, easing: 'linear' },
    { time: 5, values: { semilla: 7, aleatoriedad: 100, extra: true, eje: 'y' }, easing: 'linear' },
    { time: 10, values: { semilla: 99, aleatoriedad: 0, extra: false, nuevo: true, eje: 'z' }, easing: 'linear' },
  ],
};
const m2 = anim.evaluateDeformadorTrack(trackMix, 2);
ok(m2.semilla === 7 && m2.aleatoriedad === 40, 'número lerp (kf2 aún no: semilla 7)');
ok(m2.extra === false, 'boolean sostenido del kf de origen (false en 0-5)');
ok(m2.eje === 'x', 'string sostenido del kf de origen (x en 0-5)');
const m7 = anim.evaluateDeformadorTrack(trackMix, 7);
ok(Math.abs(m7.semilla - 43.8) < 1e-9 && Math.abs(m7.aleatoriedad - 60) < 1e-9, 'lerp del segmento 5-10 a 40% (semilla 43.8, aleatoriedad 60)');
ok(m7.extra === true, 'boolean sostenido del kf de origen (true en 5-10)');
ok(m7.eje === 'y', 'string sostenido del kf de origen (y en 5-10)');
ok(m7.nuevo === true, 'boolean que nace en el kf destino: hold de `to`');
const m9 = anim.evaluateDeformadorTrack(trackMix, 9);
ok(Math.abs(m9.semilla - 80.6) < 1e-9, 'semilla numérica sí interpola (80.6 a 80%)');
ok(m9.extra === true, 'extra sostenido a t=9 (true)');
const m99 = anim.evaluateDeformadorTrack(trackMix, 10);
ok(m99.semilla === 99, 'en el kf destino la semilla YA es 99');

// Loop warp: t > duration vuelve a t - duration.
const trackLoop = { ...track, looping: true };
const l11 = anim.evaluateDeformadorTrack(trackLoop, 11);
const l1 = anim.evaluateDeformadorTrack(trackLoop, 1);
ok(
  Math.abs(l11.angulo - l1.angulo) < 1e-9,
  `loop warp t=11 == t=1 (${l11.angulo} vs ${l1.angulo})`
);

// Keyframes vacíos → null.
ok(
  anim.evaluateDeformadorTrack({ ...track, keyframes: [] }, 5) === null,
  'sin keyframes → null'
);

// Un solo kf → hold.
const trackSingle = { ...track, keyframes: [{ time: 2, values: { angulo: 40 }, easing: 'linear' }] };
ok(anim.evaluateDeformadorTrack(trackSingle, 0).angulo === 40, 'un kf: antes del hold');
ok(anim.evaluateDeformadorTrack(trackSingle, 9).angulo === 40, 'un kf: después del hold');

console.log(fallos === 0 ? 'TODO OK' : `${fallos} FALLAN`);
process.exit(fallos === 0 ? 0 : 1);