const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

console.log('🚀 Iniciando compilación del servidor de vista previa...\n');

// Configuración de pkg
const pkgConfig = {
  targets: ['node18-win-x64'],
  output: path.join(__dirname, 'preview-server.exe'),
  assets: [
    'public/**/*',
    'node_modules/**/*'
  ]
};

// Comando de pkg
// Nota: Los warnings de bytecode son normales y no críticos.
// Algunos módulos (ansi-styles, string-width, etc.) no se pueden convertir a bytecode
// pero funcionan correctamente en tiempo de ejecución.
const pkgCommand = `npx pkg server.js --targets node18-win-x64 --output preview-server.exe --compress GZip`;

console.log('📦 Compilando con pkg...');
console.log(`Comando: ${pkgCommand}\n`);
console.log('ℹ️  Nota: Los warnings sobre bytecode son normales y no afectan la funcionalidad.\n');

exec(pkgCommand, { cwd: __dirname, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Error durante la compilación:', error);
    console.error('stderr:', stderr);
    process.exit(1);
  }

  // Filtrar warnings de bytecode (no son críticos)
  const bytecodeWarnings = stderr && stderr.includes('Failed to make bytecode');
  const otherErrors = stderr && !stderr.includes('Failed to make bytecode');
  
  console.log(stdout);
  
  if (bytecodeWarnings) {
    console.log('\n⚠️  Advertencias de bytecode (no críticas):');
    console.log('   Algunos módulos no se pudieron convertir a bytecode.');
    console.log('   Esto es normal y NO afecta la funcionalidad del ejecutable.\n');
  }
  
  if (otherErrors) {
    console.warn('⚠️  Otras advertencias/errores:', stderr.replace(/Failed to make bytecode[^\n]*\n/g, ''));
  }

  if (error) {
    console.error('\n❌ Error durante la compilación:', error);
    process.exit(1);
  }

  console.log('\n✅ Compilación completada exitosamente!');
  console.log(`📁 Ejecutable creado en: ${path.join(__dirname, 'preview-server.exe')}`);
  console.log('\n📋 Próximos pasos:');
  console.log('1. Verifica que la carpeta "public" esté en el mismo directorio que el .exe');
  console.log('2. Ejecuta el instalador NSIS para crear el instalador');
  console.log('3. Instala la aplicación usando preview-server-setup.exe');
});
