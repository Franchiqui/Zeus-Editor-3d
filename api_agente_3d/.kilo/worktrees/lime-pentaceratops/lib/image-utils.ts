export function rotateImageData(imageData: ImageData, degrees: number): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);

  const rotatedCanvas = document.createElement('canvas');
  const rotatedCtx = rotatedCanvas.getContext('2d')!;

  if (degrees === 90 || degrees === 270) {
    rotatedCanvas.width = canvas.height;
    rotatedCanvas.height = canvas.width;
  } else {
    rotatedCanvas.width = canvas.width;
    rotatedCanvas.height = canvas.height;
  }

  rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  rotatedCtx.rotate((degrees * Math.PI) / 180);
  rotatedCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  return rotatedCtx.getImageData(0, 0, rotatedCanvas.width, rotatedCanvas.height);
}

export function flipImageData(imageData: ImageData, horizontal: boolean): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);

  const flippedCanvas = document.createElement('canvas');
  const flippedCtx = flippedCanvas.getContext('2d')!;
  flippedCanvas.width = canvas.width;
  flippedCanvas.height = canvas.height;

  if (horizontal) {
    flippedCtx.scale(-1, 1);
    flippedCtx.drawImage(canvas, -canvas.width, 0);
  } else {
    flippedCtx.scale(1, -1);
    flippedCtx.drawImage(canvas, 0, -canvas.height);
  }

  return flippedCtx.getImageData(0, 0, canvas.width, canvas.height);
}

export function cropImageData(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);

  const croppedCanvas = document.createElement('canvas');
  const croppedCtx = croppedCanvas.getContext('2d')!;
  croppedCanvas.width = width;
  croppedCanvas.height = height;

  croppedCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);

  return croppedCtx.getImageData(0, 0, width, height);
}

export function adjustBrightness(imageData: ImageData, brightness: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, data[i] + brightness));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + brightness));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + brightness));
  }

  return new ImageData(data, imageData.width, imageData.height);
}

export function adjustContrast(imageData: ImageData, contrast: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
    data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
    data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
  }

  return new ImageData(data, imageData.width, imageData.height);
}
