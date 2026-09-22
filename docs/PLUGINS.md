# Plugins de Zeus Editor 3D — Guía para añadir plugins nuevos

> Sistema equivalente libre de los modificadores de 3ds Max. Cada plugin es
> una herramienta que transforma la malla de un objeto de la escena.

---

## Mapa de archivos

| Archivo | Qué es |
|---|---|
| `lib/plugins/types.ts` | El contrato `ZeusPlugin` y los tipos de parámetros |
| `lib/plugins/registry.ts` | Registro: alta/baja/listado de plugins (reactivo) |
| `lib/plugins/index.ts` | Punto de entrada: **aquí se registra cada plugin nuevo** |
| `lib/plugins/builtin/deformadores.ts` | Plugins integrados de deformación (Bend, Twist, Taper, Noise) |
| `lib/plugins/builtin/utilidades.ts` | Plugins de utilidad (suavizar, decimar) |
| `components/editor/PluginsModal.tsx` | El modal «Plugins» (menú **Acciones** del editor) |
| `components/editor/Editor3D.tsx` | `handleApplyPlugin`: ejecuta el plugin sobre el objeto |

---

## Añadir un plugin nuevo (3 pasos)

### 1. Crear el archivo del plugin

Crea `lib/plugins/builtin/mi-plugin.ts`:

```ts
import type { Mesh } from '@/lib/geometry';
import type { ZeusPlugin, PluginParams } from '../types';

const num = (params: PluginParams, id: string, porDefecto = 0) => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};

export const miPlugin: ZeusPlugin = {
  id: 'mi-plugin',                    // único, estable, kebab-case
  nombre: 'Mi Plugin',                // visible en el modal
  categoria: 'deformadores',          // 'deformadores' | 'utilidades' | propia
  descripcion: 'Lo que hace, en una línea.',
  params: [
    {
      tipo: 'slider',
      id: 'fuerza',
      etiqueta: 'Fuerza',
      min: 0,
      max: 100,
      paso: 1,
      valor: 50,                      // valor por defecto
      unidad: '%',                    // opcional, se muestra junto al valor
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje',
      opciones: [
        { valor: 'x', etiqueta: 'X' },
        { valor: 'y', etiqueta: 'Y' },
      ],
      valor: 'y',
    },
    {
      tipo: 'check',
      id: 'invertir',
      etiqueta: 'Invertir efecto',
      descripcion: 'Texto aclaratorio opcional.',
      valor: false,
    },
  ],
  aplicar(mesh, params) {
    const fuerza = num(params, 'fuerza', 50) / 100;
    // ... transformar los vértices aquí ...
    const vertices = mesh.vertices.map((v) => ({
      x: v.x,
      y: v.y + fuerza,
      z: v.z,
    }));
    // Conservar TODO lo demás del mesh (caras, colores, texturas):
    return { ...mesh, vertices };
  },
};
```

### 2. Registrarlo

En `lib/plugins/index.ts`:

```ts
import { miPlugin } from './builtin/mi-plugin';

// ...
for (const p of [...DEFORMADORES, ...UTILIDADES, miPlugin]) registrarPlugin(p);
```

### 3. Nada más

Al abrir el modal **Acciones → Plugins** el plugin aparece con su panel de
parámetros generado automáticamente. No hay que tocar la UI ni el editor.

---

## Reglas de oro

1. **NO mutar la malla de entrada.** El editor guarda la original para
   deshacer/rehacer. Copia siempre: `const vertices = mesh.vertices.map(...)`
   y devuelve `{ ...mesh, vertices }` (así se conservan `faces`,
   `faceColors`, `faceOpacities`, `faceTextures` y el resto de propiedades).
2. **La malla llega en espacio LOCAL** del objeto (sin su transformada de
   posición/rotación/escala), igual que en las booleanas.
3. **Los plugins con matemáticas continuas** (doblar, torcer, afilar…) son
   seguros para mallas de vóxeles: vértices coincidentes en posición se
   mueven igual. Evita desplazamientos aleatorios por índice (usar la
   POSICIÓN como semilla, como hace `ruido`).
4. **Protege los extremos**: si el parámetro anula el efecto (ángulo 0,
   amplitud 0), devuelve `mesh` sin tocar. División por extensión del eje
   → comprobar que la caja no es degenerada.
5. **Los textos del modal y los avisos** (título, botones, toasts) SÍ están
   traducidos: viven en `lib/i18n/translations.ts` bajo `editor3D.plugins`
   (en los 7 idiomas; `TranslationKeys = typeof es` obliga a añadir la clave
   en todos). Las **categorías** se traducen con la convención
   `editor3D.plugins.cat<NOMBRE>` (p. ej. `catDeformadores`); si la clave no
   existe, el modal muestra el nombre de la categoría tal cual.
6. **Los nombres y descripciones de cada plugin** son contenido del propio
   plugin (como en 3ds Max) y van en su definición, no en i18n.

---

## Tipos de parámetro (UI automática)

| `tipo` | Valor en `params` | Controles extra |
|---|---|---|
| `'slider'` | `number` | `min`, `max`, `paso?`, `unidad?` |
| `'select'` | `string` | `opciones: {valor, etiqueta}[]` |
| `'check'` | `boolean` | `descripcion?` |

Léelos en `aplicar` con el helper `num(...)` (o comprobando el tipo, como
hacen los plugins integrados) porque el usuario puede no haberlos tocado.

---

## Categorías

- `'deformadores'` — modifican la forma (aparecen primero)
- `'utilidades'` — procesado de malla (suavizar, decimar)
- Cualquier otra string crea una categoría nueva al final de la lista.

---

## Probar sin abrir el editor

Los deformadores son JS puro (los imports de tipos se eliminan al compilar).
Se puede verificar la matemática transpilando al vuelo, como hace
`smoke-plugins.test.js` en la raíz del proyecto:

```bash
node smoke-plugins.test.js
```

Checks mínimos para cualquier plugin nuevo:
- [ ] Conserva `vertices.length`
- [ ] Sin `NaN`/`Infinity` en coordenadas
- [ ] Con parámetros neutros (ángulo 0, fuerza 0…) devuelve la malla intacta
- [ ] No muta la malla de entrada

---

## Flujo al aplicar (lo que hace el editor por ti)

`handleApplyPlugin` en `components/editor/Editor3D.tsx`:

1. Resuelve la malla del objeto destino (su instantánea `obj.mesh`, o la
   viva `triMesh` si es el dueño del panel — igual que las booleanas).
2. Llama a `plugin.aplicar(malla, valores)`.
3. Desvincula el objeto del panel si era el dueño (la deformación queda
   "horneada", como en las booleanas).
4. Guarda `{ ...obj, mesh: resultado, smooth: false }` en la escena.
5. La acción queda en el historial → **Ctrl+Z la deshace**.