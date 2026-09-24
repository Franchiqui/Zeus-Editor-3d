'use client';

import type { ReactNode } from 'react';

type TFunction = (
  key: string,
  vars?: Record<string, string | number>
) => string;

export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];

/** Clave i18n de la etiqueta de cada eje (X/Y/Z, universales). */
export const AXIS_LABEL_KEY: Record<Axis, string> = {
  x: 'editor3D.axisX',
  y: 'editor3D.axisY',
  z: 'editor3D.axisZ',
};

/** Color convencional por eje (rojo = X, verde = Y, azul = Z). */
export const AXIS_COLOR: Record<Axis, string> = {
  x: 'text-red-400/80',
  y: 'text-green-400/80',
  z: 'text-blue-400/80',
};

type Props = {
  /** Traductor i18n (useI18n). */
  t: TFunction;
  /**
   * Clase de separación entre celdas. Debe coincidir con la de la fila de
   * campos para que cada rótulo caiga sobre su columna.
   */
  gap?: string;
  /** Elemento opcional que ocupa la columna de la etiqueta de la fila. */
  spacer?: ReactNode;
  /** Clases extra para la fila de cabecera (p. ej. márgenes). */
  className?: string;
  /** testid de la fila de cabecera. */
  testId?: string;
  /** Si se indica, cada eje recibe testid `${testIdPrefix}-${axis}`. */
  testIdPrefix?: string;
};

/**
 * Cabecera con los rótulos de eje (X/Y/Z) alineada con una fila de campos
 * de coordenadas. Se coloca sobre los campos de transformación del objeto
 * y sobre los campos de cámara (foco y fotogramas) para indicar a qué eje
 * pertenece cada columna. El color sigue la convención X=rojo, Y=verde,
 * Z=azul.
 */
export function AxisHeader({
  t,
  gap = 'gap-1.5',
  spacer,
  className,
  testId = 'axis-header',
  testIdPrefix,
}: Props) {
  return (
    <div
      className={`flex items-center ${gap}${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      {spacer ?? null}
      {AXES.map((axis) => (
        <span
          key={axis}
          className={`flex-1 min-w-0 text-center text-[9px] font-semibold uppercase tracking-wider ${AXIS_COLOR[axis]}`}
          data-testid={testIdPrefix ? `${testIdPrefix}-${axis}` : undefined}
        >
          {t(AXIS_LABEL_KEY[axis])}
        </span>
      ))}
    </div>
  );
}
