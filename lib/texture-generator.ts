/**
 * Texturas «creadas» — las que se generan desde la app Crear Texturas
 * (app/edit-texturas y el modal del Editor 3D). No son archivos de
 * imagen: son parámetros (color, opacidad, rugosidad y tipo de
 * material) guardados en localStorage bajo la clave 'textures_db',
 * la misma clave que usa la página /edit-texturas, de modo que lo
 * creado en un sitio aparece en el otro.
 *
 * Para poder usarlas donde el editor espera una imagen (explorador de
 * texturas, suelo, objetos, caras…) se rasterizan con un canvas en un
 * PNG en data URL según su tipo de material.
 */

import * as THREE from 'three';

import { Texture, TextureType } from '@/types';
import type { TextureMaterialParams } from './geometry';

// Alias: en el explorador y en la app de crear texturas conviene
// llamarlas «texturas creadas» para distinguirlas de los archivos.
export type CreatedTextureType = TextureType;
export type CreatedTexture = Texture;

export const CREATED_TEXTURES_KEY = 'textures_db';

export const CREATED_TYPE_LABELS: Record<CreatedTextureType, string> = {
  glass: 'Cristal',
  water: 'Agua',
  wood: 'Madera',
  metal: 'Metal',
  concrete: 'Hormigón',
  plastic: 'Plástico',
};

// Lee la lista de texturas creadas (compartida con /edit-texturas).
export function readCreatedTextures(): CreatedTexture[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = window.localStorage.getItem(CREATED_TEXTURES_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is CreatedTexture =>
          t && typeof t === 'object' && typeof t.name === 'string' && typeof t.color === 'string'
      )
      .map((t) => ({
        id: typeof t.id === 'string' ? t.id : Math.random().toString(36).slice(2),
        name: t.name,
        type: t.type,
        color: t.color,
        opacity: typeof t.opacity === 'number' ? t.opacity : 1,
        roughness: typeof t.roughness === 'number' ? t.roughness : 0.5,
      }));
  } catch {
    return [];
  }
}

// Guarda (añade) una textura creada, sin pisar las ya existentes.
export function saveCreatedTexture(texture: Omit<CreatedTexture, 'id'> & { id?: string }): CreatedTexture {
  const full: CreatedTexture = { ...texture, id: texture.id || crypto.randomUUID() };
  const list = readCreatedTextures();
  list.push(full);
  try {
    window.localStorage.setItem(CREATED_TEXTURES_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('No se pudo guardar la textura:', e);
  }
  return full;
}

// --- Rasterizado de la textura (canvas → data URL) ---

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const shade = (rgb: [number, number, number], f: number) =>
  `rgb(${clamp255(rgb[0] * f)}, ${clamp255(rgb[1] * f)}, ${clamp255(rgb[2] * f)})`;

// Pseudoaleatorio con semilla: la misma textura genera siempre el
// mismo mosaico (la vista previa no «parpadea» entre renders).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Genera un PNG en data URL con el aspecto del material. La opacidad
 * va en el canal alfa del propio PNG para que, al aplicarla como mapa
 * en el editor, la transparencia se conserve.
 */
export function renderTextureTile(texture: CreatedTexture, size = 256): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const rgb = hexToRgb(texture.color);
  const opacity = Math.max(0, Math.min(1, texture.opacity));
  const rough = Math.max(0, Math.min(1, texture.roughness));
  const rnd = mulberry32(texture.id ? texture.id.length * 7919 : 12345) as () => number;

  // Todo se dibuja con la opacidad elegida: el fondo queda transparente
  // y los píxeles del mosaico llevan ese alfa.
  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = texture.color;
  ctx.fillRect(0, 0, size, size);

  const overlay = (color: string, alphaFactor: number, draw: () => void) => {
    ctx.save();
    ctx.globalAlpha = opacity * alphaFactor;
    ctx.fillStyle = color;
    draw();
    ctx.restore();
  };

  switch (texture.type) {
    case 'wood': {
      // Vetas horizontales onduladas, más separadas si es liso.
      const lines = Math.round(28 + rough * 20);
      for (let i = 0; i < lines; i++) {
        const y = (i / lines) * size;
        const amp = 2 + rnd() * 4;
        overlay(rnd() > 0.5 ? shade(rgb, 0.78) : shade(rgb, 1.15), 0.55, () => {
          ctx.beginPath();
          for (let x = 0; x <= size; x += 4) {
            const yy = y + Math.sin((x / size) * Math.PI * 3 + i * 1.7) * amp;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.lineWidth = 1 + rnd() * 2.2;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke();
        });
      }
      break;
    }
    case 'metal': {
      // Cepillado: finísimas líneas horizontales claras y oscuras.
      for (let i = 0; i < 140; i++) {
        const y = rnd() * size;
        const h = 0.5 + rnd() * 1.5;
        overlay(rnd() > 0.5 ? shade(rgb, 1.35) : shade(rgb, 0.65), 0.28, () => {
          ctx.fillRect(0, y, size, h);
        });
      }
      break;
    }
    case 'concrete': {
      // Motas y manchas difusas.
      for (let i = 0; i < 500; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 0.5 + rnd() * 2.5;
        overlay(rnd() > 0.5 ? '#ffffff' : '#000000', 0.12 + rough * 0.12, () => {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      for (let i = 0; i < 18; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 8 + rnd() * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() > 0.5;
        g.addColorStop(0, dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.30)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        overlay('#000000', 1, () => {
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        });
      }
      break;
    }
    case 'water': {
      // Ondas suaves de luz desplazándose por la superficie.
      for (let i = 0; i < 9; i++) {
        const yBase = (i / 9) * size;
        overlay(shade(rgb, 1.35), 0.4, () => {
          ctx.beginPath();
          for (let x = 0; x <= size; x += 2) {
            const yy = yBase + Math.sin((x / size) * Math.PI * 4 + i * 0.9) * (3 + rough * 6);
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.lineWidth = 1.5 + rnd() * 2;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke();
        });
      }
      break;
    }
    case 'glass': {
      // Gradiente central suave y reflejos diagonales.
      const g = ctx.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, shade(rgb, 1.25));
      g.addColorStop(0.5, shade(rgb, 1.0));
      g.addColorStop(1, shade(rgb, 0.8));
      ctx.save();
      ctx.globalAlpha = opacity * 0.6;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
      for (let i = 0; i < 5; i++) {
        const x = (i / 5) * size + rnd() * 20;
        overlay('#ffffff', 0.18, () => {
          ctx.save();
          ctx.translate(x, 0);
          ctx.rotate(0.5);
          ctx.fillRect(0, -size, 2 + rnd() * 3, size * 2.4);
          ctx.restore();
        });
      }
      break;
    }
    default: {
      // Plástico: brillo suave arriba-izquierda y viñeteado ligero.
      const g = ctx.createRadialGradient(size * 0.3, size * 0.25, 0, size * 0.3, size * 0.25, size * 0.7);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      overlay('#ffffff', 1, () => {
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      });
      const v = ctx.createRadialGradient(size / 2, size / 2, size * 0.4, size / 2, size / 2, size * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.25)');
      overlay('#000000', 1, () => {
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, size, size);
      });
      break;
    }
  }

  // Rugosidad: grano monocromo sobre cualquier material.
  if (rough > 0.02) {
    ctx.save();
    ctx.globalAlpha = opacity * rough * 0.3;
    for (let i = 0; i < 1600; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const val = rnd() > 0.5 ? 255 : 0;
      ctx.fillStyle = `rgb(${val},${val},${val})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

// --- Material físico de una textura creada (igual al de la vista previa) ---

/**
 * Devuelve los parámetros físicos de una textura creada, para guardarlos
 * en la malla al aplicarla (`mesh.textureMaterialParams`).
 */
export function creadaComoParams(creada: CreatedTexture): TextureMaterialParams {
  return {
    type: creada.type,
    color: creada.color,
    opacity: Math.max(0, Math.min(1, creada.opacity)),
    roughness: Math.max(0, Math.min(1, creada.roughness)),
  };
}

function limpiarMaterialCreado(mat: THREE.MeshPhysicalMaterial): void {
  mat.transmission = 0;
  mat.thickness = 0;
  mat.ior = 1.5;
  mat.sheen = 0;
  mat.sheenRoughness = 1;
  mat.clearcoat = 0;
  mat.clearcoatRoughness = 0;
}

/**
 * Quita de un material los efectos de una textura creada anterior
 * (transmisión, sheen, barniz…), dejándolo listo para el acabado normal.
 * Los materiales de objetos nuevos ya construyen limpios; esto es para
 * materiales PERSISTENTES (el suelo, que nunca se reconstruye).
 */
export function limpiarExtrasCreados(mat: THREE.MeshPhysicalMaterial): void {
  limpiarMaterialCreado(mat);
}

/**
 * Configura un `MeshPhysicalMaterial` con las MISMAS propiedades que usa
 * la vista previa 3D (components/TexturePreview.tsx) para ese tipo de
 * material: así un cristal aplicado a un objeto se ve con la misma
 * transmitancia, y un metal con la misma metalidad, que en la previsualización.
 *
 * No toca `color` ni `map`: el mosaico (data URL aplicado como textura)
 * ya lleva el color y el dibujo del material. Tampoco fija `opacity`
 * (la opacidad la sigue poniendo el editor vía `mesh.opacity`); solo
 * activa la transparencia cuando el material la necesita.
 */
export function aplicarMaterialCreado(
  mat: THREE.MeshPhysicalMaterial,
  params: TextureMaterialParams
): void {
  limpiarMaterialCreado(mat);
  const rough = Math.max(0, Math.min(1, params.roughness));

  switch (params.type) {
    case 'metal':
      mat.metalness = 1;
      mat.roughness = Math.max(0.04, rough);
      mat.clearcoat = 1 - rough * 0.5;
      mat.clearcoatRoughness = rough * 0.5;
      mat.envMapIntensity = 1.6;
      break;
    case 'glass':
      mat.metalness = 0;
      mat.roughness = Math.max(0.04, rough);
      mat.transmission = 0.95;
      mat.thickness = 1.5;
      mat.ior = 1.5;
      mat.specularIntensity = 1;
      mat.envMapIntensity = 1.5;
      break;
    case 'water':
      mat.metalness = 0;
      mat.roughness = Math.max(0.02, rough * 0.5);
      mat.transmission = 1;
      mat.thickness = 2;
      mat.ior = 1.33;
      mat.specularIntensity = 1;
      mat.envMapIntensity = 1.5;
      break;
    case 'plastic':
      mat.metalness = 0;
      mat.roughness = Math.max(0.04, rough);
      mat.clearcoat = 1;
      mat.clearcoatRoughness = 0.08;
      mat.envMapIntensity = 1.2;
      break;
    case 'wood':
      mat.metalness = 0;
      mat.roughness = Math.max(0.45, rough);
      mat.sheen = 0.3;
      mat.sheenRoughness = 0.6;
      mat.envMapIntensity = 1.2;
      break;
    case 'concrete':
      mat.metalness = 0;
      mat.roughness = Math.max(0.6, rough);
      mat.sheen = 0.15;
      mat.sheenRoughness = 0.9;
      mat.envMapIntensity = 1.2;
      break;
  }

  const opacity = Math.max(0, Math.min(1, params.opacity));
  // Igual que la vista previa: transparente si la opacidad lo pide, o si
  // el material transmite (cristal/agua). Nunca se BAJA de true: el
  // material del visor puede necesitarla (opacidad parcial de costados).
  if (opacity < 1 || mat.transmission > 0) {
    mat.transparent = true;
  }
  mat.needsUpdate = true;
}