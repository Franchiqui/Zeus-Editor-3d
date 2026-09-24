
; Script NSIS para el instalador del Preview Server

; Modern UI
!include "MUI2.nsh"

; Nombre del instalador / Producto
Name "ZEUS - Visor de Vista Previa"

; Archivo de salida
OutFile "preview-server-setup.exe"

; Directorio de instalación por defecto (en AppData para evitar problemas de permisos)
InstallDir "$LOCALAPPDATA\ZEUS\VisorVistaPrevia"

; Iconos del instalador (ventanas de setup) y del binario de setup
!define MUI_ICON "public\zeus-10.ico"
!define MUI_UNICON "public\zeus-10.ico"
Icon "public\logo-negro.ico"

; Metadatos de versión (mostrados en Programas y características)
VIProductVersion "1.2.0.0"
VIAddVersionKey "ProductName" "ZEUS - Visor de Vista Previa"
VIAddVersionKey "CompanyName" "ZEUS"
VIAddVersionKey "FileDescription" "Instalador del Visor de Vista Previa"
VIAddVersionKey "FileVersion" "1.2.0"
BrandingText "ZEUS"

; Nombre del producto para el registro (debe ser único)
!define MUI_PRODUCT "PreviewServerApp"

; Páginas de la interfaz de usuario
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Páginas de desinstalación
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Idioma
!insertmacro MUI_LANGUAGE "Spanish"

; Sección de instalación
Section "Preview Server"
  SetOutPath "$INSTDIR"
  File "preview-server.exe"
  
  ; Copiar carpeta public con todos sus archivos
  SetOutPath "$INSTDIR\public"
  File /r "public\*.*"
  
  ; Manejar cloudflared.exe para túnel automático
  ; Prioridad 1: Si está en public como cloudflared-windows-amd64.exe, copiarlo y renombrarlo
  IfFileExists "$INSTDIR\public\cloudflared-windows-amd64.exe" 0 +4
    DetailPrint "Copiando cloudflared.exe desde public..."
    SetOutPath "$INSTDIR"
    CopyFiles "$INSTDIR\public\cloudflared-windows-amd64.exe" "$INSTDIR\cloudflared.exe"
    Delete "$INSTDIR\public\cloudflared-windows-amd64.exe"
    Goto cloudflared_done
  
  ; Prioridad 2: Si está en la raíz del instalador, copiarlo
  ; Usar /nonfatal para que no falle si el archivo no existe
  DetailPrint "Verificando si cloudflared.exe está en el directorio de compilación..."
  SetOutPath "$INSTDIR"
  File /nonfatal "cloudflared.exe"
  ; Verificar si se copió exitosamente
  IfFileExists "$INSTDIR\cloudflared.exe" 0 +2
    Goto cloudflared_done
  
  ; Prioridad 3: Si no existe, descargarlo automáticamente desde GitHub
  DetailPrint "Descargando cloudflared.exe desde GitHub (esto puede tardar unos segundos)..."
  SetOutPath "$INSTDIR"
  ; URL de la última versión estable: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  ; Usando PowerShell para descargar (más confiable en Windows)
  ; Crear un script temporal de PowerShell para evitar problemas con comillas en NSIS
  FileOpen $0 "$TEMP\download-cloudflared.ps1" w
  FileWrite $0 '$ProgressPreference = "SilentlyContinue"$\r$\n'
  FileWrite $0 '$ErrorActionPreference = "Stop"$\r$\n'
  FileWrite $0 'try {$\r$\n'
  FileWrite $0 '  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"$\r$\n'
  FileWrite $0 '  $outFile = "$INSTDIR\cloudflared.exe"$\r$\n'
  FileWrite $0 '  Write-Host "Descargando desde: $url"$\r$\n'
  FileWrite $0 '  Write-Host "Guardando en: $outFile"$\r$\n'
  FileWrite $0 '  Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing$\r$\n'
  FileWrite $0 '  Start-Sleep -Seconds 2$\r$\n'
  FileWrite $0 '  if (Test-Path $outFile) {$\r$\n'
  FileWrite $0 '    $size = (Get-Item $outFile).Length$\r$\n'
  FileWrite $0 '    if ($size -gt 0) {$\r$\n'
  FileWrite $0 '      Write-Host "Descarga completada. Tamaño: $size bytes"$\r$\n'
  FileWrite $0 '      exit 0$\r$\n'
  FileWrite $0 '    } else {$\r$\n'
  FileWrite $0 '      Write-Host "ERROR: Archivo descargado está vacío"$\r$\n'
  FileWrite $0 '      Remove-Item $outFile -ErrorAction SilentlyContinue$\r$\n'
  FileWrite $0 '      exit 1$\r$\n'
  FileWrite $0 '    }$\r$\n'
  FileWrite $0 '  } else {$\r$\n'
  FileWrite $0 '    Write-Host "ERROR: Archivo no encontrado después de descargar"$\r$\n'
  FileWrite $0 '    exit 1$\r$\n'
  FileWrite $0 '  }$\r$\n'
  FileWrite $0 '} catch {$\r$\n'
  FileWrite $0 '  Write-Host "ERROR al descargar: $($_.Exception.Message)"$\r$\n'
  FileWrite $0 '  exit 1$\r$\n'
  FileWrite $0 '}'
  FileClose $0
  ; Ejecutar el script de PowerShell y capturar el código de salida
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\download-cloudflared.ps1"' $1
  ; Limpiar el script temporal
  Delete "$TEMP\download-cloudflared.ps1"
  
  ; Verificar si la descarga fue exitosa
  IfFileExists "$INSTDIR\cloudflared.exe" 0 +5
    DetailPrint "cloudflared.exe descargado exitosamente"
    Goto cloudflared_done
  
  ; Si falló la descarga, mostrar advertencia pero continuar
  DetailPrint "ADVERTENCIA: No se pudo descargar cloudflared.exe automaticamente"
  DetailPrint "Codigo de salida de PowerShell: $1"
  DetailPrint "El tunel automatico no estara disponible"
  DetailPrint "Puedes descargarlo manualmente desde: https://github.com/cloudflare/cloudflared/releases"
  
  cloudflared_done:
  
  ; Copiar carpeta node_modules (necesaria para el funcionamiento del ejecutable)
  SetOutPath "$INSTDIR\node_modules"
  File /r "node_modules\*.*"
  
  ; Crear carpetas necesarias
  SetOutPath "$INSTDIR"
  CreateDirectory "$INSTDIR\uploads"
  CreateDirectory "$INSTDIR\projects"
  CreateDirectory "$INSTDIR\logs"

  ; Carpeta de accesos directos en el menú Inicio
  CreateDirectory "$SMPROGRAMS\ZEUS\Visor de Vista Previa"
  CreateShortCut "$SMPROGRAMS\ZEUS\Visor de Vista Previa\Visor de Vista Previa.lnk" "$INSTDIR\preview-server.exe" "" "$INSTDIR\public\zeus-10.ico"
  
  ; Acceso directo en el escritorio
  CreateShortCut "$DESKTOP\ZEUS Visor de Vista Previa.lnk" "$INSTDIR\preview-server.exe" "" "$INSTDIR\public\zeus-10.ico"

  ; Desinstalador
  WriteUninstaller "$INSTDIR\uninstaller.exe"

  ; Escribir entradas de registro para el desinstalador (HKCU para no requerir admin)
  !define UNINSTALLER_EXE "$INSTDIR\uninstaller.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "DisplayName" "ZEUS - Visor de Vista Previa"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "UninstallString" "${UNINSTALLER_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "QuietUninstallString" "${UNINSTALLER_EXE} /S"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "NoRepair" 1
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "Publisher" "ZEUS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia" "DisplayVersion" "1.2.0"
SectionEnd

; Sección de desinstalación
Section "Uninstall"
  ; Eliminar archivos y carpetas
  Delete "$INSTDIR\preview-server.exe"
  Delete "$INSTDIR\cloudflared.exe"
  Delete "$INSTDIR\tunnel-url.txt"
  Delete "$INSTDIR\uninstaller.exe"
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\uploads"
  RMDir /r "$INSTDIR\projects"
  RMDir /r "$INSTDIR\logs"
  
  ; Eliminar accesos directos
  Delete "$SMPROGRAMS\ZEUS\Visor de Vista Previa\Visor de Vista Previa.lnk"
  Delete "$DESKTOP\ZEUS Visor de Vista Previa.lnk"
  RMDir "$SMPROGRAMS\ZEUS\Visor de Vista Previa"
  RMDir "$SMPROGRAMS\ZEUS"
  RMDir "$INSTDIR"

  ; Eliminar entradas de registro del desinstalador
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZEUS_VisorVistaPrevia"
SectionEnd
