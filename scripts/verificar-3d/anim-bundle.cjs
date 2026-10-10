"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/animation.ts
var animation_exports = {};
__export(animation_exports, {
  EASING_OPTIONS: () => EASING_OPTIONS,
  EFFECT_PROPERTY_PRESETS: () => EFFECT_PROPERTY_PRESETS,
  EFFECT_TYPE_LABELS: () => EFFECT_TYPE_LABELS,
  KEYFRAME_PROPERTY_LABELS: () => KEYFRAME_PROPERTY_LABELS,
  OBJECT_PROPERTIES: () => OBJECT_PROPERTIES,
  TRANSFORM_PROPERTIES: () => TRANSFORM_PROPERTIES,
  TRANSFORM_PROPERTY_LABELS: () => TRANSFORM_PROPERTY_LABELS,
  allTracksMaxDuration: () => allTracksMaxDuration,
  animationTrackToUnified: () => animationTrackToUnified,
  buildUnifiedTracks: () => buildUnifiedTracks,
  cloneTrack: () => cloneTrack,
  createDefaultCameraData: () => createDefaultCameraData,
  createDefaultKeyframe: () => createDefaultKeyframe,
  createDefaultTrack: () => createDefaultTrack,
  createDeformadorTrack: () => createDeformadorTrack,
  createEffectTrack: () => createEffectTrack,
  createGroupTransformTrack: () => createGroupTransformTrack,
  createPluginParamTrack: () => createPluginParamTrack,
  createTransformTrack: () => createTransformTrack,
  diffTransform: () => diffTransform,
  effectTrackToUnified: () => effectTrackToUnified,
  evaluateCameraKeyframes: () => evaluateCameraKeyframes,
  evaluateDeformadorTrack: () => evaluateDeformadorTrack,
  evaluateEffectTrack: () => evaluateEffectTrack,
  evaluatePluginParamTrack: () => evaluatePluginParamTrack,
  evaluateTrack: () => evaluateTrack,
  evaluateTransformTrack: () => evaluateTransformTrack,
  findKeyframeSegment: () => findKeyframeSegment,
  getEasingFunction: () => getEasingFunction,
  interpolateValue: () => interpolateValue,
  motionMaxDuration: () => motionMaxDuration,
  pluginParamTrackToUnified: () => pluginParamTrackToUnified,
  transformTrackToUnified: () => transformTrackToUnified,
  unifiedTimeMs: () => sToMs,
  unifiedTracksMaxDuration: () => unifiedTracksMaxDuration,
  upsertKeyframeAt: () => upsertKeyframeAt
});
module.exports = __toCommonJS(animation_exports);
var EASING_FUNCTIONS = {
  linear: (t) => t,
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  "ease-in-cubic": (t) => t * t * t,
  "ease-out-cubic": (t) => 1 - Math.pow(1 - t, 3),
  "ease-in-out-cubic": (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  spring: (t) => {
    const oscillation = 4;
    const decay = 3;
    return 1 - Math.cos(t * Math.PI * oscillation) * Math.exp(-t * decay);
  }
};
function getEasingFunction(fn) {
  return EASING_FUNCTIONS[fn] || EASING_FUNCTIONS.linear;
}
function interpolateValue(from, to, progress, easing) {
  if (from === void 0 || to === void 0) return to ?? from;
  const eased = getEasingFunction(easing)(progress);
  return from + (to - from) * eased;
}
function findKeyframeSegment(keyframes, time) {
  if (keyframes.length < 2) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) {
    return { start: sorted[0], end: sorted[1], segmentProgress: 0 };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (time >= start.time && time <= end.time) {
      const segmentDuration = end.time - start.time;
      const segmentProgress = segmentDuration > 0 ? (time - start.time) / segmentDuration : 0;
      return { start, end, segmentProgress };
    }
  }
  const last = sorted[sorted.length - 1];
  const secondLast = sorted[sorted.length - 2];
  return { start: secondLast, end: last, segmentProgress: 1 };
}
function evaluateTrack(track, time) {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0 ? (time % track.duration + track.duration) % track.duration : time;
  if (effectiveTime <= sorted[0].time) {
    return { ...sorted[0].values ?? {} };
  }
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return { ...sorted[sorted.length - 1].values ?? {} };
  }
  const segment = findKeyframeSegment(sorted, effectiveTime);
  if (!segment) return { ...sorted[0].values ?? {} };
  const result = {};
  const properties = Array.from(
    /* @__PURE__ */ new Set([...Object.keys(segment.start.values ?? {}), ...Object.keys(segment.end.values ?? {})])
  );
  for (const prop of properties) {
    const fromVal = (segment.start.values ?? {})[prop];
    const toVal = (segment.end.values ?? {})[prop];
    result[prop] = interpolateValue(fromVal, toVal, segment.segmentProgress, segment.end.easing);
  }
  return result;
}
var EASING_OPTIONS = [
  { value: "linear", label: "Lineal" },
  { value: "ease-in", label: "Entrada" },
  { value: "ease-out", label: "Salida" },
  { value: "ease-in-out", label: "Entrada/Salida" },
  { value: "ease-in-cubic", label: "Entrada C\xFAbica" },
  { value: "ease-out-cubic", label: "Salida C\xFAbica" },
  { value: "ease-in-out-cubic", label: "Entrada/Salida C\xFAbica" },
  { value: "spring", label: "Resorte" }
];
var KEYFRAME_PROPERTY_LABELS = {
  zoom: "Zoom",
  offsetX: "Desplazamiento X",
  offsetY: "Desplazamiento Y",
  rotationX: "Rotaci\xF3n X",
  rotationY: "Rotaci\xF3n Y",
  translateX: "Traslaci\xF3n X",
  translateY: "Traslaci\xF3n Y",
  translateZ: "Traslaci\xF3n Z",
  scale: "Escala"
};
var OBJECT_PROPERTIES = [
  "translateX",
  "translateY",
  "translateZ",
  "rotationX",
  "rotationY",
  "scale"
];
function createDefaultTrack(objectId, name, duration = 3) {
  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    name,
    duration,
    looping: false,
    keyframes: [
      { time: 0, values: {}, easing: "linear" },
      { time: duration, values: {}, easing: "linear" }
    ]
  };
}
function createDefaultKeyframe(time, properties, values) {
  return {
    time,
    values: { ...values },
    easing: "linear"
  };
}
function cloneTrack(track) {
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({ ...k, values: { ...k.values } }))
  };
}
function createDefaultCameraData() {
  return { fov: 45, target: { x: 0, y: 1, z: 0 }, keyframes: [] };
}
function evaluateCameraKeyframes(keyframes, time, fovFallback = 45) {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const poseOf = (k) => ({
    position: k.position,
    target: k.target,
    fov: k.fov ?? fovFallback
  });
  if (keyframes.length === 1 || time <= sorted[0].time) {
    return poseOf(sorted[0]);
  }
  if (time >= sorted[sorted.length - 1].time) {
    return poseOf(sorted[sorted.length - 1]);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (time >= start.time && time <= end.time) {
      const dur = end.time - start.time;
      const progress = dur > 0 ? (time - start.time) / dur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const lerp = (a, b) => a + (b - a) * eased;
      const fovA = start.fov ?? fovFallback;
      const fovB = end.fov ?? fovFallback;
      return {
        position: {
          x: lerp(start.position.x, end.position.x),
          y: lerp(start.position.y, end.position.y),
          z: lerp(start.position.z, end.position.z)
        },
        target: {
          x: lerp(start.target.x, end.target.x),
          y: lerp(start.target.y, end.target.y),
          z: lerp(start.target.z, end.target.z)
        },
        fov: lerp(fovA, fovB)
      };
    }
  }
  return poseOf(sorted[sorted.length - 1]);
}
var TRANSFORM_PROPERTIES = [
  "px",
  "py",
  "pz",
  "rx",
  "ry",
  "rz",
  "sx",
  "sy",
  "sz",
  "o"
];
var TRANSFORM_PROPERTY_LABELS = {
  px: "Posici\xF3n X",
  py: "Posici\xF3n Y",
  pz: "Posici\xF3n Z",
  rx: "Rotaci\xF3n X",
  ry: "Rotaci\xF3n Y",
  rz: "Rotaci\xF3n Z",
  sx: "Escala X",
  sy: "Escala Y",
  sz: "Escala Z",
  o: "Opacidad"
};
function evaluateTransformTrack(track, time) {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0 ? (time % track.duration + track.duration) % track.duration : time;
  if (effectiveTime <= sorted[0].time) {
    return { ...sorted[0].values ?? {} };
  }
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return { ...sorted[sorted.length - 1].values ?? {} };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const props = Array.from(
        /* @__PURE__ */ new Set([...Object.keys(start.values ?? {}), ...Object.keys(end.values ?? {})])
      );
      const result = {};
      for (const prop of props) {
        const from = (start.values ?? {})[prop];
        const to = (end.values ?? {})[prop];
        if (from === void 0 && to === void 0) continue;
        result[prop] = from !== void 0 && to !== void 0 ? from + (to - from) * eased : to ?? from;
      }
      return result;
    }
  }
  return { ...sorted[sorted.length - 1].values ?? {} };
}
function evaluatePluginParamTrack(track, time) {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0 ? (time % track.duration + track.duration) % track.duration : time;
  if (effectiveTime <= sorted[0].time) return sorted[0].value;
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      return start.value + (end.value - start.value) * eased;
    }
  }
  return sorted[sorted.length - 1].value;
}
function upsertKeyframeAt(keyframes, kf, epsilon = 1e-4) {
  const existing = keyframes.findIndex((k) => Math.abs(k.time - kf.time) < epsilon);
  if (existing >= 0) {
    const next = [...keyframes];
    next[existing] = kf;
    return next.sort((a, b) => a.time - b.time);
  }
  return [...keyframes, kf].sort((a, b) => a.time - b.time);
}
function diffTransform(from, to, eps = 1e-4) {
  const result = {};
  for (const prop of TRANSFORM_PROPERTIES) {
    const a = from[prop];
    const b = to[prop];
    if (a === void 0 || b === void 0) continue;
    if (Math.abs(b - a) > eps) result[prop] = b;
  }
  return result;
}
function createTransformTrack(objectId, transform, duration = 5) {
  return {
    id: `ttrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    name: "Transformaci\xF3n",
    duration,
    looping: false,
    keyframes: [
      {
        time: 0,
        values: TRANSFORM_PROPERTIES.reduce((acc, p) => {
          if (transform[p] !== void 0) acc[p] = transform[p];
          return acc;
        }, {}),
        easing: "linear"
      }
    ]
  };
}
function createGroupTransformTrack(objectIds, transform, duration = 5) {
  if (objectIds.length === 0) {
    return createTransformTrack("", transform, duration);
  }
  const mainId = objectIds[0];
  const rest = objectIds.slice(1);
  return {
    id: `ttrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId: mainId,
    name: "Grupo",
    duration,
    looping: false,
    keyframes: [
      {
        time: 0,
        values: TRANSFORM_PROPERTIES.reduce((acc, p) => {
          if (transform[p] !== void 0) acc[p] = transform[p];
          return acc;
        }, {}),
        easing: "linear"
      }
    ],
    objectIds: rest.length > 0 ? rest : void 0
  };
}
function createPluginParamTrack(objectId, pluginId, paramId, value, duration = 5) {
  return {
    id: `ptrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    pluginId,
    paramId,
    duration,
    looping: false,
    keyframes: [{ time: 0, value, easing: "linear" }]
  };
}
function motionMaxDuration(transformTracks, pluginTracks, effectTracks = [], deformadorTracks = []) {
  let max = 0;
  for (const t of transformTracks) max = Math.max(max, t.duration);
  for (const t of pluginTracks) max = Math.max(max, t.duration);
  for (const t of effectTracks) max = Math.max(max, t.duration);
  for (const t of deformadorTracks) max = Math.max(max, t.duration);
  return max;
}
function evaluateEffectTrack(track, time) {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0 ? (time % track.duration + track.duration) % track.duration : time;
  if (effectiveTime <= sorted[0].time) {
    return { ...sorted[0].values ?? {} };
  }
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return { ...sorted[sorted.length - 1].values ?? {} };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const props = Array.from(
        /* @__PURE__ */ new Set([...Object.keys(start.values ?? {}), ...Object.keys(end.values ?? {})])
      );
      const result = {};
      for (const prop of props) {
        const from = (start.values ?? {})[prop];
        const to = (end.values ?? {})[prop];
        if (from === void 0 && to === void 0) continue;
        if (typeof from === "boolean" || typeof to === "boolean") {
          result[prop] = from !== void 0 ? from : to;
        } else if (typeof from === "string" || typeof to === "string") {
          result[prop] = from !== void 0 ? from : to;
        } else {
          const numFrom = from;
          const numTo = to;
          if (numFrom !== void 0 && numTo !== void 0) {
            result[prop] = numFrom + (numTo - numFrom) * eased;
          } else {
            result[prop] = from !== void 0 ? from : to;
          }
        }
      }
      return result;
    }
  }
  return { ...sorted[sorted.length - 1].values ?? {} };
}
var EFFECT_PROPERTY_PRESETS = {
  rain: ["enabled", "count", "speed"],
  smoke: ["enabled", "count", "size", "color", "riseSpeed"],
  stars: ["enabled", "starSize"],
  fire: ["enabled", "count", "size", "intensity"],
  sparks: ["enabled", "count", "size"],
  glow: ["enabled", "glowColor", "glowIntensity", "glowObjects"]
};
var EFFECT_TYPE_LABELS = {
  rain: "Lluvia",
  smoke: "Humo",
  stars: "Estrellas",
  fire: "Fuego",
  sparks: "Chispas",
  glow: "Brillo"
};
function createEffectTrack(effectType, duration = 5, objectId = null) {
  return {
    id: `etrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    effectType,
    objectId,
    duration,
    looping: false,
    keyframes: [
      {
        time: 0,
        values: { enabled: true },
        easing: "linear"
      }
    ]
  };
}
function evaluateDeformadorTrack(track, time) {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0 ? (time % track.duration + track.duration) % track.duration : time;
  if (effectiveTime <= sorted[0].time) {
    return { ...sorted[0].values ?? {} };
  }
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return { ...sorted[sorted.length - 1].values ?? {} };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const props = Array.from(
        /* @__PURE__ */ new Set([...Object.keys(start.values ?? {}), ...Object.keys(end.values ?? {})])
      );
      const result = {};
      for (const prop of props) {
        const from = (start.values ?? {})[prop];
        const to = (end.values ?? {})[prop];
        if (from === void 0 && to === void 0) continue;
        if (typeof from === "boolean" || typeof to === "boolean") {
          result[prop] = from !== void 0 ? from : to;
        } else if (typeof from === "string" || typeof to === "string") {
          result[prop] = from !== void 0 ? from : to;
        } else {
          const numFrom = from;
          const numTo = to;
          if (numFrom !== void 0 && numTo !== void 0) {
            result[prop] = numFrom + (numTo - numFrom) * eased;
          } else {
            result[prop] = from !== void 0 ? from : to;
          }
        }
      }
      return result;
    }
  }
  return { ...sorted[sorted.length - 1].values ?? {} };
}
function createDeformadorTrack(objectId, deformadorId, defaults, duration = 5) {
  return {
    id: `dtrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    deformadorId,
    duration,
    looping: false,
    keyframes: []
  };
}
function msToSeconds(ms) {
  return ms / 1e3;
}
function sToMs(s) {
  return s * 1e3;
}
function animationTrackToUnified(track) {
  const properties = OBJECT_PROPERTIES.map((p) => ({
    key: p,
    label: KEYFRAME_PROPERTY_LABELS[p],
    valueType: "number"
  }));
  return {
    id: track.id,
    kind: "animation",
    name: track.name,
    objectId: track.objectId,
    originalId: track.id,
    duration: msToSeconds(track.duration),
    looping: track.looping,
    keyframes: track.keyframes.map((kf) => ({
      time: msToSeconds(kf.time),
      values: { ...kf.values ?? {} },
      easing: kf.easing
    })),
    properties
  };
}
function transformTrackToUnified(track) {
  const properties = TRANSFORM_PROPERTIES.map((p) => ({
    key: p,
    label: TRANSFORM_PROPERTY_LABELS[p],
    valueType: "number"
  }));
  return {
    id: `ttrack-${track.id}`,
    kind: "transform",
    name: track.name || `Objeto: ${track.objectId}`,
    objectId: track.objectId,
    originalId: track.id,
    duration: track.duration,
    looping: track.looping,
    keyframes: track.keyframes.map((kf) => ({
      time: kf.time,
      values: { ...kf.values ?? {} },
      easing: kf.easing
    })),
    properties
  };
}
function pluginParamTrackToUnified(track) {
  const label = `${track.paramId}`;
  const properties = [
    { key: "value", label, valueType: "number" }
  ];
  return {
    id: `ptrack-${track.id}`,
    kind: "plugin",
    name: `${track.pluginId} \u203A ${track.paramId}`,
    objectId: track.objectId,
    originalId: track.id,
    duration: track.duration,
    looping: track.looping,
    keyframes: track.keyframes.map((kf) => ({
      time: kf.time,
      values: { value: kf.value },
      easing: kf.easing
    })),
    properties
  };
}
function effectTrackToUnified(track) {
  const presets = EFFECT_PROPERTY_PRESETS[track.effectType];
  const properties = presets.map((p) => {
    const labels = {
      enabled: "Activado",
      count: "Cuenta",
      speed: "Velocidad",
      size: "Tama\xF1o",
      intensity: "Intensidad",
      color: "Color",
      riseSpeed: "Vel. Elevaci\xF3n",
      starSize: "Tama\xF1o Estrella",
      glowColor: "Color Brillo",
      glowIntensity: "Intensidad Brillo",
      glowObjects: "Objetos Brillo"
    };
    const valueType = p === "color" || p === "glowColor" ? "string" : p === "enabled" || p === "glowObjects" ? "boolean" : "number";
    return { key: p, label: labels[p] || p, valueType };
  });
  return {
    id: `etrack-${track.id}`,
    kind: "effect",
    name: `${EFFECT_TYPE_LABELS[track.effectType]}`,
    objectId: track.objectId ?? null,
    originalId: track.id,
    duration: track.duration,
    looping: track.looping,
    keyframes: track.keyframes.map((kf) => ({
      time: kf.time,
      values: { ...kf.values ?? {} },
      easing: kf.easing
    })),
    properties
  };
}
function unifiedTracksMaxDuration(tracks) {
  return tracks.reduce((max, t) => Math.max(max, t.duration), 0);
}
function buildUnifiedTracks(animationTracks = [], transformTracks = [], pluginTracks = [], effectTracks = []) {
  return [
    ...animationTracks.map(animationTrackToUnified),
    ...transformTracks.map(transformTrackToUnified),
    ...pluginTracks.map(pluginParamTrackToUnified),
    ...effectTracks.map(effectTrackToUnified)
  ];
}
function allTracksMaxDuration(animationTracks = [], transformTracks = [], pluginTracks = [], effectTracks = []) {
  let max = 0;
  const unified = buildUnifiedTracks(animationTracks, transformTracks, pluginTracks, effectTracks);
  for (const t of unified) max = Math.max(max, t.duration);
  return max;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EASING_OPTIONS,
  EFFECT_PROPERTY_PRESETS,
  EFFECT_TYPE_LABELS,
  KEYFRAME_PROPERTY_LABELS,
  OBJECT_PROPERTIES,
  TRANSFORM_PROPERTIES,
  TRANSFORM_PROPERTY_LABELS,
  allTracksMaxDuration,
  animationTrackToUnified,
  buildUnifiedTracks,
  cloneTrack,
  createDefaultCameraData,
  createDefaultKeyframe,
  createDefaultTrack,
  createDeformadorTrack,
  createEffectTrack,
  createGroupTransformTrack,
  createPluginParamTrack,
  createTransformTrack,
  diffTransform,
  effectTrackToUnified,
  evaluateCameraKeyframes,
  evaluateDeformadorTrack,
  evaluateEffectTrack,
  evaluatePluginParamTrack,
  evaluateTrack,
  evaluateTransformTrack,
  findKeyframeSegment,
  getEasingFunction,
  interpolateValue,
  motionMaxDuration,
  pluginParamTrackToUnified,
  transformTrackToUnified,
  unifiedTimeMs,
  unifiedTracksMaxDuration,
  upsertKeyframeAt
});
