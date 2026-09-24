@echo off
cd /d "%~dp0Api-Pocket-Base-Backup"
echo Deteniendo servidor API existente (puerto 8000)...
:: Matar SOLO el proceso que escucha en el puerto 8000 (el uvicorn de la API),
:: no todos los python.exe (eso mataría ComfyUI, el bridge, etc.)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /f /pid %%p 2>nul
echo Iniciando servidor API en segundo plano...

:: Crear un script VBS temporal para ejecutar en segundo plano (escapando paréntesis para Batch)
echo Set WshShell = CreateObject^("WScript.Shell"^) > run_hidden.vbs
echo WshShell.Run "python -m uvicorn main:app --host 0.0.0.0 --port 8000", 0, false >> run_hidden.vbs

:: Ejecutar el script y borrarlo
wscript.exe run_hidden.vbs
del run_hidden.vbs

echo Servidor iniciado exitosamente en segundo plano.
