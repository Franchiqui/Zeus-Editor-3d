'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Disposición de las copias: fila recta o círculo. */
export type CalcCopiesLayout = 'linea' | 'circulo';

/**
 * Parámetros completos de «Copias calculadas». El cálculo de las
 * transformadas lo hace el editor (necesita la malla y el contexto de la
 * escena); este modal solo recoge los valores del usuario.
 */
export type CalculatedCopiesParams = {
  /** Copias a crear (sin contar el original) */
  count: number;
  layout: CalcCopiesLayout;
  /* ── Línea recta ── */
  axis: 'x' | 'y' | 'z';
  /** Separación entre copias (unidades del mundo) */
  spacing: number;
  /** Suma el tamaño del objeto a la separación (copia pegada a copia) */
  autoSpacing: boolean;
  /* ── Círculo ── */
  plane: 'xz' | 'xy' | 'yz';
  radius: number;
  /** Ángulo inicial de la distribución, en grados */
  startAngle: number;
  /** Arco a repartir entre las copias, en grados (360 = círculo completo) */
  arc: number;
  /** Girar cada copia para que mire siguiendo la curva */
  orient: boolean;
  /* ── Opciones avanzadas ── */
  /** Grados extra de rotación por copia, por eje */
  rotStepX: number;
  rotStepY: number;
  rotStepZ: number;
  /** % de cambio de escala acumulado por copia */
  scaleStep: number;
  /** Añadir una variación aleatoria (posición, giro y escala) */
  random: boolean;
  /** Amplitud de la variación aleatoria */
  randomAmount: number;
  /** Semilla de la variación: misma semilla + mismos parámetros = mismo resultado */
  seed: number;
};

/** Tamaño de la caja envolvente del objeto de origen, por eje (escala incluida). */
export type CalcCopiesSize = { x: number; y: number; z: number };

interface CalculatedCopiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Nombre del objeto principal (o del grupo) para el resumen */
  objectName: string | null;
  /** Cuántos objetos hay seleccionados: >1 replica toda la selección */
  objectCount: number;
  /** Tamaño del objeto/selección en el mundo, por eje. Permite mostrar el paso efectivo. */
  objectSize: CalcCopiesSize | null;
  /** Crea las copias en la escena con estos parámetros. */
  onApply: (params: CalculatedCopiesParams) => void;
}

const DEFAULTS: CalculatedCopiesParams = {
  count: 5,
  layout: 'linea',
  axis: 'x',
  spacing: 1.5,
  autoSpacing: true,
  plane: 'xz',
  radius: 3,
  startAngle: 0,
  arc: 360,
  orient: true,
  rotStepX: 0,
  rotStepY: 0,
  rotStepZ: 0,
  scaleStep: 0,
  random: false,
  randomAmount: 0.3,
  seed: 1,
};

/** Pequeño campo numérico con etiqueta, estilo común del editor. */
function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className ?? ''}`}>
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-cyan-500"
      />
    </label>
  );
}

/**
 * Modal «Copias calculadas»: genera N copias del objeto seleccionado
 * dispuestas en línea recta o en círculo, con separación, rotación y
 * escalado configurables (más una variación aleatoria opcional). El
 * editor resuelve las transformadas; aquí solo se eligen los valores.
 */
export default function CalculatedCopiesModal({
  isOpen,
  onClose,
  objectName,
  objectCount,
  objectSize,
  onApply,
}: CalculatedCopiesModalProps) {
  const { t } = useI18n();
  const [params, setParams] = useState<CalculatedCopiesParams>(DEFAULTS);

  // Al reabrir el modal, arranca con los valores por defecto (cada
  // lote se configura desde cero).
  useEffect(() => {
    if (isOpen) setParams({ ...DEFAULTS });
  }, [isOpen]);

  const set = <K extends keyof CalculatedCopiesParams>(
    key: K,
    value: CalculatedCopiesParams[K]
  ) => setParams((prev) => ({ ...prev, [key]: value }));

  const esLinea = params.layout === 'linea';

  // Paso efectivo en el eje elegido cuando la separación es automática:
  // tamaño del objeto en ese eje + separación pedida.
  const pasoEfectivo =
    params.autoSpacing && objectSize
      ? objectSize[params.axis] + params.spacing
      : params.spacing;

  const mayApply = params.count >= 1 && params.spacing > 0 && params.radius >= 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      bodyClassName="modal-scrollbar"
    >
      <div className="flex flex-col gap-4 p-1 w-full max-w-lg text-foreground">
        {/* Cabecera */}
        <div className="flex items-center gap-3 border-b border-white/10 pb-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Copy className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              {t('editor3D.calcCopies.title')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('editor3D.calcCopies.desc')}
            </p>
          </div>
        </div>

        {/* Resumen */}
        <p className="text-[11px] text-muted-foreground bg-black/30 border border-white/5 rounded-md px-3 py-2">
          {objectCount > 1
            ? t('editor3D.calcCopies.willCreateMulti', {
                count: params.count,
                objects: objectCount,
              })
            : t('editor3D.calcCopies.willCreate', {
                count: params.count,
                name: objectName ?? t('editor3D.defaultObjectName'),
              })}
        </p>

        {/* Cantidad */}
        <NumField
          label={t('editor3D.calcCopies.count')}
          value={params.count}
          onChange={(v) => set('count', Math.max(1, Math.min(500, Math.round(v))))}
          step={1}
          min={1}
          max={500}
        />

        {/* Disposición: línea / círculo */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            {t('editor3D.calcCopies.layout')}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'linea', label: t('editor3D.calcCopies.line') },
              { id: 'circulo', label: t('editor3D.calcCopies.circle') },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => set('layout', opt.id)}
                data-testid={`calc-copies-layout-${opt.id}`}
                className={`px-3 py-2 rounded-md text-xs font-semibold border transition-colors ${
                  params.layout === opt.id
                    ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                    : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {esLinea ? (
          /* ─── Opciones de línea recta ─── */
          <div className="flex flex-col gap-3 bg-black/30 p-3.5 rounded-xl border border-white/5">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                {t('editor3D.calcCopies.direction')}
              </span>
              <select
                value={params.axis}
                onChange={(e) => set('axis', e.target.value as CalculatedCopiesParams['axis'])}
                data-testid="calc-copies-axis"
                className="bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-cyan-500"
              >
                <option value="x">{t('editor3D.calcCopies.dirX')}</option>
                <option value="y">{t('editor3D.calcCopies.dirY')}</option>
                <option value="z">{t('editor3D.calcCopies.dirZ')}</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label={t('editor3D.calcCopies.spacing')}
                value={params.spacing}
                onChange={(v) => set('spacing', v)}
                min={0.01}
              />
              <div className="flex flex-col justify-end gap-1">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={params.autoSpacing}
                    onChange={(e) => set('autoSpacing', e.target.checked)}
                    className="accent-cyan-500"
                  />
                  {t('editor3D.calcCopies.autoSpacing')}
                </label>
                {params.autoSpacing && objectSize && (
                  <span className="text-[10px] text-cyan-300/80 font-mono">
                    {t('editor3D.calcCopies.effectiveStep', { value: pasoEfectivo.toFixed(2) })}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ─── Opciones de círculo ─── */
          <div className="flex flex-col gap-3 bg-black/30 p-3.5 rounded-xl border border-white/5">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                {t('editor3D.calcCopies.plane')}
              </span>
              <select
                value={params.plane}
                onChange={(e) => set('plane', e.target.value as CalculatedCopiesParams['plane'])}
                data-testid="calc-copies-plane"
                className="bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-cyan-500"
              >
                <option value="xz">{t('editor3D.calcCopies.planeXZ')}</option>
                <option value="xy">{t('editor3D.calcCopies.planeXY')}</option>
                <option value="yz">{t('editor3D.calcCopies.planeYZ')}</option>
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <NumField
                label={t('editor3D.calcCopies.radius')}
                value={params.radius}
                onChange={(v) => set('radius', v)}
                min={0.01}
              />
              <NumField
                label={t('editor3D.calcCopies.startAngle')}
                value={params.startAngle}
                onChange={(v) => set('startAngle', v)}
                step={15}
              />
              <NumField
                label={t('editor3D.calcCopies.arc')}
                value={params.arc}
                onChange={(v) => set('arc', Math.max(1, Math.min(360, v)))}
                step={15}
                min={1}
                max={360}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={params.orient}
                onChange={(e) => set('orient', e.target.checked)}
                className="accent-cyan-500"
              />
              {t('editor3D.calcCopies.orient')}
            </label>
          </div>
        )}

        {/* Opciones avanzadas */}
        <details className="group bg-black/30 border border-white/5 rounded-xl px-3.5 py-2.5">
          <summary className="text-xs font-semibold text-foreground cursor-pointer select-none flex items-center gap-2 list-none">
            <span className={`text-cyan-400 transition-transform group-open:rotate-90`}>▸</span>
            {t('editor3D.calcCopies.advanced')}
          </summary>
          <div className="flex flex-col gap-3 pt-3">
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                {t('editor3D.calcCopies.rotStep')}
              </span>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <NumField
                  label="X"
                  value={params.rotStepX}
                  onChange={(v) => set('rotStepX', v)}
                  step={5}
                />
                <NumField
                  label="Y"
                  value={params.rotStepY}
                  onChange={(v) => set('rotStepY', v)}
                  step={5}
                />
                <NumField
                  label="Z"
                  value={params.rotStepZ}
                  onChange={(v) => set('rotStepZ', v)}
                  step={5}
                />
              </div>
            </div>
            <NumField
              label={t('editor3D.calcCopies.scaleStep')}
              value={params.scaleStep}
              onChange={(v) => set('scaleStep', v)}
              step={2}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={params.random}
                onChange={(e) => set('random', e.target.checked)}
                className="accent-cyan-500"
              />
              {t('editor3D.calcCopies.random')}
            </label>
            {params.random && (
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label={t('editor3D.calcCopies.randomAmount')}
                  value={params.randomAmount}
                  onChange={(v) => set('randomAmount', Math.max(0.01, v))}
                  min={0.01}
                />
                <NumField
                  label={t('editor3D.calcCopies.seed')}
                  value={params.seed}
                  onChange={(v) => set('seed', Math.max(1, Math.round(v)))}
                  step={1}
                  min={1}
                />
              </div>
            )}
          </div>
        </details>

        {/* Botones */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors"
          >
            {t('editor3D.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onApply(params)}
            disabled={!mayApply}
            data-testid="calc-copies-create"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-white shadow-md shadow-cyan-500/20 transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            <Copy className="w-3.5 h-3.5" />
            {t('editor3D.calcCopies.create')}
          </button>
        </div>
      </div>
    </Modal>
  );
}