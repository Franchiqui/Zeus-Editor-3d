'use client';

import type { PluginParams } from '@/lib/plugins/types';
import type { DeformadorDirecto } from '@/lib/deformadores';
import { NumberInput } from './object-transform-fields';

type TFunction = (
  key: string,
  vars?: Record<string, string | number>
) => string;

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

type Props = {
  /** Deformador activo (params, etiquetas e icono). */
  deformador: DeformadorDirecto;
  /** Valores actuales de los parámetros. */
  params: PluginParams;
  /** Se llama con el objeto de parámetros completo ya actualizado. */
  onParams: (next: PluginParams) => void;
  /** Se llama al pulsar el botón aplicar (escribe la malla en el objeto). */
  onAplicar: () => void;
  /** Se llama al cancelar (solo apaga el modo, sin tocar la malla). */
  onCancelar: () => void;
  /** Traductor i18n (useI18n). */
  t: TFunction;
};

/**
 * Panel del DEFORMADOR directo activo en la pestaña Escena: los campos
 * de sus params (contrato PluginParam del sistema de plugins: slider →
 * campo numérico, select → desplegable, check → casilla) más los botones
 * Aplicar/Cancelar. Los valores cambian la VISTA PREVIA en vivo (las 4
 * ventanas); Aplicar es la deformación permanente.
 */
export function DeformFields({
  deformador,
  params,
  onParams,
  onAplicar,
  onCancelar,
  t,
}: Props) {
  return (
    <div className="shrink-0 px-3 py-2 border-b border-white/5 space-y-1.5" data-testid="deform-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {deformador.nombre}
        </h3>
      </div>
      <p
        className="text-[9px] leading-tight text-amber-300/80 break-words"
        data-testid="deform-warn"
      >
        {t('editor3D.deformWarn')}
      </p>
      {deformador.params.map((p) => {
        if (p.tipo === 'slider') {
          const valor = typeof params[p.id] === 'number' ? (params[p.id] as number) : p.valor;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <span
                className="flex-1 min-w-0 truncate text-[10px] text-muted-foreground/80"
                title={p.etiqueta + (p.descripcion ? ' — ' + p.descripcion : '')}
              >
                {p.etiqueta}
              </span>
              <div className="w-20 shrink-0">
                <NumberInput
                  value={round(valor)}
                  step={p.paso ?? 1}
                  testId={`deform-param-${p.id}`}
                  suffix={p.unidad}
                  onCommit={(n) => onParams({ ...params, [p.id]: n })}
                />
              </div>
            </div>
          );
        }
        if (p.tipo === 'select') {
          const valor = typeof params[p.id] === 'string' ? (params[p.id] as string) : p.valor;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <span
                className="flex-1 min-w-0 truncate text-[10px] text-muted-foreground/80"
                title={p.etiqueta}
              >
                {p.etiqueta}
              </span>
              <select
                value={valor}
                onChange={(e) => onParams({ ...params, [p.id]: e.target.value })}
                data-testid={`deform-param-${p.id}`}
                className="w-24 shrink-0 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[11px] text-foreground focus:outline-none focus:border-green-500/50"
              >
                {p.opciones.map((op) => (
                  <option key={op.valor} value={op.valor}>
                    {op.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        // Casilla on/off
        const marcado = params[p.id] === undefined ? p.valor : params[p.id] === true;
        return (
          <div key={p.id} className="flex items-center gap-1.5">
            <span
              className="flex-1 min-w-0 truncate text-[10px] text-muted-foreground/80"
              title={p.etiqueta + (p.descripcion ? ' — ' + p.descripcion : '')}
            >
              {p.etiqueta}
            </span>
            <input
              type="checkbox"
              checked={marcado}
              onChange={(e) => onParams({ ...params, [p.id]: e.target.checked })}
              data-testid={`deform-param-${p.id}`}
              className="shrink-0 accent-green-500"
            />
          </div>
        );
      })}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          data-testid="deform-apply"
          onClick={onAplicar}
          className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
        >
          {t('editor3D.deformAplicar')}
        </button>
        <button
          data-testid="deform-cancel"
          onClick={onCancelar}
          className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-gray-700 hover:bg-gray-600 text-foreground transition-colors"
        >
          {t('editor3D.deformCancelar')}
        </button>
      </div>
    </div>
  );
}