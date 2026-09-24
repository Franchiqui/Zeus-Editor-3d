/**
 * Generador procedural de música de fondo con Web Audio API.
 * 100 % local/offline. Usa OfflineAudioContext para renderizar la pieza.
 */

import { audioBufferToWav } from './audio-export';

export type MusicStyle =
  | 'ambient'
  | 'electronic'
  | 'cinematic'
  | 'lofi'
  | 'epic'
  | 'relax'
  | 'suspense'
  | 'happy'
  | 'sad';

export type ProgressionComplexity = 'simple' | 'moderate' | 'complex';

export interface MusicGeneratorConfig {
  style: MusicStyle;
  /** Duración en segundos */
  duration: number;
  /** Pulsaciones por minuto */
  bpm: number;
  /** Tonalidad raíz, ej. 'C', 'Am', 'F#' */
  key: string;
  /** 0..1: define densidad/volumen de capas e intensidad */
  intensity: number;
  /** Capas activas */
  layers: {
    pads: boolean;
    bass: boolean;
    drums: boolean;
    melody: boolean;
  };
  /** Complejidad de la progresión armónica */
  progression: ProgressionComplexity;
  /** Frecuencia de muestreo de salida */
  sampleRate?: number;
}

const SEMITONES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const STYLE_SCALE: Record<
  MusicStyle,
  { scale: string; defaultLayers: Partial<MusicGeneratorConfig['layers']> }
> = {
  ambient: { scale: 'pentatonicMajor', defaultLayers: { pads: true, bass: true, drums: false, melody: false } },
  electronic: { scale: 'minor', defaultLayers: { pads: true, bass: true, drums: true, melody: true } },
  cinematic: { scale: 'minor', defaultLayers: { pads: true, bass: true, drums: true, melody: true } },
  lofi: { scale: 'pentatonicMinor', defaultLayers: { pads: true, bass: true, drums: true, melody: true } },
  epic: { scale: 'minor', defaultLayers: { pads: true, bass: true, drums: true, melody: true } },
  relax: { scale: 'pentatonicMajor', defaultLayers: { pads: true, bass: false, drums: false, melody: false } },
  suspense: { scale: 'minor', defaultLayers: { pads: true, bass: true, drums: false, melody: true } },
  happy: { scale: 'major', defaultLayers: { pads: true, bass: true, drums: true, melody: true } },
  sad: { scale: 'minor', defaultLayers: { pads: true, bass: true, drums: false, melody: true } },
};

function noteToIndex(note: string): number {
  return SEMITONES.indexOf(note);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function rootNoteToMidi(root: string): number {
  const idx = noteToIndex(root);
  if (idx === -1) return 60; // C4 por defecto
  return 60 + idx; // C4
}

function getScaleMidiNotes(rootMidi: number, scaleName: string, octaves = 2): number[] {
  const intervals = SCALE_INTERVALS[scaleName] ?? SCALE_INTERVALS.major;
  const notes: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      notes.push(rootMidi + interval + oct * 12);
    }
  }
  return notes;
}

function chordFromScale(rootMidi: number, scaleName: string, degreeIndex: number): number[] {
  const notes = getScaleMidiNotes(rootMidi, scaleName, 2);
  return [
    notes[degreeIndex % notes.length],
    notes[(degreeIndex + 2) % notes.length],
    notes[(degreeIndex + 4) % notes.length],
  ];
}

function makeProgression(rootMidi: number, scaleName: string, complexity: ProgressionComplexity): number[][] {
  const degrees: Record<ProgressionComplexity, number[]> = {
    simple: [0, 3, 4, 0],
    moderate: [0, 5, 3, 4, 0, 2, 5, 3],
    complex: [0, 5, 3, 6, 4, 0, 2, 5, 1, 4, 6, 5],
  };
  return degrees[complexity].map((d) => chordFromScale(rootMidi, scaleName, d));
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface EnvelopeOpts {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

function applyEnvelope(gain: GainNode, startTime: number, duration: number, opts: EnvelopeOpts, peak = 1) {
  const { attack, decay, sustain, release } = opts;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * sustain), startTime + attack + decay);
  const relStart = Math.max(startTime + attack + decay + 0.01, startTime + duration - release);
  gain.gain.setValueAtTime(Math.max(0.001, peak * sustain), relStart);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
}

function playPadChord(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  notes: number[],
  startTime: number,
  duration: number,
  intensity: number,
  seed: number
) {
  const rng = seededRandom(seed);
  const baseGain = ctx.createGain();
  baseGain.gain.value = 0.18 + intensity * 0.12;
  baseGain.connect(destination);

  for (const midi of notes) {
    const freq = midiToFreq(midi);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq * (1 + (rng() * 0.004 - 0.002));

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200 + rng() * 800;
    filter.Q.value = 1;

    oscA.connect(oscGain);
    oscB.connect(oscGain);
    oscGain.connect(filter);
    filter.connect(baseGain);

    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration);
    oscB.stop(startTime + duration);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1 + rng() * 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200 + rng() * 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(startTime);
    lfo.stop(startTime + duration);
  }
}

function playBassNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  midi: number,
  startTime: number,
  duration: number,
  intensity: number
) {
  const freq = midiToFreq(midi);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  applyEnvelope(gain, startTime, duration, {
    attack: 0.01,
    decay: 0.05,
    sustain: 0.7,
    release: 0.15,
  }, 0.25 + intensity * 0.15);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400 + intensity * 400;
  filter.Q.value = 2;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playPluck(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  midi: number,
  startTime: number,
  duration: number,
  intensity: number,
  seed: number
) {
  const rng = seededRandom(seed);
  const freq = midiToFreq(midi);
  const osc = ctx.createOscillator();
  osc.type = rng() > 0.5 ? 'sawtooth' : 'square';
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  applyEnvelope(gain, startTime, duration, {
    attack: 0.005,
    decay: 0.12,
    sustain: 0.2,
    release: 0.2,
  }, 0.12 + intensity * 0.1);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000 + rng() * 2000, startTime);
  filter.frequency.exponentialRampToValueAtTime(400, startTime + 0.3);
  filter.Q.value = 5;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function makeNoiseBuffer(ctx: OfflineAudioContext | AudioContext, duration: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * duration);
  const buffer = ctx.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playDrumHit(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  type: 'kick' | 'snare' | 'hihat' | 'clap' | 'tom' | 'rim' | 'shaker' | 'crash',
  startTime: number,
  intensity: number,
  seed: number,
  options?: { pan?: number; velocity?: number; decay?: number }
) {
  const rng = seededRandom(seed);
  const gain = ctx.createGain();
  const velocity = options?.velocity ?? 1;
  const peak = (0.25 + intensity * 0.2) * velocity;

  // Pan estéreo opcional
  let input = gain as AudioNode;
  if (options?.pan !== undefined) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = options.pan;
    gain.connect(panner);
    input = panner;
  }

  if (type === 'kick') {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(150, startTime);
    sub.frequency.exponentialRampToValueAtTime(40, startTime + 0.14);

    // Click de ataque
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(800, startTime);
    click.frequency.exponentialRampToValueAtTime(100, startTime + 0.03);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(peak * 0.25, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);
    click.connect(clickGain);
    clickGain.connect(gain);
    click.start(startTime);
    click.stop(startTime + 0.05);

    // Cuerpo
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + (options?.decay ?? 0.32));
    sub.connect(gain);
    sub.start(startTime);
    sub.stop(startTime + (options?.decay ?? 0.35));
  } else if (type === 'snare') {
    // Cuerpo tonal
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(185, startTime);
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'bandpass';
    bodyFilter.frequency.value = 600;
    bodyFilter.Q.value = 2;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(peak * 0.35, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(gain);
    body.start(startTime);
    body.stop(startTime + 0.13);

    // Ruido de cable/snare
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200 + rng() * 1500;
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(peak * 0.85, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + (options?.decay ?? 0.22));
    noise.connect(filter);
    filter.connect(gain);
    noise.start(startTime);
  } else if (type === 'hihat') {
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500 + rng() * 4000;
    filter.Q.value = 1;
    gain.gain.setValueAtTime(peak * 0.45, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + (options?.decay ?? 0.07));
    noise.connect(filter);
    filter.connect(gain);
    noise.start(startTime);
  } else if (type === 'clap') {
    // Clap realista: varios micro-ruidos con pequeños delays
    const count = 4;
    const spread = 0.012;
    for (let i = 0; i < count; i++) {
      const noise = ctx.createBufferSource();
      noise.buffer = makeNoiseBuffer(ctx, 0.18);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400 + rng() * 600;
      filter.Q.value = 2.5;
      const snapGain = ctx.createGain();
      const amp = peak * 0.7 * (1 - i * 0.15);
      snapGain.gain.setValueAtTime(amp, startTime + i * spread);
      snapGain.gain.exponentialRampToValueAtTime(0.001, startTime + i * spread + 0.13);
      noise.connect(filter);
      filter.connect(snapGain);
      snapGain.connect(gain);
      noise.start(startTime + i * spread);
    }
  } else if (type === 'tom') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const freq = 120 + rng() * 80;
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, startTime + 0.2);
    gain.gain.setValueAtTime(peak * 0.7, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + (options?.decay ?? 0.3));
    osc.connect(gain);
    osc.start(startTime);
    osc.stop(startTime + (options?.decay ?? 0.32));
  } else if (type === 'rim') {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1600, startTime);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 6;
    gain.gain.setValueAtTime(peak * 0.4, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);
    osc.connect(filter);
    filter.connect(gain);
    osc.start(startTime);
    osc.stop(startTime + 0.05);
  } else if (type === 'shaker') {
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 0.15);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 6000 + rng() * 3000;
    filter.Q.value = 1.5;
    gain.gain.setValueAtTime(peak * 0.35, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
    noise.connect(filter);
    filter.connect(gain);
    noise.start(startTime);
  } else if (type === 'crash') {
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    gain.gain.setValueAtTime(peak * 0.5, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.0);
    noise.connect(filter);
    filter.connect(gain);
    noise.start(startTime);
  }

  input.connect(destination);
}

// Efecto de compresión/agrupación suave para dar cuerpo a bucles
function makeParallelCompression(ctx: OfflineAudioContext, destination: AudioNode, amount = 0.5) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 12;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.08;
  input.connect(dry);
  input.connect(comp);
  comp.connect(wet);
  dry.gain.value = 1 - amount;
  wet.gain.value = amount;
  dry.connect(destination);
  wet.connect(destination);
  return input;
}

function makeSaturation(ctx: OfflineAudioContext, destination: AudioNode, amount = 0.15) {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const k = amount * 10;
  shaper.curve = new Float32Array(44100).map((_, i) => {
    const x = (i / 44100) * 2 - 1;
    return (1 + k) * x / (1 + k * Math.abs(x));
  });
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  wet.gain.value = 0.35;
  dry.gain.value = 0.65;
  input.connect(dry);
  input.connect(shaper);
  shaper.connect(wet);
  dry.connect(destination);
  wet.connect(destination);
  return input;
}

function makeReverb(ctx: OfflineAudioContext, destination: AudioNode, wetLevel: number) {
  const sr = ctx.sampleRate;
  const length = Math.ceil(sr * 2.5);
  const impulse = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1 - wetLevel;
  wet.gain.value = wetLevel;
  const input = ctx.createGain();
  input.connect(dry);
  input.connect(convolver);
  convolver.connect(wet);
  const output = ctx.createGain();
  dry.connect(output);
  wet.connect(output);
  output.connect(destination);
  return input;
}

function makeLimiter(ctx: OfflineAudioContext, destination: AudioNode) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  comp.connect(destination);
  return comp;
}

function getRootFromKey(key: string): { root: string; isMinor: boolean } {
  const lower = key.toLowerCase();
  const isMinor = lower.endsWith('m') && !lower.endsWith('maj');
  const root = key.replace(/m$/i, '').replace(/maj$/i, '').trim();
  return { root, isMinor };
}

function normalizeConfig(config: MusicGeneratorConfig): MusicGeneratorConfig {
  const style = config.style || 'ambient';
  const styleInfo = STYLE_SCALE[style];
  const layers = {
    pads: config.layers?.pads ?? styleInfo.defaultLayers.pads ?? true,
    bass: config.layers?.bass ?? styleInfo.defaultLayers.bass ?? false,
    drums: config.layers?.drums ?? styleInfo.defaultLayers.drums ?? false,
    melody: config.layers?.melody ?? styleInfo.defaultLayers.melody ?? false,
  };
  return {
    style,
    duration: Math.max(5, Math.min(600, config.duration || 30)),
    bpm: Math.max(40, Math.min(200, config.bpm || 90)),
    key: config.key || 'C',
    intensity: Math.max(0, Math.min(1, config.intensity ?? 0.5)),
    layers,
    progression: config.progression || 'moderate',
    sampleRate: config.sampleRate || 44100,
  };
}

export interface GenerateMusicResult {
  buffer: AudioBuffer;
  blob: Blob;
  url: string;
  duration: number;
}

/**
 * Genera una pieza musical procedural a partir de la configuración dada.
 * Devuelve AudioBuffer, blob WAV, URL de objeto y duración.
 */
export async function generateMusic(
  config: MusicGeneratorConfig,
  onProgress?: (progress: number) => void
): Promise<GenerateMusicResult> {
  const cfg = normalizeConfig(config);
  const { root } = getRootFromKey(cfg.key);
  const styleInfo = STYLE_SCALE[cfg.style];
  const scaleName = styleInfo.scale;

  const rootMidi = rootNoteToMidi(root);
  const sampleRate = cfg.sampleRate || 44100;
  const beatsPerSecond = cfg.bpm / 60;
  const beatDuration = 1 / beatsPerSecond;
  const barDuration = beatDuration * 4;

  const totalSamples = Math.ceil(cfg.duration * sampleRate);
  const ctx = new OfflineAudioContext(2, totalSamples, sampleRate);

  const master = makeLimiter(ctx, ctx.destination);
  const reverbBus = makeReverb(
    ctx,
    master,
    cfg.style === 'ambient' || cfg.style === 'cinematic' || cfg.style === 'epic' ? 0.35 : 0.2
  );
  const dryBus = ctx.createGain();
  dryBus.connect(master);

  const progression = makeProgression(rootMidi, scaleName, cfg.progression);
  const scaleNotes = getScaleMidiNotes(rootMidi, scaleName, 3);

  const rng = seededRandom(cfg.duration * 1000 + cfg.bpm * 10 + cfg.style.length);

  // === PADS ===
  if (cfg.layers.pads) {
    let t = 0;
    let barIndex = 0;
    while (t < cfg.duration) {
      const chord = progression[barIndex % progression.length];
      const dur = Math.min(barDuration * 2, cfg.duration - t);
      playPadChord(ctx, reverbBus, chord, t, dur, cfg.intensity, rng() * 100000);
      t += barDuration * 2;
      barIndex += 2;
    }
  }

  // === BASS ===
  if (cfg.layers.bass) {
    let t = 0;
    let barIndex = 0;
    while (t < cfg.duration) {
      const chord = progression[barIndex % progression.length];
      const rootNote = chord[0];
      const pattern = cfg.style === 'lofi' || cfg.style === 'relax' ? [1, 0, 1, 0] : [1, 0, 1, 1];
      for (let beat = 0; beat < 4; beat++) {
        if (pattern[beat % pattern.length]) {
          const note = rootNote - (rng() > 0.7 ? 12 : 0);
          playBassNote(ctx, dryBus, note, t + beat * beatDuration, beatDuration * 0.9, cfg.intensity);
        }
      }
      t += barDuration;
      barIndex++;
    }
  }

  // === DRUMS ===
  if (cfg.layers.drums) {
    let t = 0;
    while (t < cfg.duration) {
      playDrumHit(ctx, dryBus, 'kick', t, cfg.intensity, rng() * 100000);
      if (cfg.style === 'electronic' || cfg.style === 'happy' || cfg.style === 'epic') {
        playDrumHit(ctx, dryBus, 'kick', t + beatDuration * 2, cfg.intensity, rng() * 100000);
      }
      if (cfg.style !== 'relax' && cfg.style !== 'ambient') {
        const type = cfg.style === 'lofi' ? 'clap' : 'snare';
        playDrumHit(ctx, dryBus, type, t + beatDuration, cfg.intensity, rng() * 100000);
        playDrumHit(ctx, dryBus, type, t + beatDuration * 3, cfg.intensity, rng() * 100000);
      }
      const hatDensity = cfg.style === 'electronic' || cfg.style === 'happy' ? 2 : 1;
      for (let i = 0; i < 4 * hatDensity; i++) {
        if (rng() > 0.15) {
          playDrumHit(ctx, dryBus, 'hihat', t + (i * beatDuration) / hatDensity, cfg.intensity, rng() * 100000);
        }
      }
      t += barDuration;
    }
  }

  // === MELODY / ARPEGIOS ===
  if (cfg.layers.melody) {
    let t = 0;
    let barIndex = 0;
    const notesPool = scaleNotes.filter((n) => n >= rootMidi + 12 && n <= rootMidi + 36);
    while (t < cfg.duration) {
      const chord = progression[barIndex % progression.length];
      const chordNotes = chord.map((n) => n + 12);
      const density = cfg.progression === 'complex' ? 6 : cfg.progression === 'moderate' ? 4 : 2;
      for (let i = 0; i < density; i++) {
        const noteTime = t + (i * barDuration) / density;
        if (noteTime >= cfg.duration) break;
        const pool = cfg.style === 'ambient' || cfg.style === 'relax' ? chordNotes : notesPool;
        const note = pool[Math.floor(rng() * pool.length)];
        const dur = (barDuration / density) * (cfg.style === 'ambient' ? 1.8 : 0.9);
        playPluck(
          ctx,
          cfg.style === 'ambient' || cfg.style === 'relax' ? reverbBus : dryBus,
          note,
          noteTime,
          dur,
          cfg.intensity,
          rng() * 100000
        );
      }
      t += barDuration;
      barIndex++;
    }
  }

  onProgress?.(0.5);
  const buffer = await ctx.startRendering();
  onProgress?.(0.85);
  const blob = audioBufferToWav(buffer);
  const url = URL.createObjectURL(blob);
  onProgress?.(1);

  return { buffer, blob, url, duration: cfg.duration };
}

export function revokeMusicUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch (_) {
    // ignorar
  }
}

// ============================================================
// GENERADORES DE BUCLES / LOOPS PARA EL ESCAPARATE
// ============================================================

export type LoopCategory = 'drums' | 'bass' | 'pads' | 'percussion';

export interface LoopPreset {
  id: string;
  category: LoopCategory;
  name: string;
  bpm: number;
  bars: number; // 1, 2, 4, 8
  style: MusicStyle;
  key?: string; // para bass/pads
}

export interface GenerateLoopResult extends GenerateMusicResult {
  preset: LoopPreset;
}

function createLoopContext(durationSec: number, sampleRate = 44100) {
  const totalSamples = Math.ceil(durationSec * sampleRate);
  const ctx = new OfflineAudioContext(2, totalSamples, sampleRate);
  const master = makeLimiter(ctx, ctx.destination);
  const reverbBus = makeReverb(ctx, master, 0.25);
  const dryBus = ctx.createGain();
  dryBus.connect(master);
  return { ctx, master, reverbBus, dryBus, duration: durationSec };
}

function loopDurationSec(bpm: number, bars: number): number {
  return (bars * 4 * 60) / bpm;
}

function finishLoop(
  ctx: OfflineAudioContext,
  preset: LoopPreset,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  return new Promise((resolve, reject) => {
    onProgress?.(0.5);
    ctx.startRendering()
      .then((buffer) => {
        onProgress?.(0.85);
        const blob = audioBufferToWav(buffer);
        const url = URL.createObjectURL(blob);
        onProgress?.(1);
        resolve({ buffer, blob, url, duration: preset.bars * 4 * (60 / preset.bpm), preset });
      })
      .catch(reject);
  });
}


// --- DRUM LOOPS ---

export async function generateDrumLoop(
  preset: LoopPreset,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  const bps = preset.bpm / 60;
  const beatDur = 1 / bps;
  const duration = loopDurationSec(preset.bpm, preset.bars);
  const { ctx, dryBus: rawDry } = createLoopContext(duration);
  // Bus de batería con compresión paralela y saturación
  const drumBus = makeParallelCompression(ctx, rawDry, 0.45);
  const swingAmount = preset.style === 'lofi' ? 0.04 : preset.style === 'happy' ? 0.02 : 0.0;
  const rng = seededRandom(preset.bpm * 100 + preset.bars * 7 + preset.name.length);
  const intensity = 0.78;

  // Patrones por estilo
  type DrumPattern = {
    kick: number[];
    snare: number[];
    hihat: number[];
    openHat?: number[];
    ghostSnare?: number[];
    fillProb?: number;
  };

  const patterns: Record<MusicStyle, DrumPattern> = {
    electronic: {
      kick: [0, 0, 1, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 1, 1, 1, 1, 1, 1, 1],
      openHat: [0, 0, 0, 0, 0, 0, 0, 1],
    },
    happy: {
      kick: [1, 0, 0, 1, 0, 0, 1, 0],
      snare: [0, 0, 1, 0, 0, 0, 1, 0],
      hihat: [1, 1, 1, 1, 1, 1, 1, 1],
    },
    epic: {
      kick: [1, 0, 1, 0, 1, 0, 1, 0],
      snare: [0, 0, 1, 0, 0, 0, 1, 0],
      hihat: [1, 0, 1, 0, 1, 0, 1, 0],
      ghostSnare: [0, 0.5, 0, 0.4, 0, 0.5, 0, 0.4],
      fillProb: 0.4,
    },
    lofi: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [0, 1, 0, 1, 0, 1, 0, 1],
      openHat: [0, 0, 0, 0, 0, 0, 1, 0],
    },
    suspense: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 1, 0],
      hihat: [0, 1, 0, 1, 0, 1, 0, 1],
    },
    cinematic: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 0, 1, 0, 1, 0, 1, 0],
      openHat: [0, 0, 0, 0, 0, 0, 0, 1],
      fillProb: 0.5,
    },
    ambient: { kick: [], snare: [], hihat: [] },
    relax: { kick: [], snare: [], hihat: [] },
    sad: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [0, 1, 0, 1, 0, 1, 0, 1],
    },
  };

  const pattern = patterns[preset.style] || patterns['electronic'];
  const totalSteps = preset.bars * 16; // 16 pasos por compás

  for (let step = 0; step < totalSteps; step++) {
    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;
    const eighth = stepInBar / 2;
    const isOffbeat = stepInBar % 2 === 1;
    // Swing: retrasa las corcheas impares
    const timeOffset = isOffbeat ? swingAmount * beatDur : 0;
    const t = bar * 4 * beatDur + (stepInBar * beatDur) / 4 + timeOffset;
    if (t >= duration) break;

    const idx = Math.floor(eighth) % 8;
    const isLastBar = bar === preset.bars - 1;
    const isFill = isLastBar && pattern.fillProb && rng() < pattern.fillProb && stepInBar >= 12;

    // Kick
    if (pattern.kick[idx] && !isFill) {
      playDrumHit(ctx, drumBus, 'kick', t, intensity, rng() * 100000, {
        velocity: 0.9 + rng() * 0.1,
        decay: preset.style === 'lofi' ? 0.45 : 0.32,
      });
    }

    // Snare / Clap
    if (pattern.snare[idx] && !isFill) {
      playDrumHit(ctx, drumBus, preset.style === 'lofi' ? 'clap' : 'snare', t, intensity, rng() * 100000, {
        velocity: 0.85 + rng() * 0.15,
        pan: (rng() - 0.5) * 0.2,
      });
    }

    // Ghost snares
    if (pattern.ghostSnare?.[idx] && !isFill && rng() < pattern.ghostSnare[idx]) {
      playDrumHit(ctx, drumBus, 'snare', t, intensity, rng() * 100000, {
        velocity: 0.35,
        pan: (rng() - 0.5) * 0.15,
      });
    }

    // Hi-hat cerrado
    if (pattern.hihat[idx] && !isFill) {
      const isAccent = stepInBar % 4 === 0;
      playDrumHit(ctx, drumBus, 'hihat', t, intensity, rng() * 100000, {
        velocity: isAccent ? 0.9 : 0.45 + rng() * 0.25,
        pan: (rng() - 0.5) * 0.35,
        decay: isAccent ? 0.09 : 0.05,
      });
    }

    // Open hat
    if (pattern.openHat?.[idx] && stepInBar % 8 === 7) {
      playDrumHit(ctx, drumBus, 'hihat', t, intensity * 0.7, rng() * 100000, {
        velocity: 0.7,
        pan: (rng() - 0.5) * 0.25,
        decay: 0.2,
      });
    }

    // Fills: ráfagas rápidas
    if (isFill && stepInBar >= 13) {
      if (stepInBar % 2 === 1) {
        playDrumHit(ctx, drumBus, 'snare', t, intensity, rng() * 100000, {
          velocity: 0.75 + rng() * 0.2,
          pan: (rng() - 0.5) * 0.3,
        });
      }
    }

    // Crash al inicio del loop
    if (step === 0) {
      playDrumHit(ctx, drumBus, 'crash', t, intensity * 0.6, rng() * 100000);
    }
  }

  return finishLoop(ctx, preset, onProgress);
}

// --- BASS LOOPS ---

function playBassLoopNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  midi: number,
  startTime: number,
  duration: number,
  intensity: number,
  accent = false,
  slide = false
) {
  const freq = midiToFreq(midi);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq, startTime);
  if (slide) {
    sub.frequency.exponentialRampToValueAtTime(freq * 1.06, startTime + duration * 0.6);
  }

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(freq, startTime);
  if (slide) {
    saw.frequency.exponentialRampToValueAtTime(freq * 1.06, startTime + duration * 0.6);
  }

  const gain = ctx.createGain();
  const peak = (accent ? 0.35 : 0.25) + intensity * 0.12;
  applyEnvelope(gain, startTime, duration, {
    attack: 0.005,
    decay: 0.06,
    sustain: 0.65,
    release: 0.18,
  }, peak);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const baseFreq = 260 + intensity * 300;
  filter.frequency.setValueAtTime(baseFreq, startTime);
  filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, startTime + duration * 0.4);
  if (accent) {
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 1.4, startTime + 0.03);
  }
  filter.Q.value = 3 + intensity * 2;

  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.45;

  sub.connect(subGain);
  saw.connect(sawGain);
  subGain.connect(filter);
  sawGain.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  sub.start(startTime);
  saw.start(startTime);
  sub.stop(startTime + duration);
  saw.stop(startTime + duration);
}

export async function generateBassLoop(
  preset: LoopPreset,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  const bps = preset.bpm / 60;
  const beatDur = 1 / bps;
  const duration = loopDurationSec(preset.bpm, preset.bars);
  const { ctx, dryBus: rawDry } = createLoopContext(duration);
  const bassBus = makeSaturation(ctx, rawDry, 0.25);
  const rng = seededRandom(preset.bpm * 200 + preset.bars * 13 + (preset.key || 'C').length);
  const intensity = 0.72;

  const { root, isMinor } = getRootFromKey(preset.key || 'C');
  const scaleName = isMinor ? 'minor' : 'major';
  const rootMidi = rootNoteToMidi(root);
  const progression = makeProgression(rootMidi, scaleName, 'simple');
  const scaleNotes = getScaleMidiNotes(rootMidi, scaleName, 2);

  // Patrones de bajo por estilo
  const bassPatterns: Record<MusicStyle, number[][]> = {
    electronic: [[1, 0, 0, 1, 0, 0, 1, 1]],
    happy: [[1, 0, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1, 0, 1]],
    epic: [[1, 0, 0, 0, 1, 0, 0, 1], [1, 0, 0, 1, 1, 0, 0, 1]],
    lofi: [[1, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 1, 0, 1]],
    suspense: [[1, 0, 0, 1, 0, 0, 0, 1]],
    cinematic: [[1, 0, 0, 0, 0, 1, 0, 0]],
    ambient: [[1, 0, 0, 0, 1, 0, 0, 0]],
    relax: [[1, 0, 0, 0, 0, 0, 1, 0]],
    sad: [[1, 0, 0, 0, 1, 0, 0, 1]],
  };

  const patterns = bassPatterns[preset.style] || bassPatterns['electronic'];

  let t = 0;
  let barIndex = 0;
  while (t < duration) {
    const chord = progression[barIndex % progression.length];
    const rootNote = chord[0];
    const fifth = chord[2] ?? rootNote + 7;
    const third = chord[1] ?? rootNote + (isMinor ? 3 : 4);
    const pattern = patterns[barIndex % patterns.length];

    for (let step = 0; step < 8; step++) {
      const stepTime = t + (step * beatDur) / 2;
      if (stepTime >= duration) break;
      if (pattern[step]) {
        let note = rootNote;
        // Añadir variedad melódica
        if (step === 2 || step === 6) note = fifth;
        if (step === 3 || step === 7) note = third;
        if (rng() > 0.8) note += 12; // octava superior
        if (rng() > 0.9) note -= 12; // sub-bajo

        const isAccent = step === 0 || step === 4;
        playBassLoopNote(ctx, bassBus, note, stepTime, beatDur * 0.7, intensity, isAccent, rng() > 0.7);
      }
    }
    t += 4 * beatDur;
    barIndex++;
  }

  return finishLoop(ctx, preset, onProgress);
}

// --- PAD LOOPS ---

function playRichPadChord(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  notes: number[],
  startTime: number,
  duration: number,
  intensity: number,
  seed: number
) {
  const rng = seededRandom(seed);
  const baseGain = ctx.createGain();
  baseGain.gain.value = 0.12 + intensity * 0.1;
  baseGain.connect(destination);

  // Autopan lento
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime((rng() - 0.5) * 0.4, startTime);
  baseGain.connect(panner);
  const panTarget = ctx.createGain();
  panTarget.gain.value = 1;
  panner.connect(panTarget);
  panTarget.connect(destination);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08 + rng() * 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.25;
  lfo.connect(lfoGain);
  lfoGain.connect(panner.pan);
  lfo.start(startTime);
  lfo.stop(startTime + duration);

  for (const midi of notes) {
    const freq = midiToFreq(midi);
    // 3 osciladores por nota: sine, triangle, saw suave
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const oscC = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscC.type = 'sawtooth';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq * (1 + (rng() * 0.005 - 0.0025));
    oscC.frequency.value = freq * (1 + (rng() * 0.006 - 0.003));

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.33;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseFilter = 900 + rng() * 700;
    filter.frequency.setValueAtTime(baseFilter * 0.7, startTime);
    filter.frequency.linearRampToValueAtTime(baseFilter, startTime + duration * 0.4);
    filter.Q.value = 1.5;

    oscA.connect(oscGain);
    oscB.connect(oscGain);
    oscC.connect(oscGain);
    oscGain.connect(filter);
    filter.connect(panTarget);

    oscA.start(startTime);
    oscB.start(startTime);
    oscC.start(startTime);
    oscA.stop(startTime + duration);
    oscB.stop(startTime + duration);
    oscC.stop(startTime + duration);

    // Envolvente larga por nota
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, startTime);
    noteGain.gain.linearRampToValueAtTime(1, startTime + 0.4);
    noteGain.gain.setValueAtTime(1, startTime + duration - 0.8);
    noteGain.gain.linearRampToValueAtTime(0, startTime + duration);
    // Nota: por simplicidad la envolvente no se aplica individualmente aquí; se deja el corte limpio
  }
}

export async function generatePadLoop(
  preset: LoopPreset,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  const bps = preset.bpm / 60;
  const beatDur = 1 / bps;
  const duration = loopDurationSec(preset.bpm, preset.bars);
  const { ctx, reverbBus } = createLoopContext(duration);
  const padBus = ctx.createGain();
  padBus.gain.value = 0.85;
  padBus.connect(reverbBus);
  const rng = seededRandom(preset.bpm * 300 + preset.bars * 19 + (preset.key || 'C').length);
  const intensity = 0.55;

  const { root, isMinor } = getRootFromKey(preset.key || 'C');
  const scaleName = isMinor ? 'minor' : 'major';
  const rootMidi = rootNoteToMidi(root);
  const progression = makeProgression(rootMidi, scaleName, preset.bars > 2 ? 'moderate' : 'simple');

  let t = 0;
  let barIndex = 0;
  while (t < duration) {
    const chord = progression[barIndex % progression.length];
    // Añadir octava superior para más cuerpo
    const richChord = [...chord, ...chord.map((n) => n + 12)];
    const dur = Math.min(4 * beatDur * 2, duration - t);
    playRichPadChord(ctx, padBus, richChord, t, dur, intensity, rng() * 100000);
    t += 4 * beatDur * 2;
    barIndex += 2;
  }

  return finishLoop(ctx, preset, onProgress);
}

// --- PERCUSSION LOOPS ---

export async function generatePercussionLoop(
  preset: LoopPreset,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  const bps = preset.bpm / 60;
  const beatDur = 1 / bps;
  const duration = loopDurationSec(preset.bpm, preset.bars);
  const { ctx, dryBus: rawDry } = createLoopContext(duration);
  const percBus = makeParallelCompression(ctx, rawDry, 0.35);
  const rng = seededRandom(preset.bpm * 400 + preset.bars * 23 + preset.name.length);
  const intensity = 0.6;

  // Patrones por estilo
  type PercPattern = {
    shaker: number[];
    clap: number[];
    tom?: number[];
    rim?: number[];
  };

  const patterns: Record<MusicStyle, PercPattern> = {
    happy: {
      shaker: [0.6, 0.3, 0.7, 0.4, 0.6, 0.3, 0.7, 0.5],
      clap: [0, 0, 1, 0, 0, 0, 1, 0],
      rim: [1, 0, 0, 1, 0, 1, 0, 0],
    },
    epic: {
      shaker: [0.5, 0.2, 0.6, 0.2, 0.5, 0.2, 0.6, 0.2],
      clap: [0, 0, 1, 0, 0, 0, 1, 0],
      tom: [0, 0, 0, 0, 0, 1, 0, 0],
    },
    relax: {
      shaker: [0.4, 0.2, 0.5, 0.2, 0.4, 0.2, 0.5, 0.2],
      clap: [0, 0, 0.6, 0, 0, 0, 0.6, 0],
    },
    lofi: {
      shaker: [0.3, 0.5, 0.3, 0.5, 0.3, 0.5, 0.3, 0.5],
      clap: [0, 0, 0.8, 0, 0, 0, 0.8, 0],
    },
    electronic: {
      shaker: [0.7, 0.4, 0.7, 0.4, 0.7, 0.4, 0.7, 0.4],
      clap: [0, 0, 1, 0, 0, 0, 1, 0],
      rim: [0, 0.8, 0, 0, 0, 0.8, 0, 0],
    },
    cinematic: {
      shaker: [0.5, 0.2, 0.5, 0.2, 0.5, 0.2, 0.5, 0.2],
      clap: [0, 0, 0.8, 0, 0, 0, 0.8, 0],
      tom: [1, 0, 0, 0, 0, 0, 0, 1],
    },
    suspense: {
      shaker: [0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0],
      clap: [0, 0, 0, 0, 0, 0, 0.7, 0],
      rim: [0.7, 0, 0.7, 0, 0.7, 0, 0.7, 0],
    },
    ambient: {
      shaker: [0.2, 0, 0.2, 0, 0.2, 0, 0.2, 0],
      clap: [0, 0, 0.3, 0, 0, 0, 0.3, 0],
    },
    sad: {
      shaker: [0.3, 0.1, 0.3, 0.1, 0.3, 0.1, 0.3, 0.1],
      clap: [0, 0, 0.5, 0, 0, 0, 0.5, 0],
    },
  };

  const pattern = patterns[preset.style] || patterns['happy'];

  let t = 0;
  let barIndex = 0;
  while (t < duration) {
    for (let step = 0; step < 8; step++) {
      const stepTime = t + (step * beatDur) / 2;
      if (stepTime >= duration) break;

      // Shaker con velocidad variable
      if (pattern.shaker[step] && rng() < pattern.shaker[step]) {
        playDrumHit(ctx, percBus, 'shaker', stepTime, intensity, rng() * 100000, {
          velocity: 0.5 + rng() * 0.5,
          pan: (rng() - 0.5) * 0.5,
        });
      }

      // Claps
      if (pattern.clap[step] && rng() < pattern.clap[step]) {
        playDrumHit(ctx, percBus, 'clap', stepTime, intensity, rng() * 100000, {
          velocity: 0.7 + rng() * 0.3,
          pan: (rng() - 0.5) * 0.25,
        });
      }

      // Toms (variación)
      if (pattern.tom?.[step] && rng() < pattern.tom[step]) {
        playDrumHit(ctx, percBus, 'tom', stepTime, intensity, rng() * 100000, {
          velocity: 0.6 + rng() * 0.3,
          pan: (rng() - 0.5) * 0.4,
        });
      }

      // Rim
      if (pattern.rim?.[step] && rng() < pattern.rim[step]) {
        playDrumHit(ctx, percBus, 'rim', stepTime, intensity, rng() * 100000, {
          velocity: 0.5 + rng() * 0.3,
          pan: (rng() - 0.5) * 0.3,
        });
      }
    }
    t += 4 * beatDur;
    barIndex++;
  }

  return finishLoop(ctx, preset, onProgress);
}

export interface LoopCatalogItem {
  id: string;
  category: LoopCategory;
  name: string;
  description: string;
  bpm: number;
  bars: number;
  style: MusicStyle;
  key?: string;
}

export const LOOP_CATALOG: LoopCatalogItem[] = [
  // DRUMS
  { id: 'drum-house-4', category: 'drums', name: 'House Beat', description: 'Kick + snare + hi-hats 4/4', bpm: 128, bars: 4, style: 'electronic' },
  { id: 'drum-lofi-4', category: 'drums', name: 'Lo-Fi Beat', description: 'Clap suave y hats crujientes', bpm: 85, bars: 4, style: 'lofi' },
  { id: 'drum-rock-4', category: 'drums', name: 'Rock Beat', description: 'Batería potente con doble bombo', bpm: 120, bars: 4, style: 'epic' },
  { id: 'drum-happy-4', category: 'drums', name: 'Pop Beat', description: 'Ritmo alegre y dinámico', bpm: 110, bars: 4, style: 'happy' },
  { id: 'drum-suspense-4', category: 'drums', name: 'Tension Beat', description: 'Kick irregular y atmósfera oscura', bpm: 90, bars: 4, style: 'suspense' },

  // BASS
  { id: 'bass-house-4', category: 'bass', name: 'House Bassline', description: 'Línea de bajo house en C', bpm: 128, bars: 4, style: 'electronic', key: 'C' },
  { id: 'bass-lofi-4', category: 'bass', name: 'Lo-Fi Bass', description: 'Bajo relajado en Am', bpm: 85, bars: 4, style: 'lofi', key: 'Am' },
  { id: 'bass-cinematic-4', category: 'bass', name: 'Cinematic Bass', description: 'Bajo épico en Dm', bpm: 100, bars: 4, style: 'cinematic', key: 'Dm' },
  { id: 'bass-happy-4', category: 'bass', name: 'Pop Bass', description: 'Bajo alegre en G', bpm: 115, bars: 4, style: 'happy', key: 'G' },
  { id: 'bass-suspense-4', category: 'bass', name: 'Dark Bass', description: 'Bajo tenso en C#m', bpm: 90, bars: 4, style: 'suspense', key: 'C#m' },

  // PADS
  { id: 'pad-ambient-8', category: 'pads', name: 'Ambient Pad', description: 'Textura etérea en C', bpm: 90, bars: 8, style: 'ambient', key: 'C' },
  { id: 'pad-cinematic-8', category: 'pads', name: 'Cinematic Pad', description: 'Cuerdas oscuras en Dm', bpm: 90, bars: 8, style: 'cinematic', key: 'Dm' },
  { id: 'pad-relax-8', category: 'pads', name: 'Relax Pad', description: 'Ambiente relajante en G', bpm: 70, bars: 8, style: 'relax', key: 'G' },
  { id: 'pad-suspense-8', category: 'pads', name: 'Suspense Pad', description: 'Textura tensa en C#m', bpm: 80, bars: 8, style: 'suspense', key: 'C#m' },

  // PERCUSSION
  { id: 'perc-latin-4', category: 'percussion', name: 'Latin Percussion', description: 'Shakers y claps latinos', bpm: 110, bars: 4, style: 'happy' },
  { id: 'perc-tribal-4', category: 'percussion', name: 'Tribal Percussion', description: 'Percusión tribal con claps', bpm: 100, bars: 4, style: 'epic' },
  { id: 'perc-soft-4', category: 'percussion', name: 'Soft Percussion', description: 'Percusión ligera y suave', bpm: 85, bars: 4, style: 'relax' },
];

export async function generateLoop(
  item: LoopCatalogItem,
  onProgress?: (progress: number) => void
): Promise<GenerateLoopResult> {
  const preset: LoopPreset = {
    id: item.id,
    category: item.category,
    name: item.name,
    bpm: item.bpm,
    bars: item.bars,
    style: item.style,
    key: item.key,
  };

  switch (item.category) {
    case 'drums':
      return generateDrumLoop(preset, onProgress);
    case 'bass':
      return generateBassLoop(preset, onProgress);
    case 'pads':
      return generatePadLoop(preset, onProgress);
    case 'percussion':
      return generatePercussionLoop(preset, onProgress);
    default:
      throw new Error(`Categoría de bucle no soportada: ${item.category}`);
  }
}

