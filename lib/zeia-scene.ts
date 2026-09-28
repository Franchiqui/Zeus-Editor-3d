import type { Mesh, ObjectTransform, Vertex3D } from './geometry';
import type { TransformProperty, TransformTrack } from './animation';
import type { ZeiaApplyResult, ZeiaAppliedPlan, ZeiaPlanStep } from './zeia';
import { buildPrimitiveMesh, fallbackMesh, normalizePrimitiveName, primitiveIsSmooth, type ZeiaPrimitiveName } from './zeia-primitives';

/**
 * Puente ZEIA -> escena del EDITOR 3D (lógica pura).
 *
 * ZEIA planifica y ejecuta sobre SU escena interna (server-side). Para que el
 * ciclo chat -> ZEIA -> escena se refleje en el editor REAL (`components/editor/
 * Editor3D.tsx` -> `components/viewer-3d.tsx`), traducimos los pasos del plan
 * ZEIA a mutaciones de la escena del editor: objetos (con malla primitiva) y
 * animaciones (pistas de transformada).
 *
 * Todo es PURO (sin React, sin red): recibe la escena actual y devuelve la
 * nueva, de modo que es testeable en Node y trivial de enganchar a un `setState`.
 */

/** Subconjunto estructural de `SceneObject` (Editor3D) que necesita el mapeo. */
export type ZeiaSceneObject = {
  id: string;
  name: string;
  transform: ObjectTransform;
  mesh: Mesh;
  smooth?: boolean;
  [k: string]: unknown;
};

export type ApplyZeiaOptions = {
  /** Generador de ids del editor. Por defecto pseudoaleatorio. */
  makeId?: (prefix: string) => string;
  /** Mapa persistente id-ZEIA -> id-editor (para resolver referencias entre planes). */
  idMap?: Record<string, string>;
  /** ID del último objeto creado (para resolver referencias entre llamadas individuales). */
  lastCreatedId?: string | null;
};

export type ApplyZeiaOutput<T extends ZeiaSceneObject> = {
  objects: T[];
  transformTracks: TransformTrack[];
  result: ZeiaApplyResult;
  idMap: Record<string, string>;
  lastCreatedId: string | null;
};

const RAD = Math.PI / 180;

function num(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function pickId(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

/** Lee un vector [x,y,z] que puede venir como array o como {x,y,z}. */
function triple(t: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(t)) {
    return [num(t[0], fallback[0]), num(t[1], fallback[1]), num(t[2], fallback[2])];
  }
  if (t && typeof t === 'object') {
    const o = t as Record<string, unknown>;
    return [num(o.x ?? o[0], fallback[0]), num(o.y ?? o[1], fallback[1]), num(o.z ?? o[2], fallback[2])];
  }
  return fallback;
}

/** Transformada del editor a partir del `transform` de un paso ZEIA (rotación en grados). */
function transformFromParams(params: Record<string, unknown>): ObjectTransform {
  const t = (params.transform && typeof params.transform === 'object' ? params.transform : {}) as Record<string, unknown>;
  const [px, py, pz] = triple(t.position, [0, 0, 0]);
  const [rxd, ryd, rzd] = triple(t.rotation, [0, 0, 0]);
  const [sx, sy, sz] = triple(t.scale, [1, 1, 1]);
  return {
    px, py, pz,
    rx: rxd * RAD, ry: ryd * RAD, rz: rzd * RAD,
    sx: sx || 1, sy: sy || 1, sz: sz || 1,
  };
}

function resolvePrimitiveName(params: Record<string, unknown>): ZeiaPrimitiveName | null {
  return normalizePrimitiveName(params.primitive) ?? normalizePrimitiveName(primitiveFromGeometry(params.geometry)) ?? null;
}

function objectName(params: Record<string, unknown>): string {
  const n = params.name;
  if (typeof n === 'string' && n.trim()) return n.trim();
  const prim = resolvePrimitiveName(params);
  if (prim) return prim.charAt(0).toUpperCase() + prim.slice(1);
  const type = typeof params.type === 'string' ? params.type : 'mesh';
  if (type === 'light') return 'Luz';
  if (type === 'camera') return 'Cámara';
  return 'Objeto';
}

function buildObject<T extends ZeiaSceneObject>(id: string, params: Record<string, unknown>): T {
  const prim = resolvePrimitiveName(params);
  const primName = prim?.toString() ?? params.primitive ?? primitiveFromGeometry(params.geometry) ?? null;
  const primitiveMesh = buildPrimitiveMesh(primName) ?? fallbackMesh();
  // Si se proporcionó una malla explícita (execute.mesh), usarla en lugar
  // de generar una primitiva: así los objetos guardados con geometría real
  // (p. ej. Taza.txt) se crean con su malla original, no con un cubo de reserva.
  const mesh: Mesh =
    params.mesh && typeof params.mesh === 'object' && !Array.isArray(params.mesh)
      ? (params.mesh as Mesh)
      : primitiveMesh;
  // Luces/cámaras: usamos una esfera (marcador) si no son una primitiva conocida.
  const meshFinal = params.type === 'light' || params.type === 'camera' ? buildPrimitiveMesh('sphere') ?? mesh : mesh;
  const smooth = primitiveIsSmooth(prim);
  const obj: ZeiaSceneObject = {
    id,
    name: objectName(params),
    transform: transformFromParams(params),
    mesh: meshFinal,
    smooth,
    // Propiedades de textura/acabado/opacity pasadas desde execute.
    ...extractTextureProps(params),
  };
  return obj as unknown as T;
}

/** Extrae las propiedades de textura/acabado/opacity de params al objeto. */
function extractTextureProps(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = ['texture', 'textureColor', 'textureRelief', 'textureRepeat', 'textureFinish', 'texturePanela', 'textureHelper', 'textureHelperTransform', 'opacity'];
  for (const key of keys) {
    if (key in params && params[key] !== undefined) out[key] = params[key];
  }
  return out;
}

function applyTransformPatch(base: ObjectTransform, patch: Record<string, unknown>): ObjectTransform {
  const out: ObjectTransform = { ...base };
  const t = (patch.transform && typeof patch.transform === 'object' ? patch.transform : null) as Record<string, unknown> | null;
  const source = t ?? patch;
  if ('position' in source) {
    const [x, y, z] = triple(source.position, [out.px, out.py, out.pz]);
    out.px = x; out.py = y; out.pz = z;
  }
  if ('rotation' in source) {
    const [x, y, z] = triple(source.rotation, [out.rx / RAD, out.ry / RAD, out.rz / RAD]);
    out.rx = x * RAD; out.ry = y * RAD; out.rz = z * RAD;
  }
  if ('scale' in source) {
    const [x, y, z] = triple(source.scale, [out.sx, out.sy, out.sz]);
    out.sx = x; out.sy = y; out.sz = z;
  }
  // Campos planos (px, py, rx...) por si el modelo los envía directos.
  const flat = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;
  for (const k of flat) {
    if (typeof source[k] === 'number' && Number.isFinite(source[k] as number)) {
      out[k] = source[k] as number;
    }
  }
  return out;
}

function valuesOf(t: ObjectTransform): Partial<Record<TransformProperty, number>> {
  return { px: t.px, py: t.py, pz: t.pz, rx: t.rx, ry: t.ry, rz: t.rz, sx: t.sx, sy: t.sy, sz: t.sz };
}

function buildMotionTrack<T extends ZeiaSceneObject>(
  target: T,
  params: Record<string, unknown>,
  makeId: (prefix: string) => string
): TransformTrack | null {
  const type = String(params.type || 'rotate').toLowerCase();
  const duration = Math.max(0.1, num(params.duration, 5));
  const loop = params.loop === true;
  const degrees = num(params.degrees, 360);
  const base = { ...target.transform };
  let end: ObjectTransform;
  switch (type) {
    case 'rotate': {
      const axis = String(params.axis || 'y').toLowerCase();
      end = { ...base };
      if (axis === 'x') end.rx = base.rx + degrees * RAD;
      else if (axis === 'z') end.rz = base.rz + degrees * RAD;
      else end.ry = base.ry + degrees * RAD;
      break;
    }
    case 'orbit': {
      const axis = String(params.axis || 'y').toLowerCase();
      const angle = params.angle !== undefined ? num(params.angle, num(params.degrees, 360)) : degrees;
      end = { ...base };
      if (axis === 'x') end.rx = base.rx + angle * RAD;
      else if (axis === 'z') end.rz = base.rz + angle * RAD;
      else end.ry = base.ry + angle * RAD;
      break;
    }
    case 'translate':
      end = { ...base, px: base.px + 1 };
      break;
    case 'scale': {
      const minS = params.min_scale ?? params.minScale;
      const maxS = params.max_scale ?? params.maxScale ?? params.scale;
      if (minS) {
        const [sx, sy, sz] = triple(minS, [base.sx, base.sy, base.sz]);
        base.sx = sx; base.sy = sy; base.sz = sz;
      }
      if (maxS) {
        const [sx, sy, sz] = triple(maxS, [base.sx * 2, base.sy * 2, base.sz * 2]);
        end = { ...base, sx, sy, sz };
      } else {
        end = { ...base, sx: base.sx * 2, sy: base.sy * 2, sz: base.sz * 2 };
      }
      break;
    }
    default:
      return null;
  }
  return {
    id: makeId('ttrack'),
    objectId: target.id,
    name: `Animación ZEIA (${type})`,
    duration,
    looping: loop,
    keyframes: [
      { time: 0, values: valuesOf(base), easing: 'linear' },
      { time: duration, values: valuesOf(end), easing: 'ease-in-out' },
    ],
  };
}

/**
 * Convierte el campo `geometry` (que puede ser `{type, shapes}` o un nombre de
 * primitiva) al nombre de primitiva que entiende el editor (`cube`, `sphere`, …).
 * Para `compound` usa la primera forma; si no se reconoce devuelve `undefined`.
 */
function primitiveFromGeometry(geometry: unknown): string | undefined {
  if (!geometry || typeof geometry !== 'object') return undefined;
  const g = geometry as Record<string, unknown>;
  const geoType = typeof g.type === 'string' ? g.type.toLowerCase() : '';
  if (geoType === 'compound' && Array.isArray(g.shapes)) {
    const first = g.shapes[0];
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).type === 'string') {
      return (first as Record<string, unknown>).type as string;
    }
  }
  if (geoType) return geoType;
  return undefined;
}

/**
 * Mapea nombres de forma que el modelo usa frecuentemente pero que no son
 * primitivas estándar del editor a una primitiva aproximada.
 */
function shapeAlias(prim: string | null | undefined): string | null {
  if (!prim) return null;
  const n = prim.toLowerCase();
  if (n === 'vase' || n === 'jar' || n === 'bottle' || n === 'column' || n === 'tower') return 'cylinder';
  if (n === 'bell' || n === 'teardrop' || n === 'drop') return 'cone';
  if (n === 'pyramid' || n === 'tetrahedron') return 'pyramid';
  if (n === 'torus' || n === 'donut') return 'torus';
  return null;
}

/**
 * Normaliza params de creación: traduce campos del formato del modelo
 * (`geometry`, `position/rotation/scale` sueltos, `material`, `type`/`shape`
 * como nombre de forma) al formato ZEIA interno que espera `buildObject`
 * (`primitive`, `transform`, …).
 */
function normalizeCreateParams(execute: Record<string, unknown>): Record<string, unknown> {
  const exeType = typeof execute.type === 'string' ? execute.type : '';
  const isKnownObjectType = exeType === 'mesh' || exeType === 'light' || exeType === 'camera';

  // Si `type` no es un tipo de objeto (mesh/light/camera), el modelo lo usa como
  // nombre de forma → lo convertimos en primitive y forzamos type='mesh'.
  const typeAsPrimitive = !isKnownObjectType && exeType ? exeType : null;

  const params: Record<string, unknown> = {
    type: isKnownObjectType ? exeType : 'mesh',
  };

  const primitive =
    execute.primitive ??
    primitiveFromGeometry(execute.geometry) ??
    typeAsPrimitive ??
    (typeof execute.shape === 'string' ? execute.shape : null);

  // Intentar normalizar; si no es primitiva conocida, usar alias (vase→cylinder…)
  const normalized = normalizePrimitiveName(primitive);
  const resolved = normalized ?? shapeAlias(primitive as string | null | undefined);

  if (resolved) params.primitive = resolved;

  // name: usar el explícito, o derivarlo del type/shape/primitive/geometry.mesh
  if (execute.name) {
    params.name = execute.name;
  } else if (typeAsPrimitive) {
    params.name = capitalize(typeAsPrimitive);
  } else if (typeof execute.shape === 'string') {
    params.name = capitalize(execute.shape);
  } else if (execute.geometry && typeof execute.geometry === 'object') {
    const mesh = (execute.geometry as Record<string, unknown>).mesh;
    if (typeof mesh === 'string' && mesh.trim()) params.name = mesh.trim();
  }

  if (typeof execute.id === 'string') params.id = execute.id;
  if (typeof execute.objectId === 'string') params.id = execute.objectId;

  const transform: Record<string, unknown> = {};
  if (execute.position) transform.position = execute.position;
  if (execute.rotation) transform.rotation = execute.rotation;
  if (execute.scale) transform.scale = execute.scale;
  if (execute.transform && typeof execute.transform === 'object') {
    Object.assign(transform, execute.transform as Record<string, unknown>);
  }

  // Extraer transform del primer shape de un geometry compound si no se especificó en nivel superior
  if (execute.geometry && typeof execute.geometry === 'object') {
    const g = execute.geometry as Record<string, unknown>;
    if (g.type === 'compound' && Array.isArray(g.shapes)) {
      const firstShape = g.shapes[0] as Record<string, unknown> | undefined;
      if (firstShape) {
        if (firstShape.position && !transform.position) transform.position = firstShape.position;
        if (firstShape.rotation && !transform.rotation) transform.rotation = firstShape.rotation;
        if (firstShape.scale && !transform.scale) transform.scale = firstShape.scale;
        if (!params.name && typeof firstShape.type === 'string') {
          const prim = normalizePrimitiveName(firstShape.type);
          if (prim) params.name = capitalize(prim);
        }
      }
    }
  }

   if (Object.keys(transform).length) params.transform = transform;

   if (execute.material) params.material = execute.material;
   if (execute.color) params.material = { ...(typeof execute.material === 'object' ? execute.material : {}), color: execute.color };

   // Malla explícita (execute.mesh o execute.geometry con vertices/faces).
   // Cuando se provee, buildObject la usa directamente en lugar de generar
   // una primitiva: esto permite cargar objetos guardados con geometría real
   // (p. ej. Taza.txt) en vez de caer en el cubo de reserva.
   const explicitMesh = extractExplicitMesh(execute);
   if (explicitMesh) params.mesh = explicitMesh;

   // Pasar propiedades de textura/acabado/opacity para que lleguen al objeto.
   for (const key of ['texture', 'textureColor', 'textureRelief', 'textureRepeat', 'textureFinish', 'texturePanela', 'textureHelper', 'textureHelperTransform', 'opacity']) {
     if (key in execute && execute[key] !== undefined) (params as Record<string, unknown>)[key] = execute[key];
   }

   return params;
}

/** Extrae una malla {vertices, faces} de execute.mesh o execute.geometry.{mesh|vertices|faces}. */
function extractExplicitMesh(execute: Record<string, unknown>): Mesh | null {
  if (execute.mesh && typeof execute.mesh === 'object' && !Array.isArray(execute.mesh)) {
    const m = execute.mesh as Record<string, unknown>;
    if (Array.isArray(m.vertices) && Array.isArray(m.faces)) return m as unknown as Mesh;
  }
  if (execute.geometry && typeof execute.geometry === 'object') {
    const g = execute.geometry as Record<string, unknown>;
    if (g.mesh && typeof g.mesh === 'object' && !Array.isArray(g.mesh)) {
      const m = g.mesh as Record<string, unknown>;
      if (Array.isArray(m.vertices) && Array.isArray(m.faces)) return m as unknown as Mesh;
    }
    if (Array.isArray(g.vertices) && Array.isArray(g.faces)) {
      return { vertices: g.vertices as Vertex3D[], faces: g.faces as number[][] };
    }
  }
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Normaliza params de animación: `objectId`/`animation.*` → `object_id`/`type/degrees/…`. */
function normalizeAnimateParams(execute: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const oid = typeof execute.objectId === 'string' ? execute.objectId : execute.id;
  if (oid) params.object_id = oid;

  const anim = execute.animation && typeof execute.animation === 'object'
    ? (execute.animation as Record<string, unknown>)
    : execute;

  if (anim.type) params.type = anim.type;
  if ('angle' in anim) params.degrees = anim.angle;
  else if ('degrees' in anim) params.degrees = anim.degrees;
  if (anim.duration) params.duration = anim.duration;
  if (anim.loop !== undefined) params.loop = anim.loop;
  if (anim.axis) params.axis = anim.axis;
  if (anim.easing) params.easing = anim.easing;
  if ('scale' in anim) params.scale = anim.scale;
  if (anim.scale) params.scale = anim.scale;
  if (anim.min_scale) params.min_scale = anim.min_scale;
  if (anim.max_scale) params.max_scale = anim.max_scale;
  if (anim.minScale) params.min_scale = anim.minScale;
  if (anim.maxScale) params.max_scale = anim.maxScale;

  return params;
}

/** Normaliza params de efecto: `objectId`/`effect.*` → `object_id`/`name/...`. */
function normalizeEffectParams(execute: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (execute.objectId) params.object_id = execute.objectId;

  const effect = execute.effect && typeof execute.effect === 'object'
    ? (execute.effect as Record<string, unknown>)
    : execute;

  if (effect.name) params.name = effect.name;
  else if (effect.type) params.name = String(effect.type);
  const effectParams: Record<string, unknown> = {};
  if (effect.position) effectParams.position = effect.position;
  if (effect.scale) effectParams.scale = effect.scale;
  if (effect.color) effectParams.color = effect.color;
  if (Object.keys(effectParams).length) params.params = effectParams;

  return params;
}

/** Normaliza params de update/delete/duplicate: `objectId`/`id` → `id`. */
function normalizeObjectRefParams(execute: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const oid = typeof execute.objectId === 'string' ? execute.objectId : execute.id;
  if (oid) params.id = oid;
  return params;
}

/**
 * Convierte un plan de alto nivel (`{plan, execute}`) al formato paso a paso
 * ZEIA (`{steps, results}`). Si el plan ya tiene `steps`, se devuelve sin cambios.
 *
 * El modelo puede usar nombres de plan flexibles (prefijos como `create…`,
 * `animate…`, `addEffect…`). También soporta `animation` embebido dentro del
 * `execute` de un plan `create`, que se expande en un segundo paso `motions.create`.
 */
function normalizeZeiaPlan(plan: ZeiaAppliedPlan): ZeiaAppliedPlan {
  if (Array.isArray(plan.steps) && plan.steps.length > 0) return plan;

  const raw = plan as unknown as Record<string, unknown>;

  if (typeof raw.plan === 'string' && raw.execute && typeof raw.execute === 'object') {
    const exe = raw.execute as Record<string, unknown>;
    const steps = planStepsFromIntent(raw.plan as string, exe);
    if (steps.length > 0) return { ...plan, steps, results: [] };
  }

  return { ...plan, steps: [], results: [] };
}

/** Mapea un nombre de plan (flexible/prefijo) a uno o más pasos ZEIA. */
function planStepsFromIntent(planType: string, execute: Record<string, unknown>): ZeiaPlanStep[] {
  const t = planType.toLowerCase();
  const steps: ZeiaPlanStep[] = [];

  // --- Creación de objetos ---
  const isCreateLike =
    t.startsWith('create') ||
    (t.startsWith('add') && (execute.geometry || execute.material)) ||
    (!t.startsWith('animate') && execute.geometry && !execute.effect);

  if (t.startsWith('update') || t.startsWith('modify') || t.startsWith('move') || t.startsWith('transform')) {
    const params = normalizeObjectRefParams(execute);
    if (execute.patch) params.patch = execute.patch;
    if (execute.transform) {
      params.patch = { ...(params.patch as Record<string, unknown> || {}), transform: execute.transform };
    }
    steps.push({ action: 'objects.update', params });
  } else if (t.startsWith('delete') || t.startsWith('remove') || t.startsWith('destroy')) {
    steps.push({ action: 'objects.delete', params: normalizeObjectRefParams(execute) });
  } else if (t.startsWith('duplicate') || t.startsWith('clone') || t.startsWith('copy')) {
    steps.push({ action: 'objects.duplicate', params: normalizeObjectRefParams(execute) });
  } else if (isCreateLike) {
    steps.push({ action: 'objects.create', params: normalizeCreateParams(execute) });
  } else if (t.includes('effect') && execute.effect) {
    steps.push({ action: 'effects.apply', params: normalizeEffectParams(execute) });
  }

  // --- Animación embebida (animation dentro de execute) ---
  if (execute.animation && typeof execute.animation === 'object') {
    steps.push({ action: 'motions.create', params: normalizeAnimateParams(execute) });
  }

  return steps;
}

/**
 * Aplica una lista de planes ZEIA (plan + execute) a la escena del editor.
 * Devuelve NUEVOS arrays (no muta los de entrada) y un resumen en `result`.
 */
export function applyZeiaPlansToScene<T extends ZeiaSceneObject>(
  plans: ZeiaAppliedPlan[],
  objects: T[],
  transformTracks: TransformTrack[],
  opts: ApplyZeiaOptions = {}
): ApplyZeiaOutput<T> {
  const makeId = opts.makeId ?? ((prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`);
  const idMap: Record<string, string> = { ...(opts.idMap ?? {}) };
  let objs: T[] = objects.slice();
  let tracks: TransformTrack[] = transformTracks.slice();

  const warnings: string[] = [];
  const warned = new Set<string>();
  const warnOnce = (msg: string) => {
    if (!warned.has(msg)) {
      warned.add(msg);
      warnings.push(msg);
    }
  };

  let applied = 0;
  let created = 0;
  let updated = 0;
  let removed = 0;
  let motions = 0;
  let lastCreatedId: string | null = opts.lastCreatedId ?? null;

  const byId = (id?: string | null): T | undefined => (id ? objs.find((o) => o.id === id) : undefined);
  const resolve = (raw?: string | null): T | undefined => {
    if (!raw) return undefined;
    const mapped = idMap[raw];
    if (mapped) {
      const o = byId(mapped);
      if (o) return o;
    }
    return byId(raw);
  };

  for (const plan of plans) {
    const n = normalizeZeiaPlan(plan);
    const wasNormalized = !Array.isArray(plan.steps);
    const steps = Array.isArray(n.steps) ? n.steps : [];
    const results = Array.isArray(n.results) ? n.results : [];
    if (wasNormalized && steps.length === 0) {
      warnOnce('Plan ZEIA sin `steps` ni `{plan, execute}` reconocible: se omitió.');
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as ZeiaPlanStep;
      const res = (results[i] || {}) as Record<string, unknown>;
      const params = (step.params || {}) as Record<string, unknown>;
      const action = String(step.action || '');

      switch (action) {
        case 'objects.create': {
          const editorId = makeId('obj');
          objs = [...objs, buildObject<T>(editorId, params)];
          lastCreatedId = editorId;
          created++;
          applied++;
          if (typeof res.object_id === 'string') idMap[res.object_id] = editorId;
          if (typeof params.id === 'string') idMap[params.id] = editorId;
          if (typeof params.name === 'string' && params.name.trim()) idMap[params.name.trim()] = editorId;
          if (params.type === 'light') warnOnce('ZEIA creó una luz; el editor la representa como una malla (sin iluminación real).');
          if (params.type === 'camera') warnOnce('ZEIA creó una cámara; el editor la representa como una malla.');
          break;
        }

        case 'objects.duplicate': {
          const src = resolve(pickId(params.id, params.object_id, res.object_id));
          if (!src) {
            warnOnce('objects.duplicate: no se encontró el objeto de origen.');
            break;
          }
          const editorId = makeId('obj');
          const clone = { ...src, id: editorId, name: `${src.name} (copia)`, transform: { ...src.transform } } as T;
          objs = [...objs, clone];
          lastCreatedId = editorId;
          created++;
          applied++;
          if (typeof res.object_id === 'string') idMap[res.object_id] = editorId;
          break;
        }

        case 'objects.update':
        case 'objects.batch': {
          const target = resolve(pickId(params.id, params.object_id, res.object_id)) ?? (lastCreatedId ? byId(lastCreatedId) : undefined);
          if (!target) {
            warnOnce(`${action}: no se encontró el objeto a actualizar.`);
            break;
          }
          const patch = (params.patch && typeof params.patch === 'object' ? params.patch : params) as Record<string, unknown>;
          const newTransform = applyTransformPatch(target.transform, patch);
          const newName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : target.name;
          objs = objs.map((o) => (o.id === target.id ? ({ ...o, transform: newTransform, name: newName } as T) : o));
          updated++;
          applied++;
          break;
        }

        case 'objects.delete': {
          const target = resolve(pickId(params.id, params.object_id, res.object_id));
          if (!target) {
            warnOnce('objects.delete: no se encontró el objeto a eliminar.');
            break;
          }
          objs = objs.filter((o) => o.id !== target.id);
          tracks = tracks.filter((t) => t.objectId !== target.id);
          removed++;
          applied++;
          break;
        }

        case 'objects.parent': {
          // La escena del editor es plana: no hay jerarquía padre/hijo.
          applied++;
          break;
        }

        case 'motions.create':
        case 'motions.update': {
          const target = resolve(pickId(res.object_id, params.object_id)) ?? (lastCreatedId ? byId(lastCreatedId) : undefined);
          if (!target) {
            warnOnce(`${action}: no hay objeto destino para la animación.`);
            break;
          }
          const track = buildMotionTrack(target, params, makeId);
          if (!track) {
            warnOnce(`${action}: tipo de motion no soportado ("${String(params.type)}").`);
            break;
          }
          // Acumular tracks: permite animar múltiples propiedades del mismo
          // objeto (rotate + orbit + scale, etc.) sin que una reemplace a otra.
          tracks = [...tracks, track];
          motions++;
          applied++;
          break;
        }

        default: {
          warnOnce(`${action}: se aplicó en ZEIA pero no tiene representación directa en la escena del editor.`);
          break;
        }
      }
    }
  }

  return {
    objects: objs,
    transformTracks: tracks,
    idMap,
    lastCreatedId,
    result: { applied, created, updated, removed, motions, warnings },
  };
}
