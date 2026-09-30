'use client';

import React from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import type { EffectType } from '@/lib/animation';
import {
  VALORES_DEFECTO_EFECTO,
  valoresEfecto,
  type EfectoObjeto,
  type EfectoValores,
} from '@/lib/efectos-objeto';

/** Campos editables de cada tipo de efecto (en el orden en que se muestran). */
interface CampoFx {
  key: keyof EfectoValores;
  label: string;
  kind: 'color' | 'int' | 'float';
  min?: number;
  max?: number;
  step?: number;
}

const SECCIONES: Array<{ tipo: EffectType; titulo: string; campos: CampoFx[] }> = [
  {
    tipo: 'glow',
    titulo: 'Halo de neón (Glow)',
    campos: [
      { key: 'glowColor', label: 'Color', kind: 'color' },
      { key: 'glowIntensity', label: 'Intensidad', kind: 'float', min: 0, max: 3, step: 0.1 },
    ],
  },
  {
    tipo: 'sparks',
    titulo: 'Chispas (Sparks)',
    campos: [
      { key: 'sparksCount', label: 'Partículas', kind: 'int', min: 50, max: 500, step: 10 },
      { key: 'sparksSize', label: 'Tamaño', kind: 'float', min: 0.01, max: 0.2, step: 0.005 },
    ],
  },
  {
    tipo: 'fire',
    titulo: 'Llamas (Fire)',
    campos: [
      { key: 'fireCount', label: 'Partículas', kind: 'int', min: 50, max: 500, step: 10 },
      { key: 'fireSize', label: 'Tamaño', kind: 'float', min: 0.05, max: 0.3, step: 0.005 },
      { key: 'fireIntensity', label: 'Intensidad', kind: 'float', min: 0, max: 3, step: 0.1 },
    ],
  },
  {
    tipo: 'rain',
    titulo: 'Lluvia (Rain)',
    campos: [
      { key: 'rainCount', label: 'Gotas', kind: 'int', min: 100, max: 1000, step: 20 },
      { key: 'rainSpeed', label: 'Velocidad', kind: 'float', min: 1, max: 10, step: 0.2 },
    ],
  },
  {
    tipo: 'smoke',
    titulo: 'Humo (Smoke)',
    campos: [
      { key: 'smokeCount', label: 'Partículas', kind: 'int', min: 50, max: 500, step: 10 },
      { key: 'smokeSize', label: 'Tamaño', kind: 'float', min: 0.05, max: 0.5, step: 0.01 },
      { key: 'smokeColor', label: 'Color', kind: 'color' },
      { key: 'smokeRiseSpeed', label: 'Ascenso', kind: 'float', min: 0.1, max: 5, step: 0.1 },
    ],
  },
  {
    tipo: 'stars',
    titulo: 'Estrellas',
    campos: [{ key: 'starSize', label: 'Tamaño', kind: 'float', min: 0.3, max: 3, step: 0.1 }],
  },
];

interface FxConfigEditorProps {
  isOpen: boolean;
  onClose: () => void;
  /** Efectos de la selección actual: mapa objectId -> lista de efectos. */
  seleccion: Record<string, EfectoObjeto[] | undefined>;
  /** Cambio en lote de los valores de un tipo (aplica a todos los objetos
   *  de la selección que tengan ese efecto activo). */
  onValores: (tipo: EffectType, valores: EfectoValores) => void;
}

/** Etiqueta "(mixto)" que se muestra cuando los objetos seleccionados
 *  tienen valores distintos para el mismo campo. */
const Mixto: React.FC = () => (
  <span className="text-[10px] text-amber-400 italic" title="Los objetos seleccionados tienen valores distintos">
    (mixto)
  </span>
);

const ColorField: React.FC<{
  label: string;
  value: string;
  mixto?: boolean;
  onChange: (v: string) => void;
}> = ({ label, value, mixto, onChange }) => {
  const safeValue = typeof value === 'string' && value.length > 0 ? value : '#000000';
  return (
    <div className="flex items-center gap-2 col-span-2">
      <label className="w-24 text-xs text-gray-400">
        {label} {mixto && <Mixto />}
      </label>
      <input
        type="color"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-6 p-0 border rounded cursor-pointer bg-gray-800 border-gray-600"
      />
      <input
        type="text"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 text-xs text-gray-300 bg-gray-800 border border-gray-600 rounded px-1 py-0.5"
      />
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  mixto?: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 1, mixto, onChange }) => {
  const safeValue = Number.isFinite(value) ? Math.round(value) : Math.round(min);
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeStep = Number.isFinite(step) ? step : 1;
  const safeOnChange = (v: number) => {
    if (Number.isFinite(v)) onChange(v);
  };
  return (
    <div className="flex items-center gap-2 col-span-2">
      <label className="w-24 text-xs text-gray-400">
        {label} {mixto && <Mixto />}
      </label>
      <Slider
        min={safeMin}
        max={safeMax}
        step={safeStep}
        value={[safeValue]}
        onValueChange={([v]) => safeOnChange(v)}
        className="flex-1"
      />
      <input
        type="number"
        value={safeValue}
        onChange={(e) => {
          const num = Number(e.target.value);
          if (!Number.isNaN(num)) safeOnChange(num);
        }}
        min={safeMin}
        max={safeMax}
        className="w-12 text-xs text-gray-300 bg-gray-800 border border-gray-600 rounded px-1 py-0.5"
      />
    </div>
  );
};

const FloatField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  mixto?: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 0.1, mixto, onChange }) => {
  const safeValue = Number.isFinite(value) ? value : min;
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 1;
  const safeStep = Number.isFinite(step) ? step : 0.1;
  const safeOnChange = (v: number) => {
    if (Number.isFinite(v)) onChange(v);
  };
  return (
    <div className="flex items-center gap-2 col-span-2">
      <label className="w-24 text-xs text-gray-400">
        {label} {mixto && <Mixto />}
      </label>
      <Slider
        min={safeMin}
        max={safeMax}
        step={safeStep}
        value={[safeValue]}
        onValueChange={([v]) => safeOnChange(v)}
        className="flex-1"
      />
      <input
        type="number"
        value={safeValue}
        onChange={(e) => {
          const num = Number(e.target.value);
          if (!Number.isNaN(num)) safeOnChange(num);
        }}
        min={safeMin}
        max={safeMax}
        step={safeStep}
        className="w-14 text-xs text-gray-300 bg-gray-800 border border-gray-600 rounded px-1 py-0.5"
      />
    </div>
  );
};

export const FxConfigEditor: React.FC<FxConfigEditorProps> = ({
  isOpen,
  onClose,
  seleccion,
  onValores,
}) => {
  // Para cada tipo: los efectos activos de ese tipo en la selección.
  const porTipo = React.useMemo(() => {
    const out: Partial<Record<EffectType, EfectoObjeto[]>> = {};
    for (const lista of Object.values(seleccion)) {
      for (const e of lista ?? []) {
        if (!e.activo) continue;
        (out[e.tipo] ??= []).push(e);
      }
    }
    return out;
  }, [seleccion]);

  const visibles = SECCIONES.filter((s) => (porTipo[s.tipo]?.length ?? 0) > 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración de efectos visuales"
      description="Ajusta los parámetros de cada efecto. Los cambios se aplican a todos los objetos seleccionados al instante."
      size="lg"
    >
      <ModalBody className="space-y-5">
        {visibles.length === 0 && (
          <p className="text-xs text-gray-500">
            Ningún objeto de la selección tiene efectos activos. Añade efectos desde el menú FX.
          </p>
        )}
        {visibles.map(({ tipo, titulo, campos }) => {
          const efectos = porTipo[tipo] ?? [];
          const enVarios = efectos.length > 1;
          return (
            <div key={tipo} className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-white">{titulo}</h4>
                {enVarios && (
                  <span className="text-[10px] text-gray-500">
                    en {efectos.length} objetos
                  </span>
                )}
              </div>
              <div className="grid grid-cols-[auto,1fr] gap-3">
                {campos.map((campo) => {
                  // Valor actual del campo en cada efecto (con los defectos
                  // del tipo completados).
                  const valores = efectos.map((e) => valoresEfecto(e)[campo.key]);
                  const mixto =
                    valores.length > 1 &&
                    valores.some((v) => v !== valores[0]);
                  const valor = valores.length > 0 ? valores[0] : VALORES_DEFECTO_EFECTO[tipo][campo.key];
                  const cambiar = (v: string | number) =>
                    onValores(tipo, { [campo.key]: v } as EfectoValores);
                  if (campo.kind === 'color') {
                    return (
                      <ColorField
                        key={campo.key}
                        label={campo.label}
                        value={typeof valor === 'string' ? valor : '#000000'}
                        mixto={mixto}
                        onChange={cambiar}
                      />
                    );
                  }
                  if (campo.kind === 'int') {
                    return (
                      <NumberField
                        key={campo.key}
                        label={campo.label}
                        value={typeof valor === 'number' ? valor : 0}
                        min={campo.min ?? 0}
                        max={campo.max ?? 100}
                        step={campo.step}
                        mixto={mixto}
                        onChange={cambiar}
                      />
                    );
                  }
                  return (
                    <FloatField
                      key={campo.key}
                      label={campo.label}
                      value={typeof valor === 'number' ? valor : 0}
                      min={campo.min ?? 0}
                      max={campo.max ?? 1}
                      step={campo.step}
                      mixto={mixto}
                      onChange={cambiar}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 text-sm text-gray-300 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700"
        >
          Cerrar
        </button>
      </ModalFooter>
    </Modal>
  );
};

FxConfigEditor.displayName = 'FxConfigEditor';