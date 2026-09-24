const fs = require('fs');
const p = 'lib/views-mesh.ts';
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const before = s;

// Ancla única: el cierre del bucle del suelo del calado ciego + return.
const anchorTail = [
  '      faces.push([ring[tri[0]], ring[tri[1]], ring[tri[2]]]);',
  '    }',
  '  }',
  '',
  '  return { vertices, faces };',
].join(nl);

const replacement = [
  '      faces.push([ring[tri[0]], ring[tri[1]], ring[tri[2]]]);',
  '    }',
  '  }',
  '',
  '  // Orientación hacia FUERA: este constructor deja las caras con winding',
  '  // INTERIOR (mismo convenio heredado que ya existía). Se invierten todas',
  '  // para que las normales miren hacia fuera, igual que el recorrido',
  '  // (buildSweepMesh), de modo que el suelo del calado ciego mire a +Z',
  '  // (abertura del bolsillo) y las exportaciones STL/OBJ salgan correctas.',
  '  const orientedFaces = faces.map((f) => [...f].reverse());',
  '  return { vertices, faces: orientedFaces };',
].join(nl);

if (!s.includes(anchorTail)) {
  if (s.includes('orientedFaces')) {
    console.log('Ya aplicado.');
    process.exit(0);
  }
  console.error('Ancla no encontrada.');
  process.exit(1);
}
s = s.replace(anchorTail, replacement);
if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('Parche de orientación aplicado.');
}
