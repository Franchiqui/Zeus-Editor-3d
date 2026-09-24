const fs = require('fs');
const p = 'lib/views-mesh.ts';
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const before = s;

// Muros del agujero PASANTE: invertir el winding para que miren hacia el
// eje del agujero (hacia dentro del agujero), como corresponde al sólido.
const thruOld = [
  '      faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);',
].join(nl);
const thruNew = [
  '      faces.push([bIds[k], bIds[k2], fIds[k2], fIds[k]]);',
].join(nl);

// Muros del agujero CIEGO: idem.
const blindOld = [
  '      faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);',
].join(nl);

const countThru = s.split(thruOld).length - 1;
if (countThru !== 2) {
  if (!thruOld && false) {}
  if (s.includes('faces.push([bIds[k], bIds[k2], fIds[k2], fIds[k]]);')) {
    console.log('Ya aplicado.');
    process.exit(0);
  }
  console.error('Esperaba 2 ocurrencias del muro de agujero, encontradas ' + countThru);
  process.exit(1);
}
// Reemplazar AMBAS (pasante y ciego) por la versión invertida.
s = s.split(thruOld).join(thruNew);
if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('Winding de muros de agujero invertido (2 sitios).');
}
