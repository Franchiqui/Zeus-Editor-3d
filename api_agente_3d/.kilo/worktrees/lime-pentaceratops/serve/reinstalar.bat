@echo off
echo ========================================
echo ZEUS - Reinstalador del Visor de Vista Previa
echo ========================================
echo.

echo [1/4] Cerrando procesos de preview-server...
taskkill /F /IM preview-server.exe 2>nul
if %errorlevel% equ 0 (
    echo ✓ Proceso cerrado exitosamente
    timeout /t 2 /nobreak >nul
) else (
    echo ℹ No se encontraron procesos en ejecución
)
echo.

echo [2/4] Desinstalando versión anterior...
set UNINSTALLER="%LOCALAPPDATA%\ZEUS\VisorVistaPrevia\uninstaller.exe"
if exist %UNINSTALLER% (
    echo Ejecutando desinstalador...
    %UNINSTALLER% /S
    timeout /t 3 /nobreak >nul
    echo ✓ Desinstalación completada
) else (
    echo ℹ No se encontró instalación anterior
)
echo.

echo [3/4] Compilando nuevo instalador...
"C:\Program Files (x86)\NSIS\makensis.exe" installer.nsi
if %errorlevel% neq 0 (
    echo ✗ Error al compilar el instalador
    pause
    exit /b 1
)
echo ✓ Instalador compilado exitosamente
echo.

echo [4/4] Ejecutando instalador...
if exist "preview-server-setup.exe" (
    start "" "preview-server-setup.exe"
    echo ✓ Instalador iniciado
) else (
    echo ✗ No se encontró el instalador
    pause
    exit /b 1
)
echo.

echo ========================================
echo Proceso completado
echo ========================================
pause
