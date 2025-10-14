import { TabInfo } from './tab';
import { TTSSettings } from './tts';

export type QueueStatus = 'idle' | 'reading' | 'paused' | 'error';

export interface ReadingQueue {
  tabs: TabInfo[];
  currentIndex: number;
  status: QueueStatus;
  settings: TTSSettings;
  progressByTab?: Record<number, number>;
  persistedAt?: number;
}

export interface QueueSnapshot extends ReadingQueue {
  updatedAt: number;
}
