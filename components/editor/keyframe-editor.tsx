'use client';

import type { FC } from 'react';
import { Download } from 'lucide-react';
import {
  AnimationTrack,
  Keyframe,
  KeyframeProperty,
  EasingFunction,
  createDefaultTrack,
  OBJECT_PROPERTIES,
  KEYFRAME_PROPERTY_LABELS,
  EASING_OPTIONS,
  UnifiedTrack,
  animationTrackToUnified,
} from '@/lib/animation';

interface KeyframeEditorProps {
  tracks: AnimationTrack[];
  setTracks: (tracks: AnimationTrack[]) => void;
  /** Tracks from the motion editor (transform, plugin, effect) in unified form. */
  motionTracks?: UnifiedTrack[];
  /** Dispatch a motion-track keyframe edit back to the motion state. */
  onMotionTrackUpdate?: (trackId: string, updates: {
    duration?: number;
    looping?: boolean;
  }) => void;
  onMotionKeyframeTimeChange?: (trackId: string, kfIndex: number, newTime: number) => void;
  onMotionKeyframeDelete?: (trackId: string, kfIndex: number) => void;
  onMotionKeyframeEasingChange?: (trackId: string, kfIndex: number, easing: EasingFunction) => void;
  onMotionKeyframeValueChange?: (trackId: string, kfIndex: number, propKey: string, value: number | string | boolean) => void;
  onMotionAddKeyframe?: (trackId: string, time: number) => void;
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  sceneObjects: { id: string; id_label?: string; name?: string }[];
  /** Hay cámara-objeto con ≥2 fotogramas: se puede exportar MP4 */
  canExportMp4?: boolean;
  /** Duración del recorrido de la cámara-objeto (s): amplía el scrubbing */
  cameraSpan?: number;
  onExportMp4?: () => void;
  exportProgress?: number | null;
  exportResult?: { success: boolean; outputPath?: string; error?: string } | null;
}

function valueToString(val: number | string | boolean): string {
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  return String(val);
}

export const KeyframeEditor: FC<KeyframeEditorProps> = ({
  tracks,
  setTracks,
  motionTracks = [],
  onMotionTrackUpdate,
  onMotionKeyframeTimeChange,
  onMotionKeyframeDelete,
  onMotionKeyframeEasingChange,
  onMotionKeyframeValueChange,
  onMotionAddKeyframe,
  selectedTrackId,
  setSelectedTrackId,
  playing,
  setPlaying,
  currentTime,
  setCurrentTime,
  sceneObjects,
  canExportMp4 = false,
  cameraSpan = 0,
  onExportMp4,
  exportProgress,
  exportResult,
}) => {
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;
  const selectedMotionTrack = motionTracks.find((t) => t.id === selectedTrackId) ?? null;
  const isMotionSelected = !!selectedMotionTrack && !selectedTrack;

  const handleAddObjectTrack = (objectId: string) => {
    const newTrack = createDefaultTrack(objectId, `Objeto: ${objectId}`, 3);
    setTracks([...tracks, newTrack]);
    setSelectedTrackId(newTrack.id);
  };

  const handleDeleteTrack = (id: string) => {
    setTracks(tracks.filter((t) => t.id !== id));
    if (selectedTrackId === id) setSelectedTrackId(null);
  };

  const handleAddKeyframe = () => {
    if (!selectedTrack) return;
    const newKeyframe: Keyframe = {
      time: currentTime * 1000,
      values: {},
      easing: 'linear',
    };
    const updatedTracks = tracks.map((t) => {
      if (t.id !== selectedTrackId) return t;
      const sorted = [...t.keyframes, newKeyframe].sort((a, b) => a.time - b.time);
      return { ...t, keyframes: sorted };
    });
    setTracks(updatedTracks);
  };

  const handleAddMotionKeyframe = () => {
    if (!selectedMotionTrack) return;
    onMotionAddKeyframe?.(selectedMotionTrack.originalId, currentTime);
  };

  const handleDeleteKeyframe = (index: number) => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) => {
      if (t.id !== selectedTrackId) return t;
      return { ...t, keyframes: t.keyframes.filter((_, i) => i !== index) };
    });
    setTracks(updatedTracks);
  };

  const handleUpdateKeyframeValue = (index: number, prop: KeyframeProperty, value: number) => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) => {
      if (t.id !== selectedTrackId) return t;
      return {
        ...t,
         keyframes: t.keyframes.map((kf, i) =>
          i === index ? { ...kf, values: { ...(kf.values ?? {}), [prop]: value } } : kf
         ),
      };
    });
    setTracks(updatedTracks);
  };

  const handleUpdateKeyframeEasing = (index: number, easing: EasingFunction) => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) => {
      if (t.id !== selectedTrackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.map((kf, i) =>
          i === index ? { ...kf, easing } : kf
        ),
      };
    });
    setTracks(updatedTracks);
  };

  const handleUpdateKeyframeTime = (index: number, time: number) => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) => {
      if (t.id !== selectedTrackId) return t;
      return {
        ...t,
        keyframes: t.keyframes.map((kf, i) => (i === index ? { ...kf, time } : kf)),
      };
    });
    setTracks(updatedTracks);
  };

  const handleUpdateTrackDuration = (duration: number) => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) =>
      t.id === selectedTrackId ? { ...t, duration } : t
    );
    setTracks(updatedTracks);
  };

  const handleToggleLooping = () => {
    if (!selectedTrack) return;
    const updatedTracks = tracks.map((t) =>
      t.id === selectedTrackId ? { ...t, looping: !t.looping } : t
    );
    setTracks(updatedTracks);
  };

  // --- Motion track handlers ---

  const handleMotionTrackDuration = (duration: number) => {
    if (!selectedMotionTrack) return;
    onMotionTrackUpdate?.(selectedMotionTrack.originalId, { duration });
  };

  const handleMotionToggleLooping = () => {
    if (!selectedMotionTrack) return;
    onMotionTrackUpdate?.(selectedMotionTrack.originalId, { looping: !selectedMotionTrack.looping });
  };

  const handleMotionKeyframeTime = (kfIndex: number, timeSec: number) => {
    if (!selectedMotionTrack) return;
    onMotionKeyframeTimeChange?.(selectedMotionTrack.originalId, kfIndex, timeSec);
  };

  const handleMotionKeyframeDelete = (kfIndex: number) => {
    if (!selectedMotionTrack) return;
    onMotionKeyframeDelete?.(selectedMotionTrack.originalId, kfIndex);
  };

  const handleMotionKeyframeEasing = (kfIndex: number, easing: EasingFunction) => {
    if (!selectedMotionTrack) return;
    onMotionKeyframeEasingChange?.(selectedMotionTrack.originalId, kfIndex, easing);
  };

  const handleMotionKeyframeValue = (kfIndex: number, propKey: string, value: number | string | boolean) => {
    if (!selectedMotionTrack) return;
    onMotionKeyframeValueChange?.(selectedMotionTrack.originalId, kfIndex, propKey, value);
  };

  // --- Combined max duration for time slider ---
  const animationMaxDuration = tracks.reduce((max, t) => Math.max(max, t.duration / 1000), 0);
  const motionMaxDuration = motionTracks.reduce((max, t) => Math.max(max, t.duration), 0);
  const combinedMaxDuration = Math.max(animationMaxDuration, motionMaxDuration, cameraSpan, 3);

  // Combined list of all tracks (animation + motion) for the overview section
  const allTracks = [
    ...tracks.map((t) => ({ kind: 'animation' as const, track: t })),
    ...motionTracks.map((t) => ({ kind: 'motion' as const, track: t })),
  ];

  return (
    <div
      className="flex flex-col gap-3 p-3 text-xs custom-scrollbar overflow-y-auto"
      style={{ maxHeight: 'calc(100vh - 400px)' }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-green-300">Animación</span>
        <div className="flex gap-1">
          {!selectedTrack && !selectedMotionTrack && sceneObjects.length > 0 && (
            <button
              onClick={() => handleAddObjectTrack(sceneObjects[0].id)}
              className="px-2 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300"
            >
              + Objeto
            </button>
          )}
          {(selectedTrack || selectedMotionTrack) && (
            <>
              {selectedTrack && (
                <button
                  onClick={() => handleDeleteTrack(selectedTrack.id)}
                  className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300"
                  title="Eliminar pista"
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-muted-foreground">Pistas:</label>
        <select
          value={selectedTrackId ?? ''}
          onChange={(e) => setSelectedTrackId(e.target.value || null)}
          className="flex-1 px-2 py-1 rounded bg-black/30 border border-white/10 text-foreground text-xs"
        >
          <option value="">Seleccionar pista</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name} {track.looping ? '↻' : ''}
            </option>
          ))}
          {motionTracks.length > 0 && (
            <optgroup label="Editor de movimiento">
              {motionTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name} {track.looping ? '↻' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {selectedTrack && !isMotionSelected && (
        <>
          <div className="flex items-center gap-2">
            <label className="w-20 text-muted-foreground">Duración:</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={selectedTrack.duration / 1000}
              onChange={(e) => handleUpdateTrackDuration((parseFloat(e.target.value) || 0.1) * 1000)}
              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
            />
            <span className="text-muted-foreground">s</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-20 text-muted-foreground">Looping:</label>
            <button
              onClick={handleToggleLooping}
              className={`px-2 py-1 rounded text-xs font-medium ${
                selectedTrack.looping
                  ? 'bg-green-500/30 text-green-300'
                  : 'bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              {selectedTrack.looping ? 'Encendido' : 'Apagado'}
            </button>
          </div>
        </>
      )}

      {selectedMotionTrack && isMotionSelected && (
        <>
          <div className="flex items-center gap-2">
            <label className="w-20 text-muted-foreground">Duración:</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={selectedMotionTrack.duration}
              onChange={(e) => handleMotionTrackDuration(parseFloat(e.target.value) || 0.1)}
              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
            />
            <span className="text-muted-foreground">s</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-20 text-muted-foreground">Looping:</label>
            <button
              onClick={handleMotionToggleLooping}
              className={`px-2 py-1 rounded text-xs font-medium ${
                selectedMotionTrack.looping
                  ? 'bg-green-500/30 text-green-300'
                  : 'bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              {selectedMotionTrack.looping ? 'Encendido' : 'Apagado'}
            </button>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <label className="w-20 text-muted-foreground">Tiempo:</label>
        <input
          type="range"
          min={0.01}
          max={combinedMaxDuration}
          step={0.01}
          value={currentTime}
          onChange={(e) => setCurrentTime(Math.max(parseFloat(e.target.value) || 0.01, 0.01))}
          className="flex-1"
        />
        <span className="w-12 text-right text-foreground">{currentTime.toFixed(2)}s</span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setPlaying(!playing)}
          data-testid="play-animation-btn"
          className={`px-3 py-1 rounded text-xs font-medium ${
            playing
              ? 'bg-green-500/20 text-green-300'
              : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
          }`}
        >
          {playing ? '⏸' : '▶'}
        </button>
        {(selectedTrack || selectedMotionTrack) && (
          <button
            onClick={() => {
              if (isMotionSelected) handleAddMotionKeyframe();
              else handleAddKeyframe();
            }}
            className="px-3 py-1 rounded text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
            title="Añadir fotograma clave"
          >
            + Fotograma
          </button>
        )}
      </div>

        {/* Botón de exportación MP4 y barra de progreso: requiere una
            cámara-objeto con ≥2 fotogramas (la cámara del recorrido). */}
        {canExportMp4 && (
          <div className="flex flex-col gap-1.5">
            {exportProgress != null && exportProgress < 100 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-green-300">Exportando MP4... {exportProgress}%</span>
                <div className="flex-1 h-1 bg-white/10 rounded overflow-hidden">
                  <div className="h-full bg-green-500 transition-all" style={{ width: exportProgress + '%' }} />
                </div>
              </div>
            )}
            {exportResult && exportProgress == null && (
              <div className="text-xs">
                {exportResult.success ? (
                  <span className="text-green-300">✓ MP4 exportado: {exportResult.outputPath}</span>
                ) : (
                  <span className="text-red-300">✗ {exportResult.error}</span>
                )}
              </div>
            )}
            {exportProgress == null && !exportResult && onExportMp4 && (
              <button
                onClick={onExportMp4}
                className="px-3 py-1 rounded text-xs font-medium bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 flex items-center gap-1"
                title="Exportar animación como MP4"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar MP4
              </button>
            )}
          </div>
        )}

        {/* Selected track keyframes table (editable) */}
        {selectedTrack && !isMotionSelected && (
          <div className="border border-white/10 rounded-md overflow-auto thin-scrollbar max-h-64">
          <table className="w-full border-collapse text-xs min-w-[400px]">
            <thead>
              <tr>
                <th className="text-left p-1 text-muted-foreground">#</th>
                <th className="text-left p-1 text-muted-foreground">Tiempo (s)</th>
                <th className="text-left p-1 text-muted-foreground">Interpolación</th>
                {OBJECT_PROPERTIES.map((prop) => (
                  <th key={prop} className="text-left p-1 text-muted-foreground">
                    {KEYFRAME_PROPERTY_LABELS[prop]}
                  </th>
                ))}
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {selectedTrack.keyframes
                .slice()
                .sort((a, b) => a.time - b.time)
                .map((kf, index) => (
                  <tr key={index} className="border-t border-white/5">
                    <td className="p-1">{index + 1}</td>
                    <td className="p-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={kf.time / 1000}
                        onChange={(e) =>
                          handleUpdateKeyframeTime(index, (parseFloat(e.target.value) || 0) * 1000)
                        }
                        className="w-12 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                      />
                    </td>
                    <td className="p-1">
                      <select
                        value={kf.easing}
                        onChange={(e) =>
                          handleUpdateKeyframeEasing(index, e.target.value as EasingFunction)
                        }
                        className="px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                      >
                        {EASING_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    {OBJECT_PROPERTIES.map((prop) => (
                      <td key={prop} className="p-1">
                        <input
                          type="number"
                          step="0.01"
                           value={kf.values?.[prop] ?? ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              handleUpdateKeyframeValue(index, prop, val);
                            }
                          }}
                          className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <button
                        onClick={() => handleDeleteKeyframe(index)}
                        className="px-1 py-0.5 rounded hover:bg-red-500/20 text-red-300"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        )}

        {/* Selected motion track keyframes table (editable) */}
        {selectedMotionTrack && isMotionSelected && (
          <div className="border border-white/10 rounded-md overflow-auto thin-scrollbar max-h-64">
          <table className="w-full border-collapse text-xs min-w-[500px]">
            <thead>
              <tr>
                <th className="text-left p-1 text-muted-foreground">#</th>
                <th className="text-left p-1 text-muted-foreground">Tiempo (s)</th>
                <th className="text-left p-1 text-muted-foreground">Interpolación</th>
                {selectedMotionTrack.properties.map((prop) => (
                  <th key={prop.key} className="text-left p-1 text-muted-foreground">
                    {prop.label}
                  </th>
                ))}
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {selectedMotionTrack.keyframes
                .slice()
                .sort((a, b) => a.time - b.time)
                .map((kf, index) => (
                  <tr key={index} className="border-t border-white/5">
                    <td className="p-1">{index + 1}</td>
                    <td className="p-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={kf.time}
                        onChange={(e) =>
                          handleMotionKeyframeTime(index, parseFloat(e.target.value) || 0)
                        }
                        className="w-12 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                      />
                    </td>
                    <td className="p-1">
                      <select
                        value={kf.easing}
                        onChange={(e) =>
                          handleMotionKeyframeEasing(index, e.target.value as EasingFunction)
                        }
                        className="px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                      >
                        {EASING_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    {selectedMotionTrack.properties.map((prop) => {
                      const val = kf.values[prop.key];
                      return (
                        <td key={prop.key} className="p-1">
                          {prop.valueType === 'string' ? (
                            <input
                              type="text"
                              value={typeof val === 'string' ? val : ''}
                              onChange={(e) =>
                                handleMotionKeyframeValue(index, prop.key, e.target.value)
                              }
                              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                              placeholder={prop.label}
                            />
                          ) : prop.valueType === 'boolean' ? (
                            <select
                              value={val !== undefined ? String(val) : ''}
                              onChange={(e) =>
                                handleMotionKeyframeValue(index, prop.key, e.target.value === 'true')
                              }
                              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                            >
                              <option value="true">Sí</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={typeof val === 'number' ? val : ''}
                              onChange={(e) => {
                                const numVal = parseFloat(e.target.value);
                                if (!isNaN(numVal)) {
                                  handleMotionKeyframeValue(index, prop.key, numVal);
                                }
                              }}
                              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground text-xs"
                              placeholder="0"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="p-1">
                      <button
                        onClick={() => handleMotionKeyframeDelete(index)}
                        className="px-1 py-0.5 rounded hover:bg-red-500/20 text-red-300"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        )}

        {/* --- All tracks overview: shows ALL tracks with ALL keyframes (read-only) --- */}
        {allTracks.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-cyan-300">Todas las pistas</span>
              <span className="text-muted-foreground text-xs">
                Duración total: {combinedMaxDuration.toFixed(2)}s
              </span>
            </div>
            {allTracks.map((entry) => {
              if (entry.kind === 'animation') {
                const track = entry.track;
                const unified = animationTrackToUnified(track);
                const sortedKeyframes = [...unified.keyframes].sort((a, b) => a.time - b.time);

                return (
                  <div key={track.id} className="border border-white/10 rounded-md overflow-auto thin-scrollbar mb-2">
                    <div className="flex items-center justify-between px-2 py-1 bg-black/20 border-b border-white/5 text-xs">
                      <span className="font-medium text-cyan-300">{track.name}</span>
                      <span className="text-muted-foreground">
                        {(track.duration / 1000).toFixed(2)}s {track.looping ? '↻' : ''}
                      </span>
                    </div>
                    <table className="w-full border-collapse text-xs min-w-[500px]">
                      <thead>
                        <tr>
                          <th className="text-left p-1 text-muted-foreground">#</th>
                          <th className="text-left p-1 text-muted-foreground">Tiempo (s)</th>
                          <th className="text-left p-1 text-muted-foreground">Interpolación</th>
                          {unified.properties.map((prop) => (
                            <th key={prop.key} className="text-left p-1 text-muted-foreground">
                              {prop.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedKeyframes.map((kf, index) => (
                          <tr key={index} className="border-t border-white/5">
                            <td className="p-1">{index + 1}</td>
                            <td className="p-1 text-muted-foreground">{kf.time.toFixed(2)}</td>
                            <td className="p-1 text-muted-foreground">{kf.easing}</td>
                            {unified.properties.map((prop) => (
                              <td key={prop.key} className="p-1 text-muted-foreground">
                                {kf.values[prop.key] !== undefined
                                  ? valueToString(kf.values[prop.key] as number | string | boolean)
                                  : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              // Motion track in overview
              const track = entry.track;
              const sortedKeyframes = [...track.keyframes].sort((a, b) => a.time - b.time);

              return (
                <div key={track.id} className="border border-white/10 rounded-md overflow-auto thin-scrollbar mb-2">
                  <div className="flex items-center justify-between px-2 py-1 bg-black/20 border-b border-white/5 text-xs">
                    <span className="font-medium text-cyan-300">{track.name}</span>
                    <span className="text-muted-foreground">
                      {track.duration.toFixed(2)}s {track.looping ? '↻' : ''}
                    </span>
                  </div>
                  <table className="w-full border-collapse text-xs min-w-[500px]">
                    <thead>
                      <tr>
                        <th className="text-left p-1 text-muted-foreground">#</th>
                        <th className="text-left p-1 text-muted-foreground">Tiempo (s)</th>
                        <th className="text-left p-1 text-muted-foreground">Interpolación</th>
                        {track.properties.map((prop) => (
                          <th key={prop.key} className="text-left p-1 text-muted-foreground">
                            {prop.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedKeyframes.map((kf, index) => (
                        <tr key={index} className="border-t border-white/5">
                          <td className="p-1">{index + 1}</td>
                          <td className="p-1 text-muted-foreground">{kf.time.toFixed(2)}</td>
                          <td className="p-1 text-muted-foreground">{kf.easing}</td>
                          {track.properties.map((prop) => (
                            <td key={prop.key} className="p-1 text-muted-foreground">
                              {kf.values[prop.key] !== undefined
                                ? valueToString(kf.values[prop.key] as number | string | boolean)
                                : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
};
