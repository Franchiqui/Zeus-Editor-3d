'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download,
  Plus, 
  Trash2, 
  Search, 
  X, 
  Layers, 
  Sparkles, 
  Droplet, 
   Box, 
   Palette,
   Edit,
   Eye
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils'; // Assuming standard utility
import TexturePreview from '@/components/TexturePreview';

// --- TYPES & SCHEMAS ---

const textureTypes = ['glass', 'water', 'wood', 'metal', 'concrete', 'plastic'] as const;
type TextureType = typeof textureTypes[number];

interface Texture {
  id: string;
  name: string;
  type: TextureType;
  color: string;
  opacity: number;
  roughness: number;
}

const textureSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  type: z.enum(textureTypes),
  color: z.string().min(1, 'Selecciona un color'),
  opacity: z.number().min(0).max(1),
  roughness: z.number().min(0).max(1),
});

type FormValues = z.infer<typeof textureSchema>;

// --- STORE LOGIC (ZUSTAND) ---

interface TextureStore {
  textures: Texture[];
  addTexture: (texture: Omit<Texture, 'id'>) => void;
  updateTexture: (id: string, texture: Partial<Texture>) => void;
  deleteTexture: (id: string) => void;
  loadTextures: () => void;
}

const useTexturesStore = create<TextureStore>((set, get) => ({
  textures: [],
  addTexture: (texture) => set((state) => {
    const textures = [...state.textures, { ...texture, id: crypto.randomUUID() }];
    localStorage.setItem('textures_db', JSON.stringify(textures));
    return { textures };
  }),
  updateTexture: (id, texture) => set((state) => {
    const textures = state.textures.map(t => t.id === id ? { ...t, ...texture } : t);
    localStorage.setItem('textures_db', JSON.stringify(textures));
    return { textures };
  }),
  deleteTexture: (id) => set((state) => {
    const textures = state.textures.filter(t => t.id !== id);
    localStorage.setItem('textures_db', JSON.stringify(textures));
    return { textures };
  }),
  loadTextures: () => {
    const saved = localStorage.getItem('textures_db');
    if (saved) {
      try {
        set({ textures: JSON.parse(saved) });
      } catch (e) {
        console.error("Error parsing textures", e);
      }
    }
  }
}));

// --- SUB-COMPONENTS ---

const TextureCard = ({ texture, onDelete, onDownload, onPreview, onEdit }: { texture: Texture; onDelete: (id: string) => void; onDownload: (texture: Texture) => void; onPreview: (texture: Texture) => void; onEdit: (texture: Texture) => void }) => {
  const getTypeIcon = (type: TextureType) => {
    switch (type) {
      case 'glass': return <Sparkles className="w-5 h-5 text-blue-400" />;
      case 'water': return <Droplet className="w-5 h-5 text-cyan-400" />;
      case 'wood': return <Box className="w-5 h-5 text-amber-600" />;
      case 'metal': return <Palette className="w-5 h-5 text-slate-400" />;
      default: return <Layers className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn(
        "group relative bg-slate-800 rounded-xl overflow-hidden shadow-lg border border-slate-700 hover:border-slate-500 transition-all duration-300",
        "flex flex-col h-full"
      )}
    >
      {/* Preview Area */}
      <div className="h-48 bg-slate-900 relative flex items-center justify-center overflow-hidden">
        <div 
          className="w-32 h-32 rounded-lg shadow-inner transition-transform duration-500 group-hover:scale-110"
          style={{ 
            backgroundColor: texture.color, 
            opacity: texture.opacity,
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3Ccircle cx='13' cy='13' r='3'/%3E%3C/g%3E%3C/svg%3E")`,
            filter: `blur(${(1 - texture.roughness) * 20}px)`
          }}
        />
        <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-mono text-slate-300 border border-slate-700">
          {texture.type.toUpperCase()}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="text-lg font-bold text-white mb-1 truncate">{texture.name}</h3>
        <p className="text-sm text-slate-400 mb-4">
          Roughness: {(texture.roughness * 100).toFixed(0)}%
        </p>
        
        <div className="mt-auto flex items-center justify-between pt-4 border-t border-slate-700">
          <div className="flex items-center gap-2 text-slate-500">
            {getTypeIcon(texture.type)}
          </div>
           <button 
            onClick={() => onDelete(texture.id)}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            aria-label="Eliminar textura"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <button 
            onClick={() => onPreview(texture)}
            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"
            aria-label="Vista previa 3D"
          >
            <Eye className="w-5 h-5" />
          </button>
          <button 
            onClick={() => onEdit(texture)}
            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"
            aria-label="Editar textura"
          >
            <Edit className="w-5 h-5" />
          </button>
          <button 
            onClick={() => onDownload(texture)}
            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"
            aria-label="Descargar textura"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const TextureModal = ({ 
  isOpen, 
  onClose, 
  initialData 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  initialData?: Texture | null 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<FormValues>({
    name: '',
    type: 'glass',
    color: '#ffffff',
    opacity: 0.5,
    roughness: 0.5
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name,
        type: initialData.type,
        color: initialData.color,
        opacity: initialData.opacity,
        roughness: initialData.roughness
      });
      setIsEditing(true);
    } else {
      setIsEditing(false);
    }
  }, [initialData, isOpen]);

  const handleSubmit = (data: FormValues) => {
    if (isEditing && initialData) {
      useTexturesStore.getState().updateTexture(initialData.id, data);
    } else {
      useTexturesStore.getState().addTexture(data);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-0 right-0 md:bottom-12 md:right-12 w-full md:w-[450px] bg-slate-900 border border-slate-700 rounded-t-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {isEditing ? 'Editar Textura' : 'Nueva Textura'}
              </h2>
              <button onClick={onClose} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form 
              onSubmit={(e) => { e.preventDefault(); handleSubmit(formData); }}
              className="p-6 space-y-5 overflow-y-auto"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Nombre</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="Ej: Cristal Azul"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Tipo de Material</label>
                <div className="grid grid-cols-3 gap-2">
                  {textureTypes.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormData({ ...formData, type })}
                      className={cn(
                        "px-2 py-2 text-xs font-medium rounded-lg border transition-all",
                        formData.type === type 
                          ? "bg-blue-600 border-blue-500 text-white" 
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                      )}
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Color Base</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color}
                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                    className="h-10 w-10 rounded cursor-pointer border border-slate-700 bg-transparent"
                  />
                  <input
                    type="text"
                    value={formData.color}
                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-300">Opacidad</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={formData.opacity}
                    onChange={e => setFormData({ ...formData, opacity: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Transparente</span>
                    <span>Sólido</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-300">Rugosidad</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={formData.roughness}
                    onChange={e => setFormData({ ...formData, roughness: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Liso</span>
                    <span>Rugoso</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium shadow-lg shadow-blue-900/20"
                >
                  {isEditing ? 'Guardar Cambios' : 'Crear Textura'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// --- MAIN PAGE COMPONENT ---

export default function CreateTexturesPage() {
  const textures = useTexturesStore((state) => state.textures);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTexture, setEditingTexture] = useState<Texture | null>(null);
  const [previewTexture, setPreviewTexture] = useState<Texture | null>(null);

  // Load data on mount
  useEffect(() => {
    useTexturesStore.getState().loadTextures();
  }, []);


  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormValues>({
    resolver: zodResolver(textureSchema),
    defaultValues: {
      name: '',
      type: 'glass',
      color: '#ffffff',
      opacity: 0.5,
      roughness: 0.5
    }
  });

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const filteredTextures = useMemo(() => {
    if (!debouncedSearchQuery) return textures;
    return textures.filter(t => t.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()));
  }, [textures, debouncedSearchQuery]);

  const handleDelete = (id: string) => {
    if (confirm('¿Estás seguro de eliminar esta textura?')) {
      useTexturesStore.getState().deleteTexture(id);
    }
  };

  const handleDownload = (texture: Texture) => {
    const data = {
      name: texture.name,
      type: texture.type,
      color: texture.color,
      opacity: texture.opacity,
      roughness: texture.roughness,
      metalness: texture.type === 'metal' ? 1 : 0,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${texture.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openAddModal = () => {
    setEditingTexture(null);
    setIsModalOpen(true);
  };

  const openEditModal = (texture: Texture) => {
    setEditingTexture(texture);
    setIsModalOpen(true);
  };

  const handlePreview = (texture: Texture) => {
    setPreviewTexture(texture);
  };

  const closePreview = () => {
    setPreviewTexture(null);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              CreateTextures
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 hidden sm:block">
              {textures.length} texturas activas
            </div>
            <button 
              onClick={openAddModal}
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium gap-2"
              aria-label="Crear nueva textura"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Crear Textura</span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Search Bar */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar texturas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
          />
        </div>

        {/* Grid */}
        {filteredTextures.length === 0 ? (
          <div className="text-center py-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
              <Box className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-slate-300">No hay texturas encontradas</h3>
            <p className="text-slate-500 mt-2 max-w-sm mx-auto">
              {searchQuery ? "Intenta con otro término de búsqueda." : "Crea tu primera textura para comenzar a modelar."}
            </p>
            {!searchQuery && (
              <button 
                onClick={openAddModal}
                className="mt-6 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Crear Textura
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredTextures.map(texture => (
                <TextureCard 
                  key={texture.id} 
                  texture={texture} 
                  onDelete={handleDelete} 
                  onDownload={handleDownload}
                  onPreview={handlePreview}
                  onEdit={openEditModal}
                />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      <TextureModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        initialData={editingTexture}
      />

      {/* 3D Preview Modal */}
      {previewTexture && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closePreview}
        >
          <div
            className="relative bg-slate-900 rounded-xl border border-slate-700 shadow-2xl w-full max-w-full md:max-w-6xl h-[85vh] md:h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button 
                onClick={closePreview}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                aria-label="Cerrar vista previa"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <TexturePreview 
              texture={{
                color: previewTexture.color,
                opacity: previewTexture.opacity,
                roughness: previewTexture.roughness,
                type: previewTexture.type,
              }}
            />
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <p className="text-slate-300 text-sm">{previewTexture.name}</p>
              <p className="text-slate-500 text-xs mt-1">
Type: {previewTexture.type} | Color: {previewTexture.color} | Opacity: {Math.round(previewTexture.opacity * 100)}% | Roughness: {Math.round(previewTexture.roughness * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

  
    </main>
  );
}