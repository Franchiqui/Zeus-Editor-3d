@echo off
setlocal enabledelayedexpansion

REM Evitar que la ventana se cierre automáticamente
if "%1"=="" (
    cmd /k "%~f0" run
    exit /b
)

REM Función para mostrar error y pausar
goto :main

:error_exit
echo.
echo ========================================
echo ERROR: El proceso se detuvo
echo ========================================
echo.
pause
exit /b 1

:main

REM Cambiar al directorio del script
cd /d "%~dp0"

REM Verificar que estamos en el directorio correcto
if not exist "package.json" (
    echo ERROR: No se encontro package.json
    echo Asegurate de ejecutar este script desde la carpeta serve/
    echo Directorio actual: %CD%
    pause
    exit /b 1
)

echo ========================================
echo ZEUS - Actualizar y Reinstalar
echo ========================================
echo.

echo [1/6] Cerrando procesos de preview-server...
taskkill /F /IM preview-server.exe >nul 2>&1
set ERR=%errorlevel%
if !ERR! equ 0 (
    echo Proceso cerrado exitosamente
    timeout /t 2 /nobreak >nul
) else (
    echo No se encontraron procesos en ejecucion
)
echo.

echo [2/6] Desinstalando version anterior...
set UNINSTALLER="%LOCALAPPDATA%\ZEUS\VisorVistaPrevia\uninstaller.exe"
if exist %UNINSTALLER% (
    echo Ejecutando desinstalador...
    %UNINSTALLER% /S
    timeout /t 3 /nobreak >nul
    echo Desinstalacion completada
) else (
    echo No se encontro instalacion anterior
)
echo.

echo [3/6] Actualizando API Auto Build Fix...
REM Crear carpetas necesarias
if not exist "public" (
    mkdir "public"
)
if not exist "public\auto-build-fix" (
    mkdir "public\auto-build-fix"
)

REM Verificar y copiar el archivo
set API_SOURCE=..\app\api\auto-build-fix\route.ts
if exist "%API_SOURCE%" (
    echo Copiando API desde: %API_SOURCE%
    copy /Y "%API_SOURCE%" "public\auto-build-fix\route.ts" >nul 2>&1
    REM Verificar que el archivo se copió correctamente (más confiable que errorlevel)
    timeout /t 1 /nobreak >nul
    if exist "public\auto-build-fix\route.ts" (
        echo API actualizada correctamente
    ) else (
        echo ERROR: El archivo no se copio correctamente
        echo Archivo fuente: %API_SOURCE%
        echo Archivo destino: public\auto-build-fix\route.ts
        echo Verificando permisos y rutas...
        goto error_exit
    )
) else (
    echo ERROR: No se encontro el archivo fuente
    echo Buscando en: %API_SOURCE%
    echo Directorio actual: %CD%
    echo.
    echo Verifica que la estructura del proyecto sea correcta
    goto error_exit
)
echo.

echo [3.5/6] Verificando cloudflared.exe para tunel automatico...
if exist "cloudflared.exe" (
    echo cloudflared.exe encontrado - Se incluira en el instalador
    echo   El visor iniciara el tunel automaticamente al ejecutarse
) else (
    echo cloudflared.exe no encontrado en serve/
    echo   El instalador lo descargara automaticamente desde GitHub durante la instalacion
    echo   No es necesario descargarlo manualmente
    echo.
    echo   Opcional: Si quieres incluirlo ahora mas rapido
    echo   1. Descarga desde: https://github.com/cloudflare/cloudflared/releases
    echo   2. Descarga: cloudflared-windows-amd64.exe
    echo   3. Renombralo a: cloudflared.exe
    echo   4. Colocalo en la carpeta serve
    echo.
)
echo.

echo [4/6] Compilando nuevo ejecutable con correccion de concurrently...
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    if !errorlevel! neq 0 (
        echo ERROR: No se pudieron instalar las dependencias
        goto error_exit
    )
)
call npm run build
set ERR=%errorlevel%
if !ERR! neq 0 (
    echo ERROR: Error al compilar el ejecutable
    echo Codigo de error: !ERR!
    goto error_exit
)
if not exist "preview-server.exe" (
    echo ERROR: preview-server.exe no fue creado
    goto error_exit
)
echo Ejecutable compilado exitosamente
echo [4.5/6] Iniciando API Python de Backup en segundo plano...
if exist "public\Api-Pocket-Base-Backup" (
    pushd "public\Api-Pocket-Base-Backup"
    echo Deteniendo procesos previos...
    taskkill /f /im python.exe >nul 2>&1
    echo Creando lanzador invisible...
    echo Set WshShell = CreateObject^("WScript.Shell"^) > run_hidden.vbs
    echo WshShell.Run "python -m uvicorn main:app --host 0.0.0.0 --port 8000", 0, false >> run_hidden.vbs
    wscript.exe run_hidden.vbs
    timeout /t 1 >nul
    del run_hidden.vbs
    popd
    echo API iniciada exitosamente en segundo plano
) else (
    echo Advertencia: no se encontro public\Api-Pocket-Base-Backup
)
echo.

echo [5/6] Compilando instalador NSIS...
if not exist "C:\Program Files (x86)\NSIS\makensis.exe" (
    echo ERROR: NSIS no esta instalado o no se encuentra en la ruta esperada
    echo Instala NSIS desde: https://nsis.sourceforge.io/Download
    goto error_exit
)
"C:\Program Files (x86)\NSIS\makensis.exe" installer.nsi
set ERR=%errorlevel%
if !ERR! neq 0 (
    echo ERROR: Error al compilar el instalador
    echo Codigo de error: !ERR!
    echo.
    echo Verifica que installer.nsi este correcto
    goto error_exit
)
if not exist "preview-server-setup.exe" (
    echo ERROR: preview-server-setup.exe no fue creado
    goto error_exit
)
echo Instalador compilado exitosamente
echo.

echo [6/6] Ejecutando instalador...
if exist "preview-server-setup.exe" (
    start "" "preview-server-setup.exe"
    echo Instalador iniciado
) else (
    echo ERROR: No se encontro el instalador
    goto error_exit
)
echo.

echo ========================================
echo Proceso completado
echo ========================================
echo.
echo La correccion de concurrently ha sido aplicada.
echo Ahora el servidor instalara automaticamente concurrently
echo cuando detecte que un proyecto lo necesita.
echo.
if exist "cloudflared.exe" (
    echo TUNEL AUTOMATICO HABILITADO
    echo   El visor iniciara el tunel de Cloudflare automaticamente
    echo   La URL del tunel se enviara automaticamente a ZEUS
    echo   No necesitas configurar variables en Vercel manualmente
) else (
    echo TUNEL AUTOMATICO SE HABILITARA AUTOMATICAMENTE
    echo   El instalador descargara cloudflared.exe desde GitHub
    echo   El visor iniciara el tunel automaticamente al ejecutarse
    echo   La URL del tunel se enviara automaticamente a ZEUS
    echo   No necesitas configurar variables en Vercel manualmente
)
echo.
pause
