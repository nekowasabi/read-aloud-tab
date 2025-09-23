import { QueueStatus, TabInfo, TTSSettings } from './types';

export type QueueSkipDirection = 'next' | 'previous';

export interface QueueTabInput {
  tabId: number;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  extractedAt?: number | string | Date;
}

export interface QueueAddPayload {
  tab: QueueTabInput;
  position?: 'start' | 'end' | number;
  autoStart?: boolean;
}

export interface QueueRemovePayload {
  tabId: number;
}

export interface QueueReorderPayload {
  fromIndex: number;
  toIndex: number;
}

export interface QueueSkipPayload {
  direction: QueueSkipDirection;
}

export type QueueControlAction = 'start' | 'pause' | 'resume' | 'stop';

export interface QueueControlPayload {
  action: QueueControlAction;
}

export interface QueueSettingsUpdatePayload {
  settings: Partial<TTSSettings>;
}

export type QueueCommandMessage =
  | { type: 'QUEUE_ADD'; payload: QueueAddPayload }
  | { type: 'QUEUE_REMOVE'; payload: QueueRemovePayload }
  | { type: 'QUEUE_REORDER'; payload: QueueReorderPayload }
  | { type: 'QUEUE_SKIP'; payload: QueueSkipPayload }
  | { type: 'QUEUE_CONTROL'; payload: QueueControlPayload }
  | { type: 'QUEUE_UPDATE_SETTINGS'; payload: QueueSettingsUpdatePayload }
  | { type: 'REQUEST_QUEUE_STATE' };

export interface SerializedTabInfo
  extends Omit<TabInfo, 'extractedAt'> {
  extractedAt: string | null;
}

export interface QueueStatusPayload {
  status: QueueStatus;
  currentIndex: number;
  totalCount: number;
  activeTabId: number | null;
  tabs: SerializedTabInfo[];
  settings: TTSSettings;
  updatedAt: number;
}

export interface QueueProgressPayload {
  tabId: number;
  progress: number;
  timestamp: number;
}

export interface QueueErrorPayload {
  code: string;
  message: string;
  tabId?: number;
  detail?: unknown;
  timestamp: number;
}

export type QueueBroadcastMessage =
  | { type: 'QUEUE_STATUS_UPDATE'; payload: QueueStatusPayload }
  | { type: 'QUEUE_PROGRESS_UPDATE'; payload: QueueProgressPayload }
  | { type: 'QUEUE_ERROR'; payload: QueueErrorPayload }
  | { type: 'QUEUE_CONTENT_REQUEST'; payload: { tabId: number; reason: 'missing' | 'stale' } };

export type QueueStatusListener = (payload: QueueStatusPayload) => void;
export type QueueProgressListener = (payload: QueueProgressPayload) => void;
export type QueueErrorListener = (payload: QueueErrorPayload) => void;
export type QueueCommandListener = (
  event: Extract<QueueBroadcastMessage, { type: 'QUEUE_CONTENT_REQUEST' }>
) => void;

export function isQueueCommandMessage(message: unknown): message is QueueCommandMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }

  switch (candidate.type) {
    case 'QUEUE_ADD':
    case 'QUEUE_REMOVE':
    case 'QUEUE_REORDER':
    case 'QUEUE_SKIP':
    case 'QUEUE_CONTROL':
    case 'QUEUE_UPDATE_SETTINGS':
    case 'REQUEST_QUEUE_STATE':
      return true;
    default:
      return false;
  }
}

export function isQueueBroadcastMessage(message: unknown): message is QueueBroadcastMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }

  switch (candidate.type) {
    case 'QUEUE_STATUS_UPDATE':
    case 'QUEUE_PROGRESS_UPDATE':
    case 'QUEUE_ERROR':
    case 'QUEUE_CONTENT_REQUEST':
      return true;
    default:
      return false;
  }
}

export function toSerializedTabInfo(tab: TabInfo): SerializedTabInfo {
  return {
    ...tab,
    extractedAt: tab.extractedAt ? new Date(tab.extractedAt).toISOString() : null,
  };
}
