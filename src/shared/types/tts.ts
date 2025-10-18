export interface TTSSettings {
  rate: number; // 0.5 - 2.0
  pitch: number; // 0 - 2
  volume: number; // 0 - 1
  voice: string | null;
  // === process5 sub4: UI改善（設定パネルに性別フィルター追加）===
  preferredGender?: 'any' | 'female' | 'male'; // 優先性別（デフォルト: 'female'）
}

export interface TTSState {
  isReading: boolean;
  isPaused: boolean;
  currentTabId: number | null;
  progress: number;
}
