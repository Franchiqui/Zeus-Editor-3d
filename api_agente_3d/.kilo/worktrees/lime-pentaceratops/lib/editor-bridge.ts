// lib/editor-bridge.ts
// Puente para comunicar componentes fuera del editor (ej. modal de iconos)
// con el store del editor sin importar page.tsx directamente.

let addStrokeRef: ((stroke: unknown | unknown[]) => void) | null = null;

/**
 * Registra la función que añade strokes al editor.
 * Llámalo una vez desde el componente principal del editor.
 */
export function registerAddStroke(fn: (stroke: unknown | unknown[]) => void) {
  addStrokeRef = fn;
}

/**
 * Añade uno o varios strokes al editor si está disponible.
 */
export function addStrokeToEditor(stroke: unknown | unknown[]) {
  if (addStrokeRef) {
    addStrokeRef(stroke);
  } else {
    console.warn('El editor no está listo para recibir strokes. Asegúrate de haber llamado registerAddStroke.');
  }
}

// ---------------------------------------------------------------------------
// Imagen de referencia del icono seleccionado (plantilla flotante)
// ---------------------------------------------------------------------------

let iconReferenceRef: {
  dataUrl: string | null;
  name: string;
  set: (dataUrl: string, name: string) => void;
  clear: () => void;
} = {
  dataUrl: null,
  name: '',
  set: () => {},
  clear: () => {},
};

/** Registra el callback para actualizar la referencia de icono */
export function registerIconReference(
  setFn: (dataUrl: string, name: string) => void,
  clearFn: () => void
) {
  iconReferenceRef.set = setFn;
  iconReferenceRef.clear = clearFn;
}

/** Establece la imagen de referencia del icono seleccionado */
export function setIconReference(dataUrl: string, name: string) {
  iconReferenceRef.dataUrl = dataUrl;
  iconReferenceRef.name = name;
  iconReferenceRef.set(dataUrl, name);
}

/** Limpia la imagen de referencia */
export function clearIconReference() {
  iconReferenceRef.dataUrl = null;
  iconReferenceRef.name = '';
  iconReferenceRef.clear();
}

/** Lee el estado actual de la referencia */
export function getIconReference() {
  return { dataUrl: iconReferenceRef.dataUrl, name: iconReferenceRef.name };
}
