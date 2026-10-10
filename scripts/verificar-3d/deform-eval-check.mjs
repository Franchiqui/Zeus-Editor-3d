// Verifica evaluateDeformadorTrack cuando el kf de ORIGEN del segmento no
// contiene la clave (pista nacida del autoclave «desde fuera»: kf@0 = {}).
const { evaluateDeformadorTrack } = await import('./anim-bundle.cjs');

const pista = {
  id: 'dtrack-prueba',
  objectId: 'obj1',
  deformadorId: 'doblar',
  duration: 5,
  looping: false,
  keyframes: [
    { time: 0, values: {}, easing: 'linear' },
    { time: 3, values: { angulo: 180 }, easing: 'linear' },
  ],
};

let fallos = 0;
const check = (nombre, cond) => {
  console.log((cond ? 'OK  ' : 'FAIL') + '  ' + nombre);
  if (!cond) fallos++;
};

const t15 = evaluateDeformadorTrack(pista, 1.5);
check('kf@0 = {} → t=1.5 incluye angulo', t15 && typeof t15.angulo === 'number');
check('t=1.5 angulo = 90 (lerp) o 180 (hold del kf destino)', t15 && (t15.angulo === 90 || t15.angulo === 180));

const t3 = evaluateDeformadorTrack(pista, 3);
check('t=3 angulo = 180', t3 && t3.angulo === 180);

const t0 = evaluateDeformadorTrack(pista, 0);
if (t0 && t0.angulo !== undefined) {
  console.log('INFO t=0 angulo =', t0.angulo, '(el kf vacío rellena algo)');
} else {
  console.log('INFO t=0 sin angulo (kfs vacíos → null o faltan claves)');
}

// Pista con kfs NEUTROS completos + kf editado en medio (caso «dentro del
// editor»): la evaluación debe interpolar y MANTENER las claves.
const neutro = { angulo: 0, diametro: 0 };
const dentro = {
  ...pista,
  keyframes: [
    { time: 0, values: { ...neutro }, easing: 'linear' },
    { time: 2.5, values: { angulo: 120, diametro: 0 }, easing: 'linear' },
    { time: 5, values: { ...neutro }, easing: 'linear' },
  ],
};
const d1 = evaluateDeformadorTrack(dentro, 1.25);
check('caso dentro: t=1.25 angulo = 60', d1 && Math.abs((d1.angulo ?? NaN) - 60) < 1e-6);
check('caso dentro: t=1.25 diametro = 0', d1 && d1.diametro === 0);

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);