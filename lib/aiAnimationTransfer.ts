// Transferencia en memoria para pasar datos de animación IA (timeline estructurado)
// entre la home y el editor de vídeo sin usar sessionStorage (los object URLs y la
// timeline pueden ser grandes y superar el límite de ~5-10 MB).

export type AnimationTransferData = {
  animation?: any;
  /** nombreArchivo -> object URL (URL.createObjectURL) creado en la home */
  mediaUrls?: Record<string, string>;
} | null;

let transferData: AnimationTransferData = null;

export function setAnimationTransfer(data: AnimationTransferData) {
  transferData = data;
}

export function getAnimationTransfer(): AnimationTransferData {
  const data = transferData;
  transferData = null; // limpiar después de leer para evitar leaks
  return data;
}