'use client';

/**
 * Modal para CREAR (o editar) una textura en el Editor 3D, derivado de
 * la app Crear Texturas (app/edit-texturas). Guarda en la misma clave
 * localStorage ('textures_db'), así que la textura aparece tanto en el
 * explorador de Texturas del editor como en la página /edit-texturas.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  CreatedTexture,
  CreatedTextureType,
  CREATED_TYPE_LABELS,
  readCreatedTextures,
  renderTextureTile,
  saveCreatedTexture,
} from '@/lib/texture-generator';

interface CreateTextureModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Si llega una textura, el modal edita en lugar de crear. */
  initialData?: CreatedTexture | null;
  /** Se avisa tras guardar (crear o editar) para que la escena refresque. */
  onSaved?: () => void;
}

const TEXTURE_TYPES: CreatedTextureType[] = ['glass', 'water', 'wood', 'metal', 'concrete', 'plastic'];

const DEFAULT_FORM = {
  name: '',
  type: 'glass' as CreatedTextureType,
  color: '#4ecdc4',
  opacity: 0.5,
  roughness: 0.5,
};

export default function CreateTextureModal({
  isOpen,
  onClose,
  initialData = null,
  onSaved,
}: CreateTextureModalProps) {
  const [name, setName] = useState(DEFAULT_FORM.name);
  const [type, setType] = useState<CreatedTextureType>(DEFAULT_FORM.type);
  const [color, setColor] = useState(DEFAULT_FORM.color);
  const [opacity, setOpacity] = useState(DEFAULT_FORM.opacity);
  const [roughness, setRoughness] = useState(DEFAULT_FORM.roughness);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Al abrir el modal se carga el formulario: con initialData se edita.
  useEffect(() => {
    if (!isOpen) return;
    if (initialData) {
      setName(initialData.name);
      setType(initialData.type);
      setColor(initialData.color);
      setOpacity(initialData.opacity);
      setRoughness(initialData.roughness);
      setEditingId(initialData.id);
    } else {
      setName('');
      setType(DEFAULT_FORM.type);
      setColor(DEFAULT_FORM.color);
      setOpacity(DEFAULT_FORM.opacity);
      setRoughness(DEFAULT_FORM.roughness);
      setEditingId(null);
    }
  }, [isOpen, initialData]);

  // Vista previa en vivo del mosaico resultante.
  const tile = useMemo(() => {
    if (!isOpen) return '';
    try {
      return renderTextureTile({ id: editingId || 'preview', name, type, color, opacity, roughness });
    } catch {
      return '';
    }
  }, [isOpen, editingId, name, type, color, opacity, roughness]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) return;
    if (editingId) {
      // Editar: sustituye la entrada en la lista guardada.
      const list = readCreatedTextures().map((t) =>
        t.id === editingId ? { ...t, name: cleanName, type, color, opacity, roughness } : t
      );
      try {
        window.localStorage.setItem('textures_db', JSON.stringify(list));
      } catch (err) {
        console.error('No se pudo guardar la textura:', err);
      }
    } else {
      saveCreatedTexture({ name: cleanName, type, color, opacity, roughness });
    }
    onSaved?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingId ? 'Editar textura' : 'Crear textura'}
      description={
        editingId
          ? 'Modifica la textura guardada: los cambios se reflejan en el explorador de Texturas.'
          : 'La textura se guardará en el explorador de Texturas, lista para usarla en suelo, objetos y caras.'
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Nombre */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-300">Nombre</label>
          <input
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-green-500/60 focus:border-transparent outline-none transition-all"
            placeholder="Ej: Cristal Azul"
          />
        </div>

        {/* Tipo de material */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-300">Tipo de material</label>
          <div className="grid grid-cols-3 gap-2">
            {TEXTURE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'px-2 py-2 text-xs font-medium rounded-lg border transition-all',
                  type === t
                    ? 'bg-green-500/20 border-green-500/40 text-green-300'
                    : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5 hover:text-gray-200'
                )}
              >
                {CREATED_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Vista previa del mosaico */}
        {tile && (
          <div className="flex items-center gap-3">
            <img
              src={tile}
              alt="Vista previa de la textura"
              className="w-16 h-16 rounded-lg border border-white/10 object-cover"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2a35 25%, transparent 25%), linear-gradient(-45deg, #2a2a35 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a35 75%), linear-gradient(-45deg, transparent 75%, #2a2a35 75%)',
                backgroundSize: '12px 12px',
                backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
              }}
            />
            <p className="text-[11px] text-gray-500">
              Así se verá el mosaico de la textura en el editor.
            </p>
          </div>
        )}

        {/* Color */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-300">Color base</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#ffffff'}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-10 rounded cursor-pointer border border-white/10 bg-transparent p-0"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:ring-2 focus:ring-green-500/60 outline-none"
            />
          </div>
        </div>

        {/* Opacidad */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-xs font-medium text-gray-300">Opacidad</label>
            <span className="text-xs text-gray-400">{Math.round(opacity * 100)}%</span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[opacity]}
            onValueChange={([v]) => setOpacity(v)}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>Transparente</span>
            <span>Sólido</span>
          </div>
        </div>

        {/* Rugosidad */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-xs font-medium text-gray-300">Rugosidad</label>
            <span className="text-xs text-gray-400">{Math.round(roughness * 100)}%</span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[roughness]}
            onValueChange={([v]) => setRoughness(v)}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>Liso</span>
            <span>Rugoso</span>
          </div>
        </div>

        {/* Acciones */}
        <div className="pt-2 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/5 text-gray-300 rounded-lg hover:bg-white/10 transition-colors font-medium text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors font-medium text-sm"
          >
            {editingId ? 'Guardar cambios' : 'Crear textura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}