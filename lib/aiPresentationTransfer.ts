// Transferencia en memoria para pasar datos de presentación IA entre páginas
// sin usar sessionStorage (que tiene límite de ~5-10 MB y data URLs de imágenes lo superan)

type TransferData = {
  presentation?: any;
  imageDataUrls?: Record<string, string>;
  audioDataUrl?: string;
  backgroundDataUrl?: string;
} | null;

let transferData: TransferData = null;

export function setPresentationTransfer(data: TransferData) {
  transferData = data;
}

export function getPresentationTransfer(): TransferData {
  const data = transferData;
  transferData = null; // limpiar después de leer para evitar leaks
  return data;
}
