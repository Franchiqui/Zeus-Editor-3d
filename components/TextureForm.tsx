'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Texture, TextureType, TextureFormData } from '@/types';
import { useTexturesStore } from '@/store/textures';
import { useRouter } from 'next/navigation';
import { X, Save, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';

// Define Zod Schema for better type safety and validation
const textureFormSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  type: z.enum(['glass', 'water', 'wood', 'metal', 'concrete', 'plastic']),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Debe ser un código de color hexadecimal válido'),
  // El mosaico guardado usa opacidad 0..1; el slider trabaja en %.
  opacity: z.number().min(0).max(100),
  roughness: z.number().min(0).max(1),
});

type TextureFormValues = z.infer<typeof textureFormSchema>;

interface TextureFormProps {
  initialData?: Texture;
  mode?: 'create' | 'edit';
}

export default function TextureForm({ initialData, mode = 'create' }: TextureFormProps) {
  const router = useRouter();
  const addTexture = useTexturesStore((state) => state.addTexture);
  const updateTexture = useTexturesStore((state) => state.updateTexture);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setValue,
  } = useForm<TextureFormValues>({
    resolver: zodResolver(textureFormSchema),
    defaultValues: initialData
      ? {
          name: initialData.name,
          type: initialData.type,
          description: initialData.description,
          color: initialData.color,
          opacity: initialData.opacity * 100,
          roughness: initialData.roughness,
        }
      : {
          name: '',
          type: 'glass',
          description: '',
          color: '#4ecdc4',
          opacity: 50,
          roughness: 0.5,
        },
  });

  const onSubmit = async (data: TextureFormValues) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const textureData: TextureFormData = {
        name: data.name,
        type: data.type,
        description: data.description,
        color: data.color,
        opacity: data.opacity / 100,
        roughness: data.roughness,
      };
      if (mode === 'create') {
        await addTexture(textureData);
      } else if (initialData) {
        await updateTexture(initialData.id, textureData);
      }
      router.push('/edit-texturas');
    } catch (err) {
      setError('Error al guardar los datos. Inténtalo de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const watchColor = watch('color');
  const watchOpacity = watch('opacity');
  const watchRoughness = watch('roughness');
  const watchType = watch('type');

  const handleCancel = () => {
    router.push('/edit-texturas');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">
            {mode === 'create' ? 'Nueva Textura' : 'Editar Textura'}
          </h2>
          <p className="text-slate-400 text-sm">
            {mode === 'create' ? 'Crea una nueva textura para tu proyecto' : 'Modifica las propiedades de la textura'}
          </p>
        </div>
        <Button 
          type="button" 
          variant="ghost" 
          onClick={handleCancel}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Cancelar
        </Button>
      </div>

      {/* Card */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="p-6 space-y-6">
          
          {/* Name Field */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">Nombre</Label>
            <Input
              id="name"
              placeholder="Ej. Cristal Transparente"
              {...register('name')}
              className="bg-slate-950 border-slate-700 text-white focus:border-indigo-500 focus:ring-indigo-500"
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
          </div>

          {/* Type Field */}
          <div className="space-y-2">
            <Label htmlFor="type" className="text-slate-300">Tipo</Label>
            <Select 
              value={watchType} 
              onValueChange={(value) => setValue('type', value as TextureType)}
            >
              <SelectTrigger className="bg-slate-950 border-slate-700 text-white focus:border-indigo-500 focus:ring-indigo-500">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent className="bg-slate-950 border-slate-700 text-slate-200">
                <SelectItem value="glass" className="hover:bg-slate-800">Cristal</SelectItem>
                <SelectItem value="water" className="hover:bg-slate-800">Agua</SelectItem>
                <SelectItem value="wood" className="hover:bg-slate-800">Madera</SelectItem>
                <SelectItem value="metal" className="hover:bg-slate-800">Metal</SelectItem>
                <SelectItem value="concrete" className="hover:bg-slate-800">Hormigón</SelectItem>
                <SelectItem value="plastic" className="hover:bg-slate-800">Plástico</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-slate-300">Descripción</Label>
            <Textarea
              id="description"
              placeholder="Describe las propiedades de esta textura..."
              {...register('description')}
              className="bg-slate-950 border-slate-700 text-white focus:border-indigo-500 focus:ring-indigo-500 min-h-[80px]"
            />
            {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description.message}</p>}
          </div>

          {/* Color Field */}
          <div className="space-y-2">
            <Label htmlFor="color" className="text-slate-300">Color Base</Label>
            <div className="flex gap-3 items-center">
              <div
                className="w-10 h-10 rounded-lg border border-slate-700 cursor-pointer overflow-hidden"
                style={{ backgroundColor: watchColor }}
              />
              <Input
                id="color"
                type="text"
                placeholder="#FF0000"
                {...register('color')}
                className="bg-slate-950 border-slate-700 text-white font-mono focus:border-indigo-500 focus:ring-indigo-500"
              />
              <input
                type="color"
                value={watchColor.startsWith('#') ? watchColor : '#ffffff'}
                onChange={(e) => setValue('color', e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-slate-700 bg-transparent p-0"
              />
            </div>
            {errors.color && <p className="text-red-400 text-xs mt-1">{errors.color.message}</p>}
          </div>

          {/* Opacity Slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="opacity" className="text-slate-300">Opacidad</Label>
              <span className="text-slate-300 font-medium">{watchOpacity}%</span>
            </div>
            <Slider
              id="opacity"
              min={0}
              max={100}
              step={1}
              value={[watchOpacity]}
              onValueChange={(value) => setValue('opacity', value[0])}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Roughness Slider */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="roughness" className="text-slate-300">Rugosidad</Label>
              <span className="text-slate-300 font-medium">{watchRoughness.toFixed(2)}</span>
            </div>
            <Slider
              id="roughness"
              min={0}
              max={1}
              step={0.01}
              value={[watchRoughness]}
              onValueChange={(value) => setValue('roughness', value[0])}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>Liso</span>
              <span>Rugoso</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form Actions */}
      <div className="p-6 border-t border-slate-800 flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={handleCancel}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X className="h-4 w-4 mr-2" />
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          <Save className="h-4 w-4 mr-2" />
          {isSubmitting ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
      </form>
    );
}
