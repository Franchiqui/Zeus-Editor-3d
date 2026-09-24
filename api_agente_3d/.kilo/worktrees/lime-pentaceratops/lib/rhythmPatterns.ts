/**
 * Patrones de acompañamiento rítmico para el teclado MIDI.
 * Cada patrón tiene 16 pasos por compás (semicorcheas); 1 = golpe, 0 = silencio.
 */

export type RhythmId = 'off' | 'rock' | 'pop' | 'bossa' | 'jazz' | 'reggae';

export interface RhythmStep {
  kick: boolean;
  snare: boolean;
  hihat: boolean;
  /** Hi-hat abierto (accent) en pasos típicamente 0, 4, 8, 12 */
  hihatOpen?: boolean;
}

export interface RhythmPattern {
  id: RhythmId;
  name: string;
  bpm: number;
  /** 16 pasos por compás */
  steps: RhythmStep[];
}

const ROCK_STEPS: RhythmStep[] = [
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
];

const POP_STEPS: RhythmStep[] = [
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
];

const BOSSA_STEPS: RhythmStep[] = [
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
];

const JAZZ_STEPS: RhythmStep[] = [
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true, hihatOpen: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true, hihatOpen: true },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: true },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: true },
];

const REGGAE_STEPS: RhythmStep[] = [
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: true, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: true, hihat: true },
  { kick: false, snare: false, hihat: false },
  { kick: false, snare: false, hihat: true },
  { kick: false, snare: false, hihat: false },
];

export const RHYTHM_PATTERNS: Record<Exclude<RhythmId, 'off'>, RhythmPattern> = {
  rock: { id: 'rock', name: 'Rock', bpm: 128, steps: ROCK_STEPS },
  pop: { id: 'pop', name: 'Pop', bpm: 118, steps: POP_STEPS },
  bossa: { id: 'bossa', name: 'Bossa', bpm: 138, steps: BOSSA_STEPS },
  jazz: { id: 'jazz', name: 'Jazz', bpm: 148, steps: JAZZ_STEPS },
  reggae: { id: 'reggae', name: 'Reggae', bpm: 96, steps: REGGAE_STEPS },
};

export const RHYTHM_IDS: Exclude<RhythmId, 'off'>[] = ['rock', 'pop', 'bossa', 'jazz', 'reggae'];
