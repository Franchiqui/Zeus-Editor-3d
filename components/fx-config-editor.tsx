'use client';

import React from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import type { FxConfig } from '@/components/viewer-3d';

interface FxConfigEditorProps {
  isOpen: boolean;
  onClose: () => void;
  fxConfig: FxConfig;
  onFxChange: (fx: Partial<FxConfig>) => void;
}

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, value, onChange }) => {
  const safeValue = typeof value === 'string' && value.length > 0 ? value : '#000000';
  return (
  <div className="flex items-center gap-2 col-span-2">
    <label className="w-20 text-xs text-gray-400">{label}</label>
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
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => {
  const safeValue = Number.isFinite(value) ? Math.round(value) : Math.round(min);
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeStep = Number.isFinite(step) ? step : 1;
  const safeOnChange = (v: number) => {
    if (Number.isFinite(v)) onChange(v);
  };
  return (
  <div className="flex items-center gap-2 col-span-2">
    <label className="w-24 text-xs text-gray-400">{label}</label>
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
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 0.1, onChange }) => {
  const safeValue = Number.isFinite(value) ? value : min;
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 1;
  const safeStep = Number.isFinite(step) ? step : 0.1;
  const safeOnChange = (v: number) => {
    if (Number.isFinite(v)) onChange(v);
  };
  return (
  <div className="flex items-center gap-2 col-span-2">
    <label className="w-24 text-xs text-gray-400">{label}</label>
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
  fxConfig,
  onFxChange,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración de efectos visuales"
      description="Ajusta los parámetros de cada efecto. Los cambios se aplican al instante."
      size="lg"
    >
      <ModalBody className="space-y-5">
        {/* Glow */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Halo de neón (Glow)</h4>
            <label className="flex items-center gap-1 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={fxConfig.glow}
                onChange={(e) => onFxChange({ glow: e.target.checked })}
              />
              Activo
            </label>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-3">
            <ColorField
              label="Color"
              value={fxConfig.glowColor}
              onChange={(v) => onFxChange({ glowColor: v })}
            />
           <FloatField
               label="Intensidad"
               value={fxConfig.glowIntensity}
               min={0}
               max={3}
               step={0.1}
               onChange={(v) => onFxChange({ glowIntensity: v })}
             />
           </div>
           <label className="flex items-center gap-1 text-xs text-gray-300">
             <input
               type="checkbox"
               checked={fxConfig.glowObjects ?? false}
               onChange={(e) => onFxChange({ glowObjects: e.target.checked })}
             />
             Aplicar a objetos
           </label>
         </div>

        {/* Sparks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Chispas (Sparks)</h4>
            <label className="flex items-center gap-1 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={fxConfig.sparks}
                onChange={(e) => onFxChange({ sparks: e.target.checked })}
              />
              Activo
            </label>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-3">
            <NumberField
              label="Partículas"
              value={fxConfig.sparksCount}
              min={50}
              max={500}
              step={10}
              onChange={(v) => onFxChange({ sparksCount: v })}
            />
            <FloatField
              label="Tamaño"
              value={fxConfig.sparksSize}
              min={0.01}
              max={0.2}
              step={0.005}
              onChange={(v) => onFxChange({ sparksSize: v })}
            />
          </div>
        </div>

        {/* Fire */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Llamas (Fire)</h4>
            <label className="flex items-center gap-1 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={fxConfig.fire}
                onChange={(e) => onFxChange({ fire: e.target.checked })}
              />
              Activo
            </label>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-3">
            <NumberField
              label="Partículas"
              value={fxConfig.fireCount}
              min={50}
              max={500}
              step={10}
              onChange={(v) => onFxChange({ fireCount: v })}
            />
            <FloatField
              label="Tamaño"
              value={fxConfig.fireSize}
              min={0.05}
              max={0.3}
              step={0.005}
              onChange={(v) => onFxChange({ fireSize: v })}
            />
            <FloatField
              label="Intensidad"
              value={fxConfig.fireIntensity}
              min={0}
              max={3}
              step={0.1}
              onChange={(v) => onFxChange({ fireIntensity: v })}
            />
          </div>
        </div>

        {/* Rain */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Lluvia (Rain)</h4>
            <label className="flex items-center gap-1 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={fxConfig.rain}
                onChange={(e) => onFxChange({ rain: e.target.checked })}
              />
              Activo
            </label>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-3">
            <NumberField
              label="Gotas"
              value={fxConfig.rainCount}
              min={100}
              max={1000}
              step={20}
              onChange={(v) => onFxChange({ rainCount: v })}
            />
            <FloatField
              label="Velocidad"
              value={fxConfig.rainSpeed}
              min={1}
              max={10}
              step={0.2}
              onChange={(v) => onFxChange({ rainSpeed: v })}
            />
          </div>
        </div>

        {/* Smoke */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Humo (Smoke)</h4>
            <label className="flex items-center gap-1 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={fxConfig.smoke}
                onChange={(e) => onFxChange({ smoke: e.target.checked })}
              />
              Activo
            </label>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-3">
            <NumberField
              label="Partículas"
              value={fxConfig.smokeCount}
              min={50}
              max={500}
              step={10}
              onChange={(v) => onFxChange({ smokeCount: v })}
            />
            <FloatField
              label="Tamaño"
              value={fxConfig.smokeSize}
              min={0.05}
              max={0.5}
              step={0.01}
              onChange={(v) => onFxChange({ smokeSize: v })}
            />
            <ColorField
              label="Color"
              value={fxConfig.smokeColor}
              onChange={(v) => onFxChange({ smokeColor: v })}
            />
            <FloatField
              label="Ascenso"
              value={fxConfig.smokeRiseSpeed}
              min={0.1}
              max={5}
              step={0.1}
              onChange={(v) => onFxChange({ smokeRiseSpeed: v })}
            />
          </div>
        </div>
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
