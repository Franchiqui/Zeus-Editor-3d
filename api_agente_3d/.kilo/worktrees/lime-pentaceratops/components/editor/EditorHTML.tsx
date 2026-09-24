'use client';

import React from 'react'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Head from 'next/head'
import { create } from 'zustand'
import { Download, Code2, ChevronRight, Bold, Italic, Underline, Square, Circle, Wine as LineIcon, Type, Image as ImageIcon, Trash2, Moon, Copy, ClipboardPaste, Undo2, Redo2, FolderOpen, Save, ExternalLink, FilePlus2, Plus, X, Sparkles, Ungroup, ArrowUp, ArrowDown, BringToFront, SendToBack, Star, RefreshCw } from 'lucide-react'
import JSZip from 'jszip'
import { getLocalPaths, listDirectory, readProject, saveProject, ensureDir } from '@/lib/electron-fs'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext'
import { useI18n } from '@/lib/i18n'


// ------------------------------------------------------------------
// Types & Store
// ------------------------------------------------------------------

interface AnimSlot {
  name: string
  duration: number
  delay: number
  shorthand?: string
}

interface Element {
  id: string
  type: 'rect' | 'circle' | 'line' | 'text' | 'image' | 'video'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  strokeColor: string
  strokeWidth: number
  fillColor: string
  fillOpacity: number
  background?: string
  backgroundSize?: string
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: string
  textDecoration?: string
  color?: string
  textStrokeColor?: string
  textStrokeWidth?: number
  textShadowColor?: string
  textShadowX?: number
  textShadowY?: number
  textShadowBlur?: number
  textShadow?: string
  src?: string
  opacity: number
  animations?: AnimSlot[]
  iluminacionColor?: string
  iluminacionIntensity?: number
  iluminacionDensity?: number
  localImageId?: string
  imageBorderRadius?: number
  imageBorderWidth?: number
  imageBorderColor?: string
  cornerRadius?: number
}

const CANVAS_WIDTH = 1560
const CANVAS_HEIGHT = 1180

// Animaciones que se repiten en bucle (necesitan infinite en lugar de "both").
const LOOP_ANIMATIONS = new Set(['pulse', 'iluminacion', 'flotar', 'girar', 'balanceo', 'neon'])
// Bucles que deben ir con timing lineal (ease-in-out se vería a "trompicones").
const LINEAR_LOOP_ANIMATIONS = new Set(['girar'])
// Efectos de resplandor configurables (color/intensidad/densidad vía custom props).
const GLOW_ANIMATIONS = new Set(['iluminacion', 'neon'])

// Opciones del selector de animación (reutilizado por cada slot).
// Las etiquetas se traducen; los `value` son ids internos (no se traducen).
function getAnimOptions(t: (k: string, v?: Record<string, string | number>) => string): { value: string; label: string }[] {
  return [
    { value: 'fadeIn', label: t('editorHTML.anim.fadeIn') },
    { value: 'fadeOut', label: t('editorHTML.anim.fadeOut') },
    { value: 'slideInLeft', label: t('editorHTML.anim.slideInLeft') },
    { value: 'slideInRight', label: t('editorHTML.anim.slideInRight') },
    { value: 'slideInUp', label: t('editorHTML.anim.slideInUp') },
    { value: 'slideInDown', label: t('editorHTML.anim.slideInDown') },
    { value: 'bounceIn', label: t('editorHTML.anim.bounceIn') },
    { value: 'pulse', label: t('editorHTML.anim.pulse') },
    { value: 'iluminacion', label: t('editorHTML.anim.iluminacion') },
    { value: 'neon', label: t('editorHTML.anim.neon') },
    { value: 'flotar', label: t('editorHTML.anim.flotar') },
    { value: 'girar', label: t('editorHTML.anim.girar') },
    { value: 'balanceo', label: t('editorHTML.anim.balanceo') },
    { value: 'shake', label: t('editorHTML.anim.shake') },
    { value: 'zoomIn', label: t('editorHTML.anim.zoomIn') },
    { value: 'flipInX', label: t('editorHTML.anim.flipInX') },
  ]
}

// Migra elementos viejos (con el campo plano `animation`) al modelo de lista
// `animations`. Acepta `any` porque viene de proyectos guardados/parseados.
function normalizeElement(el: any): Element {
  if (Array.isArray(el.animations) && el.animations.length) {
    return { ...el, animations: el.animations }
  }
  if (el.animation) {
    return {
      ...el,
      animations: [{
        name: el.animation,
        duration: el.animationDuration ?? 1,
        delay: el.animationDelay ?? 0,
        shorthand: el.animationShorthand,
      }],
    }
  }
  return { ...el, animations: undefined }
}

// Pista de contexto que el editor HTML registra en el bridge para que el chat
// flotante la inyecte en el systemContext del modelo de texto.
const HTML_EDITOR_HINT = `Estás conectado al EDITOR HTML de Zeus Media Studio. El editor tiene un lienzo visual de ${CANVAS_WIDTH}×${CANVAS_HEIGHT}px y una pestaña "Código" que sincroniza el HTML con el lienzo de forma bidireccional.
Cuando el usuario te pida crear o modificar el diseño/HTML, genera SIEMPRE un documento HTML completo usando CSS INLINE (atributo style="..." en cada elemento). NO uses clases ni etiquetas <style> externas (sólo se permite <style> para keyframes de animación). Así cada elemento es editable visualmente en el lienzo.
Formato obligatorio para que el lienzo lo entienda:
- Cada elemento visual debe ser un <div> o <img> con position:absolute y left/top/width/height en píxeles (px), dentro del <body>.
- <div> sin texto y con border-radius:50% → círculo; sin border-radius → rectángulo (incluye background-color/border en su style).
- <div> con texto (hoja, sin elementos hijos) → elemento de texto: incluye font-family, font-size, color, font-weight, font-style, text-decoration en su style.
- <img> → imagen (atributo src + position:absolute).
- El fondo del lienzo va en el style del <body> (background o background-color).
- El <body> debe llevar width:${CANVAS_WIDTH}px y min-height:${CANVAS_HEIGHT}px; margin:0; position:relative.
EFECTOS Y ANIMACIONES (el editor los conserva y los muestra en el lienzo y al descargar):
- Para animar un elemento, define sus @keyframes en el <style> y aplica la animación con una regla #id { animation: nombre duración timing iteración; } (por ejemplo #el-x { animation: girar 3s linear infinite; }). Usa el id del elemento. Puedes usar timing-function (linear/ease) e iteration-count (infinite) libremente: se conservan tal cual.
- Puedes encadenar VARIAS animaciones en un mismo elemento separándolas por coma en la regla animation: se reproducen en secuencia. El segundo slot lleva un delay igual a la duración del primero para que empiece después. Ejemplo: #el-x { animation: zoomIn 1s both, iluminacion 3s ease-in-out 1s infinite; } (hace zoom y luego queda iluminando en bucle). Mantén el mismo número de sombras/filtros entre keyframes contiguos para que la transición sea suave.
- Hay efectos predefinidos en bucle que puedes aplicar con #id { animation: nombre duración timing infinite; }: "iluminacion" (texto/imagen se enciende/apaga lentamente con resplandor que sigue la silueta; ajustable con las custom properties inline --ilum-color, --ilum-intensity y --ilum-density, ej. <div id="el-x" style="...; --ilum-color: #ffdd00; --ilum-intensity: 1.5; --ilum-density: 0.4;">), "neon" (resplandor tipo neón, mismas custom properties que iluminacion), "pulse" (pulso), "flotar" (sube/baja suave), "girar" (rotación continua, usa timing linear), "balanceo" (péndulo suave), "shake" (sacudida). Para el resto de animaciones (fadeIn, slideInLeft, bounceIn, zoomIn, flipInX...) define sus @keyframes en el <style>.
- El <style> sólo debe contener @keyframes y reglas #id { animation: ... }; el resto va inline en cada elemento.
- El background del <body> (sólido o linear-gradient) se conserva y se muestra como fondo del lienzo.
IMÁGENES Y VÍDEOS: el usuario puede haber cargado imágenes o vídeos en el editor (campo "Insertar Imagen"). Si hay recursos disponibles se listarán más abajo con su nombre y un identificador. Para reusar uno de esos recursos, pon en el <img> o <video> el atributo src="local-image:<id>" usando exactamente el id indicado (por ejemplo src="local-image:img-1700000000000"). NO inventes URLs ni rutas relativas (./algo.jpg) si el recurso no está en la lista: si necesitas una imagen o vídeo que no está cargado, dile al usuario que lo cargue primero con "Insertar Imagen". Si no se lista ningún recurso, asume que no hay recursos disponibles.
Responde con el HTML completo dentro de un único bloque \`\`\`html ... \`\`\`, SIN prosa adicional (o como mucho una frase muy breve). Ese HTML se escribirá directamente en la pestaña Código y se reflejará en el lienzo, así que debe ser un documento completo y autónomo. Si el usuario pide un cambio pequeño, devuelve el documento entero con el cambio aplicado.`

interface AppState {
  elements: Element[]
  setElements: (elements: Element[]) => void
  code: string
  setCode: (code: string) => void
  activeTab: 'editor' | 'code'
  setActiveTab: (tab: 'editor' | 'code') => void
  selectedElementId: string | null
  setSelectedElementId: (id: string | null) => void
  tool: 'select' | 'line' | 'rect' | 'circle' | 'text' | 'image'
  setTool: (tool: AppState['tool']) => void
}

const useStore = create<AppState>((set) => ({
  elements: [],
  setElements: (elements) => set({ elements }),
  code: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Tu diseño aparecerá aquí</h1>\n  </body>\n</html>',
  setCode: (code) => set({ code }),
  activeTab: 'editor',
  setActiveTab: (activeTab) => set({ activeTab }),
  selectedElementId: null,
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  tool: 'select',
  setTool: (tool) => set({ tool }),
}))



// ------------------------------------------------------------------
// Helpers: Code generation from elements
// ------------------------------------------------------------------

function generateHtml(elements: Element[], useLocalImagePaths = false, localImages?: { url: string; file: File; ext: string; id: string }[], canvasBackground?: string, canvasWidth = CANVAS_WIDTH, canvasHeight = CANVAS_HEIGHT, canvasEffect = 'none', particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, starCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff', gradientSpeed = 15, spotlightSize = 220, spotlightOpacity = 0.18, spotlightColor = '#ffffff', customParticleImage?: { url: string; file: File; ext: string; id: string } | null, customKeyframes = '', previewScale = 1, localFontFaces: Record<string, { url: string; format: string }> = {}): string {
  const styles: string[] = []
  const body: string[] = []
  const googleFonts = new Set<string>()
  const systemFonts = new Set(['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'])
  const animatedIds = new Set<string>()

  let contentWidth = canvasWidth
  let contentHeight = canvasHeight

  elements.forEach((el) => {
    const id = `el-${el.id}`
    const css: string[] = [
      `position: absolute`,
      `z-index: 1`,
      `left: ${el.x}px`,
      `top: ${el.y}px`,
      `width: ${el.width}px`,
      `height: ${el.height}px`,
      `opacity: ${el.opacity}`,
      `transform: rotate(${el.rotation}deg)`,
    ]

    // Iluminación/Neón: si algún slot es glow, expone color/intensidad/densidad
    // como custom properties del elemento para que el keyframe las use.
    // Deben ir en el style inline (css), así que se añaden ANTES de que cada
    // rama haga body.push(style="${css.join('; ')}").
    if (hasGlowSlot(el)) {
      css.push(
        `--ilum-color: ${el.iluminacionColor || el.color || '#ffffff'}`,
        `--ilum-intensity: ${el.iluminacionIntensity ?? 1}`,
        `--ilum-density: ${el.iluminacionDensity ?? 1}`
      )
    }

    if (el.type === 'rect') {
      if (el.background) {
        css.push(`background: ${el.background}`)
        if (el.backgroundSize) css.push(`background-size: ${el.backgroundSize}`)
      } else {
        css.push(`background-color: ${hexToRgba(el.fillColor, el.fillOpacity)}`)
      }
      css.push(
        `border: ${el.strokeWidth}px solid ${el.strokeColor}`,
        `border-radius: ${el.cornerRadius ?? 0}px`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'circle') {
      if (el.background) {
        css.push(`background: ${el.background}`)
        if (el.backgroundSize) css.push(`background-size: ${el.backgroundSize}`)
      } else {
        css.push(`background-color: ${hexToRgba(el.fillColor, el.fillOpacity)}`)
      }
      css.push(
        `border: ${el.strokeWidth}px solid ${el.strokeColor}`,
        `border-radius: 50%`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'line') {
      const angle = Math.atan2(el.height, el.width)
      const len = Math.hypot(el.width, el.height)
      css.push(
        `width: ${len}px`,
        `height: ${el.strokeWidth}px`,
        `background-color: ${el.strokeColor}`,
        `transform-origin: center`,
        `transform: rotate(${(angle * 180) / Math.PI}deg)`
      )
      body.push(`<div id="${id}" style="${css.join('; ')}"></div>`)
    } else if (el.type === 'text') {
      // Sanitizar el font-family: las comillas dobles (p. ej. "Segoe UI") romperían
      // el atributo style="..." al cerrarlo antes de tiempo y harían que el navegador
      // ignorase font-size y todo lo posterior. Se convierten a comillas simples.
      const fontFamily = (el.fontFamily || 'Arial').replace(/"/g, "'")
      const fontName = fontFamily.replace(/['"]/g, '')
      if (!localFontFaces[fontName] && !systemFonts.has(fontName)) {
        googleFonts.add(fontName)
      }
      css.push(
        `font-family: ${fontFamily}`,
        `font-size: ${el.fontSize}px`,
        `font-weight: ${el.fontWeight}`,
        `font-style: ${el.fontStyle}`,
        `text-decoration: ${el.textDecoration}`,
        `color: ${el.color}`,
        `text-align: center`,
        `width: ${el.width}px`
      )
      if (el.textStrokeColor && el.textStrokeWidth) {
        css.push(`-webkit-text-stroke: ${el.textStrokeWidth}px ${el.textStrokeColor}`)
        css.push(`text-stroke: ${el.textStrokeWidth}px ${el.textStrokeColor}`)
      }
      if (el.textShadowColor || el.textShadowX != null || el.textShadowY != null || el.textShadowBlur != null) {
        css.push(`text-shadow: ${el.textShadowX ?? 0}px ${el.textShadowY ?? 0}px ${el.textShadowBlur ?? 0}px ${el.textShadowColor || '#000000'}`)
      } else if (el.textShadow) {
        css.push(`text-shadow: ${el.textShadow}`)
      }
      body.push(`<div id="${id}" style="${css.join('; ')}">${el.text}</div>`)
    } else if ((el.type === 'image' || el.type === 'video') && el.src) {
      let src = el.src
      if (useLocalImagePaths) {
        const localImage = localImages?.find(img => img.url === el.src)
        const ext = localImage?.ext || 'jpg'
        src = `./${el.id}.${ext}`
      }
      if (el.imageBorderRadius) css.push(`border-radius: ${el.imageBorderRadius}px`)
      if (el.imageBorderWidth) css.push(`border: ${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}`)
      // object-fit: cover — igual que el lienzo (object-cover): sin esto, la imagen
      // o el vídeo se ESTIRA a la caja del elemento en el preview (proporción rota).
      css.push('object-fit: cover')
      if (el.type === 'video') {
        body.push(`<video id="${id}" src="${src}" style="${css.join('; ')}" autoplay muted loop playsinline></video>`)
      } else {
        body.push(`<img id="${id}" src="${src}" style="${css.join('; ')}" onerror="this.style.border='2px solid red';this.title='Error loading image: '+this.src;" />`)
      }
    }

    if (el.type !== 'image' && el.type !== 'video') {
      styles.push(`#${id} { position: absolute; }`)
    }

    if (el.animations && el.animations.length) {
      const list = buildAnimationList(el)
      if (list) {
        animatedIds.add(id)
        styles.push(`#${id} { animation: ${list}; }`)
      }
    }

    const elRight = el.x + Math.max(el.width, 0)
    const elBottom = el.y + Math.max(el.height, 0)
    if (elRight > contentWidth) contentWidth = elRight
    if (elBottom > contentHeight) contentHeight = elBottom
  })

  const googleFontsLink = googleFonts.size > 0
    ? `@import url('https://fonts.googleapis.com/css2?family=${Array.from(googleFonts).map(f => f.replace(/ /g, '+')).join('&family=')}');`
    : ''

  // Fuentes locales (carpeta Fuentes configurada en la pestaña Archivo): se
  // incrustan como data URL para que el HTML exportado funcione sin red.
  const localFontFaceCss = Object.entries(localFontFaces || {})
    .map(([family, face]) => `@font-face{font-family:'${family}';src:url(${face.url}) format('${face.format}');}`)
    .join('\n')

  const animationKeyframes = animatedIds.size > 0 ? getAnimationKeyframes() : ''
  // Keyframes personalizados que la IA haya definido (se conservan del HTML original).
  const extraKeyframes = customKeyframes ? `\n${customKeyframes}` : ''
  const canvasEffectCode = getCanvasEffectCode(canvasEffect, canvasWidth, canvasHeight, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, spotlightSize, spotlightOpacity, spotlightColor, customParticleImage, useLocalImagePaths)
  const animatedBackground = canvasEffect === 'gradient-animated'
    ? (canvasBackground?.startsWith('linear-gradient') ? canvasBackground : `linear-gradient(-45deg, ${canvasBackground || 'white'}, ${canvasBackground || 'white'}, #1e3a8a, #3b82f6)`)
    : canvasBackground
  const bodyBackgroundStyle = canvasEffect === 'gradient-animated'
    ? `background: ${animatedBackground}; background-size: 400% 400%; animation: gradientShift ${gradientSpeed}s ease infinite;`
    : `background: ${canvasBackground || 'white'};`

  return `<!DOCTYPE html>
<html>
<head>
<style>
  ${googleFontsLink}
  ${localFontFaceCss}
  ${animationKeyframes}${extraKeyframes}
  ${canvasEffectCode.css}
  html {
    min-height: 100%;
    overflow: auto;
  }
  body {
    width: ${contentWidth}px;
    /* El body mide EXACTAMENTE el lienzo; la ventana de vista previa se ajusta
       a este tamaño dinámicamente (handlePreview → fitWindowToContent) para que
       no quede hueco por debajo. */
    min-height: ${contentHeight}px;
    ${bodyBackgroundStyle}
    position: relative;
    margin: 0 auto;
    overflow: visible;
    ${previewScale !== 1 ? `zoom: ${previewScale};` : ''}
  }
  ${styles.join('\n')}
</style>
</head>
 <body>
 ${body.join('\n')}
 ${canvasEffectCode.html}
 ${canvasEffectCode.script}
 </body>
</html>`
}

// ------------------------------------------------------------------
// Helpers: Parse inline-CSS HTML back into editable elements
// (sincronización bidireccional: editar código o que la IA escriba
//  código → el lienzo refleja los cambios).
// ------------------------------------------------------------------

/** Convierte un color CSS (hex/rgb/rgba) a {hex, alpha}. Best-effort. */
function parseColorToHex(color: string): { hex: string; alpha: number } | null {
  if (!color) return null
  const s = color.trim().toLowerCase()
  if (s === 'transparent' || s === 'none' || s === '') return null
  if (s.startsWith('#')) {
    const h = s.slice(1)
    if (h.length === 3) return { hex: `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`, alpha: 1 }
    if (h.length === 6) return { hex: s, alpha: 1 }
    if (h.length === 8) return { hex: `#${h.slice(0, 6)}`, alpha: parseInt(h.slice(6, 8), 16) / 255 }
    return null
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim())
    const r = parseInt(parts[0], 10)
    const g = parseInt(parts[1], 10)
    const b = parseInt(parts[2], 10)
    const a = parts.length === 4 ? parseFloat(parts[3]) : 1
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      const hex = `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`
      return { hex, alpha: Number.isFinite(a) ? a : 1 }
    }
  }
  // hsl(h, s%, l%) / hsla(h, s%, l%, a) — convertir a hex para no perder el color.
  const hm = s.match(/hsla?\(([^)]+)\)/)
  if (hm) {
    const parts = hm[1].split(',').map((p) => p.trim())
    const h = parseFloat(parts[0])
    const sat = parseFloat(parts[1]) / 100
    const light = parseFloat(parts[2]) / 100
    const a = parts.length === 4 ? parseFloat(parts[3]) : 1
    if ([h, sat, light].every((n) => Number.isFinite(n))) {
      const c = (1 - Math.abs(2 * light - 1)) * sat
      const hp = (h % 360) / 60
      const x = c * (1 - Math.abs((hp % 2) - 1))
      let r1 = 0, g1 = 0, b1 = 0
      if (hp < 1) [r1, g1, b1] = [c, x, 0]
      else if (hp < 2) [r1, g1, b1] = [x, c, 0]
      else if (hp < 3) [r1, g1, b1] = [0, c, x]
      else if (hp < 4) [r1, g1, b1] = [0, x, c]
      else if (hp < 5) [r1, g1, b1] = [x, 0, c]
      else [r1, g1, b1] = [c, 0, x]
      const m1 = light - c / 2
      const hex = `#${[r1, g1, b1].map((n) => Math.max(0, Math.min(255, Math.round((n + m1) * 255))).toString(16).padStart(2, '0')).join('')}`
      return { hex, alpha: Number.isFinite(a) ? a : 1 }
    }
  }
  // Formato no reconocido (currentColor, initial, gradient, nombre sin normalizar...)
  // → devolver null para que el elemento quede transparente en vez de arrastrar
  // un valor inválido que generaría `rgba(NaN, ...)` al descargar.
  return null
}

/** Extrae el ángulo de rotación (deg) de un transform CSS. */
function parseRotation(transform: string): number {
  if (!transform) return 0
  const m = transform.match(/rotate\(([-\d.]+)deg\)/)
  return m ? parseFloat(m[1]) : 0
}

/** Lee el bloque <style> y mapea id → {name,duration,delay,shorthand} para #id { animation: ... }. */
function parseAnimMap(doc: Document): Record<string, AnimSlot[]> {
  const map: Record<string, AnimSlot[]> = {}
  doc.querySelectorAll('style').forEach((style) => {
    const txt = style.textContent || ''
    const re = /#([\w-]+)\s*\{([^}]*)\}/g
    let match: RegExpExecArray | null
    while ((match = re.exec(txt)) !== null) {
      const id = match[1]
      const body = match[2]
      // Valor completo de animation (puede tener varias separadas por coma).
      const sm = body.match(/animation:\s*([^;}]+)/)
      if (!sm) continue
      // Separa por coma y parsea cada parte: NAME DURs [DELAYs] [timing] [iter]
      const slots: AnimSlot[] = []
      sm[1].split(',').forEach((part) => {
        const p = part.trim()
        if (!p) return
        const am = p.match(/^(\S+)\s+([\d.]+)s(?:\s+([\d.]+)s)?/)
        if (!am) return
        slots.push({
          name: am[1],
          duration: parseFloat(am[2]),
          delay: am[3] ? parseFloat(am[3]) : 0,
          // Conserva el shorthand original (con timing/iteration) de la IA.
          shorthand: p,
        })
      })
      if (slots.length) map[id] = slots
    }
  })
  return map
}

/** Extrae todos los bloques @keyframes del texto CSS respetando el anidamiento de llaves. */
function extractKeyframes(css: string): string {
  const out: string[] = []
  let i = 0
  while (true) {
    const start = css.indexOf('@keyframes', i)
    if (start === -1) break
    const open = css.indexOf('{', start)
    if (open === -1) break
    let depth = 1
    let k = open + 1
    while (k < css.length && depth > 0) {
      const ch = css[k]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      k++
    }
    out.push(css.slice(start, k))
    i = k
  }
  return out.join('\n\n')
}

/**
 * Extrae del HTML generado por la IA los "extras" que no son elementos editables
 * pero que hay que conservar para que los efectos se vean en el lienzo y se
 * descarguen correctamente:
 * - customKeyframes: todos los @keyframes personalizados del <style>.
 * - bodyBackground: el background del <body> (inline o del <style>), o null.
 */
function parseHtmlExtras(html: string): { customKeyframes: string; bodyBackground: string | null } {
  if (typeof window === 'undefined' || !html) return { customKeyframes: '', bodyBackground: null }
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return { customKeyframes: '', bodyBackground: null }
  }
  let cssText = ''
  doc.querySelectorAll('style').forEach((s) => { cssText += '\n' + (s.textContent || '') })
  const customKeyframes = extractKeyframes(cssText)

  let bodyBackground: string | null = null
  const bodyInline = doc.body?.style?.background || ''
  if (bodyInline && bodyInline !== 'initial') bodyBackground = bodyInline
  if (!bodyBackground) {
    const m = cssText.match(/body\s*\{([^}]*)\}/)
    if (m) {
      const bg = m[1].match(/background(?:-color)?\s*:\s*([^;}]+)/)
      if (bg) {
        const val = bg[1].trim()
        if (val && val !== 'initial' && val !== 'inherit') bodyBackground = val
      }
    }
  }
  return { customKeyframes, bodyBackground }
}

/**
 * Parsea un documento HTML con CSS inline y reconstruye la lista de Element
 * editables del lienzo. Soporta el formato que produce generateHtml y, de forma
 * best-effort, HTML generado por la IA con CSS inline (divs/img absolutos).
 */
function parseHtmlToElements(html: string): Element[] {
  if (typeof window === 'undefined' || !html) return []
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return []
  }
  const body = doc.body
  if (!body) return []
  const animMap = parseAnimMap(doc)

  const all = Array.from(body.querySelectorAll('*')) as HTMLElement[]
  const hasAbsoluteDescendant = (n: HTMLElement) =>
    Array.from(n.querySelectorAll('*')).some((c) => {
      const p = (c as HTMLElement).style?.position
      return p === 'absolute' || p === 'fixed'
    })

  const out: Element[] = []
  all.forEach((node, idx) => {
    const tag = node.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'head') return
    const style = node.style
    const pos = style.position
    if (pos !== 'absolute' && pos !== 'fixed') return
    // Solo nodos "hoja" (sin descendientes absolutos) → evita mapear contenedores.
    if (hasAbsoluteDescendant(node)) return

    const left = parseFloat(style.left) || 0
    const top = parseFloat(style.top) || 0
    const width = parseFloat(style.width) || 0
    const height = parseFloat(style.height) || 0
    const opacityRaw = style.opacity
    const opacity = opacityRaw === '' ? 1 : parseFloat(opacityRaw)
    const rotation = parseRotation(style.transform)
    const idAttr = node.id || ''
    const baseId = idAttr.startsWith('el-') ? idAttr.slice(3) : (idAttr || `parsed-${idx}`)
    const animSlots = animMap[`el-${baseId}`] || animMap[idAttr] || []
    // Custom properties del efecto iluminación (si la IA las definió inline).
    const ilumColor = style.getPropertyValue('--ilum-color')?.trim() || ''
    const ilumIntenRaw = style.getPropertyValue('--ilum-intensity')?.trim()
    const ilumInten = ilumIntenRaw ? parseFloat(ilumIntenRaw) : undefined
    const ilumDensRaw = style.getPropertyValue('--ilum-density')?.trim()
    const ilumDens = ilumDensRaw ? parseFloat(ilumDensRaw) : undefined

    if (tag === 'img' || tag === 'video') {
      const src = node.getAttribute('src') || ''
      const bc = parseColorToHex(style.borderTopColor || '')
      out.push({
        id: baseId,
        type: tag === 'video' ? 'video' : 'image',
        x: left, y: top, width, height, rotation,
        strokeColor: 'transparent', strokeWidth: 0,
        fillColor: 'transparent', fillOpacity: 0,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        src,
        imageBorderRadius: parseFloat(style.borderRadius) || 0,
        imageBorderWidth: parseFloat(style.borderTopWidth) || 0,
        imageBorderColor: bc ? bc.hex : '#000000',
        animations: animSlots.length ? animSlots : undefined,
        iluminacionColor: ilumColor || undefined,
        iluminacionIntensity: ilumInten,
        iluminacionDensity: ilumDens,
      })
      return
    }

    const textContent = node.textContent?.trim() || ''
    const isLeafText = node.children.length === 0 && textContent !== ''

    if (isLeafText) {
      const ts = style.textShadow || ''
      const tsm = ts.match(/^([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+(.+)$/)
      const wtk = style.getPropertyValue('-webkit-text-stroke') || ''
      const wtkm = wtk.match(/^([-\d.]+)px\s+(.+)$/)
      out.push({
        id: baseId,
        type: 'text',
        x: left, y: top, width, height, rotation,
        strokeColor: 'transparent', strokeWidth: 0,
        fillColor: 'transparent', fillOpacity: 0,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        text: node.innerHTML,
        fontFamily: style.fontFamily || 'Arial',
        fontSize: parseFloat(style.fontSize) || 20,
        fontWeight: style.fontWeight === 'bold' ? 700 : style.fontWeight === 'normal' ? 400 : (parseInt(style.fontWeight, 10) || 400),
        fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
        textDecoration: style.textDecoration || 'none',
        color: style.color || '#000000',
        textStrokeColor: wtkm ? wtkm[2] : undefined,
        textStrokeWidth: wtkm ? parseFloat(wtkm[1]) : undefined,
        textShadowColor: tsm ? tsm[4] : undefined,
        textShadowX: tsm ? parseFloat(tsm[1]) : undefined,
        textShadowY: tsm ? parseFloat(tsm[2]) : undefined,
        textShadowBlur: tsm ? parseFloat(tsm[3]) : undefined,
        animations: animSlots.length ? animSlots : undefined,
        iluminacionColor: ilumColor || undefined,
        iluminacionIntensity: ilumInten,
        iluminacionDensity: ilumDens,
      })
      return
    }

    const bg = parseColorToHex(style.backgroundColor || '')
    const borderW = parseFloat(style.borderTopWidth) || 0
    const borderC = parseColorToHex(style.borderTopColor || '')
    // Fondo del modelo: si usó un gradiente (linear/radial/conic) en
    // `background`, lo capturamos tal cual para conservarlo al ejecutar/descargar
    // (los gradientes animados como "moverFondo" se perderían si sólo leyéramos
    // background-color sólido). También capturamos background-size para que las
    // animaciones de background-position se muevan.
    const bgFull = style.background || style.backgroundImage || ''
    const hasGradient = /gradient/i.test(bgFull)
    out.push({
      id: baseId,
      type: style.borderRadius === '50%' ? 'circle' : 'rect',
      x: left, y: top, width, height, rotation,
      strokeColor: borderC ? borderC.hex : 'transparent',
      strokeWidth: borderW,
      fillColor: bg ? bg.hex : 'transparent',
      fillOpacity: bg ? bg.alpha : 0,
      cornerRadius: style.borderRadius === '50%' ? undefined : (parseFloat(style.borderRadius) || 0),
      background: hasGradient ? bgFull : undefined,
      backgroundSize: hasGradient ? (style.backgroundSize || undefined) : undefined,
      opacity: Number.isFinite(opacity) ? opacity : 1,
      animations: animSlots.length ? animSlots : undefined,
      iluminacionColor: ilumColor || undefined,
      iluminacionIntensity: ilumInten,
      iluminacionDensity: ilumDens,
    })
  })
  return out
}

/**
 * Extrae el HTML útil de la respuesta del modelo (puede venir con prosa +
 * bloque ```html ... ```). Si no hay bloque, intenta aislar el documento HTML
 * completo; si no, devuelve el texto tal cual.
 */
function extractHtmlFromResponse(text: string): string {
  const fenced = text.match(/```(?:html|HTML)?\s*([\s\S]*?)```/g)
  if (fenced && fenced.length > 0) {
    // Quedarse con el último bloque que parezca HTML.
    for (let i = fenced.length - 1; i >= 0; i--) {
      const inner = fenced[i].replace(/```(?:html|HTML)?\s*/, '').replace(/```$/, '')
      if (/<\/?(html|body|div|img|section|p|h[1-6])\b/i.test(inner)) {
        return inner.trim()
      }
    }
  }
  const htmlStart = text.search(/<!DOCTYPE html>|<html/i)
  if (htmlStart >= 0) {
    const endIdx = text.search(/<\/html>/i)
    if (endIdx >= 0) return text.slice(htmlStart, endIdx + '</html>'.length).trim()
    return text.slice(htmlStart).trim()
  }
  return text.trim()
}

function getCanvasEffectCode(effect: string, width: number, height: number, particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, starCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff', gradientSpeed = 15, spotlightSize = 220, spotlightOpacity = 0.18, spotlightColor = '#ffffff', customParticleImage?: { url: string; file: File; ext: string; id: string } | null, useLocalImagePaths = false): { css: string; html: string; script: string } {
  if (effect === 'gradient-animated') {
    return {
      css: `@keyframes gradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }`,
      html: '',
      script: '',
    }
  }

  if (effect === 'spotlight') {
    const rgb = hexToRgb(spotlightColor) || '255,255,255'
    return {
      css: `#effect-spotlight {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle ${spotlightSize}px at var(--spotlight-x, 50%) var(--spotlight-y, 50%), rgba(${rgb},${spotlightOpacity}) 0%, rgba(0,0,0,0.55) 100%);
        pointer-events: none;
        z-index: 10;
        border-radius: inherit;
      }`,
      html: `<div id="effect-spotlight"></div>`,
      script: `<script>
        (function() {
          var canvas = document.getElementById('effect-spotlight');
          if (!canvas) return;
          var parent = canvas.parentElement;
          if (!parent) return;
          parent.addEventListener('mousemove', function(e) {
            var rect = parent.getBoundingClientRect();
            var x = ((e.clientX - rect.left) / rect.width) * 100;
            var y = ((e.clientY - rect.top) / rect.height) * 100;
            canvas.style.setProperty('--spotlight-x', x + '%');
            canvas.style.setProperty('--spotlight-y', y + '%');
          });
        })();
      </script>`,
    }
  }

  if (effect === 'particles' || effect === 'stars') {
    const particleImageUrl = effect === 'particles' && customParticleImage
      ? (useLocalImagePaths ? `./${customParticleImage.id}.${customParticleImage.ext}` : customParticleImage.url)
      : undefined
    return {
      css: `#effect-canvas {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
      }`,
      html: `<canvas id="effect-canvas"></canvas>`,
      script: effect === 'particles' ? getParticlesScript(particleCount, particleColor, particleShape, particleSpeed, particleSize, particleImageUrl) : getStarsScript(starCount, starSpeed, starSize, starColor),
    }
  }

  return { css: '', html: '', script: '' }
}

function getParticlesScript(particleCount = 60, particleColor = '#ffffff', particleShape = 'circle', particleSpeed = 1, particleSize = 1, customParticleImageUrl?: string): string {
  const rgb = hexToRgb(particleColor) || '255,255,255'
  const baseRadius = Math.max(0.5, particleSize) * 3
  const imagePreload = customParticleImageUrl
    ? `const particleImg = new Image(); particleImg.src = '${customParticleImageUrl}';`
    : 'const particleImg = null;'
  return `<script>
    (function() {
      ${imagePreload}
      const canvas = document.getElementById('effect-canvas')
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      let width = window.innerWidth
      let height = window.innerHeight
      canvas.width = width
      canvas.height = height
      const particles = []
      const count = ${particleCount}
      const speed = ${particleSpeed}
      const baseR = ${baseRadius.toFixed(2)}
      const shape = '${particleShape}'
      for (let i = 0; i < count; i++) {
        const r = Math.max(0.5, baseR * (0.5 + Math.random()))
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: r,
          dx: (Math.random() - 0.5) * 0.8 * speed,
          dy: (Math.random() - 0.5) * 0.8 * speed,
          opacity: Math.random() * 0.5 + 0.2,
        })
      }
      function draw() {
        ctx.clearRect(0, 0, width, height)
        particles.forEach((p) => {
          ctx.globalAlpha = p.opacity
          if (particleImg && particleImg.complete) {
            const size = p.radius * 2
            ctx.drawImage(particleImg, p.x - size / 2, p.y - size / 2, size, size)
          } else {
            ctx.beginPath()
            if (shape === 'square') {
              ctx.rect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2)
            } else if (shape === 'triangle') {
              ctx.moveTo(p.x, p.y - p.radius)
              ctx.lineTo(p.x + p.radius, p.y + p.radius)
              ctx.lineTo(p.x - p.radius, p.y + p.radius)
              ctx.closePath()
            } else {
              ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
            }
            ctx.fillStyle = 'rgba(${rgb},' + p.opacity + ')'
            ctx.fill()
          }
          ctx.globalAlpha = 1
          p.x += p.dx
          p.y += p.dy
          if (p.x < 0) p.x = width
          if (p.x > width) p.x = 0
          if (p.y < 0) p.y = height
          if (p.y > height) p.y = 0
        })
        requestAnimationFrame(draw)
      }
      draw()
      window.addEventListener('resize', () => {
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = width
        canvas.height = height
      })
    })()
  </script>`
}

function getStarsScript(particleCount = 80, starSpeed = 1, starSize = 1, starColor = '#ffffff'): string {
  const rgb = hexToRgb(starColor) || '255,255,255'
  return `<script>
    (function() {
      const canvas = document.getElementById('effect-canvas')
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      let width = window.innerWidth
      let height = window.innerHeight
      canvas.width = width
      canvas.height = height
      const stars = []
      const count = ${particleCount}
      const speed = ${starSpeed}
      const size = ${starSize}
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.5 + 0.5,
          alpha: Math.random(),
          speed: (Math.random() * 0.02 + 0.005) * speed,
        })
      }
      function draw() {
        ctx.clearRect(0, 0, width, height)
        stars.forEach((s) => {
          s.alpha += s.speed
          if (s.alpha > 1 || s.alpha < 0.1) s.speed = -s.speed
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(${rgb},' + Math.abs(s.alpha) + ')'
          ctx.fill()
        })
        requestAnimationFrame(draw)
      }
      draw()
      window.addEventListener('resize', () => {
        width = window.innerWidth
        height = window.innerHeight
        canvas.width = width
        canvas.height = height
      })
    })()
  </script>`
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex || hex === 'transparent' || hex === 'none' || hex === 'initial' || hex === 'inherit' || hex === 'unset' || hex === 'currentColor') {
    return 'rgba(0, 0, 0, 0)'
  }
  let h = hex.replace('#', '').trim()
  // hex de 3 dígitos (#fff) → expandir a 6.
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  // Cualquier cosa que no sea un hex válido de 6 dígitos → transparente.
  // Evita el temido `rgba(NaN, NaN, NaN, ...)` cuando el color venía en un
  // formato que el parser no supo convertir (hsl, gradiente, nombre raro...).
  if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return 'rgba(0, 0, 0, 0)'
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexToRgb(hex: string): string | null {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
}

// Reconstruye el shorthand de un slot de animación. Si no hay offset de delay
// (effectiveDelay === slot.delay) y existe shorthand de la IA, se conserva.
// Los bucles usan infinite; girar usa timing lineal; el resto ease-in-out.
function buildSlotShorthand(slot: AnimSlot, effectiveDelay: number): string {
  if (effectiveDelay === slot.delay && slot.shorthand) return slot.shorthand
  const name = slot.name
  const dur = slot.duration ?? 1
  const timing = LINEAR_LOOP_ANIMATIONS.has(name) ? 'linear' : (LOOP_ANIMATIONS.has(name) ? 'ease-in-out' : 'ease')
  const iter = LOOP_ANIMATIONS.has(name) ? 'infinite' : 'both'
  return `${name} ${dur}s ${timing} ${effectiveDelay}s ${iter}`
}

// Delays efectivos para reproducción SECUENCIAL: el slot i empieza tras la
// suma de (duración + delay) de los slots anteriores, más su propio delay.
// (animation-delay es un offset fijo, así que incluso con un slot infinite
// anterior, el siguiente simplemente arranca desplazado y luego conviven.)
function computeEffectiveDelays(slots: AnimSlot[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const s of slots) {
    const d = s.delay ?? 0
    out.push(acc + d)
    acc += d + (s.duration ?? 1)
  }
  return out
}

// Lista combinada de animaciones para la descarga (todo en el #id, separado
// por coma). El texto es contenido directo del #id, así que el glow (text-shadow)
// también funciona ahí sin necesidad de split.
function buildAnimationList(el: Element): string | undefined {
  const slots = el.animations
  if (!slots || slots.length === 0) return undefined
  const delays = computeEffectiveDelays(slots)
  const parts = slots.map((s, i) => buildSlotShorthand(s, delays[i])).filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

// Animación que va en el CONTENEDOR del lienzo:
// - texto: slots NO glow (entradas + loops no-glow). El glow va en el div interno.
// - no-texto: TODOS los slots (el glow usa filter:drop-shadow que sigue el alpha).
function buildContainerAnimation(el: Element): string | undefined {
  const slots = el.animations
  if (!slots || slots.length === 0) return undefined
  const delays = computeEffectiveDelays(slots)
  const filtered = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => el.type === 'text' ? !GLOW_ANIMATIONS.has(s.name) : true)
  if (filtered.length === 0) return undefined
  const parts = filtered.map(({ s, i }) => buildSlotShorthand(s, delays[i]))
  return parts.join(', ')
}

// Animación que va en el DIV DE TEXTO INTERNO del lienzo: sólo slots glow
// (iluminacion/neon), con sus delays efectivos para que empiece tras la entrada.
function buildInnerTextAnimation(el: Element): string | undefined {
  const slots = el.animations
  if (!slots || slots.length === 0) return undefined
  const delays = computeEffectiveDelays(slots)
  const filtered = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => GLOW_ANIMATIONS.has(s.name))
  if (filtered.length === 0) return undefined
  const parts = filtered.map(({ s, i }) => buildSlotShorthand(s, delays[i]))
  return parts.join(', ')
}

// ¿Algún slot del elemento es glow? (decide si se aplican las custom props)
function hasGlowSlot(el: Element): boolean {
  return !!(el.animations && el.animations.some((s) => GLOW_ANIMATIONS.has(s.name)))
}

function getAnimationKeyframes(): string {
  return `@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideInUp {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideInDown {
    from { opacity: 0; transform: translateY(-100%); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes bounceIn {
    0% { opacity: 0; transform: scale(0.3); }
    50% { opacity: 1; transform: scale(1.05); }
    70% { transform: scale(0.9); }
    100% { transform: scale(1); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.8; }
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }
  @keyframes zoomIn {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes flipInX {
    from { opacity: 0; transform: perspective(400px) rotateX(90deg); }
    to { opacity: 1; transform: perspective(400px) rotateX(0); }
  }
  @keyframes iluminacion {
    0%, 100% { opacity: 0.5; text-shadow: 0 0 calc(3px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent), 0 0 calc(6px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent); filter: drop-shadow(0 0 calc(3px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)) drop-shadow(0 0 calc(6px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)); }
    50% { opacity: 1; text-shadow: 0 0 calc(10px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent), 0 0 calc(22px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent); filter: drop-shadow(0 0 calc(10px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)) drop-shadow(0 0 calc(22px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)); }
  }
  @keyframes flotar {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-18px); }
  }
  @keyframes girar {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes balanceo {
    0%, 100% { transform: rotate(-6deg); }
    50% { transform: rotate(6deg); }
  }
  @keyframes neon {
    0%, 100% { opacity: 0.82; text-shadow: 0 0 calc(3px * var(--ilum-intensity, 1)) var(--ilum-color, currentColor), 0 0 calc(12px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent); filter: drop-shadow(0 0 calc(3px * var(--ilum-intensity, 1)) var(--ilum-color, currentColor)) drop-shadow(0 0 calc(12px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)); }
    50% { opacity: 1; text-shadow: 0 0 calc(4px * var(--ilum-intensity, 1)) var(--ilum-color, currentColor), 0 0 calc(16px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent); filter: drop-shadow(0 0 calc(4px * var(--ilum-intensity, 1)) var(--ilum-color, currentColor)) drop-shadow(0 0 calc(16px * var(--ilum-intensity, 1)) color-mix(in srgb, var(--ilum-color, currentColor) calc(var(--ilum-density, 1) * 100%), transparent)); }
  }`
}

// ------------------------------------------------------------------
// ZIP helpers
// ------------------------------------------------------------------

async function downloadZip(files: { name: string; content: Uint8Array }[]) {
  const zip = new JSZip()
  files.forEach((file) => {
    zip.file(file.name, file.content)
  })
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'design.zip'
  a.click()
  URL.revokeObjectURL(url)
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Page Component
// ------------------------------------------------------------------

export default function Page({ isLocalProject = false, projectName = '', projectPath = '', onSave, onCancel }: { 
  isLocalProject?: boolean; 
  projectName?: string; 
  projectPath?: string; 
  onSave?: () => void; 
  onCancel?: () => void; 
}) {
  const {
    elements,
    setElements,
    code,
    setCode,
    activeTab,
    setActiveTab,
    selectedElementId,
    setSelectedElementId,
    tool,
    setTool,
  } = useStore()

  const { t } = useI18n()

  const [fontFamily, setFontFamily] = useState('Arial')
  const [customFont, setCustomFont] = useState('')
  const [isFontModalOpen, setIsFontModalOpen] = useState(false)
  const [googleFonts, setGoogleFonts] = useState<{ family: string; category?: string; variants?: string[] }[]>([])
  const [fontsLoading, setFontsLoading] = useState(false)
  const [fontSearch, setFontSearch] = useState('')
  // Fuentes locales de la carpeta «Fuentes» (configurada en la pestaña Archivo)
  const [localFonts, setLocalFonts] = useState<{ id: string; name: string; family: string; path: string; size?: number }[]>([])
  const [localFontsLoading, setLocalFontsLoading] = useState(false)
  // familia → fuente local embebible (data URL base64 + formato) para exportar HTML/ZIP
  const [localFontFaces, setLocalFontFaces] = useState<Record<string, { url: string; format: string }>>({})
  const localFontFacesRef = useRef<Record<string, { url: string; format: string }>>({})
  const registeredLocalFontsRef = useRef<Set<string>>(new Set())
  const [fontSize, setFontSize] = useState(20)
  const [fontColor, setFontColor] = useState('#000000')
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fillColor, setFillColor] = useState('#ffffff')
  const [fillOpacity, setFillOpacity] = useState(1)
  const [imageTransparency, setImageTransparency] = useState(1)
  const [imageBorderRadius, setImageBorderRadius] = useState(0)
  const [imageBorderWidth, setImageBorderWidth] = useState(0)
  const [imageBorderColor, setImageBorderColor] = useState('#000000')
  const [localImages, setLocalImages] = useState<{ url: string; file: File; ext: string; id: string }[]>([])
  // Ref siempre actualizado con localImages para leerlo desde callbacks registrados
  // en el bridge (context hint) sin re-registrar en cada cambio de imágenes.
  const localImagesRef = useRef(localImages)
  useEffect(() => { localImagesRef.current = localImages }, [localImages])
  // Ref con las imágenes cargadas convertidas a data URLs (base64) para que el
  // modelo de visión las pueda ver cuando allowVision está activado. Se
  // pre-calculan aquí (async) porque el getter del bridge es síncrono.
  const localImagesDataUrlsRef = useRef<string[]>([])
  useEffect(() => {
    let cancelled = false
    const convert = async () => {
      const dataUrls = await Promise.all(localImages.map(img => {
        if (!(img.file instanceof Blob)) return null
        return new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(img.file)
        })
      }))
      if (cancelled) return
      localImagesDataUrlsRef.current = dataUrls.filter((u): u is string => !!u)
    }
    convert()
    return () => { cancelled = true }
  }, [localImages])
  const [canvasColorType, setCanvasColorType] = useState<'solid' | 'gradient'>('solid')
  const [canvasColor, setCanvasColor] = useState('#4b5563')
  const [canvasGradientStart, setCanvasGradientStart] = useState('#ffffff')
  const [canvasGradientEnd, setCanvasGradientEnd] = useState('#000000')
  const [canvasGradientDirection, setCanvasGradientDirection] = useState(180)
  const [canvasWidth, setCanvasWidth] = useState(CANVAS_WIDTH)
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT)
  // Extras conservados del HTML generado por la IA para que los efectos
  // (keyframes personalizados, fondo del body) se vean en el lienzo y se
  // descarguen. bodyBackgroundCss=null significa "usar los color pickers".
  const [customKeyframes, setCustomKeyframes] = useState('')
  const [bodyBackgroundCss, setBodyBackgroundCss] = useState<string | null>(null)
  const [canvasEffect, setCanvasEffect] = useState<string>('none')
  const [clipboard, setClipboard] = useState<Element[] | null>(null)
  const [history, setHistory] = useState<Element[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedoRef = useRef(false)
  const [particleCount, setParticleCount] = useState<number>(60)
  const [particleColor, setParticleColor] = useState<string>('#ffffff')
  const [particleShape, setParticleShape] = useState<string>('circle')
  const [particleSpeed, setParticleSpeed] = useState<number>(1)
  const [particleSize, setParticleSize] = useState<number>(1)
  const [customParticleImage, setCustomParticleImage] = useState<{ url: string; file: File; ext: string; id: string } | null>(null)
  const [starCount, setStarCount] = useState<number>(80)
  const [starSpeed, setStarSpeed] = useState<number>(1)
  const [starSize, setStarSize] = useState<number>(1)
  const [starColor, setStarColor] = useState<string>('#ffffff')
  const [gradientSpeed, setGradientSpeed] = useState<number>(15)
  const [spotlightSize, setSpotlightSize] = useState<number>(220)
  const [spotlightOpacity, setSpotlightOpacity] = useState<number>(0.18)
  const [spotlightColor, setSpotlightColor] = useState<string>('#ffffff')
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveModalProjects, setSaveModalProjects] = useState<any[]>([])
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [localProjects, setLocalProjects] = useState<any[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)

  // Conexión con el chat general/flotante: el chat flotante puede leer el
  // código HTML actual (registerDocumentContent) y escribir en él cuando la
  // IA responde con allowAIToWriteToEditor activado (registerEditor → setCode).
  const aiBridge = useAIEditorBridgeOptional()
  useEffect(() => {
    if (!aiBridge) return
    // El chat flotante lee el código HTML actual como contexto del documento.
    const unregContent = aiBridge.registerDocumentContent(() => useStore.getState().code)
    // El chat flotante lee las imágenes cargadas (como data URLs) para que el
    // modelo de visión las pueda ver cuando allowVision está activado.
    const unregImages = aiBridge.registerDocumentImages(() =>
      localImagesDataUrlsRef.current.length ? localImagesDataUrlsRef.current : null
    )
    // Cuando la IA responde, se extrae el HTML (ignorando la prosa) y se
    // escribe en la pestaña Código → el parser lo refleja en el lienzo.
    const unregEditor = aiBridge.registerEditor((text) => {
      const html = extractHtmlFromResponse(text)
      useStore.getState().setCode(html)
    })
    // Pista de contexto: indica al modelo que genere CSS inline editable e
    // incluye la lista de imágenes cargadas por el usuario (con su token de
    // referencia) para que el modelo pueda reusarlas con src="local-image:<id>".
    const unregHint = aiBridge.registerContextHint(() => {
      const imgs = localImagesRef.current
      if (!imgs.length) return HTML_EDITOR_HINT
      const lines = imgs.map(img => {
        const name = img.file?.name || `${img.id}.${img.ext}`
        return `- "${name}" → src="local-image:${img.id}"`
      }).join('\n')
      return `${HTML_EDITOR_HINT}\n\nIMÁGENES DISPONIBLES PARA REUSAR (usa exactamente el id indicado):\n${lines}`
    })
    return () => {
      unregContent()
      unregImages()
      unregEditor()
      unregHint()
    }
  }, [aiBridge])

  const handleDeleteElement = useCallback(() => {
    if (!selectedElementId) return
    setElements(elements.filter((el) => el.id !== selectedElementId))
    setSelectedElementId(null)
  }, [elements, selectedElementId, setElements, setSelectedElementId])

  const pushHistory = useCallback((newElements: Element[]) => {
    if (isUndoRedoRef.current) return
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(newElements)))
      if (newHistory.length > 50) newHistory.shift()
      setHistoryIndex(newHistory.length - 1)
      return newHistory
    })
  }, [historyIndex])

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return
    isUndoRedoRef.current = true
    const prevElements = history[historyIndex - 1]
    setElements(JSON.parse(JSON.stringify(prevElements)))
    setHistoryIndex(historyIndex - 1)
    setTimeout(() => {
      isUndoRedoRef.current = false
    }, 0)
  }, [history, historyIndex])

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    isUndoRedoRef.current = true
    const nextElements = history[historyIndex + 1]
    setElements(JSON.parse(JSON.stringify(nextElements)))
    setHistoryIndex(historyIndex + 1)
    setTimeout(() => {
      isUndoRedoRef.current = false
    }, 0)
  }, [history, historyIndex])

  const handleCopy = useCallback(() => {
    if (!selectedElementId) return
    const el = elements.find((e) => e.id === selectedElementId)
    if (el) setClipboard([el])
  }, [elements, selectedElementId])

  const handlePaste = useCallback(() => {
    if (!clipboard || clipboard.length === 0) return
    const newElements = clipboard.map((el) => ({
      ...el,
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      x: el.x + 20,
      y: el.y + 20,
    }))
    const updated = [...elements, ...newElements]
    pushHistory(updated)
    setElements(updated)
    setSelectedElementId(newElements[0].id)
  }, [clipboard, elements, pushHistory])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const mod = isMac ? e.metaKey : e.ctrlKey
      const activeEl = document.activeElement
      const tag = activeEl?.tagName?.toLowerCase()
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select'

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((mod && e.shiftKey && e.key === 'z') || (mod && e.key === 'y')) {
        e.preventDefault()
        handleRedo()
      } else if (mod && e.key === 'c' && !isInput && selectedElementId) {
        e.preventDefault()
        handleCopy()
      } else if (mod && e.key === 'v' && !isInput && clipboard && clipboard.length > 0) {
        e.preventDefault()
        handlePaste()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId && document.activeElement === document.body) {
          e.preventDefault()
          handleDeleteElement()
        }
      } else if (e.key === 'Tab' && !isInput) {
        // Tab / Shift+Tab: cicla la selección entre los objetos del lienzo
        // (útil para alcanzar elementos que están debajo de otros).
        e.preventDefault()
        if (elements.length === 0) return
        const idx = elements.findIndex((el) => el.id === selectedElementId)
        let next: number
        if (idx === -1) {
          next = 0
        } else {
          const dir = e.shiftKey ? -1 : 1
          next = (idx + dir + elements.length) % elements.length
        }
        setSelectedElementId(elements[next].id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo, handleCopy, handlePaste, selectedElementId, handleDeleteElement, elements, setSelectedElementId])

  const selectedElement = elements.find((el) => el.id === selectedElementId) || null

  useEffect(() => {
    if (history.length === 0) {
      setHistory([JSON.parse(JSON.stringify(elements))])
      setHistoryIndex(0)
    }
  }, [])

  useEffect(() => {
    if (isUndoRedoRef.current) return
    pushHistory(elements)
  }, [elements, pushHistory])

  // Refs para sincronización bidireccional código ⇄ lienzo sin bucles infinitos.
  // - lastEmittedCodeRef: último HTML que generamos nosotros desde elements.
  //   El parser salta si code coincide con él (fue nuestro, no un cambio externo).
  // - parsingRef: el generador salta si venimos de parsear código → elements.
  const lastEmittedCodeRef = useRef('')
  const parsingRef = useRef(false)

  // elements → código (generador). Se omite si los elements acaban de llegar
  // tras parsear código del usuario/IA (parsingRef), para no sobreescribir su HTML.
  useEffect(() => {
    if (parsingRef.current) {
      parsingRef.current = false
      return
    }
    const pickedBg = canvasColorType === 'solid' ? canvasColor : `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
    // Si la IA definió un fondo de body, tiene prioridad (hasta que el usuario
    // toque los color pickers, que limpian bodyBackgroundCss).
    const background = bodyBackgroundCss ?? pickedBg
    const html = generateHtml(elements, false, undefined, background, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, spotlightSize, spotlightOpacity, spotlightColor, customParticleImage, customKeyframes, undefined, localFontFaces)
    lastEmittedCodeRef.current = html
    setCode(html)
  }, [elements, setCode, canvasColorType, canvasColor, canvasGradientDirection, canvasGradientStart, canvasGradientEnd, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, spotlightSize, spotlightOpacity, spotlightColor, customParticleImage, customKeyframes, bodyBackgroundCss, localFontFaces])

  // código → elements (parser). Se omite si el code es justamente el que
  // acabamos de generar nosotros (cambio externo = usuario/IA editando).
  useEffect(() => {
    if (code === lastEmittedCodeRef.current) return
    const parsed = parseHtmlToElements(code)
    // Si el HTML está incompleto (el usuario está escribiendo a mitad y no hay
    // </html>) y no se rescató ningún elemento, no vaciamos el lienzo: conservamos
    // el último estado válido hasta que el código vuelva a ser parseable.
    if (parsed.length === 0 && !/<\/html>/i.test(code)) return
    // Resuelve referencias local-image:<id> (generadas por la IA) al blob URL
    // real de la imagen cargada, para que el lienzo la muestre. Si el id no
    // existe, deja src vacío (no rompe el render).
    const imgs = localImagesRef.current
    const resolved = parsed.map(el => {
      if ((el.type !== 'image' && el.type !== 'video') || !el.src) return el
      const m = /^local-image:(.+)$/.exec(el.src)
      if (!m) return el
      const local = imgs.find(img => img.id === m[1])
      if (!local) return { ...el, src: '' }
      return { ...el, src: local.url, localImageId: local.id }
    })
    // Conserva los efectos del HTML de la IA (keyframes personalizados y fondo
    // del body) para que se vean en el lienzo y se descarguen.
    const extras = parseHtmlExtras(code)
    parsingRef.current = true
    setElements(resolved)
    setCustomKeyframes(extras.customKeyframes)
    setBodyBackgroundCss(extras.bodyBackground)
  }, [code, setElements, setCustomKeyframes, setBodyBackgroundCss])

  useEffect(() => {
    const systemFonts = new Set(['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'])
    const googleFonts = new Set<string>()

    elements.forEach((el) => {
      if (el.type === 'text' && el.fontFamily) {
        const fontName = el.fontFamily.replace(/['"]/g, '')
        if (!localFontFaces[fontName] && !systemFonts.has(fontName)) {
          googleFonts.add(fontName)
        }
      }
    })

    if (customFont) {
      const fontName = customFont.replace(/['"]/g, '')
      if (!systemFonts.has(fontName)) {
        googleFonts.add(fontName)
      }
    }

    const linkId = 'google-font-link'
    const existing = document.getElementById(linkId)
    if (existing) existing.remove()

    if (googleFonts.size === 0) return

    const link = document.createElement('link')
    link.id = linkId
    link.href = `https://fonts.googleapis.com/css2?family=${Array.from(googleFonts).map(f => f.replace(/ /g, '+')).join('&family=')}`
    link.rel = 'stylesheet'
    document.head.appendChild(link)

    return () => {
      const node = document.getElementById(linkId)
      if (node) node.remove()
    }
  }, [elements, customFont, localFontFaces])

  const handleDownloadZip = async () => {
    const pickedBg = canvasColorType === 'solid' ? canvasColor : `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
    const background = bodyBackgroundCss ?? pickedBg
    const html = generateHtml(elements, true, localImages, background, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, spotlightSize, spotlightOpacity, spotlightColor, customParticleImage, customKeyframes, undefined, localFontFaces)
    const files: { name: string; content: Uint8Array }[] = [
      { name: 'index.html', content: new TextEncoder().encode(html) },
    ]

    const imageElements = elements.filter((el): el is Element & { src: string } => (el.type === 'image' || el.type === 'video') && !!el.src)

    for (const el of imageElements) {
      const localImage = localImages.find(img => img.url === el.src)
      if (localImage?.file instanceof Blob) {
        const arrayBuffer = await localImage.file.arrayBuffer()
        files.push({ name: `${el.id}.${localImage.ext}`, content: new Uint8Array(arrayBuffer) })
      } else if (el.src.startsWith('http')) {
        try {
          const response = await fetch(el.src)
          const blob = await response.blob()
          const arrayBuffer = await blob.arrayBuffer()
          const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg'
          files.push({ name: `${el.id}.${ext}`, content: new Uint8Array(arrayBuffer) })
        } catch (error) {
          console.error('Error downloading image:', error)
        }
      }
    }

    if (customParticleImage?.file instanceof Blob) {
      const arrayBuffer = await customParticleImage.file.arrayBuffer()
      files.push({ name: `${customParticleImage.id}.${customParticleImage.ext}`, content: new Uint8Array(arrayBuffer) })
    }

    await downloadZip(files)
  }

  // Abre una ventana nueva con el HTML renderizado tal como lo entregaría la
  // descarga (mismo generateHtml, pero con las URLs de imágenes en línea para
  // que se vean sin tener que empaquetarlas en un ZIP).
  const handlePreview = () => {
    const pickedBg = canvasColorType === 'solid' ? canvasColor : `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
    const background = bodyBackgroundCss ?? pickedBg
    // Escala automática: si el lienzo no cabe en la pantalla, la vista previa se
    // abre ESCALADA (zoom CSS en el body) para que el diseño completo se vea con
    // la misma proporción y disposición que en el lienzo. Antes se abría una
    // ventana más pequeña con scroll → los objetos parecían "en otro sitio".
    const availW = window.screen.availWidth - 40
    const availH = window.screen.availHeight - 120
    const previewScale = Math.min(1, availW / canvasWidth, availH / canvasHeight)
    const html = generateHtml(elements, false, undefined, background, canvasWidth, canvasHeight, canvasEffect, particleCount, particleColor, particleShape, particleSpeed, particleSize, starCount, starSpeed, starSize, starColor, gradientSpeed, spotlightSize, spotlightOpacity, spotlightColor, customParticleImage, customKeyframes, previewScale, localFontFaces)
    // La ventana se abre al tamaño del lienzo (escalado + margen para chrome/barras)
    // para que el diseño se vea a tamaño real 1:1 (o escalado si no cabe), igual
    // que en el editor. Se capita a la pantalla disponible para que no se salga.
    const winW = Math.max(360, Math.min(canvasWidth * previewScale + 40, window.screen.availWidth - 20))
    const winH = Math.max(320, Math.min(canvasHeight * previewScale + 90, window.screen.availHeight - 40))
    const left = Math.max(10, Math.floor((window.screen.availWidth - winW) / 2))
    const top = Math.max(10, Math.floor((window.screen.availHeight - winH) / 2))
    // Se usa un Blob URL en vez de window.open('') + document.write. Antes se
    // abría un popup about:blank y se escribía el HTML con document.write; en
    // ese contexto los <script> de los efectos de canvas (estrellas/partículas)
    // no siempre se ejecutaban (el fondo de estrellas no aparecía en la vista
    // previa aunque sí en el ZIP descargado). Navegar el popup a un Blob URL hace
    // que el documento se cargue como una página real y los scripts se ejecuten
    // exactamente igual que en el archivo descargado.
    const blob = new Blob([html], { type: 'text/html' })
    const blobUrl = URL.createObjectURL(blob)
    const w = window.open(blobUrl, '_blank', `width=${winW},height=${winH},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`)
    if (!w) {
      URL.revokeObjectURL(blobUrl)
      alert(t('editorHTML.alerts.popupBlocked'))
      return
    }
    // Ajusta la ventana al tamaño EXACTO del lienzo (escalado): se mide el chrome
    // real (bordes + barra de título = outer - client) y se redimensiona a
    // canvas*escala + chrome, de modo que el área de contenido coincide 1:1 con
    // el lienzo y no queda hueco por debajo ni a los lados. (scrollWidth/scrollHeight
    // NO son fiables con el zoom CSS del body, que es lo que causaba que la
    // ventana se agrandara de más.)
    const fitWindowToContent = () => {
      try {
        const doc = w.document
        const chromeW = w.outerWidth - doc.documentElement.clientWidth
        const chromeH = w.outerHeight - doc.documentElement.clientHeight
        const targetW = Math.round(canvasWidth * previewScale + chromeW)
        const targetH = Math.round(canvasHeight * previewScale + chromeH)
        if (w.outerWidth !== targetW || w.outerHeight !== targetH) {
          w.resizeTo(targetW, targetH)
        }
      } catch {
        // Popup cerrado o sin acceso al documento: no hay nada que ajustar.
      }
    }
    w.addEventListener('load', fitWindowToContent)
    // Respaldo por si el evento load ya se disparó antes de registrar el listener.
    setTimeout(() => { try { fitWindowToContent() } catch { /* noop */ } }, 400)
    // El documento ya se navegó desde el Blob URL; se libera la URL pasado un
    // tiempo prudencial para no dejarla colgada en memoria.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000)
  }

  const handleSaveProject = async () => {
    setIsSaveModalOpen(true)
    setSaveTitle(projectName || '')
    setSaveModalProjects([])
    try {
      const paths = await getLocalPaths()
      const folder = (paths?.proyectos_html || projectPath || '').trim()
      if (!folder) return
      const files = await listDirectory(folder, 'proyectos')
      const projects = (files || [])
        .filter((f: any) => f && typeof f.name === 'string' && f.name.toLowerCase().endsWith('.zeus'))
        .map((f: any) => ({
          id: f.path,
          name: f.name,
          path: f.path,
        }))
      setSaveModalProjects(projects)
    } catch (e) {
      console.error('Error cargando proyectos para guardar:', e)
    }
  }

  const handleConfirmSave = async () => {
    const saveImages = async () => {
      const savedImages = await Promise.all(
        localImages.map(async (img) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(img.file)
          })
          return {
            id: img.id,
            ext: img.ext,
            base64,
          }
        })
      )
      const savedParticleImage = customParticleImage && customParticleImage.file instanceof Blob
        ? await new Promise<{ id: string; ext: string; base64: string }>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              resolve({
                id: customParticleImage.id,
                ext: customParticleImage.ext,
                base64: reader.result as string,
              })
            }
            reader.onerror = () => resolve({
              id: customParticleImage.id,
              ext: customParticleImage.ext,
              base64: '',
            })
            reader.readAsDataURL(customParticleImage.file)
          })
        : null
      const project = {
        elements: elements.map((el) => {
          if ((el.type === 'image' || el.type === 'video') && el.src) {
            const localImage = localImages.find((img) => img.url === el.src)
            if (localImage) {
              return { ...el, localImageId: localImage.id }
            }
          }
          return el
        }),
        canvasColorType,
        canvasColor,
        canvasGradientStart,
        canvasGradientEnd,
        canvasGradientDirection,
        canvasWidth,
        canvasHeight,
        customFont,
        canvasEffect,
        particleCount,
        particleColor,
        particleShape,
        particleSpeed,
        particleSize,
        starCount,
        starSpeed,
        starSize,
        starColor,
        gradientSpeed,
        spotlightSize,
        spotlightOpacity,
        spotlightColor,
        customParticleImage: savedParticleImage,
        images: savedImages,
        customKeyframes,
        bodyBackgroundCss,
      }

      try {
        const paths = await getLocalPaths();
        const folder = (paths?.proyectos_html || projectPath || '').trim();
        console.log('[EditorHTML] Guardar proyecto - folder:', folder);
        if (!folder) {
          alert(t('editorHTML.alerts.noFolder'));
          return;
        }

        await ensureDir(folder);
        const fileName = saveTitle.trim() || 'proyecto';
        const projectPathFull = `${folder}\\${fileName}.zeus`;
        console.log('[EditorHTML] Guardar proyecto - ruta completa:', projectPathFull);
        await saveProject(projectPathFull, {
          titulo: fileName,
          tipo: 'edit_html',
          file: project,
        });
        alert(t('editorHTML.alerts.saveOk'));
        setIsSaveModalOpen(false);
        setSaveTitle('');
        onSave?.();
      } catch (e) {
        console.error('Error guardando proyecto HTML local:', e);
        alert(t('editorHTML.alerts.saveError'));
      }
    }
    await saveImages()
  }

  const handleOpenLoadModal = async () => {
    setProjectsLoading(true);
    setIsLoadModalOpen(true);
    setLocalProjects([]);
    try {
      const paths = await getLocalPaths();
      const folder = (paths?.proyectos_html || projectPath || '').trim();
      console.log('[EditorHTML] Cargar proyectos - folder:', folder);
      if (!folder) {
        alert(t('editorHTML.alerts.noFolder'));
        setProjectsLoading(false);
        return;
      }
      const files = await listDirectory(folder, 'proyectos');
      console.log('[EditorHTML] listDirectory result:', files);
      const projects = (files || [])
        .filter((f: any) => f && typeof f.name === 'string' && f.name.toLowerCase().endsWith('.zeus'))
        .map((f: any) => ({
          id: f.path,
          name: f.name,
          path: f.path,
        }));
      console.log('[EditorHTML] proyectos filtrados:', projects);
      setLocalProjects(projects);
    } catch (e) {
      console.error('Error cargando proyectos HTML:', e);
      alert(t('editorHTML.alerts.loadError'));
    } finally {
      setProjectsLoading(false);
    }
  }

  const handleOpenLocalProject = async (p: any) => {
    try {
      const projectData = await readProject(p.path);
      console.log('[EditorHTML] handleOpenLocalProject raw:', projectData);
      if (!projectData) throw new Error(t('editorHTML.alerts.readError'));
      const data = projectData.file || projectData;
      console.log('[EditorHTML] handleOpenLocalProject data keys:', Object.keys(data || {}));
      console.log('[EditorHTML] handleOpenLocalProject elements count:', data?.elements?.length);
      console.log('[EditorHTML] handleOpenLocalProject images count:', data?.images?.length);
      if (data.canvasColorType) setCanvasColorType(data.canvasColorType);
      if (data.canvasColor) setCanvasColor(data.canvasColor);
      if (data.canvasGradientStart) setCanvasGradientStart(data.canvasGradientStart);
      if (data.canvasGradientEnd) setCanvasGradientEnd(data.canvasGradientEnd);
      if (data.canvasGradientDirection) setCanvasGradientDirection(data.canvasGradientDirection);
      if (data.canvasWidth) setCanvasWidth(data.canvasWidth);
      if (data.canvasHeight) setCanvasHeight(data.canvasHeight);
      if (data.customFont) setCustomFont(data.customFont);
      if (data.canvasEffect) setCanvasEffect(data.canvasEffect);
      if (data.particleCount) setParticleCount(data.particleCount);
      if (data.particleColor) setParticleColor(data.particleColor);
      if (data.particleShape) setParticleShape(data.particleShape);
      if (data.particleSpeed) setParticleSpeed(data.particleSpeed);
      if (data.particleSize) setParticleSize(data.particleSize);
      if (data.starCount) setStarCount(data.starCount);
      if (data.starSpeed) setStarSpeed(data.starSpeed);
      if (data.starSize) setStarSize(data.starSize);
      if (data.starColor) setStarColor(data.starColor);
      if (data.gradientSpeed) setGradientSpeed(data.gradientSpeed);
      if (data.spotlightSize) setSpotlightSize(data.spotlightSize);
      if (data.spotlightOpacity) setSpotlightOpacity(data.spotlightOpacity);
      if (data.spotlightColor) setSpotlightColor(data.spotlightColor);
      if (data.customParticleImage) setCustomParticleImage(data.customParticleImage);
      // Conserva los efectos del modelo (keyframes personalizados y fondo del body)
      // que se guardaron junto al proyecto.
      setCustomKeyframes(typeof data.customKeyframes === 'string' ? data.customKeyframes : '');
      setBodyBackgroundCss(data.bodyBackgroundCss ?? null);
      let restoredImages: { url: string; file: File; ext: string; id: string }[] = [];
      if (data.images) {
        // Extensiones de vídeo: el MIME del File restaurado debe ser video/* para
        // que la miniatura se muestre como <video> y el clic cree un elemento vídeo.
        const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v'])
        restoredImages = data.images.map((img: any) => {
          console.log('[EditorHTML] restoring image', img.id, img.ext, !!img.base64);
          const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray]);
          const url = URL.createObjectURL(blob);
          const ext = String(img.ext || 'bin').toLowerCase()
          const isVideo = VIDEO_EXTS.has(ext)
          const file = new File([blob], `${img.id}.${img.ext}`, { type: isVideo ? `video/${ext}` : `image/${ext}` });
          return {
            id: img.id,
            ext: img.ext,
            url,
            file,
          };
        });
        console.log('[EditorHTML] restoredImages count:', restoredImages.length);
        setLocalImages(restoredImages);
      }
      if (data.elements) {
        const restoredElements = data.elements.map((el: Element & { localImageId?: string }) => {
          console.log('[EditorHTML] element', el.id, el.type, !!el.src, !!el.localImageId);
          if ((el.type !== 'image' && el.type !== 'video') || !el.src) return el
          const restoredImage = el.localImageId
            ? restoredImages.find((img) => img.id === el.localImageId)
            : restoredImages.find((img) => img.id === el.id)
          console.log('[EditorHTML] matched image for', el.id, !!restoredImage);
          if (restoredImage) {
            return {
              ...el,
              src: restoredImage.url,
            }
          }
          return {
            ...el,
            src: '',
          }
        });
        console.log('[EditorHTML] restoredElements image count:', restoredElements.filter((el: { type: string; }) => el.type === 'image').length);
        setElements(restoredElements.map(normalizeElement));
      }
      setIsLoadModalOpen(false);
    } catch (e: any) {
      console.error('Error abriendo proyecto local:', e);
      alert(e.message || t('editorHTML.alerts.openError'));
    }
  }

  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const project = JSON.parse(event.target?.result as string)
        if (project.canvasColorType) setCanvasColorType(project.canvasColorType)
        if (project.canvasColor) setCanvasColor(project.canvasColor)
        if (project.canvasGradientStart) setCanvasGradientStart(project.canvasGradientStart)
        if (project.canvasGradientEnd) setCanvasGradientEnd(project.canvasGradientEnd)
        if (project.canvasGradientDirection) setCanvasGradientDirection(project.canvasGradientDirection)
        if (project.canvasWidth) setCanvasWidth(project.canvasWidth)
        if (project.canvasHeight) setCanvasHeight(project.canvasHeight)
        if (project.canvasEffect) setCanvasEffect(project.canvasEffect)
        if (project.particleCount) setParticleCount(project.particleCount)
        if (project.particleColor) setParticleColor(project.particleColor)
        if (project.particleShape) setParticleShape(project.particleShape)
        if (project.particleSpeed) setParticleSpeed(project.particleSpeed)
        if (project.particleSize) setParticleSize(project.particleSize)
        if (project.starCount) setStarCount(project.starCount)
        if (project.starSpeed) setStarSpeed(project.starSpeed)
        if (project.starSize) setStarSize(project.starSize)
        if (project.starColor) setStarColor(project.starColor)
        if (project.gradientSpeed) setGradientSpeed(project.gradientSpeed)
        if (project.spotlightSize) setSpotlightSize(project.spotlightSize)
        if (project.spotlightOpacity) setSpotlightOpacity(project.spotlightOpacity)
        if (project.spotlightColor) setSpotlightColor(project.spotlightColor)
        if (project.customFont) {
          setCustomFont(project.customFont)
          setFontFamily(`'${project.customFont}'`)
        }
        // Conserva los efectos del modelo (keyframes personalizados y fondo del body).
        setCustomKeyframes(typeof project.customKeyframes === 'string' ? project.customKeyframes : '');
        setBodyBackgroundCss(project.bodyBackgroundCss ?? null);
        let restoredImages: { url: string; file: File; ext: string; id: string }[] = []
        if (project.images) {
          // Extensiones de vídeo: MIME video/* para que el recurso se detecte como vídeo.
          const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv', 'm4v'])
          restoredImages = project.images.map((img: { id: string; ext: string; base64: string }) => {
            const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64
            const byteCharacters = atob(base64Data)
            const byteNumbers = new Array(byteCharacters.length)
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i)
            }
            const byteArray = new Uint8Array(byteNumbers)
            const blob = new Blob([byteArray])
            const url = URL.createObjectURL(blob)
            const ext = String(img.ext || 'bin').toLowerCase()
            const isVideo = VIDEO_EXTS.has(ext)
            const file = new File([blob], `${img.id}.${img.ext}`, { type: isVideo ? `video/${ext}` : `image/${ext}` })
            return {
              id: img.id,
              ext: img.ext,
              url,
              file,
            }
          })
          setLocalImages(restoredImages)
        }

        if (project.customParticleImage) {
          const base64Data = project.customParticleImage.base64.split(',')[1]
          const byteCharacters = atob(base64Data)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const blob = new Blob([byteArray])
          const url = URL.createObjectURL(blob)
          const file = new File([blob], `${project.customParticleImage.id}.${project.customParticleImage.ext}`, { type: `image/${project.customParticleImage.ext}` })
          setCustomParticleImage({
            id: project.customParticleImage.id,
            ext: project.customParticleImage.ext,
            url,
            file,
          })
        }

        if (project.elements) {
          const restoredElements = project.elements.map((el: Element & { localImageId?: string }) => {
            if ((el.type !== 'image' && el.type !== 'video') || !el.src) return el
            const restoredImage = el.localImageId
              ? restoredImages.find((img) => img.id === el.localImageId)
              : restoredImages.find((img) => img.id === el.id)
            if (restoredImage) {
              return {
                ...el,
                src: restoredImage.url,
              }
            }
            return {
              ...el,
              src: '',
            }
          })
          console.log('Restored elements:', restoredElements)
          console.log('Restored images:', restoredImages)
          setElements(restoredElements.map(normalizeElement))
        }
      } catch (error) {
        console.error('Error loading project:', error)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Setters envueltos: al tocar los color pickers de fondo el usuario toma el
  // control y se descarta el background de body que hubiera definido la IA.
  const setCanvasColorTypeP = (v: React.SetStateAction<'solid' | 'gradient'>) => { setBodyBackgroundCss(null); setCanvasColorType(v) }
  const setCanvasColorP = (v: React.SetStateAction<string>) => { setBodyBackgroundCss(null); setCanvasColor(v) }
  const setCanvasGradientStartP = (v: React.SetStateAction<string>) => { setBodyBackgroundCss(null); setCanvasGradientStart(v) }
  const setCanvasGradientEndP = (v: React.SetStateAction<string>) => { setBodyBackgroundCss(null); setCanvasGradientEnd(v) }
  const setCanvasGradientDirectionP = (v: React.SetStateAction<number>) => { setBodyBackgroundCss(null); setCanvasGradientDirection(v) }

  // Limpia todo el proyecto: elementos, código, imágenes, efectos y fondo,
  // devolviendo el editor a un lienzo en blanco.
  const handleNewProject = () => {
    if (typeof window !== 'undefined' && !window.confirm(t('editorHTML.alerts.confirmNew'))) return
    localImages.forEach((img) => URL.revokeObjectURL(img.url))
    if (customParticleImage) URL.revokeObjectURL(customParticleImage.url)
    lastEmittedCodeRef.current = ''
    setElements([])
    setSelectedElementId(null)
    setCustomKeyframes('')
    setBodyBackgroundCss(null)
    setLocalImages([])
    setCustomParticleImage(null)
    setCode('<!DOCTYPE html>\n<html>\n  <body>\n  </body>\n</html>')
    setCanvasColorType('solid')
    setCanvasColor('#4b5563')
    setCanvasGradientStart('#ffffff')
    setCanvasGradientEnd('#000000')
    setCanvasGradientDirection(180)
    setCanvasWidth(CANVAS_WIDTH)
    setCanvasHeight(CANVAS_HEIGHT)
    setCanvasEffect('none')
    setParticleCount(60)
    setParticleColor('#ffffff')
    setParticleShape('circle')
    setParticleSpeed(1)
    setParticleSize(1)
    setStarCount(80)
    setStarSpeed(1)
    setStarSize(1)
    setStarColor('#ffffff')
    setGradientSpeed(15)
    setSpotlightSize(220)
    setSpotlightOpacity(0.18)
    setSpotlightColor('#ffffff')
    setHistory([[]])
    setHistoryIndex(0)
    setTool('select')
    setClipboard(null)
  }

  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const loadLocalFonts = useCallback(async () => {
    setLocalFontsLoading(true)
    try {
      const res = await fetch('/api/local-fonts')
      if (!res.ok) return
      const data = await res.json()
      setLocalFonts(Array.isArray(data.fonts) ? data.fonts : [])
    } catch (e) {
      console.warn('No se pudieron cargar las fuentes locales:', e)
    } finally {
      setLocalFontsLoading(false)
    }
  }, [])

  // Carga las fuentes de la carpeta «Fuentes» configurada en la pestaña Archivo.
  useEffect(() => {
    loadLocalFonts()
  }, [loadLocalFonts])

  // Registra la fuente en el navegador (para el lienzo) y la cachea en base64
  // para incrustarla como @font-face en el HTML exportado (vista previa / ZIP).
  const ensureLocalFontFace = async (family: string) => {
    const font = localFonts.find((f) => f.family === family)
    if (!font || localFontFacesRef.current[family]) return
    try {
      const res = await fetch(`/api/local-font-file?path=${encodeURIComponent(font.path)}`)
      if (!res.ok) return
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!registeredLocalFontsRef.current.has(family)) {
        registeredLocalFontsRef.current.add(family)
        try {
          const blob = new Blob([buf], { type: res.headers.get('content-type') || 'font/ttf' })
          const url = URL.createObjectURL(blob)
          const face = new FontFace(family, `url(${url})`)
          const loaded = await face.load()
          document.fonts.add(loaded)
        } catch (e) {
          console.warn('No se pudo registrar la fuente local en el lienzo:', family, e)
        }
      }
      // Base64 en trozos para no petar la pila con fuentes grandes.
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
      }
      const ext = (font.path.split('.').pop() || 'ttf').toLowerCase()
      const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf'
      const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype'
      localFontFacesRef.current[family] = { url: `data:${mime};base64,${btoa(bin)}`, format }
      setLocalFontFaces({ ...localFontFacesRef.current })
    } catch (e) {
      console.warn('No se pudo preparar la fuente local para exportar:', family, e)
    }
  }

  const applyLocalFont = async (family: string) => {
    if (!family) return
    await ensureLocalFontFace(family)
    setFontFamily(`'${family}'`)
    if (selectedElement) {
      setElements(elements.map((el) => (el.id === selectedElement.id ? { ...el, fontFamily: `'${family}'` } : el)))
    }
  }

  return (
    <>
      <Head>
        <title>{t('editorHTML.doc.title')}</title>
        <meta name="description" content={t('editorHTML.doc.metaDescription')} />
      </Head>

      <div className="min-h-screen pb-8 bg-gradient-to-br from-gray-950 to-blue-950 text-gray-200">
        <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="flex h-14 w-full items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Moon className="h-6 w-6 text-blue-400" />
              <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                {t('editorHTML.header.brand')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm transition hover:border-red-500 hover:text-red-400"
                title={t('editorHTML.header.newTooltip')}
              >
                <FilePlus2 className="h-4 w-4" />
                {t('editorHTML.header.new')}
              </button>
              <button
                onClick={handleSaveProject}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm transition hover:border-blue-500"
              >
                <Save className="h-4 w-4" />
                {t('editorHTML.header.save')}
              </button>
              <button
                onClick={handleOpenLoadModal}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm transition hover:border-blue-500"
              >
                <FolderOpen className="h-4 w-4" />
                {t('editorHTML.header.load')}
              </button>
              <button
                onClick={handlePreview}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm transition hover:border-emerald-500"
                title={t('editorHTML.header.previewTooltip')}
              >
                <ExternalLink className="h-4 w-4" />
                {t('editorHTML.header.preview')}
              </button>
              <button
                onClick={handleDownloadZip}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                {t('editorHTML.header.downloadZip')}
              </button>
            </div>
          </div>
        </header>

        <div className="flex w-full border-b border-gray-800 px-4">
            <button
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === 'editor'
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <ChevronRight className="h-4 w-4" />
              {t('editorHTML.tabs.editor')}
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === 'code'
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Code2 className="h-4 w-4" />
              {t('editorHTML.tabs.code')}
            </button>
          </div>

        <main className="flex w-full flex-1 flex-col px-4 py-2">
          {activeTab === 'editor' ? (
            <Editor
              elements={elements}
              setElements={setElements}
              selectedElementId={selectedElementId}
              setSelectedElementId={setSelectedElementId}
              tool={tool}
              setTool={setTool}
              fontFamily={fontFamily}
              setFontFamily={setFontFamily}
              customFont={customFont}
              setCustomFont={setCustomFont}
              fontSize={fontSize}
              setFontSize={setFontSize}
              fontColor={fontColor}
              setFontColor={setFontColor}
              isBold={isBold}
              setIsBold={setIsBold}
              isItalic={isItalic}
              setIsItalic={setIsItalic}
              isUnderline={isUnderline}
              setIsUnderline={setIsUnderline}
              strokeColor={strokeColor}
              setStrokeColor={setStrokeColor}
              strokeWidth={strokeWidth}
              setStrokeWidth={setStrokeWidth}
              fillColor={fillColor}
              setFillColor={setFillColor}
              fillOpacity={fillOpacity}
              setFillOpacity={setFillOpacity}
               imageTransparency={imageTransparency}
               setImageTransparency={setImageTransparency}
               imageBorderRadius={imageBorderRadius}
               setImageBorderRadius={setImageBorderRadius}
               imageBorderWidth={imageBorderWidth}
               setImageBorderWidth={setImageBorderWidth}
               imageBorderColor={imageBorderColor}
               setImageBorderColor={setImageBorderColor}
               selectedElement={selectedElement}
              onDelete={handleDeleteElement}
              localImages={localImages}
              setLocalImages={setLocalImages}
              canvasColorType={canvasColorType}
              setCanvasColorType={setCanvasColorTypeP}
              canvasColor={canvasColor}
              setCanvasColor={setCanvasColorP}
              canvasGradientStart={canvasGradientStart}
              setCanvasGradientStart={setCanvasGradientStartP}
              canvasGradientEnd={canvasGradientEnd}
              setCanvasGradientEnd={setCanvasGradientEndP}
  canvasGradientDirection={canvasGradientDirection}
  setCanvasGradientDirection={setCanvasGradientDirectionP}
  canvasWidth={canvasWidth}
  setCanvasWidth={setCanvasWidth}
  canvasHeight={canvasHeight}
  setCanvasHeight={setCanvasHeight}
  canvasEffect={canvasEffect}
  setCanvasEffect={setCanvasEffect}
  customKeyframes={customKeyframes}
  bodyBackgroundCss={bodyBackgroundCss}
  particleCount={particleCount}
  setParticleCount={setParticleCount}
  particleColor={particleColor}
  setParticleColor={setParticleColor}
  particleShape={particleShape}
  setParticleShape={setParticleShape}
  particleSpeed={particleSpeed}
  setParticleSpeed={setParticleSpeed}
  particleSize={particleSize}
  setParticleSize={setParticleSize}
  customParticleImage={customParticleImage}
  setCustomParticleImage={setCustomParticleImage}
  starCount={starCount}
  setStarCount={setStarCount}
  starSpeed={starSpeed}
  setStarSpeed={setStarSpeed}
  starSize={starSize}
  setStarSize={setStarSize}
  starColor={starColor}
  setStarColor={setStarColor}
  gradientSpeed={gradientSpeed}
  setGradientSpeed={setGradientSpeed}
  spotlightSize={spotlightSize}
  setSpotlightSize={setSpotlightSize}
  spotlightOpacity={spotlightOpacity}
  setSpotlightOpacity={setSpotlightOpacity}
  spotlightColor={spotlightColor}
  setSpotlightColor={setSpotlightColor}
  clipboard={clipboard}
  setClipboard={setClipboard}
  history={history}
  historyIndex={historyIndex}
  onCopy={handleCopy}
  onPaste={handlePaste}
  onUndo={handleUndo}
  onRedo={handleRedo}
  localFonts={localFonts}
  localFontsLoading={localFontsLoading}
  loadLocalFonts={loadLocalFonts}
  applyLocalFont={applyLocalFont}
  ensureLocalFontFace={ensureLocalFontFace}
/>
          ) : (
            <CodePanel
              code={code}
              onChange={setCode}
            />
          )}
        </main>
      </div>

      <Modal isOpen={isSaveModalOpen} onClose={() => setIsSaveModalOpen(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">{t('editorHTML.saveModal.title')}</h2>
          <input
            type="text"
            value={saveTitle}
            onChange={(e) => setSaveTitle(e.target.value)}
            placeholder={t('editorHTML.saveModal.namePlaceholder')}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm mb-4"
          />
          {saveModalProjects.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">{t('editorHTML.saveModal.existing')}</p>
              <div className="max-h-48 overflow-y-auto space-y-2 border border-gray-700 rounded-md bg-gray-900/50 p-2">
                {saveModalProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setSaveTitle(project.name.replace(/\.zeus$/i, ''))}
                    className="w-full text-left px-3 py-2 rounded border border-gray-700 bg-gray-900 hover:border-blue-500 text-sm transition truncate"
                  >
                    {project.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsSaveModalOpen(false)}
              className="px-4 py-2 text-sm border border-gray-700 rounded-md hover:border-gray-500"
            >
              {t('editorHTML.saveModal.cancel')}
            </button>
            <button
              onClick={handleConfirmSave}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-500"
            >
              {t('editorHTML.saveModal.save')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isLoadModalOpen} onClose={() => setIsLoadModalOpen(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">{t('editorHTML.loadModal.title')}</h2>
          <p className="mb-4 text-xs text-gray-400 break-all">{t('editorHTML.loadModal.folder')} {localProjects.length ? localProjects[0]?.path?.split(/[\\/]/).slice(0, -1).join('\\') : '...'}</p>
          {projectsLoading ? (
            <div className="text-center py-8 text-gray-400">{t('editorHTML.loadModal.loading')}</div>
          ) : localProjects.length === 0 ? (
            <div className="text-center py-8 text-gray-400">{t('editorHTML.loadModal.empty')}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {localProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleOpenLocalProject(project)}
                  className="w-full text-left px-4 py-3 rounded-md border border-gray-700 bg-gray-900 hover:border-blue-500 transition"
                >
                  {project.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

// ------------------------------------------------------------------
// Editor Component
// ------------------------------------------------------------------

interface EditorProps {
  elements: Element[]
  setElements: (elements: Element[]) => void
  selectedElementId: string | null
  setSelectedElementId: (id: string | null) => void
  tool: AppState['tool']
  setTool: (tool: AppState['tool']) => void
  fontFamily: string
  setFontFamily: React.Dispatch<React.SetStateAction<string>>
  customFont: string
  setCustomFont: React.Dispatch<React.SetStateAction<string>>
  fontSize: number
  setFontSize: React.Dispatch<React.SetStateAction<number>>
  fontColor: string
  setFontColor: React.Dispatch<React.SetStateAction<string>>
  isBold: boolean
  setIsBold: React.Dispatch<React.SetStateAction<boolean>>
  isItalic: boolean
  setIsItalic: React.Dispatch<React.SetStateAction<boolean>>
  isUnderline: boolean
  setIsUnderline: React.Dispatch<React.SetStateAction<boolean>>
  strokeColor: string
  setStrokeColor: React.Dispatch<React.SetStateAction<string>>
  strokeWidth: number
  setStrokeWidth: React.Dispatch<React.SetStateAction<number>>
  fillColor: string
  setFillColor: React.Dispatch<React.SetStateAction<string>>
  fillOpacity: number
  setFillOpacity: React.Dispatch<React.SetStateAction<number>>
  imageTransparency: number
  setImageTransparency: React.Dispatch<React.SetStateAction<number>>
  imageBorderRadius: number
  setImageBorderRadius: React.Dispatch<React.SetStateAction<number>>
  imageBorderWidth: number
  setImageBorderWidth: React.Dispatch<React.SetStateAction<number>>
  imageBorderColor: string
  setImageBorderColor: React.Dispatch<React.SetStateAction<string>>
  selectedElement: Element | null
  onDelete: () => void
  localImages: { url: string; file: File; ext: string; id: string }[]
  setLocalImages: React.Dispatch<React.SetStateAction<{ url: string; file: File; ext: string; id: string }[]>>
  canvasColorType: 'solid' | 'gradient'
  setCanvasColorType: React.Dispatch<React.SetStateAction<'solid' | 'gradient'>>
  canvasColor: string
  setCanvasColor: React.Dispatch<React.SetStateAction<string>>
  canvasGradientStart: string
  setCanvasGradientStart: React.Dispatch<React.SetStateAction<string>>
  canvasGradientEnd: string
  setCanvasGradientEnd: React.Dispatch<React.SetStateAction<string>>
  canvasGradientDirection: number
  setCanvasGradientDirection: React.Dispatch<React.SetStateAction<number>>
  canvasWidth: number
  setCanvasWidth: React.Dispatch<React.SetStateAction<number>>
  canvasHeight: number
  setCanvasHeight: React.Dispatch<React.SetStateAction<number>>
  canvasEffect: string
  setCanvasEffect: React.Dispatch<React.SetStateAction<string>>
  customKeyframes: string
  bodyBackgroundCss: string | null
  particleCount: number
  setParticleCount: React.Dispatch<React.SetStateAction<number>>
  particleColor: string
  setParticleColor: React.Dispatch<React.SetStateAction<string>>
  particleShape: string
  setParticleShape: React.Dispatch<React.SetStateAction<string>>
  particleSpeed: number
  setParticleSpeed: React.Dispatch<React.SetStateAction<number>>
  particleSize: number
  setParticleSize: React.Dispatch<React.SetStateAction<number>>
  customParticleImage: { url: string; file: File; ext: string; id: string } | null
  setCustomParticleImage: React.Dispatch<React.SetStateAction<{ url: string; file: File; ext: string; id: string } | null>>
  starCount: number
  setStarCount: React.Dispatch<React.SetStateAction<number>>
  starSpeed: number
  setStarSpeed: React.Dispatch<React.SetStateAction<number>>
  starSize: number
  setStarSize: React.Dispatch<React.SetStateAction<number>>
  starColor: string
  setStarColor: React.Dispatch<React.SetStateAction<string>>
  gradientSpeed: number
  setGradientSpeed: React.Dispatch<React.SetStateAction<number>>
  spotlightSize: number
  setSpotlightSize: React.Dispatch<React.SetStateAction<number>>
  spotlightOpacity: number
  setSpotlightOpacity: React.Dispatch<React.SetStateAction<number>>
  spotlightColor: string
  setSpotlightColor: React.Dispatch<React.SetStateAction<string>>
  clipboard: Element[] | null
  setClipboard: React.Dispatch<React.SetStateAction<Element[] | null>>
  history: Element[][]
  historyIndex: number
  onCopy: () => void
  onPaste: () => void
  onUndo: () => void
  onRedo: () => void
  localFonts: { id: string; name: string; family: string; path: string; size?: number }[]
  localFontsLoading: boolean
  loadLocalFonts: () => void
  applyLocalFont: (family: string) => void
  ensureLocalFontFace: (family: string) => void
}

function Editor({
  elements,
  setElements,
  selectedElementId,
  setSelectedElementId,
  tool,
  setTool,
  fontFamily,
  setFontFamily,
  customFont,
  setCustomFont,
  fontSize,
  setFontSize,
  fontColor,
  setFontColor,
  isBold,
  setIsBold,
  isItalic,
  setIsItalic,
  isUnderline,
  setIsUnderline,
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  fillColor,
  setFillColor,
  fillOpacity,
  setFillOpacity,
  imageTransparency,
  setImageTransparency,
  imageBorderRadius,
  setImageBorderRadius,
  imageBorderWidth,
  setImageBorderWidth,
  imageBorderColor,
  setImageBorderColor,
  selectedElement,
  onDelete,
  localImages,
  setLocalImages,
  canvasColorType,
  setCanvasColorType,
  canvasColor,
  setCanvasColor,
  canvasGradientStart,
  setCanvasGradientStart,
  canvasGradientEnd,
  setCanvasGradientEnd,
  canvasGradientDirection,
  setCanvasGradientDirection,
  canvasWidth,
  setCanvasWidth,
  canvasHeight,
  setCanvasHeight,
  canvasEffect,
  setCanvasEffect,
  particleCount,
  setParticleCount,
  particleColor,
  setParticleColor,
  particleShape,
  setParticleShape,
  particleSpeed,
  setParticleSpeed,
  particleSize,
  setParticleSize,
  customParticleImage,
  setCustomParticleImage,
  starCount,
  setStarCount,
  starSpeed,
  setStarSpeed,
  starSize,
  setStarSize,
  starColor,
  setStarColor,
  gradientSpeed,
  setGradientSpeed,
  spotlightSize,
  setSpotlightSize,
  spotlightOpacity,
  setSpotlightOpacity,
  spotlightColor,
  setSpotlightColor,
  clipboard,
  setClipboard,
  history,
  historyIndex,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  customKeyframes,
  bodyBackgroundCss,
  localFonts,
  localFontsLoading,
  loadLocalFonts,
  applyLocalFont,
  ensureLocalFontFace,
}: EditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    type: 'move' | 'create' | 'marquee'
    elementId?: string
    startX: number
    startY: number
    originalX?: number
    originalY?: number
  } | null>(null)
  // Selección múltiple por marco (marquee). Transitorio: no va al store.
  const [multiSelectIds, setMultiSelectIds] = useState<string[]>([])
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Estado del panel "Grupo": lista de slots de animación a aplicar al conjunto.
  const [groupSlots, setGroupSlots] = useState<AnimSlot[]>([{ name: 'pulse', duration: 1, delay: 0 }])
  const [groupGlowColor, setGroupGlowColor] = useState('#ffdd00')
  const [groupGlowIntensity, setGroupGlowIntensity] = useState(1.5)
  const [groupGlowDensity, setGroupGlowDensity] = useState(0.4)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Fuentes favoritas de Google Fonts (persisten en localStorage del navegador).
  const [favoriteFonts, setFavoriteFonts] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem('zeusHtmlFavFonts')
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try { window.localStorage.setItem('zeusHtmlFavFonts', JSON.stringify(favoriteFonts)) } catch { /* noop */ }
  }, [favoriteFonts])
  // Carga las favoritas de Google Fonts para que el ejemplo se vea con su tipografía.
  useEffect(() => {
    const system = new Set(['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'])
    const fams = favoriteFonts.filter((f) => f && !system.has(f))
    if (!fams.length) return
    const linkId = 'zeus-html-fav-fonts'
    const existing = document.getElementById(linkId)
    if (existing) existing.remove()
    const link = document.createElement('link')
    link.id = linkId
    link.href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f)}`).join('&')}&display=swap`
    link.rel = 'stylesheet'
    document.head.appendChild(link)
    return () => { document.getElementById(linkId)?.remove() }
  }, [favoriteFonts])
  const { t } = useI18n()
  // Opciones de animación y etiquetas de tipo traducidas (memoizadas por `t`,
  // que sólo cambia cuando cambia el locale).
  const animOptions = useMemo(() => getAnimOptions(t), [t])
  const typeLabels = useMemo<Record<string, string>>(() => ({
    text: t('editorHTML.selected.typeText'),
    rect: t('editorHTML.selected.typeRect'),
    circle: t('editorHTML.selected.typeCircle'),
    line: t('editorHTML.selected.typeLine'),
    image: t('editorHTML.selected.typeImage'),
    video: t('editorHTML.selected.typeVideo'),
  }), [t])

  useEffect(() => {
    if (canvasEffect !== 'spotlight') return
    const canvas = canvasRef.current
    if (!canvas) return

     const onSpotlightMove = (e: MouseEvent) => {
       const rect = canvas.getBoundingClientRect()
       const x = ((e.clientX - rect.left) / rect.width) * 100
       const y = ((e.clientY - rect.top) / rect.height) * 100
        const spotlight = canvas.querySelector('#effect-spotlight')
        if (spotlight) {
          const el = spotlight as HTMLDivElement
          el.style.setProperty('--spotlight-x', `${x}%`)
          el.style.setProperty('--spotlight-y', `${y}%`)
        }
     }

    canvas.addEventListener('mousemove', onSpotlightMove)
    return () => canvas.removeEventListener('mousemove', onSpotlightMove)
  }, [canvasEffect])

  const handleSelectImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newImages = Array.from(files).map(file => {
      const fullName = file.name || `image.${file.type.split('/')[1] || 'bin'}`
      const nameWithoutExt = fullName.replace(/\.[^/.]+$/, '')
      const ext = fullName.split('.').pop() || 'bin'
      return {
        url: URL.createObjectURL(file),
        file: file,
        ext: ext,
        id: nameWithoutExt,
      }
    })
    setLocalImages(prev => [...prev, ...newImages])
    e.target.value = ''
  }

  const getMousePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  // Bounding box absoluto de un elemento (width/height pueden ser negativos,
  // p.ej. en líneas trazadas hacia arriba/izquierda).
  const elementBounds = (el: Element) => ({
    x: Math.min(el.x, el.x + el.width),
    y: Math.min(el.y, el.y + el.height),
    w: Math.abs(el.width),
    h: Math.abs(el.height),
  })
  const rectsIntersect = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e)
    if (tool === 'select') {
      const reversed = [...elements].reverse()
      const el = reversed.find((el) => {
        const x = el.x
        const y = el.y
        const w = el.width
        const h = el.height
        return pos.x >= x && pos.x <= x + Math.abs(w) && pos.y >= y && pos.y <= y + Math.abs(h)
      })
      if (el) {
        setSelectedElementId(el.id)
        setMultiSelectIds([])
        setDragState({ type: 'move', elementId: el.id, startX: pos.x, startY: pos.y, originalX: el.x, originalY: el.y })
      } else {
        // Clic en lienzo vacío con herramienta "Seleccionar": inicia un marco
        // (marquee) de línea discontinua para seleccionar varios objetos.
        setSelectedElementId(null)
        setMultiSelectIds([])
        setMarqueeRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
        setDragState({ type: 'marquee', startX: pos.x, startY: pos.y })
      }
      return
    }

    const newId = `el-${Date.now()}`
    let newElement: Element | undefined

    if (tool === 'line') {
      newElement = {
        id: newId,
        type: 'line',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor: 'transparent',
        fillOpacity: 0,
        opacity: 1,
        animations: undefined,
      }
    } else if (tool === 'rect') {
      newElement = {
        id: newId,
        type: 'rect',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor,
        fillOpacity,
        opacity: 1,
        animations: undefined,
        cornerRadius: 0,
      }
    } else if (tool === 'circle') {
      newElement = {
        id: newId,
        type: 'circle',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        rotation: 0,
        strokeColor,
        strokeWidth,
        fillColor,
        fillOpacity,
        opacity: 1,
        animations: undefined,
      }
    } else if (tool === 'text') {
      newElement = {
        id: newId,
        type: 'text',
        x: pos.x,
        y: pos.y,
        width: 200,
        height: fontSize + 10,
        rotation: 0,
        strokeColor: 'transparent',
        strokeWidth: 0,
        fillColor: 'transparent',
        fillOpacity: 0,
        text: t('editorHTML.editor.defaultText'),
        fontFamily,
        fontSize,
        fontWeight: isBold ? 700 : 400,
        fontStyle: isItalic ? 'italic' : 'normal',
        textDecoration: isUnderline ? 'underline' : 'none',
        color: fontColor,
        opacity: 1,
        animations: undefined,
      }
    } else if (tool === 'image' && localImages.length) {
      const localImage = localImages[Math.floor(Math.random() * localImages.length)]
      const imageUrl = localImage.url
      const isVideo = localImage.file.type.startsWith('video/')
      newElement = {
        id: newId,
        type: isVideo ? 'video' : 'image',
        x: pos.x,
        y: pos.y,
        width: 200,
        height: 140,
        rotation: 0,
        strokeColor: 'transparent',
        strokeWidth: 0,
        fillColor: 'transparent',
        fillOpacity: 0,
        src: imageUrl,
        opacity: imageTransparency,
        animations: undefined,
        localImageId: localImage.id,
        imageBorderRadius,
        imageBorderWidth,
        imageBorderColor,
      }
    }

    if (newElement) {
      const finalId = newElement.id || newId
      setElements([...elements, { ...newElement, id: finalId }])
      setSelectedElementId(finalId)
      setDragState({ type: 'create', elementId: finalId, startX: pos.x, startY: pos.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState) return
    const pos = getMousePos(e)
    if (dragState.type === 'marquee') {
      setMarqueeRect({ x: dragState.startX, y: dragState.startY, w: pos.x - dragState.startX, h: pos.y - dragState.startY })
      return
    }
    const dx = pos.x - dragState.startX
    const dy = pos.y - dragState.startY

    const updated = elements.map((el) => {
      if (el.id !== dragState.elementId) return el
      if (dragState.type === 'move') {
        return {
          ...el,
          x: (dragState.originalX ?? 0) + dx,
          y: (dragState.originalY ?? 0) + dy,
        }
      } else {
        if (el.type === 'line') {
          return { ...el, width: dx, height: dy }
        } else if (el.type === 'circle' || el.type === 'rect') {
          // Con Ctrl: cuadrado/círculo perfecto (ancho = alto). Se usa el mayor
          // de los dos desplazamientos y se conserva la dirección del trazado.
          if (e.ctrlKey || e.metaKey) {
            const size = Math.max(Math.abs(dx), Math.abs(dy))
            const w = dx < 0 ? -size : size
            const h = dy < 0 ? -size : size
            return { ...el, width: w, height: h }
          }
          return { ...el, width: dx, height: dy }
        }
        return el
      }
    })
    setElements(updated)
  }

  const handleMouseUp = () => {
    if (dragState?.type === 'marquee' && marqueeRect) {
      const m = {
        x: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
        y: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
        w: Math.abs(marqueeRect.w),
        h: Math.abs(marqueeRect.h),
      }
      // Ignora arrastres minúsculos (clics sin arrastrar de verdad).
      if (m.w >= 3 || m.h >= 3) {
        const hits = elements.filter((el) => rectsIntersect(m, elementBounds(el)))
        if (hits.length > 1) {
          setSelectedElementId(null)
          setMultiSelectIds(hits.map((e) => e.id))
        } else if (hits.length === 1) {
          setSelectedElementId(hits[0].id)
          setMultiSelectIds([])
        } else {
          setSelectedElementId(null)
          setMultiSelectIds([])
        }
      }
      setMarqueeRect(null)
    }
    setDragState(null)
  }

  const getCanvasBackground = () => {
    if (canvasColorType === 'solid') {
      return canvasColor
    }
    return `linear-gradient(${canvasGradientDirection}deg, ${canvasGradientStart}, ${canvasGradientEnd})`
  }

  const handleUpdateSelected = (patch: Partial<Element>) => {
    if (!selectedElement) return
    setElements(elements.map((el) => (el.id === selectedElement.id ? { ...el, ...patch } : el)))
  }

  // --- Capas (orden de apilado = orden del array elements; el último se dibuja encima) ---
  const layerTargetIds = () =>
    multiSelectIds.length ? multiSelectIds : (selectedElementId ? [selectedElementId] : [])

  const bringToFront = useCallback(() => {
    const ids = layerTargetIds()
    if (!ids.length) return
    const moved = elements.filter((el) => ids.includes(el.id))
    const rest = elements.filter((el) => !ids.includes(el.id))
    const next = [...rest, ...moved]
    setElements(next)
  }, [elements, multiSelectIds, selectedElementId])

  const sendToBack = useCallback(() => {
    const ids = layerTargetIds()
    if (!ids.length) return
    const moved = elements.filter((el) => ids.includes(el.id))
    const rest = elements.filter((el) => !ids.includes(el.id))
    const next = [...moved, ...rest]
    setElements(next)
  }, [elements, multiSelectIds, selectedElementId])

  // Sube un nivel (intercambia con el siguiente elemento no seleccionado).
  const moveForward = useCallback(() => {
    const ids = layerTargetIds()
    if (!ids.length) return
    const next = [...elements]
    for (let i = next.length - 2; i >= 0; i--) {
      if (ids.includes(next[i].id) && !ids.includes(next[i + 1].id)) {
        const tmp = next[i]; next[i] = next[i + 1]; next[i + 1] = tmp
      }
    }
    if (next.some((el, i) => el.id !== elements[i].id)) {
      setElements(next)
    }
  }, [elements, multiSelectIds, selectedElementId])

  // Baja un nivel (intercambia con el anterior elemento no seleccionado).
  const moveBackward = useCallback(() => {
    const ids = layerTargetIds()
    if (!ids.length) return
    const next = [...elements]
    for (let i = 1; i < next.length; i++) {
      if (ids.includes(next[i].id) && !ids.includes(next[i - 1].id)) {
        const tmp = next[i]; next[i] = next[i - 1]; next[i - 1] = tmp
      }
    }
    if (next.some((el, i) => el.id !== elements[i].id)) {
      setElements(next)
    }
  }, [elements, multiSelectIds, selectedElementId])

  // --- Fuentes favoritas de Google Fonts ---
  const saveFavoriteFont = () => {
    const name = customFont.trim().replace(/^['"]|['"]$/g, '')
    if (!name) return
    setFavoriteFonts((prev) => (prev.includes(name) ? prev : [...prev, name]))
  }
  const applyFavoriteFont = (name: string) => {
    // Si es una fuente local de la carpeta «Fuentes», la registra para el lienzo y el export.
    ensureLocalFontFace(name)
    setCustomFont(name)
    setFontFamily(`'${name}'`)
    if (selectedElement?.type === 'text') handleUpdateSelected({ fontFamily: `'${name}'` })
  }
  // Elimina un recurso (imagen o vídeo) del panel y libera su blob URL.
  const handleRemoveLocalImage = (index: number) => {
    const img = localImages[index]
    if (img) URL.revokeObjectURL(img.url)
    setLocalImages((prev) => prev.filter((_, i) => i !== index))
  }

  // --- Animaciones (lista de slots por elemento) ---
  const slotsOf = (el: Element | null) => (el?.animations ? el.animations : [])

  const handleUpdateSlot = (index: number, patch: Partial<AnimSlot>) => {
    if (!selectedElement) return
    setElements(elements.map((el) => {
      if (el.id !== selectedElement.id) return el
      const slots = slotsOf(el).slice()
      if (!slots[index]) return el
      // Al editar un slot desde la UI, se descarta el shorthand de la IA y se
      // reconstruye desde los campos editables.
      slots[index] = { ...slots[index], ...patch, shorthand: undefined }
      return { ...el, animations: slots }
    }))
  }

  const handleAddSlot = () => {
    if (!selectedElement) return
    const slots = slotsOf(selectedElement)
    if (slots.length >= 5) return
    setElements(elements.map((el) => el.id === selectedElement.id
      ? { ...el, animations: [...slots, { name: 'pulse', duration: 1, delay: 0 }] }
      : el))
  }

  const handleRemoveSlot = (index: number) => {
    if (!selectedElement) return
    setElements(elements.map((el) => {
      if (el.id !== selectedElement.id) return el
      const slots = slotsOf(el).filter((_, i) => i !== index)
      return { ...el, animations: slots.length ? slots : undefined }
    }))
  }

  const handleSetSlotName = (index: number, name: string) => {
    if (!selectedElement) return
    if (name === '') { handleRemoveSlot(index); return }
    // Duración por defecto al elegir glow (iluminación 3s, neón 2s).
    const defaultDur = name === 'iluminacion' ? 3 : (name === 'neon' ? 2 : 1)
    setElements(elements.map((el) => {
      if (el.id !== selectedElement.id) return el
      const slots = slotsOf(el).slice()
      if (!slots[index]) return el
      const prev = slots[index]
      slots[index] = { name, duration: prev.duration ?? defaultDur, delay: prev.delay ?? 0, shorthand: undefined }
      return { ...el, animations: slots }
    }))
  }

  // Glow config (color/intensidad/densidad) a nivel de elemento + "velocidad"
  // que edita la duración del primer slot glow.
  const glowSlotIndex = (el: Element | null) => {
    const slots = slotsOf(el)
    return slots.findIndex((s) => GLOW_ANIMATIONS.has(s.name))
  }
  const handleUpdateGlow = (patch: Partial<Pick<Element, 'iluminacionColor' | 'iluminacionIntensity' | 'iluminacionDensity'>> & { duration?: number }) => {
    if (!selectedElement) return
    setElements(elements.map((el) => {
      if (el.id !== selectedElement.id) return el
      const { duration, ...rest } = patch
      let next: Element = { ...el, ...rest }
      if (duration !== undefined) {
        const gi = glowSlotIndex(el)
        const slots = slotsOf(el).slice()
        if (gi >= 0 && slots[gi]) {
          slots[gi] = { ...slots[gi], duration, shorthand: undefined }
          next = { ...next, animations: slots }
        }
      }
      return next
    }))
  }

  // --- Animación de grupo (selección múltiple por marquee) ---
  // El panel "Grupo" mantiene su propia lista de slots (como el panel de un
  // elemento) y al pulsar "Aplicar al grupo" reemplaza las animaciones de cada
  // elemento del grupo por esa lista (mismos slots → se reproducen en secuencia
  // vía computeEffectiveDelays, igual que en un elemento único).
  const groupHasGlow = groupSlots.some((s) => GLOW_ANIMATIONS.has(s.name))
  const groupGlowIdx = groupSlots.findIndex((s) => GLOW_ANIMATIONS.has(s.name))

  const handleGroupAddSlot = () => setGroupSlots((s) => (s.length >= 5 ? s : [...s, { name: 'pulse', duration: 1, delay: 0 }]))
  const handleGroupRemoveSlot = (i: number) => setGroupSlots((s) => s.filter((_, idx) => idx !== i))
  const handleGroupSetSlotName = (i: number, name: string) => {
    if (name === '') { handleGroupRemoveSlot(i); return }
    const defaultDur = name === 'iluminacion' ? 3 : (name === 'neon' ? 2 : 1)
    setGroupSlots((s) => s.map((slot, idx) => idx === i ? { name, duration: slot.duration ?? defaultDur, delay: slot.delay ?? 0 } : slot))
  }
  const handleGroupUpdateSlot = (i: number, patch: Partial<AnimSlot>) =>
    setGroupSlots((s) => s.map((slot, idx) => (idx === i ? { ...slot, ...patch } : slot)))

  const handleApplyGroupAnimation = () => {
    if (multiSelectIds.length === 0) return
    const slots = groupSlots.length ? groupSlots.map((s) => ({ ...s })) : undefined
    setElements(elements.map((el) => {
      if (!multiSelectIds.includes(el.id)) return el
      let next: Element = { ...el, animations: slots }
      if (groupHasGlow) {
        next = { ...next, iluminacionColor: groupGlowColor, iluminacionIntensity: groupGlowIntensity, iluminacionDensity: groupGlowDensity }
      }
      return next
    }))
  }
  // Disuelve el grupo: deja de ser selección múltiple pero NO borra los objetos.
  const handleDisbandGroup = () => {
    setMultiSelectIds([])
    setSelectedElementId(null)
  }
  // Sí elimina los objetos seleccionados del lienzo.
  const handleDeleteGroup = () => {
    if (multiSelectIds.length === 0) return
    setElements(elements.filter((el) => !multiSelectIds.includes(el.id)))
    setMultiSelectIds([])
    setSelectedElementId(null)
  }

  // Esc limpia la selección múltiple; cambiar a una herramienta de creación
  // también (para no dejar anillos sueltos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase()
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === 'Escape' && !isInput && multiSelectIds.length) {
        setMultiSelectIds([])
        setSelectedElementId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [multiSelectIds, setSelectedElementId])
  useEffect(() => {
    if (tool !== 'select') setMultiSelectIds([])
  }, [tool])

  // Valores derivados del elemento seleccionado para el panel de animación.
  const selectedSlots = slotsOf(selectedElement)
  const glowIdx = glowSlotIndex(selectedElement)
  const glowSlot = glowIdx >= 0 ? selectedSlots[glowIdx] : undefined
  const isNeonGlow = selectedSlots.some((s) => s.name === 'neon')

  // Sliders de imagen en "Insertar Imagen": si hay una imagen seleccionada
  // editan esa imagen en vivo; si no, fijan el valor por defecto para la
  // próxima imagen que se inserte.
  const imgRadius = selectedElement?.type === 'image' || selectedElement?.type === 'video' ? selectedElement.imageBorderRadius ?? 0 : imageBorderRadius
  const imgBorderW = selectedElement?.type === 'image' || selectedElement?.type === 'video' ? selectedElement.imageBorderWidth ?? 0 : imageBorderWidth
  const imgBorderColor = selectedElement?.type === 'image' || selectedElement?.type === 'video' ? selectedElement.imageBorderColor ?? '#000000' : imageBorderColor
  const imgOpacity = selectedElement?.type === 'image' || selectedElement?.type === 'video' ? selectedElement.opacity ?? 1 : imageTransparency

  // Etiqueta legible del objeto seleccionado para mostrarla en el panel.
  const selectedLabel = selectedElement
    ? `${typeLabels[selectedElement.type] || selectedElement.type} · ${
        selectedElement.type === 'text'
          ? `"${(selectedElement.text || '').slice(0, 24)}${(selectedElement.text || '').length > 24 ? '…' : ''}"`
          : selectedElement.id
      }`
    : t('editorHTML.selected.none')

  return (
    <div className="html-editor flex w-full gap-4 flex-col lg:flex-row lg:h-[calc(100vh-9.5rem)]">
      <div className="w-full lg:w-96 shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto scrollbar-thin-transparent pr-1">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.selected.title')}</span>
            <span
              className={`truncate rounded px-2 py-0.5 text-xs font-medium ${
                selectedElement
                  ? 'bg-blue-500/15 text-blue-300'
                  : 'bg-gray-800 text-gray-500'
              }`}
              title={selectedLabel}
            >
              {selectedLabel}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.canvas.title')}</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.width')}</span>
              <input
                type="number"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(Number(e.target.value))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.height')}</span>
              <input
                type="number"
                value={canvasHeight}
                onChange={(e) => setCanvasHeight(Number(e.target.value))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={canvasColorType}
                onChange={(e) => setCanvasColorType(e.target.value as 'solid' | 'gradient')}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              >
                <option value="solid">{t('editorHTML.canvas.bgSolid')}</option>
                <option value="gradient">{t('editorHTML.canvas.bgGradient')}</option>
              </select>
            </div>
            {canvasColorType === 'solid' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                <input
                  type="color"
                  value={canvasColor}
                  onChange={(e) => setCanvasColor(e.target.value)}
                  className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <input
                  type="text"
                  value={canvasColor}
                  onChange={(e) => setCanvasColor(e.target.value)}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.start')}</span>
                  <input
                    type="color"
                    value={canvasGradientStart}
                    onChange={(e) => setCanvasGradientStart(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={canvasGradientStart}
                    onChange={(e) => setCanvasGradientStart(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.end')}</span>
                  <input
                    type="color"
                    value={canvasGradientEnd}
                    onChange={(e) => setCanvasGradientEnd(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={canvasGradientEnd}
                    onChange={(e) => setCanvasGradientEnd(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.angle')}</span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={canvasGradientDirection}
                    onChange={(e) => setCanvasGradientDirection(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">{canvasGradientDirection}°</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.effect')}</span>
              <select
                value={canvasEffect}
                onChange={(e) => setCanvasEffect(e.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              >
                <option value="none">{t('editorHTML.canvas.effectNone')}</option>
                <option value="particles">{t('editorHTML.canvas.effectParticles')}</option>
                <option value="stars">{t('editorHTML.canvas.effectStars')}</option>
                <option value="gradient-animated">{t('editorHTML.canvas.effectGradient')}</option>
                <option value="spotlight">{t('editorHTML.canvas.effectSpotlight')}</option>
              </select>
            </div>
            {canvasEffect === 'particles' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.count')}</span>
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={particleCount}
                    onChange={(e) => setParticleCount(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                  <input
                    type="color"
                    value={particleColor}
                    onChange={(e) => setParticleColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={particleColor}
                    onChange={(e) => setParticleColor(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.shape')}</span>
                  <select
                    value={particleShape}
                    onChange={(e) => setParticleShape(e.target.value)}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  >
                    <option value="circle">{t('editorHTML.canvas.shapeCircle')}</option>
                    <option value="square">{t('editorHTML.canvas.shapeSquare')}</option>
                    <option value="triangle">{t('editorHTML.canvas.shapeTriangle')}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.size')}</span>
                  <input
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={particleSize}
                    onChange={(e) => setParticleSize(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.image')}</span>
                  <input
                    type="file"
                    accept="image/png,image/webp,image/gif,image/svg+xml,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = URL.createObjectURL(file)
                      const ext = file.name.split('.').pop() || 'png'
                      setCustomParticleImage({ url, file, ext, id: `particle-img-${Date.now()}` })
                    }}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                  {customParticleImage && (
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(customParticleImage.url)
                        setCustomParticleImage(null)
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      {t('editorHTML.canvas.remove')}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.speed')}</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={particleSpeed}
                    onChange={(e) => setParticleSpeed(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            )}
            {canvasEffect === 'stars' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.count')}</span>
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={starCount}
                    onChange={(e) => setStarCount(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                  <input
                    type="color"
                    value={starColor}
                    onChange={(e) => setStarColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                  />
                  <input
                    type="text"
                    value={starColor}
                    onChange={(e) => setStarColor(e.target.value)}
                    className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.size')}</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={starSize}
                    onChange={(e) => setStarSize(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.speed')}</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={starSpeed}
                    onChange={(e) => setStarSpeed(Number(e.target.value))}
                    className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            )}
             {canvasEffect === 'gradient-animated' && (
               <div className="mt-2 space-y-2">
                 <div className="flex items-center gap-2">
                   <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.speed')}</span>
                   <input
                     type="number"
                     min="1"
                     max="60"
                     step="1"
                     value={gradientSpeed}
                     onChange={(e) => setGradientSpeed(Number(e.target.value))}
                     className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                   />
                   <span className="text-xs text-gray-400">{t('editorHTML.canvas.seconds')}</span>
                 </div>
               </div>
             )}
             {canvasEffect === 'spotlight' && (
               <div className="mt-2 space-y-2">
                 <div className="flex items-center gap-2">
                   <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.size')}</span>
                   <input
                     type="range"
                     min="60"
                     max="500"
                     value={spotlightSize}
                     onChange={(e) => setSpotlightSize(Number(e.target.value))}
                     className="flex-1"
                   />
                   <span className="text-xs text-gray-400 w-10 text-right">{spotlightSize}px</span>
                 </div>
                 <div className="flex items-center gap-2">
                   <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.intensity')}</span>
                   <input
                     type="range"
                     min="0.02"
                     max="1"
                     step="0.02"
                     value={spotlightOpacity}
                     onChange={(e) => setSpotlightOpacity(Number(e.target.value))}
                     className="flex-1"
                   />
                   <span className="text-xs text-gray-400 w-10 text-right">{Math.round(spotlightOpacity * 100)}%</span>
                 </div>
                 <div className="flex items-center gap-2">
                   <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                   <input
                     type="color"
                     value={spotlightColor}
                     onChange={(e) => setSpotlightColor(e.target.value)}
                     className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                   />
                   <input
                     type="text"
                     value={spotlightColor}
                     onChange={(e) => setSpotlightColor(e.target.value)}
                     className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                   />
                 </div>
               </div>
             )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.text.title')}</h3>
          <div className="space-y-2">
            <select
              value={fontFamily}
              onChange={(e) => {
                setFontFamily(e.target.value)
                if (selectedElement?.type === 'text') handleUpdateSelected({ fontFamily: e.target.value })
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
            >
              {['Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={t('editorHTML.text.fontPlaceholder')}
                value={customFont}
                onChange={(e) => setCustomFont(e.target.value)}
                className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  if (!customFont.trim()) return
                  setFontFamily(`'${customFont.trim()}'`)
                  if (selectedElement?.type === 'text') {
                    handleUpdateSelected({ fontFamily: `'${customFont.trim()}'` })
                  }
                }}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                {t('editorHTML.text.apply')}
              </button>
              <button
                onClick={() => window.open('https://fonts.google.com', '_blank')}
                className="rounded-md border border-gray-700 bg-gray-900 p-2 text-gray-300 transition hover:border-blue-500 hover:text-blue-400"
                title={t('editorHTML.text.openGoogleFonts')}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('editorHTML.text.localFonts')}</div>
                <button
                  type="button"
                  onClick={loadLocalFonts}
                  title={t('editorHTML.text.refreshLocalFonts')}
                  className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-white"
                >
                  <RefreshCw className={`h-3 w-3 ${localFontsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <select
                value={localFonts.some((f) => f.family === fontFamily.replace(/['"]/g, '')) ? fontFamily.replace(/['"]/g, '') : ''}
                onChange={(e) => { const fam = e.target.value; if (fam) applyLocalFont(fam) }}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              >
                <option value="">
                  {localFonts.length === 0
                    ? (localFontsLoading ? t('editorHTML.text.loadingLocalFonts') : t('editorHTML.text.noLocalFonts'))
                    : t('editorHTML.text.selectLocalFont')}
                </option>
                {localFonts.map((f) => (
                  <option key={f.id} value={f.family} style={{ fontFamily: `'${f.family}', sans-serif` }}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {favoriteFonts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('editorHTML.text.favorites')}</div>
                {favoriteFonts.map((f) => (
                  <div key={f} className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900/50 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => applyFavoriteFont(f)}
                      title={t('editorHTML.text.applyFav', { font: f })}
                      className="min-w-0 flex-1 text-left"
                      style={{ fontFamily: `'${f}', sans-serif` }}
                    >
                      <span className="block truncate text-[10px] text-gray-400">{f}</span>
                      <span className="block truncate text-sm text-gray-100">A a B b C c · 123</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFavoriteFonts(favoriteFonts.filter((x) => x !== f))}
                      title={t('editorHTML.text.removeFav')}
                      className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={fontSize}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setFontSize(v)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontSize: v, height: v + 10 })
                }}
                className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
              <input
                type="color"
                value={fontColor}
                onChange={(e) => {
                  setFontColor(e.target.value)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ color: e.target.value })
                }}
                className="h-8 w-8 cursor-pointer rounded-md border border-gray-700 bg-gray-900"
              />
              <button
                onClick={saveFavoriteFont}
                title={t('editorHTML.text.saveFav')}
                className="rounded-md border border-amber-600/50 bg-amber-900/20 p-2 text-amber-300 transition hover:bg-amber-800/40"
              >
                <Star className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setIsBold(!isBold)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontWeight: !isBold ? 700 : 400 })
                }}
                className={`rounded-md p-2 ${isBold ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Bold className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setIsItalic(!isItalic)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ fontStyle: !isItalic ? 'italic' : 'normal' })
                }}
                className={`rounded-md p-2 ${isItalic ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Italic className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setIsUnderline(!isUnderline)
                  if (selectedElement?.type === 'text') handleUpdateSelected({ textDecoration: !isUnderline ? 'underline' : 'none' })
                }}
                className={`rounded-md p-2 ${isUnderline ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
              >
                <Underline className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.draw.title')}</h3>
          <div className="flex gap-2 mb-2">
            <button
              onClick={onCopy}
              disabled={!selectedElementId}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              {t('editorHTML.draw.copy')}
            </button>
            <button
              onClick={onPaste}
              disabled={!clipboard}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <ClipboardPaste className="h-4 w-4" />
              {t('editorHTML.draw.paste')}
            </button>
            <button
              onClick={onUndo}
              disabled={historyIndex <= 0}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              {t('editorHTML.draw.undo')}
            </button>
            <button
              onClick={onRedo}
              disabled={historyIndex >= history.length - 1}
              className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs transition hover:border-blue-500 disabled:opacity-50"
            >
              <Redo2 className="h-4 w-4" />
              {t('editorHTML.draw.redo')}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<ChevronRight className="h-4 w-4" />} label={t('editorHTML.draw.toolSelect')} />
            <ToolButton active={tool === 'line'} onClick={() => setTool('line')} icon={<LineIcon className="h-4 w-4" />} label={t('editorHTML.draw.toolLine')} />
            <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} icon={<Square className="h-4 w-4" />} label={t('editorHTML.draw.toolRect')} />
            <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} icon={<Circle className="h-4 w-4" />} label={t('editorHTML.draw.toolCircle')} />
            <ToolButton active={tool === 'text'} onClick={() => setTool('text')} icon={<Type className="h-4 w-4" />} label={t('editorHTML.draw.toolText')} />
            <ToolButton active={tool === 'image'} onClick={() => setTool('image')} icon={<ImageIcon className="h-4 w-4" />} label={t('editorHTML.draw.toolImage')} />
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">{t('editorHTML.draw.stroke')}</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => {
                  setStrokeColor(e.target.value)
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line'))
                    handleUpdateSelected({ strokeColor: e.target.value })
                }}
                className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
              />
              <input
                type="number"
                value={strokeWidth}
                onChange={(e) => {
                  setStrokeWidth(Number(e.target.value))
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line'))
                    handleUpdateSelected({ strokeWidth: Number(e.target.value) })
                }}
                className="w-16 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">{t('editorHTML.draw.fill')}</span>
              <input
                type="color"
                value={fillColor}
                onChange={(e) => {
                  setFillColor(e.target.value)
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle'))
                    handleUpdateSelected({ fillColor: e.target.value })
                }}
                className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={fillOpacity}
                onChange={(e) => {
                  setFillOpacity(Number(e.target.value))
                  if (selectedElement && (selectedElement.type === 'rect' || selectedElement.type === 'circle'))
                    handleUpdateSelected({ fillOpacity: Number(e.target.value) })
                }}
                className="flex-1"
              />
            </div>
            {selectedElement?.type === 'rect' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.draw.corners')}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={selectedElement.cornerRadius ?? 0}
                  onChange={(e) => handleUpdateSelected({ cornerRadius: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-8 text-right text-xs text-gray-400">{selectedElement.cornerRadius ?? 0}px</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.insertMedia.title')}</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleSelectImages}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 transition hover:border-blue-500 hover:text-blue-400"
          >
            <ImageIcon className="h-4 w-4" />
            {t('editorHTML.insertMedia.select')}
          </button>
          <div className="mt-3 space-y-2">
            <div>
              <label className="block text-xs text-gray-500">{t('editorHTML.image.roundCorners', { n: imgRadius })}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={imgRadius}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (selectedElement?.type === 'image' || selectedElement?.type === 'video') handleUpdateSelected({ imageBorderRadius: v })
                  else setImageBorderRadius(v)
                }}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">{t('editorHTML.image.borderWidth', { n: imgBorderW })}</label>
              <input
                type="range"
                min="0"
                max="50"
                value={imgBorderW}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (selectedElement?.type === 'image' || selectedElement?.type === 'video') handleUpdateSelected({ imageBorderWidth: v })
                  else setImageBorderWidth(v)
                }}
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('editorHTML.image.borderColor')}</span>
              <input
                type="color"
                value={imgBorderColor}
                onChange={(e) => {
                  const v = e.target.value
                  if (selectedElement?.type === 'image' || selectedElement?.type === 'video') handleUpdateSelected({ imageBorderColor: v })
                  else setImageBorderColor(v)
                }}
                className="h-7 w-10 rounded border border-gray-700 bg-gray-900"
              />
              <span className="text-xs text-gray-400 font-mono">{imgBorderColor}</span>
            </div>
            <div>
              <label className="block text-xs text-gray-500">{t('editorHTML.image.transparency', { n: Math.round(imgOpacity * 100) })}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={imgOpacity}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (selectedElement?.type === 'image' || selectedElement?.type === 'video') handleUpdateSelected({ opacity: v })
                  else setImageTransparency(v)
                }}
                className="w-full"
              />
            </div>
            <p className="text-[10px] text-gray-600">
              {selectedElement?.type === 'image' || selectedElement?.type === 'video' ? t('editorHTML.image.noteSelected') : t('editorHTML.image.noteNew')}
            </p>
          </div>
          {localImages.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {localImages.map((item, i) => {
                const isVideo = item.file.type.startsWith('video/')
                return (
                  <div key={i} className="relative overflow-hidden rounded-md border border-gray-700">
                  <button
                    type="button"
                    onClick={() => {
                      const newId = item.id || `img-${Date.now()}`
                      setElements([
                        ...elements,
                        {
                          id: newId,
                          type: isVideo ? 'video' : 'image',
                          x: Math.random() * 200 + 50,
                          y: Math.random() * 200 + 50,
                          width: 160,
                          height: 110,
                          rotation: 0,
                          strokeColor: 'transparent',
                          strokeWidth: 0,
                          fillColor: 'transparent',
                          fillOpacity: 0,
                          src: item.url,
                          opacity: 1,
                          imageBorderRadius,
                          imageBorderWidth,
                          imageBorderColor,
                        },
                      ])
                    }}
                    className="block w-full"
                  >
                    {isVideo ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={item.url} muted loop playsInline preload="metadata" className="h-12 w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-12 w-full object-cover" loading="lazy" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveLocalImage(i) }}
                    title={t('editorHTML.canvas.remove')}
                    className="absolute right-1 top-1 rounded bg-black/75 p-0.5 text-gray-200 hover:bg-red-600 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center overflow-auto p-4 lg:min-h-0">
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="relative overflow-hidden rounded-xl border border-gray-800 shadow-2xl"
          style={{ width: canvasWidth, height: canvasHeight, background: bodyBackgroundCss ?? getCanvasBackground() }}
        >
        {/* Keyframes (predefinidos + personalizados de la IA) inyectados en el
            documento para que las animaciones se reproduzcan dentro del lienzo. */}
        <style dangerouslySetInnerHTML={{ __html: `${getAnimationKeyframes()}\n${customKeyframes}` }} />
        {elements.map((el) => (
          <div
            key={el.id}
            className={`absolute cursor-move ${
              selectedElementId === el.id
                ? 'ring-2 ring-blue-500'
                : multiSelectIds.includes(el.id)
                ? 'ring-2 ring-blue-400'
                : ''
            }`}
            style={{
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              transform: `rotate(${el.rotation}deg)`,
              opacity: el.opacity,
              pointerEvents: tool === 'select' ? 'auto' : 'none',
              animation: buildContainerAnimation(el),
              ...(hasGlowSlot(el) && el.type !== 'text' ? {
                '--ilum-color': el.iluminacionColor || el.color || '#ffffff',
                '--ilum-intensity': String(el.iluminacionIntensity ?? 1),
                '--ilum-density': String(el.iluminacionDensity ?? 1),
              } : {}),
            } as React.CSSProperties}
            onMouseDown={(e) => {
              if (tool !== 'select') return
              e.stopPropagation()
              const pos = getMousePos(e)
              setSelectedElementId(el.id)
              setMultiSelectIds([])
              setDragState({ type: 'move', elementId: el.id, startX: pos.x, startY: pos.y, originalX: el.x, originalY: el.y })
            }}
          >
            {el.type === 'rect' && (
              <div
                className="h-full w-full"
                style={{
                  // El relleno lleva su transparencia en el propio color (rgba),
                  // así el borde NO se vuelve transparente aunque el relleno lo sea.
                  backgroundColor: el.background ? undefined : hexToRgba(el.fillColor, el.fillOpacity),
                  ...(el.background ? { background: el.background, backgroundSize: el.backgroundSize || undefined } : {}),
                  border: `${el.strokeWidth}px solid ${el.strokeColor}`,
                  ...(el.cornerRadius ? { borderRadius: `${el.cornerRadius}px` } : {}),
                }}
              />
            )}
            {el.type === 'circle' && (
              <div
                className="h-full w-full rounded-full"
                style={{
                  backgroundColor: el.background ? undefined : hexToRgba(el.fillColor, el.fillOpacity),
                  ...(el.background ? { background: el.background, backgroundSize: el.backgroundSize || undefined } : {}),
                  border: `${el.strokeWidth}px solid ${el.strokeColor}`,
                }}
              />
            )}
            {el.type === 'line' && (
              <div
                className="h-full w-full"
                style={{
                  backgroundColor: el.strokeColor,
                  height: el.strokeWidth,
                  transform: `rotate(${Math.atan2(el.height, el.width)}rad)`,
                  transformOrigin: 'top left',
                  width: Math.hypot(el.width, el.height),
                  opacity: el.opacity,
                }}
              />
            )}
            {el.type === 'text' && (
              <div
                className="whitespace-pre-wrap"
                style={{
                  fontFamily: el.fontFamily,
                  fontSize: el.fontSize,
                  fontWeight: el.fontWeight,
                  fontStyle: el.fontStyle,
                  textDecoration: el.textDecoration,
                  color: el.color,
                  textAlign: 'center',
                  width: '100%',
                  opacity: el.opacity,
                  ...(el.textStrokeColor && el.textStrokeWidth ? {
                    WebkitTextStroke: `${el.textStrokeWidth}px ${el.textStrokeColor}`,
                    textStroke: `${el.textStrokeWidth}px ${el.textStrokeColor}`,
                  } : {}),
                  ...(el.textShadowColor || el.textShadowX != null || el.textShadowY != null || el.textShadowBlur != null ? {
                    textShadow: `${el.textShadowX ?? 0}px ${el.textShadowY ?? 0}px ${el.textShadowBlur ?? 0}px ${el.textShadowColor || '#000000'}`,
                  } : el.textShadow ? {
                    textShadow: el.textShadow,
                  } : {}),
                  // Iluminación/Neón: los slots glow van sobre el div de texto (el
                  // text-shadow del keyframe sólo afecta al texto directo) con
                  // sus custom properties de color, intensidad y densidad.
                  ...(hasGlowSlot(el) ? {
                    animation: buildInnerTextAnimation(el),
                    '--ilum-color': el.iluminacionColor || el.color || '#ffffff',
                    '--ilum-intensity': String(el.iluminacionIntensity ?? 1),
                    '--ilum-density': String(el.iluminacionDensity ?? 1),
                  } : {}),
                } as React.CSSProperties}
              >
                {el.text}
              </div>
            )}
            {el.type === 'image' && el.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={el.src}
                alt=""
                className="h-full w-full object-cover"
                style={{
                  borderRadius: el.imageBorderRadius ? `${el.imageBorderRadius}px` : undefined,
                  border: el.imageBorderWidth ? `${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}` : undefined,
                }}
                draggable={false}
              />
            )}
            {el.type === 'video' && el.src && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={el.src}
                className="h-full w-full object-cover"
                style={{
                  borderRadius: el.imageBorderRadius ? `${el.imageBorderRadius}px` : undefined,
                  border: el.imageBorderWidth ? `${el.imageBorderWidth}px solid ${el.imageBorderColor || '#000000'}` : undefined,
                }}
                autoPlay
                muted
                loop
                playsInline
                draggable={false}
              />
            )}
            {selectedElementId === el.id && (
              <>
                <div className="absolute -top-6 left-0 max-w-full truncate rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
                  {typeLabels[el.type] || el.type}{el.type === 'text' && el.text ? `: ${el.text.slice(0, 20)}${el.text.length > 20 ? '…' : ''}` : ''}
                </div>
                <div
                  className="absolute bottom-1 right-1 h-3 w-3 cursor-se-resize rounded-sm bg-blue-500"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    const startX = e.clientX
                    const startY = e.clientY
                    const origW = el.width
                    const origH = el.height
                    const onMouseMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX
                      const dy = ev.clientY - startY
                      let newW = origW + dx
                      let newH = origH + dy
                      // Con Ctrl: cuadrado/círculo perfecto al redimensionar
                      // (ancho = alto). Se sigue el eje que el usuario arrastre más.
                      if ((ev.ctrlKey || ev.metaKey) && (el.type === 'rect' || el.type === 'circle')) {
                        const size = Math.abs(dx) > Math.abs(dy) ? newW : newH
                        newW = size
                        newH = size
                      }
                      handleUpdateSelected({ width: newW, height: newH })
                    }
                    const onMouseUp = () => {
                      window.removeEventListener('mousemove', onMouseMove)
                      window.removeEventListener('mouseup', onMouseUp)
                    }
                    window.addEventListener('mousemove', onMouseMove)
                    window.addEventListener('mouseup', onMouseUp)
                  }}
                />
                <button
                  onClick={onDelete}
                  className="absolute right-1 top-1 rounded bg-red-600 p-0.5 text-white"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}

        {marqueeRect && (() => {
          const m = {
            x: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
            y: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
            w: Math.abs(marqueeRect.w),
            h: Math.abs(marqueeRect.h),
          }
          return (
            <div
              style={{
                position: 'absolute',
                left: m.x,
                top: m.y,
                width: m.w,
                height: m.h,
                border: '2px dashed #3b82f6',
                background: 'rgba(59, 130, 246, 0.10)',
                pointerEvents: 'none',
                zIndex: 20,
              }}
            />
          )
        })()}

        {canvasEffect === 'spotlight' && (
          <div
            id="effect-spotlight"
            className="absolute inset-0 pointer-events-none rounded-xl"
            style={{
              zIndex: 10,
              background: `radial-gradient(circle ${spotlightSize}px at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}${Math.round(spotlightOpacity * 255).toString(16).padStart(2, '0')} 0%, rgba(0,0,0,0.55) 100%)`,
            }}
          />
        )}

        {elements.length === 0 && (
          <div className="flex h-full items-center justify-center text-gray-400">
            {t('editorHTML.editor.emptyHint')}
          </div>
        )}
        </div>
      </div>

      <div className="w-full lg:w-72 shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto scrollbar-thin-transparent pr-1">
        {multiSelectIds.length > 1 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('editorHTML.group.title', { n: multiSelectIds.length })}
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              {t('editorHTML.group.description')}
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                {groupSlots.length === 0 && (
                  <p className="text-xs italic text-gray-600">{t('editorHTML.group.noAnim')}</p>
                )}
                {groupSlots.map((slot, i) => {
                  const isGlow = GLOW_ANIMATIONS.has(slot.name)
                  return (
                    <div key={i} className="space-y-2 rounded-md border border-gray-700/50 bg-gray-900/40 p-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={slot.name}
                          onChange={(e) => handleGroupSetSlotName(i, e.target.value)}
                          className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                        >
                          <option value="">{t('editorHTML.group.noAnim')}</option>
                          {animOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleGroupRemoveSlot(i)}
                          className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                          title={t('editorHTML.group.removeAnim')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {!isGlow && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-14">{t('editorHTML.group.duration')}</span>
                            <input
                              type="number"
                              min="0.1"
                              max="10"
                              step="0.1"
                              value={slot.duration}
                              onChange={(e) => handleGroupUpdateSlot(i, { duration: Number(e.target.value) })}
                              className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                            />
                            <span className="text-xs text-gray-500">{t('editorHTML.group.seconds')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-14">{t('editorHTML.group.delay')}</span>
                            <input
                              type="number"
                              min="0"
                              max="10"
                              step="0.1"
                              value={slot.delay}
                              onChange={(e) => handleGroupUpdateSlot(i, { delay: Number(e.target.value) })}
                              className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                            />
                            <span className="text-xs text-gray-500">{t('editorHTML.group.seconds')}</span>
                          </div>
                        </div>
                      )}
                      {isGlow && i === groupGlowIdx && (
                        <div className="space-y-2 rounded-md border border-amber-700/40 bg-amber-900/10 p-2">
                          <div className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">
                            {slot.name === 'neon' ? t('editorHTML.group.glowNeon') : t('editorHTML.group.glowIlum')}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.color')}</span>
                            <input
                              type="color"
                              value={groupGlowColor}
                              onChange={(e) => setGroupGlowColor(e.target.value)}
                              className="h-7 w-10 rounded border border-gray-700 bg-gray-900"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.intensity')}</span>
                            <input
                              type="range"
                              min="0"
                              max="4"
                              step="0.1"
                              value={groupGlowIntensity}
                              onChange={(e) => setGroupGlowIntensity(Number(e.target.value))}
                              className="w-28"
                            />
                            <span className="text-xs text-gray-400 w-10">{groupGlowIntensity.toFixed(1)}x</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.density')}</span>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={groupGlowDensity}
                              onChange={(e) => setGroupGlowDensity(Number(e.target.value))}
                              className="w-28"
                            />
                            <span className="text-xs text-gray-400 w-10">{Math.round(groupGlowDensity * 100)}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.speed')}</span>
                            <input
                              type="range"
                              min="0.5"
                              max="8"
                              step="0.1"
                              value={slot.duration}
                              onChange={(e) => handleGroupUpdateSlot(i, { duration: Number(e.target.value) })}
                              className="w-28"
                            />
                            <span className="text-xs text-gray-400 w-10">{slot.duration.toFixed(1)}s</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {groupSlots.length < 5 && (
                  <button
                    type="button"
                    onClick={handleGroupAddSlot}
                    className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-600 px-2 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('editorHTML.group.addAnim')}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleApplyGroupAnimation}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-blue-700 bg-blue-900/40 px-2 py-1.5 text-xs text-blue-200 hover:bg-blue-800/50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('editorHTML.group.applyGroup')}
              </button>
              <button
                type="button"
                onClick={handleDisbandGroup}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-700 bg-gray-800/40 px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-700/50"
              >
                <Ungroup className="h-3.5 w-3.5" />
                {t('editorHTML.group.disband')}
              </button>
              <button
                type="button"
                onClick={handleDeleteGroup}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300 hover:bg-red-800/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('editorHTML.group.delete')}
              </button>
            </div>
          </div>
        ) : selectedElement ? (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.props.title')}</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={sendToBack}
                  title={t('editorHTML.props.layerBack')}
                  className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  <SendToBack className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={moveBackward}
                  title={t('editorHTML.props.layerBackward')}
                  className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={moveForward}
                  title={t('editorHTML.props.layerForward')}
                  className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={bringToFront}
                  title={t('editorHTML.props.layerFront')}
                  className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  <BringToFront className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  title={t('editorHTML.props.deleteObject')}
                  className="rounded-md border border-red-800 bg-red-900/30 p-1.5 text-red-300 hover:bg-red-800/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {selectedElement.type === 'image' || selectedElement.type === 'video' ? (
              <>
                <div className="space-y-2">
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.width')}</label>
                  <input
                    type="range"
                    min="20"
                    max="600"
                    value={selectedElement.width}
                    onChange={(e) => handleUpdateSelected({ width: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.height')}</label>
                  <input
                    type="range"
                    min="20"
                    max="400"
                    value={selectedElement.height}
                    onChange={(e) => handleUpdateSelected({ height: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.transparency', { n: Math.round(selectedElement.opacity * 100) })}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedElement.opacity}
                    onChange={(e) => handleUpdateSelected({ opacity: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.cornerRadius', { n: selectedElement.imageBorderRadius || 0 })}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedElement.imageBorderRadius || 0}
                    onChange={(e) => handleUpdateSelected({ imageBorderRadius: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.borderWidth', { n: selectedElement.imageBorderWidth || 0 })}</label>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={selectedElement.imageBorderWidth || 0}
                    onChange={(e) => handleUpdateSelected({ imageBorderWidth: Number(e.target.value) })}
                    className="w-full"
                  />
                  <label className="block text-xs text-gray-500">{t('editorHTML.props.borderColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedElement.imageBorderColor || '#000000'}
                      onChange={(e) => handleUpdateSelected({ imageBorderColor: e.target.value })}
                      className="h-7 w-7 cursor-pointer rounded border border-gray-700 bg-gray-900"
                    />
                    <input
                      type="text"
                      value={selectedElement.imageBorderColor || '#000000'}
                      onChange={(e) => handleUpdateSelected({ imageBorderColor: e.target.value })}
                      className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </>
            ) : null}
            {selectedElement.type === 'text' && (
              <div className="space-y-2">
                <textarea
                  value={selectedElement.text}
                  onChange={(e) => handleUpdateSelected({ text: e.target.value })}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 p-2 text-sm"
                  rows={3}
                />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-500">{t('editorHTML.props.rotation')}</span>
              <input
                type="range"
                min="0"
                max="360"
                value={selectedElement.rotation}
                onChange={(e) => handleUpdateSelected({ rotation: Number(e.target.value) })}
                className="w-32"
              />
            </div>

            {selectedElement && (
              <div className="mt-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.props.animation')}</h4>
                <div className="space-y-2">
                  {selectedSlots.length === 0 && (
                    <p className="text-xs italic text-gray-600">{t('editorHTML.group.noAnim')}</p>
                  )}
                  {selectedSlots.map((slot, i) => {
                    const isGlow = GLOW_ANIMATIONS.has(slot.name)
                    return (
                      <div key={i} className="space-y-2 rounded-md border border-gray-700/50 bg-gray-900/40 p-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={slot.name}
                            onChange={(e) => handleSetSlotName(i, e.target.value)}
                            className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                          >
                            <option value="">{t('editorHTML.group.noAnim')}</option>
                            {animOptions.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(i)}
                            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                            title={t('editorHTML.group.removeAnim')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {!isGlow && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-14">{t('editorHTML.group.duration')}</span>
                              <input
                                type="number"
                                min="0.1"
                                max="10"
                                step="0.1"
                                value={slot.duration}
                                onChange={(e) => handleUpdateSlot(i, { duration: Number(e.target.value) })}
                                className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                              />
                              <span className="text-xs text-gray-500">{t('editorHTML.group.seconds')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-14">{t('editorHTML.group.delay')}</span>
                              <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.1"
                                value={slot.delay}
                                onChange={(e) => handleUpdateSlot(i, { delay: Number(e.target.value) })}
                                className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm"
                              />
                              <span className="text-xs text-gray-500">{t('editorHTML.group.seconds')}</span>
                            </div>
                          </div>
                        )}
                        {isGlow && i === glowIdx && (
                          <div className="space-y-2 rounded-md border border-amber-700/40 bg-amber-900/10 p-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-amber-300/90">{isNeonGlow ? t('editorHTML.props.glowNeon') : t('editorHTML.props.glowIlum')}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.color')}</span>
                              <input
                                type="color"
                                value={selectedElement.iluminacionColor || selectedElement.color || '#ffffff'}
                                onChange={(e) => handleUpdateGlow({ iluminacionColor: e.target.value })}
                                className="h-7 w-10 rounded border border-gray-700 bg-gray-900"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.intensity')}</span>
                              <input
                                type="range"
                                min="0"
                                max="4"
                                step="0.1"
                                value={selectedElement.iluminacionIntensity ?? 1}
                                onChange={(e) => handleUpdateGlow({ iluminacionIntensity: Number(e.target.value) })}
                                className="w-28"
                              />
                              <span className="text-xs text-gray-400 w-10">{(selectedElement.iluminacionIntensity ?? 1).toFixed(1)}x</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.density')}</span>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={selectedElement.iluminacionDensity ?? 1}
                                onChange={(e) => handleUpdateGlow({ iluminacionDensity: Number(e.target.value) })}
                                className="w-28"
                              />
                              <span className="text-xs text-gray-400 w-10">{Math.round((selectedElement.iluminacionDensity ?? 1) * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">{t('editorHTML.group.speed')}</span>
                              <input
                                type="range"
                                min="0.5"
                                max="8"
                                step="0.1"
                                value={slot.duration}
                                onChange={(e) => handleUpdateGlow({ duration: Number(e.target.value) })}
                                className="w-28"
                              />
                              <span className="text-xs text-gray-400 w-10">{slot.duration.toFixed(1)}s</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {selectedSlots.length < 5 && (
                    <button
                      type="button"
                      onClick={handleAddSlot}
                      className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-600 px-2 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-200"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('editorHTML.group.addAnim')}
                    </button>
                  )}
                </div>
          {selectedElement?.type === 'text' && (
            <div className="mt-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.props.textBorder')}</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                <input
                  type="color"
                  value={selectedElement.textStrokeColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textStrokeColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <span className="text-xs text-gray-400 font-mono">{selectedElement.textStrokeColor || '#000000'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.props.thickness')}</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={selectedElement.textStrokeWidth || 0}
                  onChange={(e) => handleUpdateSelected({ textStrokeWidth: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-10 text-right">{(selectedElement.textStrokeWidth || 0)}</span>
              </div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.props.shadow')}</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.canvas.color')}</span>
                <input
                  type="color"
                  value={selectedElement.textShadowColor || '#000000'}
                  onChange={(e) => handleUpdateSelected({ textShadowColor: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded border border-gray-700 bg-gray-900"
                />
                <span className="text-xs text-gray-400 font-mono">{selectedElement.textShadowColor || '#000000'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.props.shadowX')}</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.textShadowX ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowX: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowX ?? 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.props.shadowY')}</span>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.textShadowY ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowY: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowY ?? 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">{t('editorHTML.props.shadowBlur')}</span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={selectedElement.textShadowBlur ?? 0}
                  onChange={(e) => handleUpdateSelected({ textShadowBlur: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-8 text-right">{(selectedElement.textShadowBlur ?? 0)}</span>
              </div>
            </div>
          )}
        </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-500">
            {t('editorHTML.props.emptyHint')}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg p-2 text-xs transition ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ------------------------------------------------------------------
// Code Panel Component
// ------------------------------------------------------------------

function CodePanel({
  code,
  onChange,
}: {
  code: string
  onChange: (code: string) => void
}) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newValue = code.substring(0, start) + '  ' + code.substring(end)
      onChange(newValue)
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('editorHTML.code.title')}</h3>
            <span className="text-xs text-gray-600">{t('editorHTML.code.chars', { n: code.length })}</span>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-[70vh] w-full rounded-md border border-gray-700 bg-gray-900 p-3 font-mono text-sm text-gray-200"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}
