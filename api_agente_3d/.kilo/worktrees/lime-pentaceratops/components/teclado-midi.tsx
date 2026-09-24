'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Keyboard, { STATIC_RHYTHM_OPTIONS } from '@/components/Keyboard';
import ControlPanel from '@/components/ControlPanel';
import EffectsRack from '@/components/EffectsRack';
import { DEFAULT_EFFECTS, type Effect } from '@/components/EffectsRack';
import { createAudioEffectsChain } from '@/lib/audioEffectsChain';
import { getInstrumentConfig } from '@/lib/instrumentSynth';
import { resetRhythmVelocityAndVolume } from '@/lib/rhythm-config-manager';
import pb from '@/lib/pocketbase';

type Note = {
  id: string;
  key: string;
  frequency: number;
  isBlack: boolean;
  isPressed: boolean;
  velocity: number;
};

const KEY_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const OCTAVES = 5;

interface TecladoMidiProps {
  embedded?: boolean;
  /** AudioContext de la aplicación (para conectar con el pipeline de audio). */
  audioContext?: AudioContext;
  /** Nodo de salida (master gain) donde conectar el audio del teclado. */
  masterOutput?: AudioNode;
  /** Color de acento de la habitación (p. ej. vizColor del editor). */
  roomColor?: string;
  /** Si el motor está activo (Engine Active). Cuando false, se aplica efecto "apagado". */
  engineActive?: boolean;
}

export default function TecladoMidi({ embedded, audioContext: appAudioContext, masterOutput, roomColor, engineActive = true }: TecladoMidiProps) {
  const [volume, setVolume] = useState(0.8);
  // Estado compartido entre ControlPanel y Keyboard
  const [keyboardVolume, setKeyboardVolume] = useState(0.8);
  const [keyboardOctave, setKeyboardOctave] = useState(0);
  const [keyboardSustain, setKeyboardSustain] = useState(false);
  const [keyboardInstrument, setKeyboardInstrument] = useState('acoustic_grand_piano');
  const [notes, setNotes] = useState<Note[]>([]);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [effects, setEffects] = useState<Effect[]>(DEFAULT_EFFECTS);
  const [effectsChainInput, setEffectsChainInput] = useState<AudioNode | null>(null);
  const [ctxReady, setCtxReady] = useState(false);
  const [keyboardRhythmEnabled, setKeyboardRhythmEnabled] = useState(false);
  const [keyboardSelectedRhythms, setKeyboardSelectedRhythms] = useState<string[]>([]);
  const [keyboardPlaybackRates, setKeyboardPlaybackRates] = useState<Record<string, number>>({});

  const audioContextRef = useRef<AudioContext | null>(null);
  const effectsChainRef = useRef<ReturnType<typeof createAudioEffectsChain> | null>(null);
  const activeOscillatorsRef = useRef<Map<string, OscillatorNode>>(new Map());
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const releaseTimesRef = useRef<Map<string, number>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const midiHandlerRef = useRef<(event: MIDIMessageEvent) => void>(() => {});

  useEffect(() => {
    const initializeNotes = () => {
      const newNotes: Note[] = [];
      let noteIndex = 0;
      
      for (let octave = 0; octave < OCTAVES; octave++) {
        KEY_NAMES.forEach((keyName, keyIndex) => {
          const isBlack = [1, 2, 4, 5, 6].includes(keyIndex % 7) && ![2, 6].includes(keyIndex % 7);
          const frequency = 440 * Math.pow(2, (noteIndex - 49) / 12);
          
          newNotes.push({
            id: `${keyName}${octave + 2}`,
            key: `${keyName}${octave + 2}`,
            frequency,
            isBlack,
            isPressed: false,
            velocity: 0.7
          });
          
          noteIndex++;
        });
      }
      
      setNotes(newNotes);
    };

    initializeNotes();
    
    const initAudioContext = () => {
      if (!appAudioContext && !audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (!appAudioContext && audioContextRef.current) {
        setCtxReady(true);
      }
    };

    const initMIDI = async () => {
      if (navigator.requestMIDIAccess) {
        try {
          const access = await navigator.requestMIDIAccess();
          setMidiAccess(access);

          access.inputs.forEach(input => {
            input.onmidimessage = (event: MIDIMessageEvent) => midiHandlerRef.current(event);
          });

          access.onstatechange = () => {
            access.inputs.forEach(input => {
              input.onmidimessage = (event: MIDIMessageEvent) => midiHandlerRef.current(event);
            });
          };
        } catch (err) {
          console.warn('MIDI access not available:', err);
        }
      }
    };

    initAudioContext();
    initMIDI();

    return () => {
      const ctx = audioContextRef.current;
      if (ctx && ctx.state !== 'closed') ctx.close();
      midiAccess?.inputs.forEach(input => {
        input.onmidimessage = null;
      });
    };
  }, [appAudioContext]);

  // Cadena de efectos: teclado -> effectsChainInput -> ... -> masterOutput
  useEffect(() => {
    const ctx = appAudioContext ?? audioContextRef.current;
    if (!ctx || ctx.state === 'closed') return;
    if (!appAudioContext && !ctxReady) return;
    const dest = masterOutput ?? ctx.destination;
    effectsChainRef.current?.disconnect();
    const chain = createAudioEffectsChain(ctx, dest);
    chain.updateEffects(effects);
    effectsChainRef.current = chain;
    setEffectsChainInput(chain.input);
    return () => {
      chain.disconnect();
      effectsChainRef.current = null;
      setEffectsChainInput(null);
    };
  }, [appAudioContext, masterOutput, ctxReady]);

  useEffect(() => {
    effectsChainRef.current?.updateEffects(effects);
  }, [effects]);

  const handleEffectsChange = useCallback((newEffects: Effect[]) => {
    setEffects(newEffects);
  }, []);

  const handleResetAllEffects = useCallback(() => {
    const freshDefaults = DEFAULT_EFFECTS.map((e) => ({
      ...e,
      enabled: false,
      parameters: { ...e.parameters },
    }));
    setEffects(freshDefaults);
    setKeyboardRhythmEnabled(false);
    setKeyboardSelectedRhythms([]);
    setKeyboardPlaybackRates({});
    
    // Volver velocidad y volumen de todos los ritmos a valores por defecto en el JSON
    resetRhythmVelocityAndVolume();
  }, []);

  const getNoteName = useCallback((midiNumber: number): string => {
    const octave = Math.floor(midiNumber / 12) - 1;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return `${noteNames[midiNumber % 12]}${octave}`;
  }, []);

  const playNote = useCallback((noteId: string, velocity: number) => {
    const ctx = appAudioContext ?? audioContextRef.current;
    if (!ctx) return;
    if (ctx instanceof AudioContext && ctx.state === 'suspended') ctx.resume();

    setNotes(prev => prev.map(note =>
      note.id === noteId ? { ...note, isPressed: true, velocity } : note
    ));

    const noteData = notes.find(n => n.id === noteId);
    if (!noteData) return;

    const config = getInstrumentConfig(keyboardInstrument);
    const peak = velocity * volume;
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(noteData.frequency, now);

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
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = config.filterFreq;
      filter.Q.value = config.filterQ ?? 1;
      oscillator.connect(filter);
      filter.connect(gainNode);
    } else {
      oscillator.connect(gainNode);
    }
    gainNode.connect(effectsChainInput ?? masterOutput ?? ctx.destination);

    oscillator.start();

    releaseTimesRef.current.set(noteId, config.release);
    activeOscillatorsRef.current.set(noteId, oscillator);
    gainNodesRef.current.set(noteId, gainNode);
  }, [notes, volume, appAudioContext, masterOutput, keyboardInstrument, effectsChainInput]);

  const stopNote = useCallback((noteId: string) => {
    setNotes(prev => prev.map(note =>
      note.id === noteId ? { ...note, isPressed: false } : note
    ));

    const gainNode = gainNodesRef.current.get(noteId);
    const oscillator = activeOscillatorsRef.current.get(noteId);
    const ctx = appAudioContext ?? audioContextRef.current;
    const release = releaseTimesRef.current.get(noteId) ?? 0.1;
    if (gainNode && oscillator && ctx) {
      const now = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + release);

      setTimeout(() => {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();

        activeOscillatorsRef.current.delete(noteId);
        gainNodesRef.current.delete(noteId);
        releaseTimesRef.current.delete(noteId);
      }, Math.ceil(release * 1000) + 50);
    }
  }, [appAudioContext]);

  const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    if (!event.data) return;

    const data = Array.from(event.data as Uint8Array);
    const [command, note, velocity] = data;
    const noteOn = command === 144;
    const noteOff = command === 128 || (noteOn && velocity === 0);

    if (noteOn || noteOff) {
      const noteId = getNoteName(note);
      if (noteOn && velocity > 0) {
        playNote(noteId, velocity / 127);
      } else {
        stopNote(noteId);
      }
    }
  }, [getNoteName, playNote, stopNote]);

  useEffect(() => {
    midiHandlerRef.current = handleMIDIMessage;
  }, [handleMIDIMessage]);

  return (
    <div className={`bg-gradient-to-br from-gray-900 to-black text-white ${embedded ? 'h-full min-h-0 w-full flex flex-col' : 'min-h-screen pb-24'}`}>
      <main className={`${embedded ? 'flex-1 min-h-0 flex flex-col w-full p-0 overflow-hidden' : 'w-full px-4 py-8'}`}>
        <div
          ref={containerRef}
          className={`bg-gray-800 shadow-2xl border border-gray-700 ${embedded ? 'flex-1 min-h-0 flex flex-col rounded-none p-0 overflow-hidden transition-all duration-500' : 'rounded-2xl p-6'} ${embedded && !engineActive ? 'opacity-30 grayscale pointer-events-none' : ''}`}
          style={roomColor && engineActive ? { borderColor: roomColor } : undefined}
        >
          <div className={`flex flex-col lg:flex-row gap-6 ${embedded ? 'flex-1 min-h-0 overflow-hidden px-2 pb-2 pt-0' : ''}`}>
            <div className="lg:w-[420px] lg:flex-shrink-0 lg:order-1 order-2">
              <ControlPanel
                volume={Math.round(keyboardVolume * 100)}
                octave={keyboardOctave}
                sustain={keyboardSustain}
                onVolumeChange={(v) => setKeyboardVolume(v / 100)}
                onOctaveChange={setKeyboardOctave}
                onSustainToggle={setKeyboardSustain}
                instrument={keyboardInstrument}
                onInstrumentChange={setKeyboardInstrument}
              />
            </div>
            <div className={`lg:flex-1 lg:min-w-0 order-1 lg:order-2 ${embedded ? 'pb-4' : ''}`}>
              <Keyboard
                volume={keyboardVolume}
                octave={keyboardOctave}
                sustain={keyboardSustain}
                onVolumeChange={setKeyboardVolume}
                onOctaveChange={setKeyboardOctave}
                onSustainChange={setKeyboardSustain}
                audioContext={appAudioContext}
                outputNode={effectsChainInput ?? masterOutput}
                accentColor={roomColor}
                instrument={keyboardInstrument}
                rhythmEnabled={keyboardRhythmEnabled}
                selectedRhythms={keyboardSelectedRhythms}
                onRhythmEnabledChange={setKeyboardRhythmEnabled}
                onSelectedRhythmsChange={setKeyboardSelectedRhythms}
                selectedRhythmForSpeed={keyboardSelectedRhythms[0] || ''}
                rhythmPlaybackRates={keyboardPlaybackRates}
                onRhythmPlaybackRateChange={(id, rate) => setKeyboardPlaybackRates((prev) => ({ ...prev, [id]: rate }))}
                onSelectRhythmForSpeed={(id) => setKeyboardSelectedRhythms([id])}
              />
            </div>
            <div className="lg:w-[420px] lg:flex-shrink-0 order-3">
              <EffectsRack 
                effects={effects} 
                onEffectsChange={handleEffectsChange} 
                onResetAll={handleResetAllEffects}
                rhythms={STATIC_RHYTHM_OPTIONS.map(r => ({ id: r.id, name: r.name }))}
                selectedRhythmId={keyboardSelectedRhythms[0] || ''}
                onSelectRhythm={(id) => {
                  setKeyboardSelectedRhythms([id]);
                }}
                rhythmEnabled={keyboardRhythmEnabled}
                onRhythmEnabledChange={setKeyboardRhythmEnabled}
                volume={keyboardVolume}
                onVolumeChange={setKeyboardVolume}
                velocity={keyboardSelectedRhythms[0] ? (keyboardPlaybackRates[keyboardSelectedRhythms[0]] || 1) : 1}
                onVelocityChange={(v) => {
                  setKeyboardPlaybackRates((prev) => ({
                    ...prev,
                    [keyboardSelectedRhythms[0]]: v,
                  }));
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}