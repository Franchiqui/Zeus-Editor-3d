'use client';

// En Electron, navigator.clipboard.writeText falla con
// "Failed to execute 'writeText' on 'Clipboard': Write permission denied"
// (NotAllowedError). El preload expone electronAPI.clipboardWriteText que usa
// electron.clipboard (main process) sin restricciones de permisos.
// Esta función usa el IPC primero y sólo cae a navigator.clipboard como fallback
// (p. ej. en navegador web o si el bridge no está disponible).

export async function copyText(text: string): Promise<boolean> {
  const ea = (window as any).electronAPI;
  if (ea?.clipboardWriteText) {
    try {
      const res = await ea.clipboardWriteText(text);
      if (res?.ok) return true;
      if (res?.error) console.warn('[clipboard] IPC writeText error:', res.error);
    } catch (e) {
      console.warn('[clipboard] IPC writeText falló, probando navigator.clipboard:', e);
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('[clipboard] navigator.clipboard.writeText falló:', e);
      return false;
    }
  }
  return false;
}