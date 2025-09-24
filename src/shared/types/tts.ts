export interface TTSSettings {
  rate: number; // 0.5 - 2.0
  pitch: number; // 0 - 2
  volume: number; // 0 - 1
  voice: string | null;
}

export interface TTSState {
  isReading: boolean;
  isPaused: boolean;
  currentTabId: number | null;
  progress: number;
}
