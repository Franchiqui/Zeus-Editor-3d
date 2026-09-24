'use client';

import { useEffect, useRef, useState } from 'react';
import type { ObjectTransform } from '@/components/viewer-3d';
import { AxisHeader, AXES, type Axis } from './axis-header';

type TFunction = (
  key: string,
  vars?: Record<string, string | number>
) => string;

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const POS_KEY: Record<Axis, 'px' | 'py' | 'pz'> = {
  x: 'px',
  y: 'py',
  z: 'pz',
};
const ROT_KEY: Record<Axis, 'rx' | 'ry' | 'rz'> = {
  x: 'rx',
  y: 'ry',
  z: 'rz',
};
const SCALE_KEY: Record<Axis, 'sx' | 'sy' | 'sz'> = {
  x: 'sx',
  y: 'sy',
  z: 'sz',
};

/** Redondeo de presentación para no llenar el campo de decimales ruidosos. */
function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Campo numérico con buffer local de texto. Mantener el texto editado
 * mientras el input está enfocado evita que el valor controlado (que se
 * reformatea en cada render) "robe" el punto decimal o los ceros que el
 * usuario está escribiendo.
 */
function NumberInput({
  value,
  step,
  onCommit,
  testId,
  suffix,
}: {
  value: number;
  step: number;
  onCommit: (n: number) => void;
  testId: string;
  suffix?: string;
}) {
  const [text, setText] = useState(() => String(value));
  const focusedRef = useRef(false);

  // Sincroniza con cambios externos (p. ej. el gizmo) solo cuando no se edita.
  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  return (
    <div className="relative flex-1 min-w-0">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={text}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onCommit(n);
        }}
        className={`w-full min-w-0 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[11px] font-mono text-foreground focus:outline-none focus:border-green-500/50 ${
          suffix ? 'pr-4' : ''
        }`}
        data-testid={testId}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/70">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

type Props = {
  /** Transform actual del objeto seleccionado (pos/rot/escala). */
  transform: ObjectTransform;
  /** Se llama con el transform completo ya actualizado. */
  onChange: (next: ObjectTransform) => void;
  /** Traductor i18n (useI18n). */
  t: TFunction;
};

/**
 * Inspector numérico del objeto seleccionado en la pestaña Escena:
 * posición, rotación (en grados) y escala por eje, editables. Reutiliza
 * el mismo canal que el gizmo (`onChange` → handleObjectTransform), de
 * modo que los cambios pasan por el historial y el auto-key.
 *
 * La cabecera superior indica a qué eje (X/Y/Z) pertenece cada columna
 * de campos, con el color convencional de cada eje.
 */
export function ObjectTransformFields({ transform, onChange, t }: Props) {
  const setPos = (axis: Axis, n: number) =>
    onChange({ ...transform, [POS_KEY[axis]]: n });
  const setRot = (axis: Axis, deg: number) =>
    onChange({ ...transform, [ROT_KEY[axis]]: deg * DEG2RAD });
  const setScale = (axis: Axis, n: number) => {
    // Evita una escala exactamente 0 (degeneraría la malla del objeto).
    const safe = Math.abs(n) < 0.001 ? (n < 0 ? -0.001 : 0.001) : n;
    onChange({ ...transform, [SCALE_KEY[axis]]: safe });
  };

  const rows: {
    label: string;
    values: [number, number, number];
    step: number;
    suffix?: string;
    commit: (axis: Axis, n: number) => void;
    prefix: string;
  }[] = [
    {
      label: t('editor3D.objPosition'),
      values: [round(transform.px), round(transform.py), round(transform.pz)],
      step: 0.1,
      commit: setPos,
      prefix: 'object-pos',
    },
    {
      label: t('editor3D.objRotation'),
      values: [
        round(transform.rx * RAD2DEG),
        round(transform.ry * RAD2DEG),
        round(transform.rz * RAD2DEG),
      ],
      step: 1,
      suffix: '°',
      commit: setRot,
      prefix: 'object-rot',
    },
    {
      label: t('editor3D.objScale'),
      values: [
        round(transform.sx, 3),
        round(transform.sy, 3),
        round(transform.sz, 3),
      ],
      step: 0.1,
      commit: setScale,
      prefix: 'object-scale',
    },
  ];

  return (
    <div className="space-y-1" data-testid="object-transform-fields">
      {/* Cabecera: a qué eje (X/Y/Z) pertenece cada columna de campos. */}
      <AxisHeader
        t={t}
        gap="gap-1.5"
        spacer={<span className="w-16 shrink-0" aria-hidden="true" />}
        testId="object-transform-axis-header"
        testIdPrefix="object-transform-axis"
      />
      {rows.map((row) => (
        <div key={row.prefix} className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/80">
            {row.label}
          </span>
          {AXES.map((axis, i) => (
            <NumberInput
              key={axis}
              value={row.values[i]}
              step={row.step}
              suffix={row.suffix}
              onCommit={(n) => row.commit(axis, n)}
              testId={`${row.prefix}-${axis}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
