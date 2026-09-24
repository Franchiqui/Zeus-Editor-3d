# Guía de personalización de la ventana (Electron)

Esta guía explica cómo cambiar el color de la ventana, los menús nativos y los botones de ventana (minimizar, maximizar, cerrar) en Zeus Media Studio.

---

## 1. Color de fondo de la ventana

**Archivo:** `electron/main.js`

**Dónde:** Al inicio del archivo, antes de la función `createWindow()`, hay una constante:

```javascript
// --- Personalización de ventana ---
const WINDOW_BACKGROUND_COLOR = '#0f172a';
```

**Qué hace:** Es el color de fondo que se ve en la ventana de Electron mientras la app carga y en los bordes si el contenido no llega al borde.

**Cómo cambiarlo:** Sustituye el valor por cualquier color en hexadecimal.

| Valor       | Descripción        |
|------------|---------------------|
| `'#0f172a'` | Gris oscuro (actual) |
| `'#1e293b'` | Gris slate          |
| `'#0c0c0c'` | Casi negro          |
| `'#18181b'` | Zinc oscuro         |
| `'#1a1a2e'` | Azul muy oscuro     |

Ejemplo:

```javascript
const WINDOW_BACKGROUND_COLOR = '#1e293b';
```

---

## 2. Barra de menú (Archivo, Edición, Ver, Ayuda)

**Archivo:** `electron/main.js`

**Dónde:** Junto a la constante del color, está la constante del modo de menú:

```javascript
// Menú: 'none' = sin barra de menú | 'minimal' = solo Archivo (Salir) y Ayuda (Acerca de)
const MENU_MODE = 'none';
```

**Opciones:**

| Valor      | Efecto |
|-----------|--------|
| `'none'`  | No se muestra la barra de menú (Archivo, Edición, Ver, Ayuda). Es el valor actual. |
| `'minimal'` | Se muestra un menú reducido: **Archivo** → Salir, **Ayuda** → Acerca de Zeus Media Studio. |

**Ejemplos:**

- Sin menú (como ahora):
  ```javascript
  const MENU_MODE = 'none';
  ```

- Menú mínimo (Archivo + Ayuda):
  ```javascript
  const MENU_MODE = 'minimal';
  ```

**Dónde se usa:** Dentro de `createWindow()`, después de crear `mainWindow`:

- Si `MENU_MODE === 'none'`: se oculta la barra y se elimina el menú de la aplicación.
- Si `MENU_MODE === 'minimal'`: se muestra la barra y se asigna un menú construido con `Menu.buildFromTemplate()` (Archivo → Salir, Ayuda → Acerca de).

Para volver al menú nativo completo de Electron (Archivo, Edición, Ver, etc.) tendrías que quitar o comentar el bloque `if (MENU_MODE === 'none') { ... } else if (MENU_MODE === 'minimal') { ... }` y no llamar a `Menu.setApplicationMenu(null)`.

---

## 3. Tamaño mínimo de la ventana

**Archivo:** `electron/main.js`  
**Dónde:** Dentro de `new BrowserWindow({ ... })` en `createWindow()`.

```javascript
minWidth: 800,
minHeight: 600,
```

Puedes cambiar estos números para permitir ventanas más pequeñas o más grandes.

---

## 4. Botones de ventana en la interfaz (Minimizar, Maximizar, Cerrar)

Los botones que controlan la ventana desde la app están en la interfaz (header) y se comunican con Electron por IPC.

### 4.1 Lógica en Electron (main)

**Archivo:** `electron/main.js`  
**Dónde:** Después de la función `createWindow()`, hay tres listeners de IPC:

```javascript
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
```

No hace falta cambiar nada aquí salvo que quieras añadir más acciones (por ejemplo, otro canal IPC).

### 4.2 Exposición al frontend (preload)

**Archivo:** `electron/preload.js`  
**Dónde:** En el objeto que se expone con `contextBridge.exposeInMainWorld('electronAPI', { ... })`:

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions,
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
});
```

Desde la interfaz se llama a `window.electronAPI.windowMinimize()`, `windowMaximize()` y `windowClose()`.

### 4.3 Botones en la interfaz

**Archivo:** `app/page.tsx`  
**Dónde:** En el `<header>`, en la parte derecha, dentro del mismo bloque que el usuario y el botón de cerrar sesión.

- Se usa el estado `isElectron` (se rellena en un `useEffect` comprobando `window.electronAPI?.windowMinimize`) para mostrar los botones solo cuando la app corre en Electron.
- Los tres botones llaman a:
  - `(window as any).electronAPI.windowMinimize()`
  - `(window as any).electronAPI.windowMaximize()`
  - `(window as any).electronAPI.windowClose()`

**Mover los botones:**  
Ahora están a la **derecha** del header. Para ponerlos a la izquierda, mueve el bloque que contiene los tres `<button>` (minimizar, maximizar, cerrar) al primer `<div className="flex items-center space-x-2">` del header, antes del logo de Zeus.

**Ocultar los botones:**  
Si no quieres botones de ventana en la UI, puedes eliminar o comentar en `app/page.tsx` el bloque que renderiza los tres botones (y, si quieres, el `useEffect` que setea `isElectron` solo para eso; si usas `isElectron` en más sitios, déjalo).

---

## 5. Resumen rápido por archivo

| Qué quieres cambiar          | Archivo            | Dónde / Qué tocar |
|-----------------------------|--------------------|--------------------|
| Color de la ventana         | `electron/main.js` | Constante `WINDOW_BACKGROUND_COLOR` |
| Ver u ocultar menú / tipo   | `electron/main.js` | Constante `MENU_MODE` (`'none'` o `'minimal'`) |
| Tamaño mínimo ventana       | `electron/main.js` | `minWidth` / `minHeight` en `new BrowserWindow()` |
| Lógica minimizar/maximizar/cerrar | `electron/main.js` | Handlers `ipcMain.on('window:minimize'|'maximize'|'close')` |
| API para el frontend        | `electron/preload.js` | `windowMinimize`, `windowMaximize`, `windowClose` en `electronAPI` |
| Botones en pantalla         | `app/page.tsx`     | Header, bloque con los tres botones y `isElectron` |

---

## 6. Ventana sin marco del sistema (opcional)

Si en el futuro quieres una ventana sin barra de título del sistema (y llevar tú los botones minimizar/maximizar/cerrar en la app):

**Archivo:** `electron/main.js`  
**Dónde:** En las opciones de `new BrowserWindow()`.

Añade:

```javascript
frame: false,
```

Con `frame: false`, la ventana no tendrá barra de título ni botones del SO; los tres botones que ya tienes en `app/page.tsx` seguirán funcionando porque usan IPC. Ajusta el diseño del header si quieres que hagan de “barra de título” (por ejemplo, que la ventana se pueda arrastrar desde esa zona usando `-webkit-app-region: drag` en CSS).

---

*Documento generado para Zeus Media Studio. Puedes copiarlo o adaptarlo a tu repositorio.*
