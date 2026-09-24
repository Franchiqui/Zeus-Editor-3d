@echo off
echo ========================================
echo 🚀 ZEUS - Compilador del Servidor de Vista Previa
echo ========================================
echo.

REM Verificar si Node.js está instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error: Node.js no está instalado
    echo Por favor instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js detectado
node --version
echo.

REM Verificar si las dependencias están instaladas
if not exist "node_modules\" (
    echo 📦 Instalando dependencias...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ Error al instalar dependencias
        pause
        exit /b 1
    )
    echo ✅ Dependencias instaladas
    echo.
)

REM Compilar el ejecutable
echo 🔨 Compilando preview-server.exe...
echo Esto puede tardar varios minutos, por favor espera...
echo.
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al compilar el ejecutable
    pause
    exit /b 1
)

echo.
echo ✅ Ejecutable compilado exitosamente
echo.

REM Verificar si el ejecutable existe
if not exist "preview-server.exe" (
    echo ❌ Error: preview-server.exe no fue creado
    pause
    exit /b 1
)

echo 📊 Tamaño del ejecutable:
dir preview-server.exe | findstr "preview-server.exe"
echo.

REM Verificar si NSIS está instalado
where makensis >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ⚠️  Advertencia: NSIS no está instalado
    echo No se puede crear el instalador automáticamente
    echo.
    echo Para crear el instalador:
    echo 1. Instala NSIS desde https://nsis.sourceforge.io/Download
    echo 2. Ejecuta: makensis installer.nsi
    echo.
    echo ✅ Compilación completada (sin instalador)
    pause
    exit /b 0
)

echo ✅ NSIS detectado
echo.

REM Crear el instalador
echo 📦 Creando instalador preview-server-setup.exe...
call npm run build:installer
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error al crear el instalador
    pause
    exit /b 1
)

echo.
echo ✅ Instalador creado exitosamente
echo.

REM Verificar si el instalador existe
if not exist "preview-server-setup.exe" (
    echo ❌ Error: preview-server-setup.exe no fue creado
    pause
    exit /b 1
)

echo 📊 Tamaño del instalador:
dir preview-server-setup.exe | findstr "preview-server-setup.exe"
echo.

echo 🔍 Verificando cloudflared.exe para túnel automático...
if exist "cloudflared.exe" (
    echo ✅ cloudflared.exe encontrado
    echo    Se incluirá en el instalador
    echo    El visor iniciará el túnel automáticamente al ejecutarse
    echo.
) else (
    echo ℹ️  cloudflared.exe no encontrado en serve/
    echo    El instalador lo descargará automáticamente desde GitHub durante la instalación
    echo    No es necesario descargarlo manualmente
    echo.
    echo    Opcional: Si quieres incluirlo ahora (más rápido):
    echo    1. Descarga desde: https://github.com/cloudflare/cloudflared/releases
    echo    2. Descarga: cloudflared-windows-amd64.exe
    echo    3. Renómbralo a: cloudflared.exe
    echo    4. Colócalo en esta carpeta (serve\)
    echo.
)

echo ========================================
echo ✅ COMPILACIÓN COMPLETADA EXITOSAMENTE
echo ========================================
echo.
echo 📁 Archivos generados:
echo    - preview-server.exe (ejecutable standalone)
echo    - preview-server-setup.exe (instalador)
if exist "cloudflared.exe" (
    echo    - cloudflared.exe (túnel automático) ✓
)
echo.
echo 📋 Próximos pasos:
echo    1. Ejecuta preview-server-setup.exe para instalar
echo    2. O copia preview-server.exe y la carpeta public/ a otro ordenador
echo    3. Lee INSTRUCCIONES-INSTALACION.md para más detalles
echo.
echo 🚀 El servidor se ejecutará en el puerto 3032
if exist "cloudflared.exe" (
    echo 🌐 El túnel se iniciará automáticamente
    echo    La URL se enviará automáticamente a ZEUS
) else (
    echo 🌐 El túnel se descargará e iniciará automáticamente durante la instalación
    echo    La URL se enviará automáticamente a ZEUS
)
echo.
pause
