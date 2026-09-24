const fs = require('fs');

// 1) Quitar el '}' duplicado en lib/views-mesh.ts
{
  const p = 'lib/views-mesh.ts';
  let s = fs.readFileSync(p, 'utf8');
  const bad = '  return { vertices, faces };\n}\n}\n\n/**\n * Construye un objeto 3D extruyendo';
  const good = '  return { vertices, faces };\n}\n\n/**\n * Construye un objeto 3D extruyendo';
  if (s.includes(bad)) {
    s = s.replace(bad, good);
    fs.writeFileSync(p, s);
    console.log('views-mesh: } duplicado eliminado');
  } else {
    console.log('views-mesh: patrón no encontrado (revisar)');
  }
}

// 2) Corregir el script de aplicación para futuras ejecuciones
{
  const p = 'tools/apply-calado-multiple-ciego.cjs';
  let s = fs.readFileSync(p, 'utf8');
  const bad = "replace: NEW_EXTRUDE + '\\n}\\n\\n/**\\n * Construye un objeto 3D extruyendo',";
  const good = "replace: NEW_EXTRUDE + '\\n\\n/**\\n * Construye un objeto 3D extruyendo',";
  if (s.includes(bad)) {
    s = s.replace(bad, good);
    fs.writeFileSync(p, s);
    console.log('apply: reemplazo corregido');
  } else {
    console.log('apply: reemplazo no encontrado (revisar)');
  }
}
