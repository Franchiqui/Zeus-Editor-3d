// Script para limpiar localStorage de Zeus Media Studio
console.log('Limpiando localStorage...');

// Limpiar específicamente el problema de efectos personalizados
localStorage.removeItem('zeus-custom-effects');
console.log('Eliminado: zeus-custom-effects');

// Opcional: limpiar otras claves que puedan estar causando problemas
const keysToRemove = [
  'zeus-custom-effects',
  'timelineZoom',
  'zeus-recent-projects',
  'zeus-preferences'
];

keysToRemove.forEach(key => {
  if (localStorage.getItem(key)) {
    localStorage.removeItem(key);
    console.log(`Eliminado: ${key}`);
  }
});

console.log('Espacio liberado en localStorage');
console.log('Claves restantes:', Object.keys(localStorage));
