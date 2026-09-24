import { RhythmConfig, RhythmConfigFile, DEFAULT_RHYTHM_CONFIG } from '@/types/rhythm-config';
import { writeFile, readFile } from '@/lib/electron-fs';

const RHYTHM_CONFIG_FILE = 'f:/Zeus Media Studio/types/rhythm-config.json';

export const loadRhythmConfig = async (): Promise<RhythmConfigFile> => {
  try {
    const data = await readFile(RHYTHM_CONFIG_FILE);
    if (data) {
      return JSON.parse(data) as RhythmConfigFile;
    }
  } catch (error) {
    console.warn('Error loading rhythm config, using defaults:', error);
  }
  return DEFAULT_RHYTHM_CONFIG;
};

export const saveRhythmConfig = async (config: RhythmConfigFile): Promise<void> => {
  try {
    config.lastUpdated = new Date().toISOString();
    const success = await writeFile(RHYTHM_CONFIG_FILE, JSON.stringify(config, null, 2));
    if (!success) {
      console.error('Failed to save rhythm config');
    }
  } catch (error) {
    console.error('Error saving rhythm config:', error);
  }
};

export const updateRhythmConfig = async (rhythmId: string, updates: Partial<RhythmConfig>): Promise<void> => {
  const config = await loadRhythmConfig();
  const rhythmIndex = config.rhythms.findIndex(r => r.id === rhythmId);
  
  if (rhythmIndex !== -1) {
    config.rhythms[rhythmIndex] = { ...config.rhythms[rhythmIndex], ...updates };
    await saveRhythmConfig(config);
  } else {
    console.warn(`Rhythm ${rhythmId} not found in config`);
  }
};

export const resetRhythmVelocityAndVolume = async (): Promise<void> => {
  const config = await loadRhythmConfig();
  config.rhythms = config.rhythms.map(rhythm => ({
    ...rhythm,
    velocity: 1,
    volume: 0.8
  }));
  await saveRhythmConfig(config);
};
