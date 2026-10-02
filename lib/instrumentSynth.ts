/**
 * Configuración de síntesis por instrumento.
 * Define tipo de onda, envolvente (ataque, decay, sustain, release) y filtro
 * para que cada instrumento suene más reconocible.
 */

export type InstrumentId =
  | 'acoustic_grand_piano'
  | 'electric_piano'
  | 'organ'
  | 'strings'
  | 'synth_lead'
  | 'bass'
  | 'brass'
  | 'pad';

export interface InstrumentSynthConfig {
  type: OscillatorType;
  /** Ataque en segundos (0 = instantáneo) */
  attack: number;
  /** Decay en segundos hasta el nivel de sustain */
  decay: number;
  /** Nivel de sustain (0-1) después del decay */
  sustain: number;
  /** Release en segundos al soltar la tecla */
  release: number;
  /** Frecuencia del filtro lowpass (Hz); 0 = sin filtro */
  filterFreq?: number;
  /** Resonancia del filtro (Q) */
  filterQ?: number;
}

export const INSTRUMENT_SYNTH_CONFIG: Record<string, InstrumentSynthConfig> = {
  acoustic_grand_piano: {
    type: 'sawtooth',
    attack: 0.008,
    decay: 0.12,
    sustain: 0.25,
    release: 0.35,
    filterFreq: 4000,
    filterQ: 1,
  },
  electric_piano: {
    type: 'square',
    attack: 0.02,
    decay: 0.25,
    sustain: 0.5,
    release: 0.25,
    filterFreq: 3500,
    filterQ: 0.5,
  },
  organ: {
    type: 'sine',
    attack: 0.002,
    decay: 0,
    sustain: 1,
    release: 0.08,
  },
  strings: {
    type: 'triangle',
    attack: 0.25,
    decay: 0.1,
    sustain: 0.75,
    release: 0.6,
    filterFreq: 6000,
    filterQ: 0.3,
  },
  synth_lead: {
    type: 'sawtooth',
    attack: 0.015,
    decay: 0.08,
    sustain: 0.7,
    release: 0.2,
    filterFreq: 5000,
    filterQ: 2,
  },
  bass: {
    type: 'triangle',
    attack: 0.01,
    decay: 0.15,
    sustain: 0.6,
    release: 0.2,
    filterFreq: 800,
    filterQ: 1,
  },
  brass: {
    type: 'sawtooth',
    attack: 0.06,
    decay: 0.05,
    sustain: 0.85,
    release: 0.25,
    filterFreq: 2500,
    filterQ: 0.8,
  },
  pad: {
    type: 'sine',
    attack: 0.5,
    decay: 0.2,
    sustain: 0.7,
    release: 0.9,
    filterFreq: 2000,
    filterQ: 0.5,
  },
};

export function getInstrumentConfig(instrument: string): InstrumentSynthConfig {
  return INSTRUMENT_SYNTH_CONFIG[instrument] ?? INSTRUMENT_SYNTH_CONFIG.acoustic_grand_piano;
}
