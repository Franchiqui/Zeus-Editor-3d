'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Texture } from '@/types';
import { renderTextureTile } from '@/lib/texture-generator';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Download,
  Eye,
  Heart,
  MoreHorizontal,
  Image as ImageIcon,
  FileImage,
  FileJson,
  FileType,
  FileX,
  FileArchive,
  Layers,
  Maximize2,
} from 'lucide-react';

// Componentes de utilidad para renderizar iconos según el tipo de textura
const getIconForType = (type: string) => {
  const t = type.toLowerCase();
  switch (true) {
    case t.includes('png'):
    case t.includes('jpg'):
    case t.includes('jpeg'):
      return <FileImage className="w-5 h-5" />;
    case t.includes('json'):
      return <FileJson className="w-5 h-5" />;
    case t.includes('zip'):
    case t.includes('rar'):
    case t.includes('7z'):
      return <FileArchive className="w-5 h-5" />;
    case t.includes('ppt'):
      return <FileType className="w-5 h-5" />;
    case t.includes('pdf'):
    case t.includes('doc'):
    case t.includes('docx'):
      return <FileX className="w-5 h-5" />;
    default:
      return <Layers className="w-5 h-5" />;
  }
};

interface TextureCardProps {
  texture: Texture;
  onDownload?: () => void;
  onFavorite?: (id: string) => void;
  isFavorite?: boolean;
}

export default function TextureCard({
  texture,
  onDownload,
  onFavorite,
  isFavorite = false,
}: TextureCardProps) {
  // Sin imageUrl se genera el mosaico de la textura creada en caliente.
  const tile = useMemo(() => {
    try {
      return texture.imageUrl || renderTextureTile(texture, 256);
    } catch {
      return '';
    }
  }, [texture]);
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getPreviewColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('png')) return 'bg-blue-500';
    if (t.includes('jpg')) return 'bg-yellow-500';
    if (t.includes('json')) return 'bg-green-500';
    if (t.includes('zip')) return 'bg-purple-500';
    return 'bg-slate-500';
  };

  return (
    <Card className="group relative flex flex-col h-full border-slate-800 bg-slate-900/40 hover:border-indigo-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/10 overflow-hidden">
      {/* Header Section */}
      <CardHeader className="p-0 relative">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/50 to-transparent z-10" />
        
        {/* Image Preview Area */}
        <div className="relative aspect-video w-full bg-slate-950 overflow-hidden">
          {texture.imageUrl || tile ? (
            <img
              src={texture.imageUrl || tile}
              alt={texture.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${getPreviewColor(texture.type)}`}>
              <ImageIcon className="w-12 h-12 text-white/80" />
            </div>
          )}
          
          {/* Overlay on Hover */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center z-20">
            <Button variant="secondary" size="sm" className="bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm">
              <Eye className="w-4 h-4 mr-2" />
              Vista Previa
            </Button>
          </div>
        </div>

        {/* Type Badge */}
        <div className="absolute top-3 right-3 z-20">
          <Badge variant="outline" className="border-slate-700 text-slate-300 bg-slate-900/80 backdrop-blur-sm">
            {texture.type}
          </Badge>
        </div>
      </CardHeader>

      {/* Content Section */}
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex justify-between items-start">
          <h3 className="font-semibold text-slate-100 line-clamp-1 text-lg">
            {texture.name}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-sm text-slate-400 line-clamp-2 flex-1">
          {texture.description || 'Sin descripción disponible'}
        </p>

        <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
          <div className="flex items-center gap-1">
            {getIconForType(texture.type)}
            <span>{texture.format}</span>
          </div>
          <div className="flex items-center gap-1">
            <Maximize2 className="w-3 h-3" />
            <span>{formatSize(texture.size || 0)}</span>
          </div>
        </div>
      </CardContent>

      {/* Footer Section */}
      <CardFooter className="p-2 pt-0 flex items-center justify-between border-t border-slate-800/50">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-9 w-9 rounded-full transition-colors',
            isFavorite ? 'text-red-500 hover:bg-red-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          )}
          onClick={() => onFavorite?.(texture.id)}
        >
          <Heart className={cn("w-4 h-4", isFavorite && "fill-current")} />
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white hover:border-slate-600"
          onClick={() => onDownload?.()}
        >
          <Download className="w-4 h-4 mr-2" />
          Descargar
        </Button>
      </CardFooter>
    </Card>
  );
}
