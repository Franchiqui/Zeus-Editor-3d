export interface RhythmConfig {
  id: string; // "Tiktac_0", "Tiktac_1", etc.
  filePath: string; // Ubicación del archivo
  velocity: number; // Velocidad (0.25 - 2.0)
  volume: number; // Volumen (0 - 1)
}

export interface RhythmConfigFile {
  rhythms: RhythmConfig[];
  lastUpdated: string;
}

export const DEFAULT_RHYTHM_CONFIG: RhythmConfigFile = {
  rhythms: Array.from({ length: 9 }, (_, i) => ({
    id: `Tiktac_${i}`,
    filePath: '',
    velocity: 1,
    volume: 0.8
  })),
  lastUpdated: new Date().toISOString()
};
