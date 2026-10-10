'use client';

import type { PrimitiveParams } from '@/lib/primitivas-parametricas';
import { NumberInput } from './object-transform-fields';

type TFunction = (
  key: string,
  vars?: Record<string, string | number>
) => string;

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

type Props = {
  /** Parámetros actuales de la primitiva del objeto seleccionado. */
  params: PrimitiveParams;
  /** Se llama con el objeto de parámetros completo ya actualizado. */
  onChange: (next: PrimitiveParams) => void;
  /** Traductor i18n (useI18n). */
  t: TFunction;
};

type Fila = {
  /** Clave i18n de la etiqueta. */
  label: string;
  /** Campo del objeto de params (key de la unión, seguro porque cada fila lo usa dentro de su kind). */
  campo: string;
  valor: number;
  step: number;
  min: number;
  entero?: boolean;
};

/**
 * Inspector de parámetros de primitiva del objeto seleccionado en la
 * pestaña Escena (solo objetos con `primitiveParams`, p. ej. cargados
 * del modal «Objeto 3D»). Cada cambio regenera la malla: se avisa de
 * que pierde las ediciones de vértices hechas a mano.
 */
export function ObjectPrimitiveFields({ params, onChange, t }: Props) {
  const filas: Fila[] = (() => {
    switch (params.kind) {
      case 'cubo':
        return [
          { label: 'editor3D.primitiveAncho', campo: 'ancho', valor: params.ancho, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAlto', campo: 'alto', valor: params.alto, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveProfundo', campo: 'profundo', valor: params.profundo, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegX', campo: 'segX', valor: params.segX, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveSegY', campo: 'segY', valor: params.segY, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveSegZ', campo: 'segZ', valor: params.segZ, step: 1, min: 1, entero: true },
        ];
      case 'esfera':
        return [
          { label: 'editor3D.primitiveRadio', campo: 'radio', valor: params.radio, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveMeridianos', campo: 'meridianos', valor: params.meridianos, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveAnillos', campo: 'anillos', valor: params.anillos, step: 1, min: 3, entero: true },
        ];
      case 'toroide':
        return [
          { label: 'editor3D.primitiveRadioAnillo', campo: 'radioAnillo', valor: params.radioAnillo, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveRadioTubo', campo: 'radioTubo', valor: params.radioTubo, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegAnillo', campo: 'segAnillo', valor: params.segAnillo, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveSegTubo', campo: 'segTubo', valor: params.segTubo, step: 1, min: 3, entero: true },
        ];
      case 'tubo':
        return [
          { label: 'editor3D.primitiveRadioInterno', campo: 'radioInterno', valor: params.radioInterno, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveRadioExterno', campo: 'radioExterno', valor: params.radioExterno, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAltura', campo: 'altura', valor: params.altura, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegRotacion', campo: 'segRotacion', valor: params.segRotacion, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveSegAltura', campo: 'segAltura', valor: params.segAltura, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveSegTapa', campo: 'segTapa', valor: params.segTapa, step: 1, min: 1, entero: true },
        ];
      case 'cono':
        return [
          { label: 'editor3D.primitiveRadio', campo: 'radio', valor: params.radio, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAltura', campo: 'altura', valor: params.altura, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegmentos', campo: 'segmentos', valor: params.segmentos, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveBandas', campo: 'bandas', valor: params.bandas, step: 1, min: 1, entero: true },
        ];
      case 'cilindro':
        return [
          { label: 'editor3D.primitiveRadio', campo: 'radio', valor: params.radio, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAltura', campo: 'altura', valor: params.altura, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegmentos', campo: 'segmentos', valor: params.segmentos, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveBandas', campo: 'bandas', valor: params.bandas, step: 1, min: 1, entero: true },
        ];
      case 'plano':
        return [
          { label: 'editor3D.primitiveAncho', campo: 'ancho', valor: params.ancho, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveProfundo', campo: 'profundo', valor: params.profundo, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegX', campo: 'segX', valor: params.segX, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveSegZ', campo: 'segZ', valor: params.segZ, step: 1, min: 1, entero: true },
        ];
      case 'piramide':
        return [
          { label: 'editor3D.primitiveLado', campo: 'lado', valor: params.lado, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAltura', campo: 'altura', valor: params.altura, step: 0.05, min: 0.001 },
        ];
      case 'capsula':
        return [
          { label: 'editor3D.primitiveRadio', campo: 'radio', valor: params.radio, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveAltura', campo: 'altura', valor: params.altura, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveSegmentos', campo: 'segmentos', valor: params.segmentos, step: 1, min: 3, entero: true },
          { label: 'editor3D.primitiveBandasCuerpo', campo: 'bandasCuerpo', valor: params.bandasCuerpo, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveBandasCasquete', campo: 'bandasCasquete', valor: params.bandasCasquete, step: 1, min: 1, entero: true },
        ];
      case 'disco':
        return [
          { label: 'editor3D.primitiveRadio', campo: 'radio', valor: params.radio, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveRadioInterior', campo: 'radioInterior', valor: params.radioInterior, step: 0.05, min: 0 },
          { label: 'editor3D.primitiveSectores', campo: 'sectores', valor: params.sectores, step: 1, min: 3, entero: true },
        ];
      case 'muelle':
        return [
          { label: 'editor3D.primitiveMuelleVueltas', campo: 'vueltas', valor: params.vueltas, step: 1, min: 1, entero: true },
          { label: 'editor3D.primitiveMuelleVertices', campo: 'verticesPorVuelta', valor: params.verticesPorVuelta, step: 1, min: 6, entero: true },
          { label: 'editor3D.primitiveMuelleSeparacion', campo: 'separacion', valor: params.separacion, step: 0.05, min: 0.01 },
          { label: 'editor3D.primitiveMuelleRadio', campo: 'radioMuelle', valor: params.radioMuelle, step: 0.05, min: 0.001 },
          { label: 'editor3D.primitiveMuelleRadioTubo', campo: 'radioTubo', valor: params.radioTubo, step: 0.02, min: 0.005 },
        ];
    }
  })();

  return (
    <div className="space-y-1" data-testid="object-primitive-fields">
      {/* El regenerado sustituye la malla completa: se pierden los retoques
          de vértices hechos a mano. Aviso siempre visible. */}
      <p
        className="text-[9px] leading-tight text-amber-300/80 break-words"
        title={t('editor3D.primitiveRegenWarnTitle')}
        data-testid="primitive-regen-warn"
      >
        {t('editor3D.primitiveRegenWarn')}
      </p>
      {filas.map((fila) => (
        <div key={fila.campo} className="flex items-center gap-1.5">
          {/* El label ocupa el resto de la fila y se recorta (tooltip con
              el nombre completo); el campo es estrecho y fijo para que
              nunca se pisen. */}
          <span
            className="flex-1 min-w-0 truncate text-[10px] text-muted-foreground/80"
            title={t(fila.label)}
          >
            {t(fila.label)}
          </span>
          <div className="w-20 shrink-0">
            <NumberInput
              value={round(fila.valor)}
              step={fila.step}
              testId={`primitive-param-${fila.campo}`}
              onCommit={(n) => {
                const siguiente = { ...params } as Record<string, unknown>;
                siguiente[fila.campo] = fila.entero ? Math.round(n) : Math.max(fila.min, n);
                onChange(siguiente as PrimitiveParams);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}