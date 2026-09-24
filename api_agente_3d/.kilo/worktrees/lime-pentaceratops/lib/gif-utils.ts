import { GIFEncoder } from 'gifenc';

export interface FrameData {
  id: string;
  imageData: ImageData;
  duration: number;
  thumbnail: string;
}

export interface TextOverlay {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface GifOptions {
  width: number;
  height: number;
  quality: number;
  loop: number;
  textOverlay?: TextOverlay;
  autoCrop?: boolean;
}

export async function generateGIF(
  frames: FrameData[],
  options: GifOptions,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const { width, height, loop } = options;

  const processedFramesData: ImageData[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const resizedImageData = await resizeImageData(frame.imageData, width, height);
    processedFramesData.push(resizedImageData);
  }

  let minX = width, minY = height, maxX = 0, maxY = 0;
  let anyVisible = false;

  for (const imgData of processedFramesData) {
    const bounds = getVisibleBounds(imgData);
    if (bounds.visible) {
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
      anyVisible = true;
    }
  }

  const finalWidth = anyVisible ? (maxX - minX) : width;
  const finalHeight = anyVisible ? (maxY - minY) : height;
  const cropX = anyVisible ? minX : 0;
  const cropY = anyVisible ? minY : 0;

  // Lógica de bucle para GIF:
  // - Si es 0: Infinito
  // - Si es 1: No poner bloque de bucle (reproduce una sola vez y para)
  // - Si es > 1: Poner n-1 repeticiones (ej: 2 veces -> bucle 1 vez)
  let loopValue: number | undefined = options.loop;
  if (loopValue === 1) {
    loopValue = undefined; // Sin bucle = 1 sola vez
  } else if (loopValue > 1) {
    loopValue = loopValue - 1; // n repeticiones extras
  }

  const gif = GIFEncoder({ loop: loopValue });

  // Crear paleta global unificada para todos los frames
  const globalColorMap = new Map<string, number>();
  let hasGlobalTransparency = false;

  // Recopilar todos los colores de todos los frames
  for (const imgData of processedFramesData) {
    const croppedData = anyVisible ? 
      cropImageData(imgData, cropX, cropY, finalWidth, finalHeight) : 
      imgData;

    for (let i = 3; i < croppedData.data.length; i += 4) {
      if (croppedData.data[i] < 128) {
        hasGlobalTransparency = true;
        break;
      }
    }

    for (let i = 0; i < croppedData.data.length; i += 4) {
      if (hasGlobalTransparency && croppedData.data[i + 3] < 128) continue;
      const key = `${croppedData.data[i]},${croppedData.data[i + 1]},${croppedData.data[i + 2]}`;
      globalColorMap.set(key, (globalColorMap.get(key) || 0) + 1);
    }
  }

  console.log('Colores únicos globales:', globalColorMap.size, 'Transparencia:', hasGlobalTransparency);

  // Crear paleta global
  const maxColors = hasGlobalTransparency ? 255 : 256;
  const globalPalette = createGlobalPalette(globalColorMap, maxColors, hasGlobalTransparency);
  console.log('Paleta global creada:', globalPalette.length, 'colores');

  // Procesar cada frame con la paleta global
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const delay = Math.round(frame.duration / 10);
    let currentImageData = processedFramesData[i];

    if (anyVisible) {
      currentImageData = cropImageData(currentImageData, cropX, cropY, finalWidth, finalHeight);
    }

    const indexed = applyGlobalPalette(currentImageData.data, globalPalette, hasGlobalTransparency, finalWidth, finalHeight);

    gif.writeFrame(indexed, finalWidth, finalHeight, {
      palette: globalPalette,
      delay,
      transparent: hasGlobalTransparency,
      transparentIndex: hasGlobalTransparency ? 0 : undefined,
      dispose: 2,
    });

    if (onProgress) {
      onProgress(((i + 1) / frames.length) * 100);
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  const arrayBuffer = new Uint8Array(bytes).buffer;
  return new Blob([arrayBuffer], { type: 'image/gif' });
}

function createGlobalPalette(colorMap: Map<string, number>, maxColors: number, hasTransparency: boolean): number[][] {
  const sortedEntries = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1]);

  // Si hay pocos colores únicos, usarlos todos
  if (sortedEntries.length <= maxColors) {
    const colors = sortedEntries.map(([key]) => key.split(',').map(Number));
    if (hasTransparency) {
      return [[0, 0, 0], ...colors];
    }
    return colors;
  }

  // Usar un método híbrido mejorado: colores más frecuentes + distribución espacial
  const frequentCount = Math.floor(maxColors * 0.6);
  const frequentColors = sortedEntries
    .slice(0, frequentCount)
    .map(([key]) => key.split(',').map(Number));

  const remainingEntries = sortedEntries.slice(frequentCount);
  const sampleCount = maxColors - frequentColors.length;

  // Muestreo inteligente: distribuir colores uniformemente en el espacio RGB
  const sampledColors = smartColorSampling(remainingEntries, sampleCount);

  const finalColors = [...frequentColors, ...sampledColors].slice(0, maxColors);

  if (hasTransparency) {
    return [[0, 0, 0], ...finalColors];
  }

  return finalColors;
}

function smartColorSampling(entries: [string, number][], count: number): number[][] {
  if (entries.length <= count) {
    return entries.map(([key]) => key.split(',').map(Number));
  }

  const colors = entries.map(([key]) => key.split(',').map(Number));
  const selected: number[][] = [];
  const used = new Set<number>();

  // Seleccionar el primer color
  selected.push(colors[0]);
  used.add(0);

  // Seleccionar colores que maximicen la distancia euclidiana en el espacio RGB
  while (selected.length < count) {
    let maxMinDist = 0;
    let bestIdx = 0;

    for (let i = 0; i < colors.length; i++) {
      if (used.has(i)) continue;

      const color = colors[i];
      let minDist = Infinity;

      for (const selectedColor of selected) {
        const dist = Math.pow(color[0] - selectedColor[0], 2) +
                     Math.pow(color[1] - selectedColor[1], 2) +
                     Math.pow(color[2] - selectedColor[2], 2);
        minDist = Math.min(minDist, dist);
      }

      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestIdx = i;
      }
    }

    selected.push(colors[bestIdx]);
    used.add(bestIdx);
  }

  return selected;
}

function applyGlobalPalette(data: Uint8ClampedArray, palette: number[][], hasTransparency: boolean, width: number, height: number): Uint8Array {
  const indexed = new Uint8Array(data.length / 4);
  const startIndex = hasTransparency ? 1 : 0;

  // Crear copia de los datos para dithering
  const pixels = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = data[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3];

      if (hasTransparency && alpha < 128) {
        indexed[y * width + x] = 0;
        continue;
      }

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // Encontrar el color más cercano en la paleta
      let minDist = Infinity;
      let bestIndex = startIndex;

      for (let j = startIndex; j < palette.length; j++) {
        const [pr, pg, pb] = palette[j];
        const dist = Math.pow(r - pr, 2) + Math.pow(g - pg, 2) + Math.pow(b - pb, 2);

        if (dist < minDist) {
          minDist = dist;
          bestIndex = j;
        }
      }

      indexed[y * width + x] = bestIndex;

      // Calcular error y difundir (Floyd-Steinberg)
      const [pr, pg, pb] = palette[bestIndex];
      const errR = r - pr;
      const errG = g - pg;
      const errB = b - pb;

      // Distribuir el error a los píxeles vecinos
      const distribute = (dx: number, dy: number, factor: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nidx = (ny * width + nx) * 4;
          pixels[nidx] += errR * factor;
          pixels[nidx + 1] += errG * factor;
          pixels[nidx + 2] += errB * factor;
        }
      };

      distribute(1, 0, 7 / 16);    // Derecha
      distribute(-1, 1, 3 / 16);  // Abajo-izquierda
      distribute(0, 1, 5 / 16);   // Abajo
      distribute(1, 1, 1 / 16);   // Abajo-derecha
    }
  }

  return indexed;
}

function getVisibleBounds(imageData: ImageData) {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let visible = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        visible = true;
      }
    }
  }

  return { visible, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function cropImageData(imageData: ImageData, x: number, y: number, width: number, height: number): ImageData {
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

async function resizeImageData(
  imageData: ImageData,
  targetWidth: number,
  targetHeight: number
): Promise<ImageData> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);

  const resizedCanvas = document.createElement('canvas');
  const resizedCtx = resizedCanvas.getContext('2d', { willReadFrequently: true })!;
  resizedCanvas.width = targetWidth;
  resizedCanvas.height = targetHeight;

  // Usar mejor calidad de redimensionamiento
  resizedCtx.imageSmoothingEnabled = true;
  resizedCtx.imageSmoothingQuality = 'high';
  
  // Limpiar canvas antes de dibujar
  resizedCtx.clearRect(0, 0, targetWidth, targetHeight);

  // Calcular escala manteniendo aspect ratio
  const scale = Math.min(targetWidth / imageData.width, targetHeight / imageData.height);
  const scaledWidth = imageData.width * scale;
  const scaledHeight = imageData.height * scale;
  
  // Centrar la imagen en el canvas
  const x = (targetWidth - scaledWidth) / 2;
  const y = (targetHeight - scaledHeight) / 2;

  // Dibujar con alta calidad
  resizedCtx.drawImage(
    canvas,
    0, 0, imageData.width, imageData.height,
    x, y, scaledWidth, scaledHeight
  );

  return resizedCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function applyTextOverlay(imageData: ImageData, overlay: TextOverlay) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);

  // Escalar la fuente proporcionalmente al alto del lienzo de dibujo (600px de referencia)
  const scaleFactor = imageData.height / 600;
  const scaledFontSize = overlay.fontSize * scaleFactor;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `${scaledFontSize}px ${overlay.fontFamily}`;

  // La posición x e y en el panel son porcentajes (0-100)
  const x = (overlay.x / 100) * imageData.width;
  const y = (overlay.y / 100) * imageData.height;

  // 1. Dibujar relleno con sombra
  if (overlay.shadowColor && overlay.shadowColor !== 'transparent') {
    ctx.shadowColor = overlay.shadowColor;
    ctx.shadowBlur = (overlay.shadowBlur || 0) * scaleFactor;
    ctx.shadowOffsetX = (overlay.shadowOffsetX || 0) * scaleFactor;
    ctx.shadowOffsetY = (overlay.shadowOffsetY || 0) * scaleFactor;
  }

  ctx.fillStyle = overlay.color;
  ctx.fillText(overlay.text, x, y);

  // 2. Desactivar sombra para el borde
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 3. Dibujar borde (stroke)
  if (overlay.strokeColor && overlay.strokeColor !== 'transparent' && overlay.strokeWidth && overlay.strokeWidth > 0) {
    ctx.strokeStyle = overlay.strokeColor;
    ctx.lineWidth = overlay.strokeWidth * scaleFactor;
    ctx.lineJoin = 'round';
    ctx.strokeText(overlay.text, x, y);
  }

  const newImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  imageData.data.set(newImageData.data);
}

function quantizeColors(data: Uint8ClampedArray, maxColors: number, hasTransparency: boolean): number[][] {
  const colorMap = new Map<string, number>();
  const uniqueColors = new Set<string>();

  // Recopilar todos los colores únicos y su frecuencia
  for (let i = 0; i < data.length; i += 4) {
    if (hasTransparency && data[i + 3] < 128) continue;

    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
    uniqueColors.add(key);
  }

  console.log('Colores únicos encontrados:', uniqueColors.size, 'Límite:', maxColors);

  const limit = hasTransparency ? maxColors - 1 : maxColors;
  
  // Si hay menos colores únicos que el límite, usar todos los colores
  if (uniqueColors.size <= limit) {
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key.split(',').map(Number));

    console.log('Usando todos los colores sin cuantización');
    if (hasTransparency) {
      return [[0, 0, 0], ...sortedColors];
    }
    return sortedColors;
  }

  // Estrategia híbrida: tomar los colores más frecuentes + muestreo uniforme
  const sortedEntries = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1]);

  // Tomar el 70% de colores más frecuentes
  const frequentCount = Math.floor(limit * 0.7);
  const frequentColors = sortedEntries
    .slice(0, frequentCount)
    .map(([key]) => key.split(',').map(Number));

  // Tomar el 30% restante con muestreo uniforme
  const remainingEntries = sortedEntries.slice(frequentCount);
  const sampleCount = limit - frequentColors.length;
  const sampleStep = Math.max(1, Math.floor(remainingEntries.length / sampleCount));
  
  const sampledColors = [];
  for (let i = 0; i < remainingEntries.length && sampledColors.length < sampleCount; i += sampleStep) {
    sampledColors.push(remainingEntries[i][0].split(',').map(Number));
  }

  const finalColors = [...frequentColors, ...sampledColors].slice(0, limit);
  console.log('Colores seleccionados (híbrido):', finalColors.length);

  if (hasTransparency) {
    return [[0, 0, 0], ...finalColors];
  }

  return finalColors;
}

function applyPalette(data: Uint8ClampedArray, palette: number[][], hasTransparency: boolean): Uint8Array {
  const width = Math.sqrt(data.length / 4);
  const height = width;
  const indexed = new Uint8Array(data.length / 4);
  const startIndex = hasTransparency ? 1 : 0;

  // Crear copia de los datos para dithering
  const pixels = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = data[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3];

      if (hasTransparency && alpha < 128) {
        indexed[y * width + x] = 0;
        continue;
      }

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // Encontrar el color más cercano en la paleta
      let minDist = Infinity;
      let bestIndex = startIndex;

      for (let j = startIndex; j < palette.length; j++) {
        const [pr, pg, pb] = palette[j];
        const dist = Math.pow(r - pr, 2) + Math.pow(g - pg, 2) + Math.pow(b - pb, 2);

        if (dist < minDist) {
          minDist = dist;
          bestIndex = j;
        }
      }

      indexed[y * width + x] = bestIndex;

      // Calcular error y difundir (Floyd-Steinberg)
      const [pr, pg, pb] = palette[bestIndex];
      const errR = r - pr;
      const errG = g - pg;
      const errB = b - pb;

      // Distribuir el error a los píxeles vecinos
      const distribute = (dx: number, dy: number, factor: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nidx = (ny * width + nx) * 4;
          pixels[nidx] += errR * factor;
          pixels[nidx + 1] += errG * factor;
          pixels[nidx + 2] += errB * factor;
        }
      };

      distribute(1, 0, 7 / 16);    // Derecha
      distribute(-1, 1, 3 / 16);  // Abajo-izquierda
      distribute(0, 1, 5 / 16);   // Abajo
      distribute(1, 1, 1 / 16);   // Abajo-derecha
    }
  }

  return indexed;
}

export async function loadImageFromFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      console.log('Cargando imagen:', file.name, 'Dimensiones:', img.width, 'x', img.height);
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Limpiar canvas antes de dibujar
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Dibujar imagen
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Analizar colores para debug
      const colorSample: Record<string, number> = {};
      for (let i = 0; i < Math.min(1000, imageData.data.length / 4); i++) {
        const r = imageData.data[i * 4];
        const g = imageData.data[i * 4 + 1];
        const b = imageData.data[i * 4 + 2];
        const key = `${r},${g},${b}`;
        colorSample[key] = (colorSample[key] || 0) + 1;
      }
      
      console.log('Muestra de colores en imagen:', Object.keys(colorSample).slice(0, 10));
      
      URL.revokeObjectURL(url);
      resolve(imageData);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

export function imageDataToThumbnail(imageData: ImageData, size = 100): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(size / imageData.width, size / imageData.height);
  canvas.width = imageData.width * scale;
  canvas.height = imageData.height * scale;

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  tempCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

export async function deconstructGIF(blob: Blob): Promise<FrameData[]> {
  if (!('ImageDecoder' in window)) {
    return deconstructFirstFrameOnly(blob);
  }

  // @ts-ignore
  const decoder = new ImageDecoder({ data: blob.stream(), type: 'image/gif' });
  
  try {
    // @ts-ignore
    await decoder.tracks.ready;
    // @ts-ignore
    const track = decoder.tracks.selectedTrack;
    
    if (!track) throw new Error('No image track found');

    const frameCount = track.frameCount;
    const frames: FrameData[] = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    for (let i = 0; i < frameCount; i++) {
      // @ts-ignore
      const result = await decoder.decode({ frameIndex: i });
      const videoFrame = result.image;

      canvas.width = videoFrame.displayWidth;
      canvas.height = videoFrame.displayHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoFrame, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // ImageDecoder entrega la duración en microsegundos.
      // Si es 0 o indefinido, usamos 100ms (100,000 us) como estándar de GIF.
      const frameDurationUs = videoFrame.duration || 100000;
      const durationMs = Math.max(10, Math.round(frameDurationUs / 1000));

      frames.push({
        id: Math.random().toString(36).substring(7),
        imageData,
        duration: durationMs,
        thumbnail: imageDataToThumbnail(imageData)
      });
      videoFrame.close();
    }
    return frames;
  } catch (e) {
    console.warn('ImageDecoder falló, intentando respaldo:', e);
    return deconstructFirstFrameOnly(blob);
  }
}

async function deconstructFirstFrameOnly(blob: Blob): Promise<FrameData[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve([{
        id: Math.random().toString(36).substring(7),
        imageData,
        duration: 100,
        thumbnail: imageDataToThumbnail(imageData)
      }]);
    };
    img.onerror = () => reject(new Error('Error al renderizar GIF'));
    img.src = url;
  });
}
