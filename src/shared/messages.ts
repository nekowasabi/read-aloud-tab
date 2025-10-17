import {
  QueueStatus,
  TabInfo,
  TTSSettings,
  SerializedTabInfo,
  createSerializedTab,
  KeepAliveDiagnostics,
} from './types';

export type { SerializedTabInfo } from './types';

export type QueueSkipDirection = 'next' | 'previous';

export interface QueueTabInput {
  tabId: number;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  translation?: string;
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
  | { type: 'QUEUE_CLEAR' }
  | { type: 'REQUEST_QUEUE_STATE' };

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

export interface PrefetchStatusPayload {
  tabId: number;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  updatedAt: number;
  error?: string;
}

export interface PrefetchStatusSnapshot {
  statuses: PrefetchStatusPayload[];
  updatedAt: number;
  diagnostics?: KeepAliveDiagnostics;
}

export type PrefetchBroadcastMessage = {
  type: 'PREFETCH_STATUS_SYNC';
  payload: PrefetchStatusSnapshot;
};

export type PrefetchCommandMessage =
  | { type: 'PREFETCH_RETRY'; payload: { tabId: number } }
  | { type: 'PREFETCH_STATUS_SNAPSHOT_REQUEST' };

export interface KeepAliveDiagnosticsMessage {
  type: 'KEEP_ALIVE_DIAGNOSTICS';
  payload: KeepAliveDiagnostics;
}

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
    case 'QUEUE_CLEAR':
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

export function isPrefetchCommandMessage(message: unknown): message is PrefetchCommandMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }
  return candidate.type === 'PREFETCH_RETRY' || candidate.type === 'PREFETCH_STATUS_SNAPSHOT_REQUEST';
}

export function isPrefetchBroadcastMessage(message: unknown): message is PrefetchBroadcastMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown };
  return candidate.type === 'PREFETCH_STATUS_SYNC';
}

export function isKeepAliveDiagnosticsMessage(message: unknown): message is KeepAliveDiagnosticsMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; payload?: unknown };
  if (candidate.type !== 'KEEP_ALIVE_DIAGNOSTICS') {
    return false;
  }
  return typeof candidate.payload === 'object' && candidate.payload !== null;
}

export function toSerializedTabInfo(tab: TabInfo): SerializedTabInfo {
  return createSerializedTab(tab);
}

// ============================================================================
// Offscreen Document Messages (Chrome Manifest V3)
// ============================================================================

/**
 * Messages sent from Service Worker to Offscreen Document
 * These messages control the TTS engine running in the offscreen context
 */
export type OffscreenCommandMessage =
  | { type: 'OFFSCREEN_TTS_START'; payload: { tab: TabInfo; settings: TTSSettings } }
  | { type: 'OFFSCREEN_TTS_PAUSE' }
  | { type: 'OFFSCREEN_TTS_RESUME' }
  | { type: 'OFFSCREEN_TTS_STOP' }
  | { type: 'OFFSCREEN_TTS_UPDATE_SETTINGS'; payload: { settings: TTSSettings } };

/**
 * Messages sent from Offscreen Document to Service Worker
 * These messages report TTS engine status, progress, and errors
 */
export type OffscreenBroadcastMessage =
  | { type: 'OFFSCREEN_TTS_STATUS'; payload: { status: 'idle' | 'speaking' | 'paused' } }
  | { type: 'OFFSCREEN_TTS_PROGRESS'; payload: { progress: number; timestamp: number } }
  | { type: 'OFFSCREEN_TTS_ERROR'; payload: { code: string; message: string; detail?: unknown } }
  | { type: 'OFFSCREEN_TTS_END' };

export function isOffscreenCommandMessage(message: unknown): message is OffscreenCommandMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }

  switch (candidate.type) {
    case 'OFFSCREEN_TTS_START':
    case 'OFFSCREEN_TTS_PAUSE':
    case 'OFFSCREEN_TTS_RESUME':
    case 'OFFSCREEN_TTS_STOP':
    case 'OFFSCREEN_TTS_UPDATE_SETTINGS':
      return true;
    default:
      return false;
  }
}

export function isOffscreenBroadcastMessage(message: unknown): message is OffscreenBroadcastMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as { type?: unknown };
  if (typeof candidate.type !== 'string') {
    return false;
  }

  switch (candidate.type) {
    case 'OFFSCREEN_TTS_STATUS':
    case 'OFFSCREEN_TTS_PROGRESS':
    case 'OFFSCREEN_TTS_ERROR':
    case 'OFFSCREEN_TTS_END':
      return true;
    default:
      return false;
  }
}

/**
 * Heartbeat message sent from Offscreen Document to Service Worker
 * Used to keep Service Worker alive in Chrome Manifest V3
 */
export interface OffscreenHeartbeatMessage {
  type: 'OFFSCREEN_HEARTBEAT';
  timestamp: number;
}

export function isOffscreenHeartbeatMessage(message: unknown): message is OffscreenHeartbeatMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; timestamp?: unknown };
  return candidate.type === 'OFFSCREEN_HEARTBEAT' && typeof candidate.timestamp === 'number';
}


// ============================================================================
// Keep-Alive Error Classes
// ============================================================================

/**
 * Base error class for keep-alive related failures
 */
export class KeepAliveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'KeepAliveError';
  }
}

/**
 * Error thrown when port connection fails
 */
export class PortConnectionError extends KeepAliveError {
  constructor(message: string, details?: unknown) {
    super(message, 'PORT_CONNECTION_FAILED', details);
    this.name = 'PortConnectionError';
  }
}

/**
 * Error thrown when heartbeat sending fails
 */
export class HeartbeatError extends KeepAliveError {
  constructor(message: string, details?: unknown) {
    super(message, 'HEARTBEAT_FAILED', details);
    this.name = 'HeartbeatError';
  }
}

/**
 * Error thrown when reconnection fails after max attempts
 */
export class ReconnectionFailedError extends KeepAliveError {
  constructor(message: string, public readonly attempts: number) {
    super(message, 'RECONNECTION_FAILED', { attempts });
    this.name = 'ReconnectionFailedError';
  }
}
