@echo off
chcp 65001 >nul
echo ========================================
echo 🧪 ZEUS - Prueba del Servidor de Vista Previa
echo ========================================
echo.

REM Verificar si el ejecutable existe
if not exist "preview-server.exe" (
    echo ❌ Error: preview-server.exe no encontrado
    echo Por favor compila primero ejecutando: compilar-todo.bat
    pause
    exit /b 1
)

echo ✅ Ejecutable encontrado
echo.

REM Verificar si la carpeta public existe
if not exist "public\" (
    echo ❌ Error: Carpeta public/ no encontrada
    echo El servidor necesita esta carpeta para funcionar
    pause
    exit /b 1
)

echo ✅ Carpeta public/ encontrada
echo.

REM Crear carpetas necesarias si no existen
if not exist "uploads\" mkdir uploads
if not exist "projects\" mkdir projects
if not exist "logs\" mkdir logs

echo ✅ Carpetas de trabajo verificadas
echo.

echo 🚀 Iniciando servidor en puerto 3032...
echo.
echo 📝 Instrucciones:
echo    - El servidor se iniciará en http://localhost:3032
echo    - Abre tu navegador en esa dirección
echo    - Presiona Ctrl+C para detener el servidor
echo.
echo ========================================
echo.

REM Iniciar el servidor
preview-server.exe

echo.
echo 🛑 Servidor detenido
pause
