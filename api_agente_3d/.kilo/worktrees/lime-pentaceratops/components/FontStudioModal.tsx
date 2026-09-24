'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { create, useStore } from 'zustand';
import { Search, Download, Eye, Palette, Layers, X, Upload, FileText, Image, Settings, Zap, Loader2, CheckCircle, Check, AlertCircle, Plus, Server, Power, RefreshCw, Sparkles, Trash2, ChevronDown, FolderOpen, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startTextureApi, stopTextureApi, getServerStatus, isElectron } from '@/lib/electron-fs';
import { useI18n, getT } from '@/lib/i18n';

// --- Types & Interfaces ---

interface FontAsset {
  id: string;
  name: string;
  family: string;
  style: 'Serif' | 'Sans' | 'Mono' | 'Display';
  previewText: string;
  url?: string;
  isTextured?: boolean;
  path?: string; // Local file path for fonts in fuentes folder
}

interface ColorOption {
  id: string;
  name: string;
  labelKey: string;
  hex: string;
}

interface TextureOption {
  id: string;
  name: string;
  labelKey: string;
  filter: string;
}

interface TexturaFile {
  path: string;
  name: string;
  fullPath: string;
  size: number;
  viewBox: string;
  modified: string;
}

interface ColorPaletteOption {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FontStoreState {
  fonts: FontAsset[];
  selectedFontId: string | null;
  selectedColorId: string | null;
  selectedTextureId: string | null;
  previewText: string;
  previewZoom: number;
  activeTab: string;
  isLoading: boolean;
// Texture API state
   textureFontFile: File | null;
   textureSvgFile: File | null;
   textureEffectFile: File | null;
   textureScale: number;
   textureBaseColorIndex: number;
   textureTextureColorIndex: number;
   texturePalette: ColorPaletteOption[];
   textureProcessing: boolean;
   textureResult: { success: boolean; message: string; outputFile?: string; error?: string; fontId?: string } | null;
   textureSpecificLetter: string | null;
  addFont: (font: FontAsset) => void;
  removeFont: (id: string) => void;
  setFont: (id: string) => void;
  setColor: (id: string) => void;
  setTexture: (id: string) => void;
  setActiveTab: (tab: string) => void;
  setPreviewText: (text: string) => void;
  setPreviewZoom: (zoom: number) => void;
  loadFonts: () => void;
  // Texture actions
  setTextureFontFile: (file: File | null) => void;
  setTextureSvgFile: (file: File | null) => void;
  setTextureEffectFile: (file: File | null) => void;
  setTextureScale: (scale: number) => void;
  setTextureBaseColorIndex: (index: number) => void;
  setTextureTextureColorIndex: (index: number) => void;
  setTextureSpecificLetter: (letter: string | null) => void;
  addTexturePaletteColor: (color: ColorPaletteOption) => void;
  removeTexturePaletteColor: (index: number) => void;
  updateTexturePaletteColor: (index: number, color: ColorPaletteOption) => void;
  effectColor: { r: number; g: number; b: number; a: number };
  setEffectColor: (color: { r: number; g: number; b: number; a: number }) => void;
  selectedEffectId: string | null;
  setSelectedEffectId: (id: string | null) => void;
  previewEffectUrl: string | null;
  previewEffectLoading: boolean;
  previewEffectError: string | null;
  generateEffectPreview: (fontUrl: string, fontName: string, effectFile: string, effectName: string, effectColorStr: string, baseHex: string) => Promise<void>;
  clearEffectPreview: () => void;
  processTexture: () => Promise<void>;
  resetTextureResult: () => void;
}

// --- Mock Data ---

const MOCK_COLORS: ColorOption[] = [
  { id: 'c1', name: 'White', labelKey: 'fontStudio.colors.white', hex: '#FFFFFF' },
  { id: 'c2', name: 'Red', labelKey: 'fontStudio.colors.red', hex: '#FF0000' },
  { id: 'c3', name: 'Blue', labelKey: 'fontStudio.colors.blue', hex: '#0000FF' },
  { id: 'c4', name: 'Gold', labelKey: 'fontStudio.colors.gold', hex: '#FFD700' },
  { id: 'c5', name: 'Dark Gray', labelKey: 'fontStudio.colors.darkGray', hex: '#333333' },
];

const MOCK_TEXTURES: TextureOption[] = [
  { id: 't1', name: 'Matte', labelKey: 'fontStudio.textures.matte', filter: 'none' },
  { id: 't2', name: 'Metallic', labelKey: 'fontStudio.textures.metallic', filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.8))' },
  { id: 't3', name: 'Grunge', labelKey: 'fontStudio.textures.grunge', filter: 'blur(1px) contrast(1.2)' },
  { id: 't4', name: 'Neon', labelKey: 'fontStudio.textures.neon', filter: 'drop-shadow(0 0 10px #ff0000)' },
];

// SVG-based effects from Texturas/effects folder
const EFFECT_TEXTURES = [
  { id: 'fx5', name: 'Glow (SVG)', labelKey: 'fontStudio.effects.glow', file: 'effects/glow.svg' },
  { id: 'fx3', name: 'Grunge (SVG)', labelKey: 'fontStudio.effects.grunge', file: 'effects/grunge.svg' },
  { id: 'fx6', name: 'Outline (SVG)', labelKey: 'fontStudio.effects.outline', file: 'effects/outline.svg' },
];

const MOCK_FONTS: FontAsset[] = [
  { id: 'f1', name: 'Roboto', family: 'Roboto', style: 'Sans', previewText: 'Type your text here' },
  { id: 'f2', name: 'Playfair Display', family: 'Playfair Display', style: 'Serif', previewText: 'Elegant Serif Font' },
  { id: 'f3', name: 'Courier Prime', family: 'Courier Prime', style: 'Mono', previewText: 'Monospaced Code' },
  { id: 'f4', name: 'Lobster', family: 'Lobster', style: 'Display', previewText: 'Fun & Bold' },
  { id: 'f5', name: 'Oswald', family: 'Oswald', style: 'Sans', previewText: 'Condensed Sans' },
];

// --- Store ---

const DEFAULT_TEXTURE_PALETTE: ColorPaletteOption[] = [
  { r: 30, g: 30, b: 30, a: 255 },     // 0 - Negro/oscuro (relleno base)
  { r: 255, g: 180, b: 50, a: 200 },   // 1 - Dorado semitransparente (textura)
  { r: 255, g: 255, b: 255, a: 255 },  // 2 - Blanco (reserva)
  { r: 200, g: 50, b: 50, a: 255 },    // 3 - Rojo (reserva)
];

const createFontStore = () => create<FontStoreState>((set, get) => ({
  fonts: MOCK_FONTS,
  selectedFontId: null,
  selectedColorId: 'c1',
  selectedTextureId: 't1',
  previewText: 'Sample Text',
  previewZoom: 2.5,
  activeTab: 'list',
  isLoading: false,
  // Texture API state
  textureFontFile: null,
  textureSvgFile: null,
  textureEffectFile: null,
  textureScale: 1.0,
  textureBaseColorIndex: 0,
  textureTextureColorIndex: 1,
  texturePalette: DEFAULT_TEXTURE_PALETTE,
  effectColor: { r: 255, g: 40, b: 40, a: 220 }, // rojo glow por defecto
  selectedEffectId: null,
  previewEffectUrl: null,
  previewEffectLoading: false,
  previewEffectError: null,
textureProcessing: false,
   textureResult: null,
   textureSpecificLetter: null,
   addFont: (font) => set((state) => ({
    fonts: [font, ...state.fonts.filter(f => f.id !== font.id)] 
  })),
  removeFont: (id) => set((state) => {
    const font = state.fonts.find(f => f.id === id);
    // If font has a local path, delete it from disk
    if (font?.path) {
      fetch(`/api/local-font-file?path=${encodeURIComponent(font.path)}&name=${encodeURIComponent(font.name)}`, {
        method: 'DELETE',
      }).catch(console.error);
    }
    return {
      fonts: state.fonts.filter(f => f.id !== id),
      selectedFontId: state.selectedFontId === id ? (state.fonts.find(f => f.id !== id)?.id || null) : state.selectedFontId,
    };
  }),
  setFont: (id) => set({ selectedFontId: id }),
  setColor: (id) => set({ selectedColorId: id }),
  setTexture: (id) => set({ selectedTextureId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setPreviewText: (text) => set({ previewText: text }),
  setPreviewZoom: (zoom) => set({ previewZoom: zoom }),
  loadFonts: () => set({ isLoading: true }),
  // Texture actions
  setTextureFontFile: (file) => set({ textureFontFile: file }),
  setTextureSvgFile: (file) => set({ textureSvgFile: file }),
setTextureEffectFile: (file) => set({ textureEffectFile: file }),
   setTextureScale: (scale) => set({ textureScale: scale }),
   setTextureBaseColorIndex: (index) => set({ textureBaseColorIndex: index }),
   setTextureTextureColorIndex: (index) => set({ textureTextureColorIndex: index }),
   setTextureSpecificLetter: (letter: string | null) => set({ textureSpecificLetter: letter }),
  addTexturePaletteColor: (color) => set((state) => ({ texturePalette: [...state.texturePalette, color] })),
  removeTexturePaletteColor: (index) => set((state) => ({ texturePalette: state.texturePalette.filter((_, i) => i !== index) })),
  updateTexturePaletteColor: (index, color) => set((state) => ({
    texturePalette: state.texturePalette.map((c, i) => i === index ? color : c)
  })),
  setEffectColor: (color) => set({ effectColor: color }),
  setSelectedEffectId: (id) => set({ selectedEffectId: id }),
  clearEffectPreview: () => {
    const prev = get().previewEffectUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ previewEffectUrl: null, previewEffectLoading: false, previewEffectError: null });
  },
  generateEffectPreview: async (fontUrl, fontName, effectFile, effectName, effectColorStr, baseHex) => {
    try {
      set({ previewEffectLoading: true, previewEffectError: null });
      // Fetch font file
      const fontRes = await fetch(fontUrl);
      if (!fontRes.ok) throw new Error(getT()('fontStudio.errLoadFont'));
      const fontBlob = await fontRes.blob();
      // Fetch effect SVG
      const effectRes = await fetch(`/api/texturas-file/${effectFile}`);
      if (!effectRes.ok) throw new Error(getT()('fontStudio.errLoadEffect'));
      const svgContent = await effectRes.text();
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });

      const formData = new FormData();
      formData.append('font_file', fontBlob, fontName);
      formData.append('svg_effect_file', svgBlob, effectName + '.svg');
      formData.append('effect_color', effectColorStr);

      const baseR = parseInt(baseHex.slice(1, 3), 16);
      const baseG = parseInt(baseHex.slice(3, 5), 16);
      const baseB = parseInt(baseHex.slice(5, 7), 16);
      const palettes = [{
        colors: [
          [baseR, baseG, baseB, 255],
          [255, 180, 50, 255],
          [255, 255, 255, 0],
          [200, 50, 50, 0]
        ],
        palette_type: 0,
        name: "effect_palette"
      }];
      formData.append('palettes', JSON.stringify(palettes));
      formData.append('textured_glyphs', JSON.stringify({}));
      formData.append('scale', '1.0');
      formData.append('base_color_index', '0');
      formData.append('texture_color_index', '1');

      const response = await fetch('/api/apply-font-texture', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || getT()('fontStudio.errGenerate'));
      }
      const outputFontBlob = await response.blob();
      // Revoke previous preview URL
      const prev = get().previewEffectUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(outputFontBlob);
      set({ previewEffectUrl: url, previewEffectLoading: false });
    } catch (error) {
      set({ previewEffectLoading: false, previewEffectError: error instanceof Error ? error.message : getT()('fontStudio.errUnknown') });
    }
  },
  resetTextureResult: () => set({ textureResult: null, textureProcessing: false }),
processTexture: async () => {
        const state = get();
        if (!state.textureFontFile || (!state.textureSvgFile && !state.textureEffectFile)) {
          set({ textureResult: { success: false, message: getT()('fontStudio.errMissingFiles'), error: getT()('fontStudio.errMissingFiles') }, textureProcessing: false });
          return;
        }

        set({ textureProcessing: true, textureResult: null });

        try {
          const formData = new FormData();
          formData.append('font_file', state.textureFontFile);
          if (state.textureSvgFile) {
            formData.append('svg_file', state.textureSvgFile);
          }
          if (state.textureEffectFile) {
            formData.append('svg_effect_file', state.textureEffectFile);
            // Color del efecto configurable por el usuario
            const ec = state.effectColor;
            const effectColor = `${ec.r},${ec.g},${ec.b},${ec.a}`;
            formData.append('effect_color', effectColor);
          }
          
          // Create palette JSON
          const palettes = [{
            colors: state.texturePalette.map(c => [c.r, c.g, c.b, c.a]),
            palette_type: 0,
            name: "textura_paleta"
          }];
          formData.append('palettes', JSON.stringify(palettes));

          // Create textured_glyphs JSON - apply to all glyphs in font
          formData.append('textured_glyphs', JSON.stringify({}));

          // Create vector_textures JSON
          if (state.textureSvgFile) {
            const svgContent = await state.textureSvgFile.text();
            const vectorTextures = {
              "font.texture": {
                svg_content: svgContent,
                glyph_name: "font.texture",
                scale: state.textureScale
              }
            };
            formData.append('vector_textures', JSON.stringify(vectorTextures));
          }

          // Add scale and color indices
          formData.append('scale', state.textureScale.toString());
          formData.append('base_color_index', state.textureBaseColorIndex.toString());
          formData.append('texture_color_index', state.textureTextureColorIndex.toString());
          
          // Add specific letter if provided
          if (state.textureSpecificLetter) {
            formData.append('specific_letter', state.textureSpecificLetter);
          }

          const apiUrl = '/api/apply-font-texture';

          const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: getT()('fontStudio.errUnknown') }));
            throw new Error(errorData.message || errorData.detail || getT()('fontStudio.error', { msg: `${response.status}: ${response.statusText}` }));
          }

          const outputFilename = response.headers.get('X-Output-Filename') || 'textured_font.ttf';
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);

          const rawBaseName = state.textureFontFile?.name.replace(/\.[^/.]+$/, '') || 'Fuente';
          const cleanName = outputFilename.replace(/^textured_/i, '').replace(/\.[^/.]+$/, '') || rawBaseName;
          const familyName = `Textured_${cleanName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
          
          let generatedFontAsset: FontAsset | null = null;

          // Register font face for live preview in DOM
          try {
            const fontFace = new FontFace(familyName, `url(${blobUrl})`);
            const loadedFace = await fontFace.load();
            document.fonts.add(loadedFace);
            generatedFontAsset = {
              id: `font-textured-${Date.now()}`,
              name: getT()('fontStudio.texturaName', { name: cleanName }),
              family: familyName,
              style: 'Display',
              previewText: state.previewText || getT()('fontStudio.texturedPreview'),
              url: blobUrl,
              isTextured: true,
            };

            // Include in Fonts tab and select it immediately!
            get().addFont(generatedFontAsset);
            get().setFont(generatedFontAsset.id);
          } catch (fontErr) {
            console.warn('Could not register font face:', fontErr);
          }

          set({ 
            textureResult: { 
              success: true, 
              message: getT()('fontStudio.processedOk'), 
              outputFile: outputFilename,
              fontId: generatedFontAsset?.id,
            }, 
            textureProcessing: false 
          });
        } catch (error) {
          set({ 
            textureResult: { 
              success: false, 
              message: error instanceof Error ? error.message : getT()('fontStudio.errUnknown'), 
              error: error instanceof Error ? error.message : getT()('fontStudio.errUnknown') 
            }, 
            textureProcessing: false 
          });
        }
      },
}));

// --- Tab Components ---

const FontListTab = ({ store }: { store: ReturnType<typeof createFontStore> }) => {
  const { t } = useI18n();
  const fonts = useStore(store, s => s.fonts);
  const selectedFontId = useStore(store, s => s.selectedFontId);
  const setFont = useStore(store, s => s.setFont);
  const removeFont = useStore(store, s => s.removeFont);
  const [search, setSearch] = useState('');
  const [fontToDelete, setFontToDelete] = useState<FontAsset | null>(null);

  const filteredFonts = useMemo(() => {
    return fonts.filter(f => 
      f.name.toLowerCase().includes(search.toLowerCase()) || 
      f.family.toLowerCase().includes(search.toLowerCase())
    );
  }, [fonts, search]);

  const handleDeleteConfirm = () => {
    if (fontToDelete) {
      removeFont(fontToDelete.id);
      setFontToDelete(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <Input
            type="text"
            placeholder={t('fontStudio.searchFonts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all placeholder:text-gray-600"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar min-h-0">
        {filteredFonts.map(font => (
          <div
            key={font.id}
            onClick={() => setFont(font.id)}
            className={`w-full text-left p-3 rounded-lg transition-all duration-200 group cursor-pointer flex items-center justify-between ${
              selectedFontId === font.id 
                ? 'bg-gray-800 border-l-4 border-green-500 shadow-md' 
                : 'hover:bg-gray-900 border-l-4 border-transparent'
            }`}
          >
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={`font-semibold text-sm truncate ${selectedFontId === font.id ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                  {font.name}
                </h3>
                {font.isTextured && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <Sparkles size={11} className="text-purple-400" />
                    {t('fontStudio.apiBadge')}
                  </span>
                )}
                {font.url && !font.isTextured && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-300 border border-green-500/25">
                    {t('fontStudio.customBadge')}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{font.family} • {font.style}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {font.url && (
                <a
                  href={font.url}
                  download={`${font.name.replace(/\s+/g, '_')}.ttf`}
                  onClick={(e) => e.stopPropagation()}
                  title={t('fontStudio.downloadTitle')}
                  className="p-1.5 rounded text-gray-400 hover:text-green-400 hover:bg-gray-700/80 transition-colors"
                >
                  <Download size={14} />
                </a>
              )}
              {font.url && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFontToDelete(font);
                  }}
                  title={t('fontStudio.deleteTitle')}
                  className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700/80 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <div className={`p-1.5 rounded ${selectedFontId === font.id ? 'bg-green-500/20 text-green-500' : 'bg-gray-800 text-gray-500'}`}>
                <Eye size={14} />
              </div>
            </div>
          </div>
        ))}
        {filteredFonts.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">{t('fontStudio.noFonts')}</div>
        )}
        {fontToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setFontToDelete(null)}>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white">{t('fontStudio.deleteDialogTitle')}</h3>
              </div>
              <p className="text-gray-300 mb-2">{t('fontStudio.deleteConfirm', { name: fontToDelete.name })}</p>
              <p className="text-xs text-gray-500 mb-6">
                {t('fontStudio.deletePermanent')}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setFontToDelete(null)}
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-medium transition-colors"
                >
                  {t('fontStudio.cancel')}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4 inline mr-1" /> {t('fontStudio.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FontPreviewTab = ({ store }: { store: ReturnType<typeof createFontStore> }) => {
  const { t } = useI18n();
  const selectedFontId = useStore(store, s => s.selectedFontId);
  const selectedColorId = useStore(store, s => s.selectedColorId);
  const selectedTextureId = useStore(store, s => s.selectedTextureId);
  const previewText = useStore(store, s => s.previewText);
  const previewZoom = useStore(store, s => s.previewZoom);
  const fonts = useStore(store, s => s.fonts);
  const selectedEffectId = useStore(store, s => s.selectedEffectId);
  const effectColor = useStore(store, s => s.effectColor);
  const previewEffectUrl = useStore(store, s => s.previewEffectUrl);
  const previewEffectLoading = useStore(store, s => s.previewEffectLoading);
  const previewEffectError = useStore(store, s => s.previewEffectError);
  const [customFontLoaded, setCustomFontLoaded] = useState(false);
  const [effectFontLoaded, setEffectFontLoaded] = useState(false);

  const selectedFont = MOCK_FONTS.find(f => f.id === selectedFontId) || 
    fonts.find((f) => f.id === selectedFontId);
  const selectedColor = MOCK_COLORS.find(c => c.id === selectedColorId);
  const selectedTexture = MOCK_TEXTURES.find(t => t.id === selectedTextureId);

  // Nombre del efecto para mostrar en el indicador
  const effectName = selectedEffectId?.replace('fx-', '').replace('.svg', '').trim() || '';

  // Cargar fuente base (custom)
  useEffect(() => {
    if (selectedFont?.url) {
      const fontFace = new FontFace(selectedFont.family, `url(${selectedFont.url})`);
      fontFace.load().then((loadedFace) => {
        document.fonts.add(loadedFace);
        setCustomFontLoaded(true);
      }).catch(() => {
        setCustomFontLoaded(true);
      });
      return () => { document.fonts.delete(fontFace); };
    } else {
      setCustomFontLoaded(true);
    }
  }, [selectedFont?.url, selectedFont?.family]);

  // Cargar fuente con efecto aplicado (generada por el backend)
  useEffect(() => {
    if (previewEffectUrl) {
      const effectFamily = `${selectedFont?.family || 'PreviewFont'}-Effect`;
      const fontFace = new FontFace(effectFamily, `url(${previewEffectUrl})`);
      fontFace.load().then((loadedFace) => {
        // Limpiar font faces anteriores con el mismo nombre
        document.fonts.forEach(f => {
          if (f.family === effectFamily) document.fonts.delete(f);
        });
        document.fonts.add(loadedFace);
        setEffectFontLoaded(true);
      }).catch(() => {
        setEffectFontLoaded(false);
      });
      return () => { document.fonts.delete(fontFace); };
    } else {
      setEffectFontLoaded(false);
    }
  }, [previewEffectUrl, selectedFont?.family]);

  // Determinar qué fuente y estilo usar
  const hasEffect = !!selectedEffectId && !!previewEffectUrl && effectFontLoaded;
  const effectFamily = `${selectedFont?.family || 'PreviewFont'}-Effect`;
  const fontFamily = hasEffect
    ? `"${effectFamily}", sans-serif`
    : (selectedFont?.url && customFontLoaded ? `"${selectedFont.family}", sans-serif` : selectedFont?.family || 'sans-serif');

  if (!selectedFont) {
    return (
      <div className="h-32 flex flex-col items-center justify-center bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
        <Eye className="mb-2 text-gray-600" size={28} />
        <p className="text-gray-500 text-xs">{t('fontStudio.selectFont')}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-32 md:h-36 max-h-[160px] flex-shrink-0 overflow-hidden rounded-xl bg-gray-900 border border-gray-800 flex flex-col items-center justify-center p-4 shadow-xl">
      <div 
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{ 
          backgroundImage: `radial-gradient(circle at center, #333 1px, transparent 1px)`, 
          backgroundSize: '15px 15px' 
        }} 
      />
      
      <div 
        className="relative z-10 text-center transition-all duration-300 ease-out flex-1 flex items-center justify-center min-w-0"
        style={{
          fontFamily,
          fontSize: `clamp(1.25rem, ${3.5 * previewZoom}vw, ${2.5 * previewZoom}rem)`,
          fontWeight: 700,
          color: hasEffect ? '#FFFFFF' : (selectedColor?.hex || '#FFFFFF'),
          filter: hasEffect ? 'none' : (selectedTexture?.filter || 'none'),
          wordBreak: 'break-word',
          lineHeight: 1.2,
          textAlign: 'center',
        }}
      >
        {previewEffectLoading && (
          <span className="text-xs text-purple-400 animate-pulse">{t('fontStudio.generatingPreview')}</span>
        )}
        {previewEffectError && !previewEffectLoading && (
          <span className="text-xs text-red-400">{t('fontStudio.error', { msg: previewEffectError })}</span>
        )}
        {!previewEffectLoading && !previewEffectError && previewText}
      </div>

      <div className="absolute bottom-2 right-2 flex gap-2 text-[10px] text-gray-500">
        <span>{selectedFont.style}</span>
        <span>•</span>
        <span>{selectedTexture && t(selectedTexture.labelKey)}</span>
        {selectedEffectId && (<><span>•</span><span className="text-purple-400">{effectName}</span></>)}
      </div>
    </div>
  );
};

const ControlsTab = ({ store, onExportTTF }: { store: ReturnType<typeof createFontStore>; onExportTTF?: (opts: { effectFile?: File; effectColor?: string; effectName?: string }) => Promise<void> }) => {
  const { t } = useI18n();
  const selectedFontId = useStore(store, s => s.selectedFontId);
  const selectedColorId = useStore(store, s => s.selectedColorId);
  const selectedTextureId = useStore(store, s => s.selectedTextureId);
  const previewText = useStore(store, s => s.previewText);
  const previewZoom = useStore(store, s => s.previewZoom);
  const fonts = useStore(store, s => s.fonts);
  const setColor = useStore(store, s => s.setColor);
  const setTexture = useStore(store, s => s.setTexture);
  const setFont = useStore(store, s => s.setFont);
  const setPreviewText = useStore(store, s => s.setPreviewText);
  const setPreviewZoom = useStore(store, s => s.setPreviewZoom);
  // Texture state for export
  const textureSvgFile = useStore(store, s => s.textureSvgFile);
  const texturePalette = useStore(store, s => s.texturePalette);
  const textureScale = useStore(store, s => s.textureScale);
  const textureBaseColorIndex = useStore(store, s => s.textureBaseColorIndex);
  const textureTextureColorIndex = useStore(store, s => s.textureTextureColorIndex);
  const textureSpecificLetter = useStore(store, s => s.textureSpecificLetter);
  const setTextureSpecificLetter = useStore(store, s => s.setTextureSpecificLetter);

  // Effect textures state
  const [effectTextures, setEffectTextures] = useState<{id: string; name: string; file: string}[]>([]);
  const [effectLoading, setEffectLoading] = useState(false);
  const selectedEffectId = useStore(store, s => s.selectedEffectId);
  const setSelectedEffectId = useStore(store, s => s.setSelectedEffectId);
  const effectColor = useStore(store, s => s.effectColor);
  const setEffectColor = useStore(store, s => s.setEffectColor);
  const effectColorPickerRef = useRef<HTMLInputElement>(null);
  const generateEffectPreview = useStore(store, s => s.generateEffectPreview);
  const clearEffectPreview = useStore(store, s => s.clearEffectPreview);
  const processTexture = useStore(store, s => s.processTexture);
  const textureProcessing = useStore(store, s => s.textureProcessing);
  const textureResult = useStore(store, s => s.textureResult);
  const textureFontFile = useStore(store, s => s.textureFontFile);
  const textureEffectFile = useStore(store, s => s.textureEffectFile);
  const setTextureFontFile = useStore(store, s => s.setTextureFontFile);
  const resetTextureResult = useStore(store, s => s.resetTextureResult);

  const selectedFont = MOCK_FONTS.find(f => f.id === selectedFontId) ||
    fonts.find((f) => f.id === selectedFontId);
const displayPreviewText = textureSpecificLetter ? textureSpecificLetter.repeat(3) : previewText;
   
   // Update preview text after texture generation for specific letter
   useEffect(() => {
     if (!textureProcessing && textureResult && textureResult.success && textureSpecificLetter) {
       const timer = setTimeout(() => {
         // Set preview text to the specific letter (repeated for better visibility)
         setPreviewText(textureSpecificLetter.repeat(3));
       }, 30);
       
       return () => clearTimeout(timer);
     }
   }, [textureProcessing, textureResult, textureSpecificLetter, setPreviewText]);

   // Load effect textures from API
  const loadEffectTextures = async () => {
    setEffectLoading(true);
    try {
      const res = await fetch('/api/texturas-list');
      if (res.ok) {
        const data = await res.json();
        const effects = (data.files || [])
          .filter((f: any) => f.fullPath.startsWith('effects/'))
          .map((f: any) => ({
            id: `fx-${f.name}`,
            name: f.name,
            file: f.fullPath,
          }));
        setEffectTextures(effects);
      }
    } catch (error) {
      console.error('Error loading effect textures:', error);
    } finally {
      setEffectLoading(false);
    }
  };

  // Load an effect texture and apply it
  const loadEffectTexture = async (effect: {id: string; name: string; file: string}) => {
    try {
      const res = await fetch(`/api/texturas-file/${effect.file}`);
      if (res.ok) {
        const svgContent = await res.text();
        // Apply the SVG as a CSS filter-like effect by creating a data URL
        const svgDataUrl = `data:image/svg+xml;base64,${btoa(svgContent)}`;
        // For now, we'll just show the effect name and the user can use it in Texture tab
        setSelectedEffectId(effect.id);
        console.log('Effect loaded:', effect.name);
      }
    } catch (error) {
      console.error('Error loading effect texture:', error);
    }
  };

  useEffect(() => {
    loadEffectTextures();
  }, []);

  const handleExport = () => {
    const selectedFont = MOCK_FONTS.find(f => f.id === selectedFontId) || 
      fonts.find((f) => f.id === selectedFontId);
    const selectedColor = MOCK_COLORS.find(c => c.id === selectedColorId);
    const selectedTexture = MOCK_TEXTURES.find(t => t.id === selectedTextureId);
    
    if (selectedFont?.url) {
      const a = document.createElement('a');
      a.href = selectedFont.url;
      a.download = selectedFont.name;
      a.click();
    } else {
      alert(t('fontStudio.exportCustomOnly'));
    }
  };

  // Export font with effect applied via API (generates TTF)
  const handleExportWithEffect = async () => {
    const selectedFont = MOCK_FONTS.find(f => f.id === selectedFontId) || 
      fonts.find((f) => f.id === selectedFontId);
    const selectedEffect = effectTextures.find(e => e.id === selectedEffectId);
    
    if (!selectedFont?.url) {
      alert(t('fontStudio.exportCustomOnly'));
      return;
    }
    
    if (effectLoading) {
      alert(t('fontStudio.loadingEffects'));
      return;
    }
    
    if (effectTextures.length === 0) {
      alert(t('fontStudio.noEffects'));
      return;
    }
    
    if (!selectedEffect) {
      alert(t('fontStudio.selectEffect', { list: effectTextures.map(e => e.name).join(', ') }));
      return;
    }

    try {
      // Fetch the font file
      const fontRes = await fetch(selectedFont.url);
      if (!fontRes.ok) throw new Error(t('fontStudio.errLoadFont'));
      const fontBlob = await fontRes.blob();
      
      // Fetch the effect SVG
      const effectRes = await fetch(`/api/texturas-file/${selectedEffect.file}`);
      if (!effectRes.ok) throw new Error(t('fontStudio.errLoadEffect'));
      const svgContent = await effectRes.text();
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
      
      // Create form data for the API
      const formData = new FormData();
      formData.append('font_file', fontBlob, selectedFont.name);
      // El efecto se envía como svg_effect_file (no svg_file) para que el
      // backend lo procese como halo/iluminación exterior, no como textura
      // recortada al contorno de la letra.
      formData.append('svg_effect_file', svgBlob, selectedEffect.name + '.svg');

      // Color del efecto configurable por el usuario
      const ec = effectColor;
      const effectColorStr = `${ec.r},${ec.g},${ec.b},${ec.a}`;
      formData.append('effect_color', effectColorStr);

      // Color base de la letra: usar el color seleccionado en la UI
      const selectedColor = MOCK_COLORS.find(c => c.id === selectedColorId);
      const baseHex = selectedColor?.hex || '#FFFFFF';
      const baseR = parseInt(baseHex.slice(1, 3), 16);
      const baseG = parseInt(baseHex.slice(3, 5), 16);
      const baseB = parseInt(baseHex.slice(5, 7), 16);

      // Paleta de colores: base visible (la letra tapa el interior del halo)
      // + color del efecto.
      const palettes = [{
        colors: [
          [baseR, baseG, baseB, 255],  // Base color: el de la UI (letra visible)
          [255, 180, 50, 255],         // Texture color (no usado, pero necesario)
          [255, 255, 255, 0],          // Reserve transparente
          [200, 50, 50, 0]             // Reserve transparente
        ],
        palette_type: 0,
        name: "effect_palette"
      }];
      formData.append('palettes', JSON.stringify(palettes));
      formData.append('textured_glyphs', JSON.stringify({}));
      formData.append('scale', '1.0');
      formData.append('base_color_index', '0');
      formData.append('texture_color_index', '1');

      // Call the API
      const response = await fetch('/api/apply-font-texture', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || getT()('fontStudio.errGenerate'));
      }

      // Get the generated font
      const outputFontBlob = await response.blob();
      const filename = response.headers.get('X-Output-Filename') || `effect_${selectedFont.family}-${selectedEffect.name}.ttf`;
      
      // Download the generated font
      const url = URL.createObjectURL(outputFontBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
      alert(t('fontStudio.generated', { filename }));
    } catch (error) {
      console.error('Error exporting with effect:', error);
      alert(t('fontStudio.error', { msg: error instanceof Error ? error.message : t('fontStudio.errUnknown') }));
    }
  };

  const [exportingPng, setExportingPng] = useState(false);

  const handleExportTTF = async () => {
    if (!onExportTTF) {
      alert(t('fontStudio.noExportFn'));
      return;
    }

    setExportingPng(true);
    resetTextureResult();

    try {
      // Recoger efecto seleccionado del modal (si hay)
      const ec = effectColor;
      const toHex = (v: number) => v.toString(16).padStart(2, '0');
      const effectColorHex = `#${toHex(ec.r)}${toHex(ec.g)}${toHex(ec.b)}`;

      await onExportTTF({
        effectFile: textureEffectFile || undefined,
        effectColor: textureEffectFile ? effectColorHex : undefined,
        effectName: textureEffectFile?.name,
      });
    } catch (error) {
      console.error('Error exporting TTF:', error);
      alert(t('fontStudio.errExport', { msg: error instanceof Error ? error.message : t('fontStudio.errUnknown') }));
    } finally {
      setExportingPng(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">{t('fontStudio.configuration')}</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar min-h-0">
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.fontFamily')}</Label>
          <select 
            className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm text-white focus:border-green-500 focus:outline-none"
            onChange={(e) => {
              const font = MOCK_FONTS.find(f => f.family === e.target.value);
              if (font) setFont(font.id);
            }}
          >
            {MOCK_FONTS.map(font => (
              <option key={font.id} value={font.name}>{font.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.color')}</Label>
          <div className="grid grid-cols-5 gap-2">
            {MOCK_COLORS.map(color => (
              <button
                key={color.id}
                onClick={() => setColor(color.id)}
                className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  selectedColorId === color.id ? 'border-white scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: color.hex }}
                title={t(color.labelKey)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.textureEffect')}</Label>
          <div className="space-y-1">
            {MOCK_TEXTURES.map(texture => (
              <div 
                key={texture.id}
                onClick={() => setTexture(texture.id)}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer border transition-all ${
                  selectedTextureId === texture.id 
                    ? 'bg-gray-800 border-green-500/50' 
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <span className="text-sm text-gray-300">{t(texture.labelKey)}</span>
                <div className="w-6 h-6 rounded bg-gray-800 flex items-center justify-center text-[10px] text-gray-500">
                  {texture.filter === 'none' ? t('fontStudio.textures.none') : t(texture.labelKey).substring(0, 2).toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.previewText')}</Label>
          <Input 
            value={displayPreviewText}
            onChange={(e) => {
              const val = e.target.value;
              if (textureSpecificLetter) {
                // When a specific letter is set, take only the first character as the letter
                const letter = val.charAt(0) || null;
                setTextureSpecificLetter(letter);
              } else {
                setPreviewText(val);
              }
            }}
            className="bg-gray-900 border border-gray-800 text-white focus:border-green-500"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.previewZoom')}</Label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={previewZoom}
              onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-800 rounded-lg appearance-none accent-green-500"
            />
            <span className="text-sm text-gray-300 w-16 text-right">{previewZoom.toFixed(1)}x</span>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-800 space-y-2">
          <Button
            onClick={handleExportTTF}
            disabled={exportingPng || textureProcessing}
            variant="outline"
            className="w-full bg-gradient-to-r from-green-600 to-green-800 hover:from-green-500 hover:to-green-700 shadow-lg shadow-green-900/20"
          >
            <Download size={16} />
            {exportingPng || textureProcessing ? t('fontStudio.exporting') : t('fontStudio.exportTTF')}
          </Button>

          {textureResult && (
            <div className={`p-3 rounded-lg border text-sm ${
              textureResult.success
                ? 'bg-green-950/40 border-green-500/40 text-green-300'
                : 'bg-red-950/40 border-red-500/40 text-red-300'
            }`}>
              {textureResult.success ? t('fontStudio.ttfSuccess') : `✗ ${textureResult.message}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TextureTab = ({ store }: { store: ReturnType<typeof createFontStore> }) => {
  const { t } = useI18n();
  const textureFontFile = useStore(store, s => s.textureFontFile);
  const textureSvgFile = useStore(store, s => s.textureSvgFile);
  const textureEffectFile = useStore(store, s => s.textureEffectFile);
  const textureScale = useStore(store, s => s.textureScale);
  const textureBaseColorIndex = useStore(store, s => s.textureBaseColorIndex);
  const textureTextureColorIndex = useStore(store, s => s.textureTextureColorIndex);
  const texturePalette = useStore(store, s => s.texturePalette);
  const textureProcessing = useStore(store, s => s.textureProcessing);
  const textureResult = useStore(store, s => s.textureResult);

  const textureSpecificLetter = useStore(store, s => s.textureSpecificLetter);
  const setTextureFontFile = useStore(store, s => s.setTextureFontFile);
  const setTextureSvgFile = useStore(store, s => s.setTextureSvgFile);
  const setTextureEffectFile = useStore(store, s => s.setTextureEffectFile);
  const setTextureScale = useStore(store, s => s.setTextureScale);
  const setTextureBaseColorIndex = useStore(store, s => s.setTextureBaseColorIndex);
  const setTextureSpecificLetter = useStore(store, s => s.setTextureSpecificLetter);
  const setTextureTextureColorIndex = useStore(store, s => s.setTextureTextureColorIndex);
  const addTexturePaletteColor = useStore(store, s => s.addTexturePaletteColor);
  const removeTexturePaletteColor = useStore(store, s => s.removeTexturePaletteColor);
  const updateTexturePaletteColor = useStore(store, s => s.updateTexturePaletteColor);
  const effectColor = useStore(store, s => s.effectColor);
  const setEffectColor = useStore(store, s => s.setEffectColor);
  const processTexture = useStore(store, s => s.processTexture);
  const resetTextureResult = useStore(store, s => s.resetTextureResult);

  const [serverStatus, setServerStatus] = useState<{ running: boolean; checking: boolean }>({ running: false, checking: false });
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const fontInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const effectInputRef = useRef<HTMLInputElement>(null);
  const effectColorPickerRef = useRef<HTMLInputElement>(null);

  // Texturas folder selection
  const [texturasFiles, setTexturasFiles] = useState<TexturaFile[]>([]);
  const [texturasLoading, setTexturasLoading] = useState(false);
  const [showTexturasDropdown, setShowTexturasDropdown] = useState(false);
  const [showEffectsDropdown, setShowEffectsDropdown] = useState(false);
  const [texturaFilter, setTexturaFilter] = useState('');
  // Vista grande + borrado de texturas
  const [previewTextura, setPreviewTextura] = useState<TexturaFile | null>(null);
  const [texturaToDelete, setTexturaToDelete] = useState<TexturaFile | null>(null);
  const [deletingTextura, setDeletingTextura] = useState(false);

  // Effect textures (SVG-based from effects/ folder)
  const [effectTextures, setEffectTextures] = useState<{id: string; name: string; file: string}[]>([]);
  const [effectLoading, setEffectLoading] = useState(false);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);

  // Load effect textures from API
  const loadEffectTextures = async () => {
    setEffectLoading(true);
    try {
      const res = await fetch('/api/texturas-list');
      if (res.ok) {
        const data = await res.json();
        const effects = (data.files || [])
          .filter((f: any) => f.fullPath.startsWith('effects/'))
          .map((f: any) => ({
            id: `fx-${f.name}`,
            name: f.name,
            file: f.fullPath,
          }));
        setEffectTextures(effects);
      }
    } catch (error) {
      console.error('Error loading effect textures:', error);
    } finally {
      setEffectLoading(false);
    }
  };

  // Load an effect texture and apply it to textureSvgFile
  const loadEffectTexture = async (effect: {id: string; name: string; file: string}) => {
    try {
      const res = await fetch(`/api/texturas-file/${effect.file}`);
      if (res.ok) {
        const svgContent = await res.text();
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const file = new File([blob], effect.name + '.svg', { type: 'image/svg+xml' });
        setTextureSvgFile(file);
        setSelectedEffectId(effect.id);
        resetTextureResult();
      }
    } catch (error) {
      console.error('Error loading effect texture:', error);
    }
  };

  // Load texturas list from Texturas folder
  const loadTexturasList = async () => {
    setTexturasLoading(true);
    try {
      const res = await fetch('/api/texturas-list');
      if (res.ok) {
        const data = await res.json();
        // Exclude files in the effects/ subfolder — those are effect textures,
        // not regular textures. They have their own section in the Controls tab.
        setTexturasFiles((data.files || []).filter((f: TexturaFile) => !f.fullPath.startsWith('effects/')));
      }
    } catch (error) {
      console.error('Error loading texturas list:', error);
    } finally {
      setTexturasLoading(false);
    }
  };

  // Load a textura file from the Texturas folder
  const loadTexturaFromFolder = async (textura: TexturaFile) => {
    try {
      const res = await fetch(`/api/texturas-file/${textura.fullPath}`);
      if (res.ok) {
        const svgContent = await res.text();
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const file = new File([blob], textura.name + '.svg', { type: 'image/svg+xml' });
        setTextureSvgFile(file);
        resetTextureResult();
        setShowTexturasDropdown(false);
      } else {
        console.error('Error loading textura file:', await res.text());
      }
    } catch (error) {
      console.error('Error loading textura file:', error);
    }
  };

  // Delete a textura file from the Texturas folder (with confirmation)
  const handleDeleteTextura = async () => {
    if (!texturaToDelete) return;
    setDeletingTextura(true);
    try {
      const res = await fetch('/api/texturas-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullPath: texturaToDelete.fullPath }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Remove from local list and close confirm dialog
        setTexturasFiles(prev => prev.filter(f => f.fullPath !== texturaToDelete.fullPath));
        setTexturaToDelete(null);
      } else {
        alert(data.message || 'Error al borrar la textura');
        setTexturaToDelete(null);
      }
    } catch (error) {
      console.error('Error deleting textura:', error);
      alert(t('fontStudio.errDeleteTexture'));
      setTexturaToDelete(null);
    } finally {
      setDeletingTextura(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showTexturasDropdown && !(event.target as HTMLElement).closest('.relative')) {
        setShowTexturasDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTexturasDropdown]);

  useEffect(() => {
    loadTexturasList();
    loadEffectTextures();
  }, []);

  const checkStatus = async () => {
    setServerStatus(prev => ({ ...prev, checking: true }));
    try {
      if (isElectron()) {
        const s = await getServerStatus();
        setServerStatus({ running: !!s.textureApi?.running, checking: false });
      } else {
        const res = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
        setServerStatus({ running: res ? res.ok : false, checking: false });
      }
    } catch {
      setServerStatus({ running: false, checking: false });
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleStartServer = async () => {
    if (!isElectron()) {
      setServerMessage('Ejecuta python simple_api.py en la carpeta Api-Font-Texture.');
      return;
    }
    setIsStartingServer(true);
    setServerMessage('Iniciando servidor de API de texturas (puerto 8000)...');
    try {
      const res = await startTextureApi();
      if (!res.success) throw new Error(res.error || 'No se pudo iniciar el servidor');
      setServerStatus({ running: true, checking: false });
      setServerMessage('Servidor API iniciado y listo.');
    } catch (e: any) {
      setServerMessage(e.message || 'Error al iniciar el servidor');
      setServerStatus({ running: false, checking: false });
    } finally {
      setIsStartingServer(false);
    }
  };

  const handleStopServer = async () => {
    if (!isElectron()) return;
    setIsStartingServer(true);
    try {
      await stopTextureApi();
      setServerStatus({ running: false, checking: false });
      setServerMessage('Servidor API detenido.');
    } catch (e: any) {
      setServerMessage(e.message || 'Error al detener el servidor');
    } finally {
      setIsStartingServer(false);
    }
  };

  const handleFontFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && /\.(ttf|otf)$/i.test(file.name)) {
      setTextureFontFile(file);
      resetTextureResult();
    }
    if (e.target) e.target.value = '';
  };

  const handleSvgFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && /\.svg$/i.test(file.name)) {
      setTextureSvgFile(file);
      resetTextureResult();
    }
    if (e.target) e.target.value = '';
  };

  const handleEffectFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && /\.svg$/i.test(file.name)) {
      setTextureEffectFile(file);
      resetTextureResult();
    }
    if (e.target) e.target.value = '';
  };

  // Cargar un efecto de iluminación desde la carpeta effects/ como File
  const loadEffectFromFolder = async (effect: {id: string; name: string; file: string}) => {
    try {
      const res = await fetch(`/api/texturas-file/${effect.file}`);
      if (res.ok) {
        const svgContent = await res.text();
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const file = new File([blob], effect.name + '.svg', { type: 'image/svg+xml' });
        setTextureEffectFile(file);
        setSelectedEffectId(effect.id);
        resetTextureResult();
        setShowEffectsDropdown(false);
      } else {
        console.error('Error loading effect file:', await res.text());
      }
    } catch (error) {
      console.error('Error loading effect file:', error);
    }
  };

  const handlePaletteColorChange = (index: number, field: 'r' | 'g' | 'b' | 'a', value: number) => {
    const color = { ...texturePalette[index] };
    color[field] = Math.max(0, Math.min(255, value));
    updateTexturePaletteColor(index, color);
  };

  const handleAddPaletteColor = () => {
    addTexturePaletteColor({ r: 128, g: 128, b: 128, a: 255 });
  };

  const formatColor = (c: ColorPaletteOption) => `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(2)})`;

  // Color picker state
  const [colorPickerIndex, setColorPickerIndex] = useState<number | null>(null);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  const handleColorPickerChange = (index: number, hexColor: string) => {
    // Convert hex to RGBA
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    // Keep existing alpha value
    const a = texturePalette[index].a;
    
    updateTexturePaletteColor(index, { r, g, b, a });
  };

  const openColorPicker = (index: number) => {
    setColorPickerIndex(index);
    setTimeout(() => colorPickerRef.current?.click(), 0);
  };

  return (
    <>
    <div className="flex flex-col h-full min-h-0 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">{t('fontStudio.applyTitle')}</h2>
        <p className="text-xs text-gray-500 mt-1">{t('fontStudio.applySubtitle')}</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar min-h-0">
        {/* Server Status & Controls */}
        <div className="p-3 bg-gray-900/80 border border-gray-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${serverStatus.running ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]' : isStartingServer ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <Server size={14} className="text-gray-400" />
                {t('fontStudio.apiTitle')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${serverStatus.running ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {serverStatus.running ? t('fontStudio.online') : isStartingServer ? t('fontStudio.starting') : t('fontStudio.offline')}
              </span>
              <button
                type="button"
                onClick={checkStatus}
                disabled={serverStatus.checking}
                title={t('fontStudio.checkStatus')}
                className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800 transition-colors"
              >
                <RefreshCw size={13} className={serverStatus.checking ? 'animate-spin text-green-400' : ''} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-gray-800/60">
            {serverStatus.running ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleStopServer}
                disabled={isStartingServer}
                className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 gap-1.5"
              >
                <Power size={13} /> {t('fontStudio.stopServer')}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleStartServer}
                disabled={isStartingServer}
                className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5 shadow-sm"
              >
                {isStartingServer ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> {t('fontStudio.starting')}
                  </>
                ) : (
                  <>
                    <Zap size={13} /> {t('fontStudio.startServer')}
                  </>
                )}
              </Button>
            )}
            <span className="text-[11px] text-gray-500 flex-1 truncate">
              {serverMessage || (serverStatus.running ? t('fontStudio.readyHint') : t('fontStudio.startServerHint'))}
            </span>
</div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
            <FileText size={14} /> {t('fontStudio.fontFile')}
          </Label>
          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf"
            onChange={handleFontFileSelect}
            className="hidden"
          />
          <div
            onClick={() => fontInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fontInputRef.current?.click(); } }}
            className={`w-full flex items-center justify-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              textureFontFile 
                ? 'bg-gray-900 border-green-500/50 shadow-sm' 
                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
            } ${textureProcessing ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <FileText size={18} className={textureFontFile ? 'text-green-500 flex-shrink-0' : 'text-gray-400 flex-shrink-0'} />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {textureFontFile ? textureFontFile.name : t('fontStudio.selectTTF')}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {textureFontFile ? t('fontStudio.sizeKB', { size: (textureFontFile.size / 1024).toFixed(1) }) : t('fontStudio.baseFont')}
              </p>
            </div>
            {textureFontFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTextureFontFile(null); }}
                className="p-1 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors flex-shrink-0"
                title={t('fontStudio.removeFile')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* SVG Texture File Upload */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
            <Image size={14} /> {t('fontStudio.svgTexture')}
          </Label>
          
          {/* Texturas folder dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowTexturasDropdown(!showTexturasDropdown);
                if (!showTexturasDropdown && texturasFiles.length === 0) {
                  loadTexturasList();
                }
              }}
              className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                showTexturasDropdown 
                  ? 'bg-gray-900 border-green-500/50 shadow-sm' 
                  : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
              } ${textureProcessing ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FolderOpen size={18} className="text-green-500 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {t('fontStudio.projectTextures')}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {t('fontStudio.svgAvailable', { n: texturasFiles.length })}
                  </p>
                </div>
              </div>
              <ChevronDown 
                size={18} 
                className={`text-gray-400 transition-transform flex-shrink-0 ${showTexturasDropdown ? 'rotate-180' : ''}`} 
              />
            </button>

            {/* Dropdown menu */}
            {showTexturasDropdown && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-950 border border-gray-800 rounded-xl shadow-lg overflow-hidden max-h-96 overflow-y-auto custom-scrollbar">
                {texturasLoading ? (
                  <div className="p-4 text-center text-gray-500">
                    <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                    {t('fontStudio.loadingTextures')}
                  </div>
                ) : texturasFiles.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {t('fontStudio.noSvgFiles')}
                  </div>
                ) : (
                  <>
                    <div className="p-2 border-b border-gray-800">
                      <input
                        type="text"
                        placeholder={t('fontStudio.filterTextures')}
                        onChange={(e) => setTexturaFilter(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-800 rounded-lg py-1.5 px-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500"
                      />
                    </div>
                    <div className="divide-y divide-gray-800">
                      {texturasFiles
                        .filter(f => f.name.toLowerCase().includes(texturaFilter.toLowerCase()))
                        .map((textura) => (
                          <div
                            key={textura.fullPath}
                            className="flex items-center gap-3 p-2.5 hover:bg-gray-900 transition-colors group"
                          >
                            {/* Miniatura SVG — clic = ver grande */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPreviewTextura(textura); }}
                              title={t('fontStudio.viewLarge')}
                              className="w-12 h-12 flex-shrink-0 rounded-lg border border-gray-700 overflow-hidden flex items-center justify-center cursor-zoom-in hover:border-green-500/50 transition-colors"
                              style={{ background: 'linear-gradient(45deg, #e5e5e5 25%, #ffffff 25%, #ffffff 50%, #e5e5e5 50%, #e5e5e5 75%, #ffffff 75%, #ffffff 100%)', backgroundSize: '10px 10px' }}
                            >
                              <img
                                src={`/api/texturas-file/${encodeURI(textura.fullPath)}`}
                                alt={textura.name}
                                loading="lazy"
                                className="max-w-full max-h-full object-contain"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => loadTexturaFromFolder(textura)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <p className="text-sm font-medium text-white truncate">{textura.name}</p>
                              <p className="text-xs text-gray-500 truncate">
                                {textura.fullPath} • {((textura.size / 1024)).toFixed(1)} KB
                              </p>
                            </button>
                            {/* Botón borrar — con confirmación */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setTexturaToDelete(textura); }}
                              title={t('fontStudio.deleteFromFolder')}
                              className="flex-shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <input
            ref={svgInputRef}
            type="file"
            accept=".svg"
            onChange={handleSvgFileSelect}
            className="hidden"
          />
          <div
            onClick={() => svgInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); svgInputRef.current?.click(); } }}
            className={`w-full flex items-center justify-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              textureSvgFile 
                ? 'bg-gray-900 border-green-500/50 shadow-sm' 
                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
            } ${textureProcessing ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <Image size={18} className={textureSvgFile ? 'text-green-500 flex-shrink-0' : 'text-gray-400 flex-shrink-0'} />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {textureSvgFile ? textureSvgFile.name : t('fontStudio.selectSVG')}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {textureSvgFile ? t('fontStudio.sizeKB', { size: (textureSvgFile.size / 1024).toFixed(1) }) : t('fontStudio.texturePattern')}
              </p>
            </div>
            {textureSvgFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTextureSvgFile(null); }}
                className="p-1 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors flex-shrink-0"
                title={t('fontStudio.removeFile')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Efecto de Iluminación (opcional) */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" /> {t('fontStudio.lightEffect')} <span className="text-gray-600 font-normal">{t('fontStudio.optional')}</span>
          </Label>

          {/* Effects folder dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowEffectsDropdown(!showEffectsDropdown);
                if (!showEffectsDropdown && effectTextures.length === 0) {
                  loadEffectTextures();
                }
              }}
              className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                showEffectsDropdown
                  ? 'bg-gray-900 border-amber-500/50 shadow-sm'
                  : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
              } ${textureProcessing ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Sparkles size={18} className="text-amber-500 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {t('fontStudio.projectEffects')}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {t('fontStudio.effectsAvailable', { n: effectTextures.length })}
                  </p>
                </div>
              </div>
              <ChevronDown
                size={18}
                className={`text-gray-400 transition-transform flex-shrink-0 ${showEffectsDropdown ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown menu */}
            {showEffectsDropdown && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-950 border border-gray-800 rounded-xl shadow-lg overflow-hidden max-h-96 overflow-y-auto custom-scrollbar">
                {effectLoading ? (
                  <div className="p-4 text-center text-gray-500">
                    <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                    {t('fontStudio.loadingEffectsShort')}
                  </div>
                ) : effectTextures.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {t('fontStudio.noEffectsFolder')}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-800">
                    {effectTextures.map((effect) => (
                      <div
                        key={effect.id}
                        onClick={() => loadEffectFromFolder(effect)}
                        className={`flex items-center gap-3 p-2.5 hover:bg-gray-900 transition-colors cursor-pointer ${selectedEffectId === effect.id ? 'bg-amber-500/5' : ''}`}
                      >
                        <div
                          className="w-12 h-12 flex-shrink-0 rounded-lg border border-gray-700 overflow-hidden flex items-center justify-center"
                          style={{ background: 'linear-gradient(45deg, #e5e5e5 25%, #ffffff 25%, #ffffff 50%, #e5e5e5 50%, #e5e5e5 75%, #ffffff 75%, #ffffff 100%)', backgroundSize: '10px 10px' }}
                        >
                          <img
                            src={`/api/texturas-file/${encodeURI(effect.file)}`}
                            alt={effect.name}
                            loading="lazy"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-white truncate">{effect.name}</p>
                          <p className="text-xs text-gray-500 truncate">{effect.file}</p>
                        </div>
                        {selectedEffectId === effect.id && (
                          <Check size={16} className="text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <input
            ref={effectInputRef}
            type="file"
            accept=".svg"
            onChange={handleEffectFileSelect}
            className="hidden"
          />
          <div
            onClick={() => effectInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); effectInputRef.current?.click(); } }}
            className={`w-full flex items-center justify-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              textureEffectFile
                ? 'bg-gray-900 border-amber-500/50 shadow-sm'
                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
            } ${textureProcessing ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <Sparkles size={18} className={textureEffectFile ? 'text-amber-500 flex-shrink-0' : 'text-gray-400 flex-shrink-0'} />
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {textureEffectFile ? textureEffectFile.name : t('fontStudio.noEffect')}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {textureEffectFile ? t('fontStudio.sizeKB', { size: (textureEffectFile.size / 1024).toFixed(1) }) : t('fontStudio.effectHint')}
              </p>
            </div>
            {textureEffectFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTextureEffectFile(null); }}
                className="p-1 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors flex-shrink-0"
                title={t('fontStudio.removeEffect')}
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Color del efecto */}
          {textureEffectFile && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
                <Palette size={14} className="text-purple-400" /> {t('fontStudio.effectColor')}
              </Label>
              <div className="flex items-center gap-3 p-2 bg-gray-900 border border-gray-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => effectColorPickerRef.current?.click()}
                  className="w-8 h-8 rounded border-2 border-gray-700 flex-shrink-0 hover:scale-105 transition-transform"
                  style={{ backgroundColor: `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${(effectColor.a / 255).toFixed(2)})` }}
                  title={t('fontStudio.pickColor')}
                />
                <div className="flex-1 grid grid-cols-4 gap-2">
                  {(['r', 'g', 'b', 'a'] as const).map(ch => (
                    <div key={ch} className="space-y-1">
                      <label className="text-xs text-gray-500 uppercase">{ch}</label>
                      <input
                        type="number"
                        min="0"
                        max="255"
                        value={effectColor[ch]}
                        onChange={(e) => setEffectColor({ ...effectColor, [ch]: parseInt(e.target.value) || 0 })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-purple-500"
                        disabled={textureProcessing}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <input
                ref={effectColorPickerRef}
                type="color"
                className="hidden"
                onChange={(e) => {
                  const hex = e.target.value;
                  setEffectColor({
                    r: parseInt(hex.slice(1, 3), 16),
                    g: parseInt(hex.slice(3, 5), 16),
                    b: parseInt(hex.slice(5, 7), 16),
                    a: effectColor.a,
                  });
                }}
              />
            </div>
          )}
        </div>

        {/* Scale */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
            <Settings size={14} /> {t('fontStudio.textureScale', { scale: textureScale.toFixed(1) })}
          </Label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={textureScale}
              onChange={(e) => setTextureScale(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-800 rounded-lg appearance-none accent-green-500"
              disabled={textureProcessing}
            />
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={textureScale}
              onChange={(e) => setTextureScale(parseFloat(e.target.value))}
              className="w-20 bg-gray-900 border border-gray-800 rounded-lg py-1 px-2 text-sm text-white text-center focus:border-green-500"
              disabled={textureProcessing}
            />
          </div>
          <p className="text-xs text-gray-500">{t('fontStudio.scaleHint')}</p>
        </div>

        {/* Color Palette */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
            <Palette size={14} /> {t('fontStudio.palette')}
          </Label>
          
          {/* Hidden color picker input */}
          <input
            ref={colorPickerRef}
            type="color"
            className="hidden"
            onChange={(e) => {
              if (colorPickerIndex !== null) {
                handleColorPickerChange(colorPickerIndex, e.target.value);
              }
            }}
          />
          
          <div className="space-y-2">
            {texturePalette.map((color, index) => (
              <div key={index} className="flex items-center gap-3 p-2 bg-gray-900 border border-gray-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => !textureProcessing && openColorPicker(index)}
                  className="w-8 h-8 rounded border-2 border-gray-700 flex-shrink-0 hover:scale-105 transition-transform"
                  style={{ backgroundColor: formatColor(color) }}
                  disabled={textureProcessing}
                  title={t('fontStudio.pickColor')}
                />
                <div className="flex-1 grid grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">R</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={color.r}
                      onChange={(e) => handlePaletteColorChange(index, 'r', parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-green-500"
                      disabled={textureProcessing}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">G</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={color.g}
                      onChange={(e) => handlePaletteColorChange(index, 'g', parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-green-500"
                      disabled={textureProcessing}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">B</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={color.b}
                      onChange={(e) => handlePaletteColorChange(index, 'b', parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-green-500"
                      disabled={textureProcessing}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">A</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={color.a}
                      onChange={(e) => handlePaletteColorChange(index, 'a', parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-green-500"
                      disabled={textureProcessing}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-8 text-center">
                    #{index}
                    {index === textureBaseColorIndex && <span className="text-green-500 ml-1">●</span>}
                    {index === textureTextureColorIndex && <span className="text-blue-500 ml-1">◆</span>}
                  </span>
                  <button
                    onClick={() => setTextureBaseColorIndex(index)}
                    className={`p-1 rounded text-xs ${textureBaseColorIndex === index ? 'bg-green-500/20 text-green-500' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                    title={t('fontStudio.baseColor')}
                    disabled={textureProcessing}
                  >
                    {t('fontStudio.base')}
                  </button>
                  <button
                    onClick={() => setTextureTextureColorIndex(index)}
                    className={`p-1 rounded text-xs ${textureTextureColorIndex === index ? 'bg-blue-500/20 text-blue-500' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                    title={t('fontStudio.textureColor')}
                    disabled={textureProcessing}
                  >
                    {t('fontStudio.tex')}
                  </button>
                  {texturePalette.length > 1 && (
                    <button
                      onClick={() => removeTexturePaletteColor(index)}
                      className="p-1 rounded text-red-400 hover:bg-red-500/20"
                      title={t('fontStudio.removeColor')}
                      disabled={textureProcessing}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <Button
              onClick={handleAddPaletteColor}
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2"
              disabled={textureProcessing}
            >
              <Plus size={14} /> {t('fontStudio.addColor')}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            {t('fontStudio.paletteLegend')}
          </p>
        </div>

        {/* Color Index Selectors (simplified) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.baseIndex')}</Label>
            <select
              value={textureBaseColorIndex}
              onChange={(e) => setTextureBaseColorIndex(parseInt(e.target.value))}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm text-white focus:border-green-500"
              disabled={textureProcessing}
            >
              {texturePalette.map((_, i) => (
                <option key={i} value={i}>{t('fontStudio.indexOption', { i, r: texturePalette[i].r, g: texturePalette[i].g, b: texturePalette[i].b, a: (texturePalette[i].a/255).toFixed(2) })}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.textureIndex')}</Label>
            <select
              value={textureTextureColorIndex}
              onChange={(e) => setTextureTextureColorIndex(parseInt(e.target.value))}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm text-white focus:border-green-500"
              disabled={textureProcessing}
            >
              {texturePalette.map((_, i) => (
                <option key={i} value={i}>{t('fontStudio.indexOption', { i, r: texturePalette[i].r, g: texturePalette[i].g, b: texturePalette[i].b, a: (texturePalette[i].a/255).toFixed(2) })}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Process Buttons */}
        <div className="pt-4 border-t border-gray-800 space-y-3">
          {/* Single Letter Texture Option */}
          <div className="mb-2">
            <Label className="text-xs text-gray-500 font-medium">{t('fontStudio.letterLabel')}</Label>
            <input
              type="text"
              value={textureSpecificLetter || ""}
              onChange={(e) => setTextureSpecificLetter(e.target.value || null)}
              placeholder="A, B, ñ, etc."
              className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm text-white focus:border-green-500"
              disabled={textureProcessing}
              maxLength={1}
            />
          </div>
          {/* Aplicar textura a fuente completa */}
          <Button
            onClick={() => { setTextureSpecificLetter(null); processTexture(); }}
            disabled={textureProcessing || !textureFontFile || (!textureSvgFile && !textureEffectFile)}
            className="w-full bg-gradient-to-r from-green-600 to-green-800 hover:from-green-500 hover:to-green-700 shadow-lg shadow-green-900/20 py-3 text-lg"
          >
            {textureProcessing ? (
              <>
                <Loader2 size={20} className="animate-spin mr-2" />
                {t('fontStudio.processing')}
              </>
            ) : (
              <>
                <Zap size={20} />
                {t('fontStudio.applyComplete')}
              </>
            )}
          </Button>
          
          {/* Aplicar textura a una letra */}
          {textureSpecificLetter && (
            <Button
              onClick={processTexture}
              disabled={textureProcessing || !textureFontFile || (!textureSvgFile && !textureEffectFile)}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-500 hover:to-blue-700 shadow-lg shadow-blue-900/20 py-3 text-lg"
            >
              {textureProcessing ? (
                <>
                  <Loader2 size={20} className="animate-spin mr-2" />
                  {t('fontStudio.processing')}
                </>
              ) : (
                <>
                  <Zap size={20} />
                  {t('fontStudio.applySpecificLetter')}
                </>
              )}
            </Button>
          )}
          
          {textureResult && (
            <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
              textureResult.success 
                ? 'bg-green-950/40 border-green-500/40 text-green-300' 
                : 'bg-red-950/40 border-red-500/40 text-red-300'
            }`}>
              <div className="flex items-start gap-2.5">
                {textureResult.success ? (
                  <CheckCircle size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{textureResult.message}</p>
                  {textureResult.outputFile && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{t('fontStudio.output', { file: textureResult.outputFile })}</p>
                  )}
                  {textureResult.error && (
                    <p className="text-[11px] text-red-400 mt-0.5">{t('fontStudio.error', { msg: textureResult.error })}</p>
                  )}
                </div>
              </div>
              {textureResult.success && (
                <div className="flex items-center gap-2 pt-1 border-t border-green-500/20">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => store.getState().setActiveTab('list')}
                    className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5 shadow-sm"
                  >
                    <Layers size={13} /> {t('fontStudio.viewInFonts')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-xs text-gray-500 space-y-1">
          <p><strong className="text-gray-300">{t('fontStudio.howItWorks')}</strong></p>
          <p>{t('fontStudio.step1')}</p>
          <p>{t('fontStudio.step2')}</p>
          <p>{t('fontStudio.step3')}</p>
          <p>{t('fontStudio.step4')}</p>
          <p>{t('fontStudio.step5')}</p>
          <p>{t('fontStudio.step6')}</p>
          <p className="mt-2 text-amber-400">
            {t('fontStudio.keepTexture')}
          </p>
        </div>
      </div>
    </div>

    {/* Vista grande de textura */}
    <AnimatePresence>
      {previewTextura && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6"
          onClick={() => setPreviewTextura(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-[70vw] max-w-[560px] bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{previewTextura.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {previewTextura.fullPath} • {((previewTextura.size / 1024)).toFixed(1)} KB
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); loadTexturaFromFolder(previewTextura); setPreviewTextura(null); }}
                  className="rounded-lg px-3 py-1.5 bg-gradient-to-r from-green-600 to-green-800 hover:from-green-500 hover:to-green-700 text-white text-sm font-medium transition-colors"
                >
                  {t('fontStudio.useTexture')}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTextura(null)}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 flex items-center justify-center"
                 style={{ background: 'linear-gradient(45deg, #d4d4d4 25%, #f5f5f5 25%, #f5f5f5 50%, #d4d4d4 50%, #d4d4d4 75%, #f5f5f5 75%, #f5f5f5 100%)', backgroundSize: '16px 16px' }}>
              <img
                src={`/api/texturas-file/${encodeURI(previewTextura.fullPath)}`}
                alt={previewTextura.name}
                className="max-w-full max-h-[55vh] object-contain"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Confirmación de borrado */}
    <AnimatePresence>
      {texturaToDelete && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6"
          onClick={() => { if (!deletingTextura) setTexturaToDelete(null); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5 border-b border-gray-800">
              <div className="p-2 rounded-full bg-red-500/10 text-red-500 flex-shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white">{t('fontStudio.deleteTexturaTitle')}</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {t('fontStudio.deleteTexturaConfirm', { path: texturaToDelete.fullPath })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4">
              <Button
                variant="ghost"
                onClick={() => setTexturaToDelete(null)}
                disabled={deletingTextura}
                className="text-gray-300 hover:text-white hover:bg-gray-800"
              >
                {t('fontStudio.cancel')}
              </Button>
              <Button
                onClick={handleDeleteTextura}
                disabled={deletingTextura}
                className="bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30"
              >
                {deletingTextura ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {t('fontStudio.deleting')}
                  </>
                ) : (
                  <>
                    <Trash2 size={16} /> {t('fontStudio.delete')}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
};

// --- Main Modal Component ---

export interface FontStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFontLoad?: (font: FontAsset) => void;
  initialFonts?: FontAsset[];
  /** Exporta la fuente del editor (no una preexistente) con colores COLR v1 + efectos opcionales. */
  onExportTTF?: (opts: { effectFile?: File; effectColor?: string; effectName?: string }) => Promise<void>;
}

export const FontStudioModal: React.FC<FontStudioModalProps> = ({
  isOpen,
  onClose,
  onFontLoad,
  initialFonts = [],
  onExportTTF,
}) => {
  const [store] = useState(() => createFontStore());
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFont, setFont, fonts } = store.getState();
  const activeTab = useStore(store, s => s.activeTab);
  const setActiveTab = useStore(store, s => s.setActiveTab);

  // Load local fonts from fuentes folder on mount
  useEffect(() => {
    if (!isOpen) return;
    
    const loadLocalFonts = async () => {
      try {
        const res = await fetch('/api/local-fonts');
        if (res.ok) {
          const data = await res.json();
          if (data.fonts && data.fonts.length > 0) {
            for (const font of data.fonts) {
              // Convert local file path to media:// URL or blob URL
              // For now, we'll use a blob URL by fetching the file
              try {
                const fontRes = await fetch(`/api/local-font-file?path=${encodeURIComponent(font.path)}`);
                if (fontRes.ok) {
                  const blob = await fontRes.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  
                  const newFont: FontAsset = {
                    id: font.id,
                    name: font.name,
                    family: font.family,
                    style: font.style,
                    previewText: 'Custom Font',
                    url: blobUrl,
                    path: font.path, // Store local file path for deletion
                  };
                  addFont(newFont);
                }
              } catch (e) {
                console.warn('Could not load font:', font.path, e);
              }
            }
          }
        }
      } catch (error) {
        console.log('No local fonts found or error loading:', error);
      }
    };

    loadLocalFonts();
  }, [isOpen]);

  useEffect(() => {
    if (initialFonts.length > 0) {
      initialFonts.forEach(font => {
        const currentFonts = store.getState().fonts;
        const exists = currentFonts.some(f => f.id === font.id);
        if (!exists) addFont(font);
      });
    }
  }, [initialFonts]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && /\.(ttf|otf|woff|woff2)$/i.test(file.name)) {
      const url = URL.createObjectURL(file);
      const newFont: FontAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        family: file.name.split('.')[0],
        style: 'Display',
        previewText: 'Custom Font',
        url,
      };
      addFont(newFont);
      setFont(newFont.id);
      onFontLoad?.(newFont);
    }
    if (e.target) e.target.value = '';
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Add zoom state for preview
  const [zoom, setZoom] = useState(1);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="w-[90vw] max-w-[900px] min-w-[500px] h-[90vh] max-h-[90vh] overflow-hidden rounded-2xl bg-gray-900 shadow-2xl ring-1 ring-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full ${fonts.find(f => f.id === store.getState().selectedFontId) ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]' : 'bg-gray-600'}`} />
                <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-gray-100 to-green-500">{t('fontStudio.title')}</h2>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {/* Top Section: Tabs (Fonts, Controls & Textures) */}
              <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col min-h-0 flex-1">
                  <TabsList className="bg-gray-900/50 border-b border-gray-800 p-1 mx-4 mt-4 mb-2 rounded-lg flex-shrink-0">
                    <TabsTrigger value="list" className="bg-white/5 text-white hover:bg-white/10 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                      <span className="flex items-center gap-2"><Layers size={16} /> {t('fontStudio.tabs.fonts')}</span>
                    </TabsTrigger>
                    <TabsTrigger value="controls" className="bg-white/5 text-white hover:bg-white/10 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                      <span className="flex items-center gap-2"><Palette size={16} /> {t('fontStudio.tabs.controls')}</span>
                    </TabsTrigger>
                    <TabsTrigger value="textures" className="bg-white/5 text-white hover:bg-white/10 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                      <span className="flex items-center gap-2"><Image size={16} /> {t('fontStudio.tabs.textures')}</span>
                    </TabsTrigger>
                  </TabsList>

                  <div className="flex-1 overflow-hidden px-4 pb-4 min-h-0">
                    <TabsContent value="list" className="h-full mt-0 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                      <FontListTab store={store} />
                    </TabsContent>
                    <TabsContent value="controls" className="h-full mt-0 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                      <ControlsTab store={store} onExportTTF={onExportTTF} />
                    </TabsContent>
                    <TabsContent value="textures" className="h-full mt-0 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                      <TextureTab store={store} />
                    </TabsContent>
                  </div>
                </Tabs>
              </div>

              {/* Bottom Section: Always-visible Preview */}
              <div className="border-t border-gray-800 bg-gray-900/50 px-4 py-3 flex-shrink-0">
                <FontPreviewTab store={store} />
              </div>

              {/* File Upload Bar */}
              <div className="border-t border-gray-800 p-4 bg-gray-900/50 flex-shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  onClick={openFilePicker}
                  className="w-full bg-gradient-to-r from-green-600 to-green-800 hover:from-green-500 hover:to-green-700 shadow-lg shadow-green-900/20"
                >
                  <Upload size={20} />
                  {t('fontStudio.uploadFont')}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default FontStudioModal;