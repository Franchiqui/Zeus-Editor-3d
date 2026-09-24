'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import pb from '@/lib/pocketbase';
import { cn } from '@/lib/utils';
import { getInstrumentConfig } from '@/lib/instrumentSynth';
import { getMediaUrl } from '@/lib/electron-fs';
import { loadRhythmConfig, updateRhythmConfig } from '@/lib/rhythm-config-manager';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2, Music, Zap, Piano, RotateCcw, Drum } from 'lucide-react';
import GenerateMusicModal from '@/components/GenerateMusicModal';
import { useI18n } from '@/lib/i18n';

interface Note {
  id: number;
  name: string;
  octave: number;
  frequency: number;
  isBlack: boolean;
  isActive: boolean;
  midiNote: number;
}

interface KeyboardProps {
  onNotePlay?: (note: Note, velocity: number) => void;
  onNoteStop?: (note: Note) => void;
  octaveOffset?: number;
  initialVolume?: number;
  /** Volumen controlado externamente (0-1). Si se proporciona, el teclado usa este valor. */
  volume?: number;
  /** Octava controlada externamente (-2 a 2). Si se proporciona, el teclado usa este valor. */
  octave?: number;
  /** Sustain controlado externamente. Si se proporciona, el teclado usa este valor. */
  sustain?: boolean;
  /** Callback cuando cambia el volumen desde el teclado */
  onVolumeChange?: (value: number) => void;
  /** Callback cuando cambia la octava desde el teclado */
  onOctaveChange?: (value: number) => void;
  /** Callback cuando cambia el sustain desde el teclado */
  onSustainChange?: (value: boolean) => void;
  /** AudioContext externo (para conectar con el pipeline de la app). */
  audioContext?: BaseAudioContext;
  /** Nodo de salida (p.ej. master gain) donde conectar el audio del teclado. */
  outputNode?: AudioNode;
  /** Color de acento (p. ej. color de la habitación del editor). */
  accentColor?: string;
  /** Instrumento seleccionado: cambia el tipo de onda y la envolvente. */
  instrument?: string;
  /** Ritmos desde PocketBase (colección ritmos): cada uno es un campo de tipo file; el nombre del campo se muestra en el botón. */
  rhythmOptions?: { id: string; name: string; url: string }[];
  /** Si true, el volumen del slider solo afecta a la UI; el audio usa ganancia 1 (el padre aplica el volumen con un GainNode). */
  volumeOnlyForDisplay?: boolean;
  /** Ritmo controlado externamente. */
  rhythmEnabled?: boolean;
  /** Ritmos seleccionados controlados externamente. */
  selectedRhythms?: string[];
  /** Callback cuando cambia el estado de ritmo desde el teclado. */
  onRhythmEnabledChange?: (value: boolean) => void;
  /** Callback cuando cambian los ritmos seleccionados desde el teclado. */
  onSelectedRhythmsChange?: (value: string[]) => void;
  /** Ritmo seleccionado para editar velocidad (controlado externamente). */
  selectedRhythmForSpeed?: string;
  /** Ritmos seleccionados para editar velocidad (controlado externamente). */
  rhythmPlaybackRates?: Record<string, number>;
  /** Callback cuando cambia la velocidad de un ritmo. */
  onRhythmPlaybackRateChange?: (id: string, rate: number) => void;
  /** Callback cuando cambia el ritmo seleccionado para velocidad. */
  onSelectRhythmForSpeed?: (id: string) => void;
}

const WHITE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_KEYS = ['C#', 'D#', '', 'F#', 'G#', 'A#', ''];
const OCTAVES = 5;
const START_OCTAVE = 2;
const BASE_FREQUENCY = 440; // A4

const keyBindings = [
  { key: 'a', noteId: 0 },
  { key: 'w', noteId: 1 },
  { key: 's', noteId: 2 },
  { key: 'e', noteId: 3 },
  { key: 'd', noteId: 4 },
  { key: 'f', noteId: 5 },
  { key: 't', noteId: 6 },
  { key: 'g', noteId: 7 },
  { key: 'y', noteId: 8 },
  { key: 'h', noteId: 9 },
  { key: 'u', noteId: 10 },
  { key: 'j', noteId: 11 },
  { key: 'k', noteId: 12 },
  { key: 'o', noteId: 13 },
  { key: 'l', noteId: 14 },
  { key: 'p', noteId: 15 },
  { key: ';', noteId: 16 },
  { key: "'", noteId: 17 }
];

const calculateFrequency = (noteName: string, octave: number): number => {
  const noteIndex = WHITE_KEYS.indexOf(noteName.replace('#', ''));
  const semitonesFromA4 = (octave - 4) * 12 + noteIndex - (WHITE_KEYS.indexOf('A'));
  return BASE_FREQUENCY * Math.pow(2, semitonesFromA4 / 12);
};

const generateNotes = (octaveOffset: number = 0): Note[] => {
  const notes: Note[] = [];
  let midiNote = 36 + octaveOffset * 12; // C2 = MIDI 36
  
  for (let octave = START_OCTAVE; octave < START_OCTAVE + OCTAVES; octave++) {
    for (let i = 0; i < WHITE_KEYS.length; i++) {
      const noteName = WHITE_KEYS[i];
      const blackNoteName = BLACK_KEYS[i];
      
      // Add white key
      notes.push({
        id: notes.length,
        name: noteName,
        octave: octave + octaveOffset,
        frequency: calculateFrequency(noteName, octave + octaveOffset),
        isBlack: false,
        isActive: false,
        midiNote: midiNote
      });
      
      // Add black key if exists
      if (blackNoteName) {
        notes.push({
          id: notes.length + 100, // Offset to avoid ID conflicts
          name: blackNoteName,
          octave: octave + octaveOffset,
          frequency: calculateFrequency(blackNoteName, octave + octaveOffset),
          isBlack: true,
          isActive: false,
          midiNote: midiNote + 1
        });
      }
      
      midiNote += i === 2 || i === 6 ? 1 : 2; // Skip E->F and B->C
    }
  }
  
   return notes;
 };

 export const STATIC_RHYTHM_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
   id: `Tiktac_${i}`,
   name: `Tiktac_${i}`
 }));

 export default function Keyboard({
  onNotePlay,
  onNoteStop,
  octaveOffset = 0,
  initialVolume = 0.7,
  volume: controlledVolume,
  octave: controlledOctave,
  sustain: controlledSustain,
  onVolumeChange: onVolumeChangeProp,
  onOctaveChange: onOctaveChangeProp,
  onSustainChange: onSustainChangeProp,
  audioContext: externalAudioContext,
  outputNode: externalOutputNode,
  accentColor,
  instrument = 'acoustic_grand_piano',
  rhythmOptions = [],
  volumeOnlyForDisplay = false,
  rhythmEnabled: rhythmEnabledProp,
  selectedRhythms: selectedRhythmsProp,
  onRhythmEnabledChange,
  onSelectedRhythmsChange,
  selectedRhythmForSpeed,
  rhythmPlaybackRates,
  onRhythmPlaybackRateChange,
  onSelectRhythmForSpeed,
}: KeyboardProps) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<Note[]>(() => generateNotes(controlledOctave ?? octaveOffset));
  const [volume, setVolume] = useState(controlledVolume ?? initialVolume);
  const [octave, setOctave] = useState(controlledOctave ?? octaveOffset);
  const [sustain, setSustain] = useState(controlledSustain ?? false);
  const [rhythmEnabledInternal, setRhythmEnabledInternal] = useState(false);
  const [selectedRhythmsInternal, setSelectedRhythmsInternal] = useState<string[]>([]);
  const [localRhythmPaths, setLocalRhythmPaths] = useState<Record<string, string>>({});
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configuringRhythm, setConfiguringRhythm] = useState<{ id: string; name: string } | null>(null);
  const [tempPath, setTempPath] = useState('');
  const [userRhythmRecordId, setUserRhythmRecordId] = useState<string | null>(null);
  const [internalSelectedRhythmForSpeed, setInternalSelectedRhythmForSpeed] = useState<string>('');
  const [internalRhythmPlaybackRates, setInternalRhythmPlaybackRates] = useState<Record<string, number>>({});
  const [isRhythmSelectorOpen, setIsRhythmSelectorOpen] = useState(false);

  const isRhythmControlled = rhythmEnabledProp !== undefined || selectedRhythmsProp !== undefined;
  const rhythmEnabled = rhythmEnabledProp ?? rhythmEnabledInternal;
  const selectedRhythms = selectedRhythmsProp ?? selectedRhythmsInternal;
  const applyRhythmEnabled = useCallback((value: boolean) => {
    if (rhythmEnabledProp === undefined) setRhythmEnabledInternal(value);
    onRhythmEnabledChange?.(value);
  }, [rhythmEnabledProp, onRhythmEnabledChange]);
  const applySelectedRhythms = useCallback((value: string[]) => {
    if (selectedRhythmsProp === undefined) setSelectedRhythmsInternal(value);
    onSelectedRhythmsChange?.(value);
  }, [selectedRhythmsProp, onSelectedRhythmsChange]);
  const applySelectedRhythmForSpeed = useCallback((value: string) => {
    if (selectedRhythmForSpeed === undefined) setInternalSelectedRhythmForSpeed(value);
    onSelectRhythmForSpeed?.(value);
  }, [selectedRhythmForSpeed, onSelectRhythmForSpeed]);
  const handlePlaybackRateChange = useCallback((id: string, rate: number) => {
    if (onRhythmPlaybackRateChange) onRhythmPlaybackRateChange(id, rate);
    else setInternalRhythmPlaybackRates(prev => ({ ...prev, [id]: rate }));
    
    // Guardar en JSON
    updateRhythmConfig(id, { velocity: rate });
  }, [onRhythmPlaybackRateChange]);

  const isControlled = controlledVolume !== undefined || controlledOctave !== undefined || controlledSustain !== undefined;
  const effectiveVolume = isControlled && controlledVolume !== undefined ? controlledVolume : volume;
  const volumeForAudio = volumeOnlyForDisplay ? 1 : effectiveVolume;
  const effectiveOctave = isControlled && controlledOctave !== undefined ? controlledOctave : octave;
  const effectiveSustain = isControlled && controlledSustain !== undefined ? controlledSustain : sustain;

  // Cargar configuración desde archivo JSON (prioridad sobre PocketBase)
  useEffect(() => {
    const loadConfigFromJSON = async () => {
      try {
        const config = await loadRhythmConfig();
        
        // Cargar las rutas de los archivos y velocidades desde JSON
        const paths: Record<string, string> = {};
        const playbackRates: Record<string, number> = {};
        
        config.rhythms.forEach(rhythm => {
          if (rhythm.filePath) {
            paths[rhythm.id] = rhythm.filePath;
          }
          if (rhythm.velocity !== undefined) {
            playbackRates[rhythm.id] = rhythm.velocity;
          }
        });
        
        // Establecer los datos del JSON
        setLocalRhythmPaths(paths);
        setInternalRhythmPlaybackRates(playbackRates);
        
        // Si hay un volumen global, actualizarlo (usamos el primer ritmo como referencia)
        if (config.rhythms.length > 0 && config.rhythms[0].volume !== undefined) {
          setVolume(config.rhythms[0].volume);
        }
      } catch (e) {
        console.warn("{t('app.errLoadConfig')}", e);
      }
    };

    loadConfigFromJSON();
  }, []);

  // Cargar configuración desde PocketBase vía API (solo como respaldo si JSON no tiene datos)
  useEffect(() => {
    const loadRhythmsFromDB = async () => {
      const userId = pb.authStore.model?.id;
      if (!userId) return;

      try {
        const res = await fetch(`/api/ritmos-locales?user=${userId}`);
        if (res.ok) {
          const data = await res.json();
          const records = data.records || [];
          if (records.length > 0) {
            const record = records[0];
            setUserRhythmRecordId(record.id);

            // Solo cargar desde PocketBase si el JSON no tiene rutas
            setLocalRhythmPaths(prev => {
              // Si ya hay datos del JSON, no sobrescribir
              if (Object.keys(prev).length > 0) return prev;
              
              const paths: Record<string, string> = {};
              for (let i = 0; i < 10; i++) {
                const key = `Tiktac_${i}`;
                if (record[key]) paths[key] = record[key] as string;
              }
              return paths;
            });
          }
        }
      } catch (e) {
        console.warn("Error cargando ritmos desde la API local.");
      }
    };

    loadRhythmsFromDB();
  }, []);

  const closeConfigModal = () => {
    setIsConfigModalOpen(false);
    setConfiguringRhythm(null);
    setTempPath('');
  };

  const handleRhythmFileSelected = (file: any) => {
    if (!configuringRhythm) return;
    
    // Guardar la ruta del archivo seleccionado en el ritmo configurado
    setLocalRhythmPaths(prev => ({ ...prev, [configuringRhythm.id]: file.fullPath }));
    
    // Guardar en PocketBase
    saveRhythmPathToDB(configuringRhythm.id, file.fullPath);
    
    // Guardar en JSON
    updateRhythmConfig(configuringRhythm.id, { filePath: file.fullPath });
    
    setIsRhythmSelectorOpen(false);
    setConfiguringRhythm(null);
  };

  const saveRhythmPathToDB = async (rhythmId: string, path: string) => {
    const userId = pb.authStore.model?.id;
    if (!userId) return;

    try {
      if (userRhythmRecordId) {
        await fetch('/api/ritmos-locales', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: userRhythmRecordId,
            [rhythmId]: path
          })
        });
      } else {
        const res = await fetch('/api/ritmos-locales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: userId,
            [rhythmId]: path
          })
        });
        const data = await res.json();
        setUserRhythmRecordId(data.record.id);
      }
    } catch (e) {
      console.error('Error guardando ritmo en DB:', e);
    }
  };

  // Guardar configuración en PocketBase vía API
  const saveRhythmPath = async () => {
    if (!configuringRhythm) return;
    
    const userId = pb.authStore.model?.id;
    if (!userId) {
      alert("Debes estar autenticado para guardar ritmos.");
      return;
    }

    const fieldKey = configuringRhythm.id; // Ya viene con mayúscula desde staticRhythmOptions
    console.log("Intentando guardar ritmo:", { fieldKey, path: tempPath, userId, recordId: userRhythmRecordId });
    
    try {
      if (userRhythmRecordId) {
        // Actualizar registro existente
        const res = await fetch('/api/ritmos-locales', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: userRhythmRecordId,
            [fieldKey]: tempPath
          })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.details || "Error al actualizar");
        }
      } else {
        // Crear nuevo registro para el usuario
        const res = await fetch('/api/ritmos-locales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: userId,
            [fieldKey]: tempPath
          })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.details || "Error al crear");
        }
        const data = await res.json();
        setUserRhythmRecordId(data.record.id);
      }

      // IMPORTANTE: Solo actualizamos la ruta en memoria si el servidor confirmó el guardado
      setLocalRhythmPaths(prev => ({ ...prev, [fieldKey]: tempPath }));
      rhythmBuffersRef.current.delete(configuringRhythm.id);
      
      // Guardar en JSON
      updateRhythmConfig(fieldKey, { filePath: tempPath });
      
      closeConfigModal();
    } catch (e: any) {
      console.error("Error detallado al guardar:", e);
      alert(`Error al guardar: ${e.message}`);
    }
  };

  // Definimos los 10 espacios para ritmos locales (0-9)
  const staticRhythmOptions = useMemo(() => STATIC_RHYTHM_OPTIONS, []);

  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<Map<number, OscillatorNode>>(new Map());
  const gainNodesRef = useRef<Map<number, GainNode>>(new Map());
  const releaseTimesRef = useRef<Map<number, number>>(new Map());
  const rhythmAudioRef = useRef<HTMLAudioElement | null>(null);
  const rhythmSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rhythmPlayersRef = useRef<Map<string, { bufferSource: AudioBufferSourceNode; gainNode: GainNode }>>(new Map());
  const rhythmBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const externalCtxRef = useRef(externalAudioContext);
  const externalOutputRef = useRef(externalOutputNode);
  const rhythmOptionsRef = useRef(staticRhythmOptions);
  const selectedRhythmsRef = useRef(selectedRhythms);
  const initAudioRef = useRef<() => void>(() => {});
  externalCtxRef.current = externalAudioContext;
  externalOutputRef.current = externalOutputNode;
  rhythmOptionsRef.current = staticRhythmOptions;
  selectedRhythmsRef.current = selectedRhythms;
  const selectedRhythmsKey = selectedRhythms.join(',');

  const getSafePlaybackRate = (id: string) => {
    const v = rhythmPlaybackRates?.[id] ?? 1;
    return Math.max(0.25, Math.min(2, Number(v) || 1));
  };

  const initializeAudio = useCallback(() => {
    if (!externalAudioContext && !audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }, [externalAudioContext]);
  initAudioRef.current = initializeAudio;

  // Activar AudioContext en cuanto se pone Ritmo "On"
  useEffect(() => {
    if (!rhythmEnabled) return;
    initAudioRef.current();
    const ctx = (externalCtxRef.current ?? audioContextRef.current) as AudioContext | null;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }, [rhythmEnabled]);

  // Ritmos: reproducción por buffer
  useEffect(() => {
    const stopAllRhythmPlayers = () => {
      rhythmPlayersRef.current.forEach(({ bufferSource, gainNode }) => {
        try { bufferSource.stop(); } catch (_) {}
        try { bufferSource.disconnect(); } catch (_) {}
        try { gainNode.disconnect(); } catch (_) {}
      });
      rhythmPlayersRef.current.clear();
    };
    stopAllRhythmPlayers();

    if (!rhythmEnabled) return;

    const selectedRhythms = selectedRhythmsRef.current;
    if (selectedRhythms.length > 0) {
      if (!externalCtxRef.current) initAudioRef.current();
      const ctx = (externalCtxRef.current ?? audioContextRef.current) as AudioContext | null;
      if (!ctx || ctx.state === 'closed') return;
      const dest = externalOutputRef.current ?? ctx.destination;
      if (!dest) return;

      const currentIds = new Set(selectedRhythms);
      const players = rhythmPlayersRef.current;
      const cache = rhythmBuffersRef.current;

      players.forEach((player, id) => {
        if (!currentIds.has(id)) {
          try { player.bufferSource.stop(); } catch (_) {}
          try { player.bufferSource.disconnect(); } catch (_) {}
          try { player.gainNode.disconnect(); } catch (_) {}
          players.delete(id);
        }
      });

      currentIds.forEach((id) => {
        if (players.has(id)) return;
        const localPath = localRhythmPaths[id];
        if (!localPath) return;

        const vol = Math.min(1, (volumeOnlyForDisplay ? 1 : volume) * 0.9);
        const url = getMediaUrl(localPath);

        const startFromBuffer = (buffer: AudioBuffer) => {
          if (!currentIds.has(id) || players.has(id)) return;
          const bufferSource = ctx.createBufferSource();
          bufferSource.buffer = buffer;
          bufferSource.loop = true;
          bufferSource.playbackRate.value = getSafePlaybackRate(id);
          const gainNode = ctx.createGain();
          gainNode.gain.value = vol;
          bufferSource.connect(gainNode);
          gainNode.connect(dest);
          bufferSource.start(0);
          players.set(id, { bufferSource, gainNode });
        };

        const cached = cache.get(id);
        if (cached) {
          startFromBuffer(cached);
          return;
        }

        fetch(url, { mode: 'cors' })
          .then((res) => res.arrayBuffer())
          .then((ab) => ctx.decodeAudioData(ab))
          .then((buffer) => {
            cache.set(id, buffer);
            startFromBuffer(buffer);
          })
          .catch(() => {
            console.error(`Error cargando ritmo local: ${localPath}`);
            applySelectedRhythms(selectedRhythms.filter(rid => rid !== id));
          });
      });

      return () => {
        stopAllRhythmPlayers();
      };
    }
  }, [selectedRhythmsKey, rhythmEnabled, localRhythmPaths]);

  // Volumen y velocidad de ritmos (buffer: playbackRate y gain en los nodos)
  useEffect(() => {
    const vol = Math.min(1, volumeForAudio * 0.9);
    rhythmPlayersRef.current.forEach((player, id) => {
      player.bufferSource.playbackRate.value = getSafePlaybackRate(id);
      player.gainNode.gain.value = vol;
    });
  }, [rhythmPlaybackRates, volumeForAudio, volume]);

  const playNote = useCallback((note: Note, velocity: number = 1) => {
    if (!externalAudioContext) initializeAudio();
    const audioCtx = (externalAudioContext ?? audioContextRef.current) as AudioContext | null;
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const dest = externalOutputNode ?? audioCtx.destination;

    if (!audioCtx || !dest) return;

    const config = getInstrumentConfig(instrument);
    const peak = volumeForAudio * 0.95 * velocity;
    const now = audioCtx.currentTime;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(note.frequency, now);

    gainNode.gain.setValueAtTime(0, now);
    if (config.attack > 0) {
      gainNode.gain.linearRampToValueAtTime(peak, now + config.attack);
    } else {
      gainNode.gain.setValueAtTime(peak, now);
    }
    if (config.decay > 0) {
      gainNode.gain.linearRampToValueAtTime(peak * config.sustain, now + config.attack + config.decay);
    } else if (config.attack > 0 && config.sustain < 1) {
      gainNode.gain.linearRampToValueAtTime(peak * config.sustain, now + config.attack + 0.01);
    }

    if (config.filterFreq && config.filterFreq > 0) {
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = config.filterFreq;
      filter.Q.value = config.filterQ ?? 1;
      oscillator.connect(filter);
      filter.connect(gainNode);
    } else {
      oscillator.connect(gainNode);
    }
    gainNode.connect(dest);

    oscillator.start();

    releaseTimesRef.current.set(note.id, config.release);
    oscillatorsRef.current.set(note.id, oscillator);
    gainNodesRef.current.set(note.id, gainNode);

    setNotes(prev => prev.map(n =>
      n.id === note.id ? { ...n, isActive: true } : n
    ));
    setActiveNotes(prev => new Set(Array.from(prev).concat(note.id)));

    onNotePlay?.(note, velocity);
  }, [volumeForAudio, onNotePlay, initializeAudio, externalAudioContext, externalOutputNode, instrument]);

  const stopNote = useCallback((note: Note) => {
    const oscillator = oscillatorsRef.current.get(note.id);
    const gainNode = gainNodesRef.current.get(note.id);
    const ctx = externalAudioContext ?? audioContextRef.current;
    const release = releaseTimesRef.current.get(note.id) ?? 0.1;
    if (oscillator && gainNode && ctx) {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + release);
      
      setTimeout(() => {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();
        
        oscillatorsRef.current.delete(note.id);
        gainNodesRef.current.delete(note.id);
        releaseTimesRef.current.delete(note.id);
      }, Math.ceil(release * 1000) + 50);
    }
    
    setNotes(prev => prev.map(n => 
      n.id === note.id ? { ...n, isActive: false } : n
    ));
    setActiveNotes(prev => {
      const newSet = new Set(prev);
      newSet.delete(note.id);
      return newSet;
    });
    
    onNoteStop?.(note);
  }, [onNoteStop, externalAudioContext]);

  const handleKeyDown = useCallback((note: Note) => {
    if (!activeNotes.has(note.id)) {
      playNote(note);
    }
  }, [activeNotes, playNote]);

  const handleKeyUp = useCallback((note: Note) => {
    if (!effectiveSustain && activeNotes.has(note.id)) {
      stopNote(note);
    }
  }, [effectiveSustain, activeNotes, stopNote]);

  const handleNoteStart = (note: Note, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    handleKeyDown(note);
  };

  const handleNoteEnd = (note: Note) => {
    handleKeyUp(note);
  };

  const handleMouseLeave = () => {
    if (!effectiveSustain) {
      activeNotes.forEach(noteId => {
        const note = notes.find(n => n.id === noteId);
        if (note) stopNote(note);
      });
    }
  };

  const handleOctaveChange = (change: number) => {
    const currentOctave = isControlled && controlledOctave !== undefined ? controlledOctave : octave;
    const newOctave = Math.max(-2, Math.min(2, currentOctave + change));
    setOctave(newOctave);
    setNotes(generateNotes(newOctave));
    onOctaveChangeProp?.(newOctave);
    
    // Stop all active notes when changing octave
    activeNotes.forEach(noteId => {
      const note = notes.find(n => n.id === noteId);
      if (note) stopNote(note);
    });
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    onVolumeChangeProp?.(newVolume);

    const targetGain = newVolume * 0.95;
    gainNodesRef.current.forEach((gainNode, noteId) => {
      if (!activeNotes.has(noteId)) return;
      const ctx = gainNode.context as AudioContext;
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 0.05);
    });
    
    // Guardar volumen en JSON para ritmos seleccionados
    selectedRhythms.forEach(rhythmId => {
      updateRhythmConfig(rhythmId, { volume: newVolume });
    });
  };

  const handleSustainToggle = () => {
    const newSustain = !effectiveSustain;
    setSustain(newSustain);
    onSustainChangeProp?.(newSustain);
    if (!newSustain) {
      // When turning off sustain, stop all sustained notes
      activeNotes.forEach(noteId => {
        const note = notes.find(n => n.id === noteId);
        if (note) stopNote(note);
      });
    }
  };

  const handleReset = () => {
    // Stop all active notes
    activeNotes.forEach(noteId => {
      const note = notes.find(n => n.id === noteId);
      if (note) stopNote(note);
    });
    
    // Reset state
    setOctave(octaveOffset);
    setVolume(initialVolume);
    setSustain(false);
    setNotes(generateNotes(octaveOffset));
  };

  // Handle keyboard events
  useEffect(() => {
    const keyMap: { [key: string]: number } = {
      'a': 0, 'w': 1, 's': 2, 'e': 3, 'd': 4, 'f': 5, 't': 6, 'g': 7, 'y': 8, 'h': 9, 'u': 10, 'j': 11,
      'k': 12, 'o': 13, 'l': 14, 'p': 15, ';': 16, "'": 17
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      
      const keyIndex = keyMap[e.key.toLowerCase()];
      if (keyIndex !== undefined && keyIndex < notes.length) {
        const note = notes[keyIndex];
        if (note && !activeNotes.has(note.id)) {
          playNote(note);
        }
      }
      
      // Octave controls
      if (e.key === 'z') handleOctaveChange(-1);
      if (e.key === 'x') handleOctaveChange(1);
      if (e.key === ' ') {
        e.preventDefault();
        handleSustainToggle();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const keyIndex = keyMap[e.key.toLowerCase()];
      if (keyIndex !== undefined && keyIndex < notes.length) {
        const note = notes[keyIndex];
        if (note && activeNotes.has(note.id)) {
          stopNote(note);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [notes, activeNotes, playNote, stopNote]);

  // Cleanup on unmount (solo cerrar el contexto propio, no el externo)
  useEffect(() => {
    return () => {
      oscillatorsRef.current.forEach(oscillator => {
        try { oscillator.stop(); oscillator.disconnect(); } catch (_) {}
      });
      gainNodesRef.current.forEach(gainNode => {
        try { gainNode.disconnect(); } catch (_) {}
      });
      if (!externalAudioContext && audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, [externalAudioContext]);

  const whiteKeys = notes.filter(note => !note.isBlack);
  const blackKeys = notes.filter(note => note.isBlack);

  return (
    <div className="w-full bg-gradient-to-b from-gray-800 to-gray-900 rounded-xl p-6 shadow-2xl border border-gray-700">
      <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-nowrap items-center gap-3 sm:gap-4 min-w-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Piano className={cn("h-5 w-5", !accentColor && "text-blue-400")} style={accentColor ? { color: accentColor } : undefined} />
            <h2 className="text-xl font-semibold whitespace-nowrap">{t('audioEditor.virtualKeyboard')}</h2>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-700 rounded-full flex-shrink-0">
            <span className="text-sm text-gray-300">{t('audioEditor.octave')}:</span>
            <span className={cn("font-mono font-bold", !accentColor && "text-blue-300")} style={accentColor ? { color: accentColor } : undefined}>{effectiveOctave}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOctaveChange(-1)}
              disabled={effectiveOctave <= -2}
              className="h-6 w-6 p-0 text-gray-300 hover:bg-gray-600 hover:text-white"
            >
              -
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOctaveChange(1)}
              disabled={effectiveOctave >= 2}
              className="h-6 w-6 p-0 text-gray-300 hover:bg-gray-600 hover:text-white"
            >
              +
            </Button>
          </div>
          <div className="flex items-center gap-2 border-l border-gray-600 pl-3 flex-shrink-0 min-w-0">
            <Drum className={cn("h-4 w-4", !accentColor && "text-amber-400")} style={accentColor ? { color: accentColor } : undefined} />
            <span className="text-sm text-gray-400 whitespace-nowrap">{t('audioEditor.rhythm')}:</span>
            <div className="flex gap-3 items-center min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  applyRhythmEnabled(!rhythmEnabled);
                }}
                className={cn(
                  "text-xs h-7 min-w-[3rem] flex-shrink-0",
                  rhythmEnabled ? "bg-green-600/20 border-green-500 text-green-300 hover:bg-green-600/30" : "border-gray-500 bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >
                {rhythmEnabled ? 'On' : 'Off'}
              </Button>
              <div className="flex gap-2 items-center flex-wrap">
                {staticRhythmOptions.map((opt, index) => {
                  const rhythmBorderColors = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7'];
                  const borderColor = rhythmBorderColors[index % rhythmBorderColors.length];
                  const isSelected = selectedRhythms.includes(opt.id);
                  const hasPath = !!localRhythmPaths[opt.id];

                  return (
                    <Button
                      key={opt.id}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!rhythmEnabled) {
                          // SOLO si está apagado abrimos el selector de ritmos
                          setConfiguringRhythm(opt);
                          setIsRhythmSelectorOpen(true);
                        } else if (hasPath) {
                          // Si está encendido y tiene ruta, reproducimos/paramos
                          applySelectedRhythms(
                            selectedRhythms.includes(opt.id)
                              ? selectedRhythms.filter((id) => id !== opt.id)
                              : [...selectedRhythms, opt.id]
                          );
                        }
                      }}
                      className={cn(
                        "text-[10px] h-7 px-2 border-2 transition-all duration-200 bg-transparent hover:opacity-90 flex-shrink-0",
                        !hasPath && rhythmEnabled && "opacity-30 grayscale cursor-not-allowed"
                      )}
                      style={{
                        borderColor,
                        background: isSelected
                          ? `linear-gradient(to bottom, rgba(255,255,255,0.18), transparent)`
                          : `linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)`,
                        color: isSelected ? '#ef4444' : '#ffffff',
                        boxShadow: isSelected ? `0 0 12px ${borderColor}, 0 0 4px ${borderColor}` : undefined,
                      }}
                      title={!rhythmEnabled ? "Configurar archivo local" : hasPath ? "Reproducir ritmo" : "Sin archivo configurado"}
                    >
                      {opt.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {controlledVolume === undefined && (
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-gray-400" />
              <div className="w-32">
                <Slider
                  value={[effectiveVolume]}
                  onValueChange={handleVolumeChange}
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-full"
                />
              </div>
              <span className="text-sm font-mono w-10">{Math.round(effectiveVolume * 100)}%</span>
            </div>
          )}

          <Button
            variant={effectiveSustain ? "default" : "outline"}
            size="sm"
            onClick={handleSustainToggle}
            className={cn(
              "gap-2",
              !accentColor && effectiveSustain && "bg-green-600 hover:bg-green-700 text-white",
              !effectiveSustain && "border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
            )}
            style={accentColor && effectiveSustain ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          >
            <Zap className="h-4 w-4" />{t('app.sustain')}</Button>
        </div>
      </div>

      {/* Modal de Configuración de Ritmos */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Drum className="w-5 h-5 text-amber-400" />
              {t('audioEditor.configureRhythm', { name: configuringRhythm?.name ?? '' })}
            </h3>
            <p className="text-sm text-gray-400 mb-6">
              {t('app.audioPathHint')}
            </p>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-500">{t('audioEditor.wavPath')}</label>
                <input
                  type="text"
                  value={tempPath}
                  onChange={(e) => setTempPath(e.target.value)}
                  placeholder={t('app.pastePath')}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-blue-500 transition-colors"
                  autoFocus
                />
              </div>
              
              <div className="flex flex-wrap gap-3 pt-2">
                <button 
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold h-11 rounded-xl min-w-[140px] transition-colors shadow-lg active:scale-95"
                  onClick={saveRhythmPath}
                >
                  {t('audioEditor.saveRhythm')}
                </button>
                <button 
                  className="flex-1 border border-red-900/30 bg-red-950/20 text-red-400 hover:bg-red-900/30 h-11 rounded-xl transition-colors active:scale-95"
                  onClick={() => {
                    setTempPath('');
                  }}
                  title={t('audioEditor.clearPath')}
                >
                  {t('audioEditor.clear')}
                </button>
                <button 
                  className="flex-1 border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 h-11 rounded-xl transition-colors active:scale-95"
                  onClick={closeConfigModal}
                >
                  {t('audioEditor.cancelRhythm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Selector de Ritmos (GenerateMusicModal en modo teclado) */}
      <GenerateMusicModal
        isOpen={isRhythmSelectorOpen}
        onClose={() => {
          setIsRhythmSelectorOpen(false);
          setConfiguringRhythm(null);
        }}
        onGenerated={() => {}}
        keyboardMode={true}
        onFileSelectedForKeyboard={handleRhythmFileSelected}
      />

      <div className="relative h-64" onMouseLeave={handleMouseLeave}>
        {/* White keys */}
        <div className="flex h-full">
          {whiteKeys.map((note, index) => {
            const hasLeftBlack = blackKeys.some(b => 
              b.octave === note.octave && 
              (b.name === 'C#' && note.name === 'D' ||
               b.name === 'D#' && note.name === 'E' ||
               b.name === 'F#' && note.name === 'G' ||
               b.name === 'G#' && note.name === 'A' ||
               b.name === 'A#' && note.name === 'B')
            );
            
            const hasRightBlack = blackKeys.some(b =>
              b.octave === note.octave &&
              (b.name === 'C#' && note.name === 'C' ||
               b.name === 'D#' && note.name === 'D' ||
               b.name === 'F#' && note.name === 'F' ||
               b.name === 'G#' && note.name === 'G' ||
               b.name === 'A#' && note.name === 'A')
            );

            return (
              <button
                key={note.id}
                data-note-id={note.id}
                className={cn(
                  "relative flex-1 border-r border-gray-600 rounded-b-lg transition-all duration-100",
                  !accentColor && "hover:bg-gray-600 active:bg-blue-500",
                  !accentColor && activeNotes.has(note.id) && "bg-blue-500",
                  !activeNotes.has(note.id) && "bg-white",
                  index === whiteKeys.length - 1 && "border-r-0"
                )}
                style={accentColor && activeNotes.has(note.id) ? { backgroundColor: accentColor } : undefined}
                onMouseDown={(e) => handleNoteStart(note, e)}
                onMouseUp={() => handleNoteEnd(note)}
                onMouseEnter={(e) => {
                  if (e.buttons === 1) {
                    handleNoteStart(note, e);
                  }
                }}
                onMouseLeave={() => {
                  if (!effectiveSustain) {
                    handleNoteEnd(note);
                  }
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleNoteStart(note, e);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleNoteEnd(note);
                }}
              >
                <div className="absolute bottom-4 left-0 right-0 text-center">
                  <span className={cn(
                    "text-xs font-mono font-bold",
                    activeNotes.has(note.id) ? "text-white" : "text-gray-700"
                  )}>
                    {note.name}{note.octave}
                  </span>
                  <div className="text-[10px] text-gray-500 mt-1">
                    {keyBindings.find(k => k.noteId === note.id)?.key.toUpperCase()}
                  </div>
                </div>
                
                {/* Indicators for black key positions */}
                {hasLeftBlack && (
                  <div className="absolute top-0 left-0 w-1/2 h-8 border-r border-gray-400/30" />
                )}
                {hasRightBlack && (
                  <div className="absolute top-0 right-0 w-1/2 h-8 border-l border-gray-400/30" />
                )}
              </button>
            );
          })}
        </div>

        {/* Black keys */}
        <div className="absolute top-0 left-0 right-0 h-2/3 flex pointer-events-none">
          {whiteKeys.map((whiteKey, whiteIndex) => {
            const blackKey = blackKeys.find(b => {
              const whiteKeyName = whiteKey.name;
              const blackKeyName = b.name;
              const sameOctave = b.octave === whiteKey.octave;
              
              return sameOctave && (
                (blackKeyName === 'C#' && whiteKeyName === 'C') ||
                (blackKeyName === 'D#' && whiteKeyName === 'D') ||
                (blackKeyName === 'F#' && whiteKeyName === 'F') ||
                (blackKeyName === 'G#' && whiteKeyName === 'G') ||
                (blackKeyName === 'A#' && whiteKeyName === 'A')
              );
            });

            if (!blackKey) {
              // Placeholder for spacing
              return <div key={`spacer-${whiteKey.id}`} className="flex-1" />;
            }

            return (
              <button
                key={blackKey.id}
                data-note-id={blackKey.id}
                className={cn(
                  "absolute w-8 h-4/5 bg-gradient-to-b from-gray-900 to-black",
                  "rounded-b-md border border-gray-700 shadow-lg",
                  "transition-all duration-100 pointer-events-auto",
                  "hover:bg-gray-800",
                  !accentColor && "active:bg-purple-600",
                  !accentColor && activeNotes.has(blackKey.id) && "bg-purple-600",
                  "z-10"
                )}
                style={{
                  left: `calc(${((whiteIndex + 1) / whiteKeys.length) * 100}% - 1rem)`,
                  ...(accentColor && activeNotes.has(blackKey.id) ? { background: accentColor } : {}),
                }}
                onMouseDown={(e) => handleNoteStart(blackKey, e)}
                onMouseUp={() => handleNoteEnd(blackKey)}
                onMouseEnter={(e) => {
                  if (e.buttons === 1) {
                    handleNoteStart(blackKey, e);
                  }
                }}
                onMouseLeave={() => {
                  if (!effectiveSustain) {
                    handleNoteEnd(blackKey);
                  }
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleNoteStart(blackKey, e);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleNoteEnd(blackKey);
                }}
              >
                <div className="absolute bottom-2 left-0 right-0 text-center">
                  <span className={cn(
                    "text-xs font-mono font-bold",
                    activeNotes.has(blackKey.id) ? "text-white" : "text-gray-300"
                  )}>
                    {blackKey.name}{blackKey.octave}
                  </span>
                  <div className="text-[10px] text-gray-500 mt-1">
                    {keyBindings.find(k => k.noteId === blackKey.id)?.key.toUpperCase()}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={cn(
                "h-3 w-3 rounded-full animate-pulse",
                audioContextRef.current?.state === 'running' 
                  ? "bg-green-500" 
                  : "bg-red-500"
              )} />
              <span className="text-sm text-gray-300">
                Audio: {audioContextRef.current?.state === 'running' ? t('audioEditor.active') : t('audioEditor.inactive')}
              </span>
            </div>
            
            <div className="text-sm text-gray-400">
              {t('audioEditor.activeNotes')}: <span className={cn("font-bold", !accentColor && "text-blue-300")} style={accentColor ? { color: accentColor } : undefined}>{activeNotes.size}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              <span className="font-mono">{t('audioEditor.keysCount', { n: notes.length })}</span>
              <span className="mx-2">•</span>
              <span>{t('audioEditor.centralOctave', { o: octave })}</span>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="gap-2 border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              <RotateCcw className="h-3 w-3" />
              {t('audioEditor.restart')}
            </Button>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          <p>
            {t('audioEditor.keyboardHelp')}
          </p>
        </div>
      </div>
    </div>
  );
}
