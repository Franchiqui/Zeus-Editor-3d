'use client';

import { Texture } from '@/types';
import TextureCard from '@/components/TextureCard';
import { Loader2, Plus, Grid3x3, Search } from 'lucide-react';
import { useTexturesStore } from '@/store/textures';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface TextureGridProps {
  title?: string;
  className?: string;
  showSearch?: boolean;
  searchPlaceholder?: string;
  isLoading?: boolean;
}

export default function TextureGrid({
  title = 'Biblioteca de Texturas',
  className,
  showSearch = true,
  searchPlaceholder = 'Buscar texturas...',
  isLoading = false,
}: TextureGridProps) {
  const textures = useTexturesStore((state) => state.textures);
  const loadTextures = useTexturesStore((state) => state.loadTextures);
  const [searchQuery, setSearchQuery] = useState('');

  // Carga la biblioteca guardada al montar (misma clave que /edit-texturas).
  useEffect(() => {
    loadTextures();
  }, [loadTextures]);

  const filteredTextures = textures.filter(
    (texture) =>
      texture.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (texture.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      texture.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={cn('w-full', className)}>
      {/* Header Section */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Grid3x3 className="w-6 h-6 text-indigo-400" />
            {title}
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {textures.length} texturas disponibles en el sistema
          </p>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={searchPlaceholder}
              className="w-full sm:w-64 pl-9 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
            />
          </div>
        )}
      </div>

      {/* Grid Container */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {/* Loading State */}
        {isLoading && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/30">
            <Loader2 className="w-12 h-12 text-slate-600 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-slate-300">Cargando texturas...</h3>
            <p className="text-slate-500 text-sm mt-2">Por favor espera un momento</p>
          </div>
        )}

        {/* Empty State */}
        {filteredTextures.length === 0 && textures.length > 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/30">
            <p className="text-lg font-medium text-slate-300">No se encontraron resultados</p>
            <p className="text-slate-500 text-sm mt-2">Intenta con otros términos de búsqueda</p>
          </div>
        )}

        {/* Texture Cards */}
        {filteredTextures.map((texture) => (
          <TextureCard key={texture.id} texture={texture} />
        ))}
      </div>
    </div>
  );
}