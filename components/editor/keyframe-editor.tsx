'use client';

import type { FC } from 'react';
import {
  AnimationTrack,
  Keyframe,
  KeyframeProperty,
  EasingFunction,
  createDefaultTrack,
  createDefaultKeyframe,
  cloneTrack,
  evaluateTrack,
  CAMERA_PROPERTIES,
  OBJECT_PROPERTIES,
  KEYFRAME_PROPERTY_LABELS,
  EASING_OPTIONS,
} from '@/lib/animation';

interface KeyframeEditorProps {
  tracks: AnimationTrack[];
  setTracks: (tracks: AnimationTrack[]) => void;
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  sceneObjects: { id: string; id_label?: string; name?: string }[];
  panelCameras: Record<string, { zoom: number; offsetX: number; offsetY: number; rotationX: number; rotationY: number }>;
  isRecordingCameraPath?: boolean;
  onStartCameraRecording?: () => void;
  onStopCameraRecording?: () => void;
}

export const KeyframeEditor: FC<KeyframeEditorProps> = ({
  tracks,
  setTracks,
  selectedTrackId,
  setSelectedTrackId,
  playing,
  setPlaying,
  currentTime,
  setCurrentTime,
  sceneObjects,
  panelCameras,
  isRecordingCameraPath = false,
  onStartCameraRecording,
  onStopCameraRecording,
}) => {
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;

  const handleAddTrack = () => {
    const newTrack = createDefaultTrack(null, 'Cámara', 3);
    setTracks([...tracks, newTrack]);
    setSelectedTrackId(newTrack.id);
  };

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
      time: currentTime,
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

  const getPropertyColumns = (): KeyframeProperty[] => {
    if (!selectedTrack) return [];
    const hasObjects = sceneObjects.length > 0;
    return selectedTrack.objectId === null
      ? (hasObjects ? [...CAMERA_PROPERTIES] : CAMERA_PROPERTIES)
      : OBJECT_PROPERTIES;
  };

  const properties = getPropertyColumns();

  return (
    <div className="flex flex-col gap-3 p-3 text-xs custom-scrollbar overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-green-300">Animación</span>
        <div className="flex gap-1">
          {!selectedTrack && (
            <>
              <button
                onClick={handleAddTrack}
                className="px-2 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300"
              >
                + Cámara
              </button>
              {sceneObjects.length > 0 && (
                <button
                  onClick={() => handleAddObjectTrack(sceneObjects[0].id)}
                  className="px-2 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300"
                >
                  + Objeto
                </button>
              )}
            </>
          )}
          {selectedTrack && (
            <>
              <button
                onClick={() => handleDeleteTrack(selectedTrack.id)}
                className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300"
                title="Eliminar pista"
              >
                ✕
              </button>
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
        </select>
      </div>

      {selectedTrack && (
        <>
          <div className="flex items-center gap-2">
            <label className="w-20 text-muted-foreground">Duración:</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={selectedTrack.duration}
              onChange={(e) => handleUpdateTrackDuration(parseFloat(e.target.value) || 0.1)}
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

      <div className="flex items-center gap-2">
        <label className="w-20 text-muted-foreground">Tiempo:</label>
        <input
          type="range"
          min={0.01}
          max={selectedTrack?.duration ?? 3}
          step={0.01}
          value={currentTime}
          onChange={(e) => setCurrentTime(Math.max(parseFloat(e.target.value) || 0.1, 0.01))}
          className="flex-1"
        />
        <span className="w-12 text-right text-foreground">{currentTime.toFixed(2)}s</span>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setPlaying(!playing)}
          className={`px-3 py-1 rounded text-xs font-medium ${
            playing
              ? 'bg-green-500/20 text-green-300'
              : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
          }`}
        >
          {playing ? '⏸' : '▶'}
        </button>
        {selectedTrack && (
          <button
            onClick={handleAddKeyframe}
            className="px-3 py-1 rounded text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
            title="Añadir fotograma clave"
          >
            + Fotograma
          </button>
        )}
        {onStartCameraRecording && (
          <button
            onClick={isRecordingCameraPath ? onStopCameraRecording : onStartCameraRecording}
            className={`px-3 py-1 rounded text-xs font-medium ${
              isRecordingCameraPath
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300'
                : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300'
            }`}
            title={isRecordingCameraPath ? 'Detener grabación de recorrido' : 'Grabar recorrido de cámara'}
          >
            {isRecordingCameraPath ? '● Detener' : 'Grabar recorrido'}
          </button>
        )}
      </div>

      {selectedTrack && properties.length > 0 && (
        <div className="border border-white/10 rounded-md overflow-auto thin-scrollbar max-h-64">
          <table className="w-full border-collapse text-xs min-w-[400px]">
            <thead>
              <tr>
                <th className="text-left p-1 text-muted-foreground">#</th>
                <th className="text-left p-1 text-muted-foreground">Tiempo (s)</th>
                <th className="text-left p-1 text-muted-foreground">Interpolación</th>
                {properties.map((prop) => (
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
                    {properties.map((prop) => (
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
                          placeholder={selectedTrack.objectId === null && prop === 'zoom' ? '1' : '0'}
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
    </div>
  );
};
