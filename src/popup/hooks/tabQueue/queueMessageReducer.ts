/**
 * queueMessageReducer.ts
 * Extracted from useTabQueue.ts (Process 100)
 *
 * Pure functions for processing incoming queue broadcast messages.
 */
import {
  QueueBroadcastMessage,
  QueueProgressPayload,
  QueueStatusPayload,
} from '../../../shared/messages';

export interface QueueState {
  status: QueueStatusPayload | null;
  progressByTab: Record<number, number>;
  lastError: string | null;
}

export type QueueStateAction =
  | { type: 'STATUS_UPDATE'; payload: QueueStatusPayload }
  | { type: 'PROGRESS_UPDATE'; payload: QueueProgressPayload }
  | { type: 'ERROR'; message: string }
  | { type: 'COMMAND_RESULT_ERROR'; message: string };

/**
 * Filters progress map to only include tabs present in the queue status.
 */
export function filterProgressByTabs(
  prev: Record<number, number>,
  payload: QueueStatusPayload,
): Record<number, number> {
  if (!payload?.tabs?.length) {
    return {};
  }
  const allowed = new Set(payload.tabs.map((tab) => tab.tabId));
  return Object.fromEntries(
    Object.entries(prev).filter(([tabId]) => allowed.has(Number(tabId))),
  );
}

/**
 * Parses a raw queue broadcast message into a typed action.
 * Returns null if the message type is unrecognised.
 */
export function parseQueueMessage(rawMessage: QueueBroadcastMessage | any): QueueStateAction | null {
  if (!rawMessage || typeof rawMessage.type !== 'string') {
    return null;
  }
  switch (rawMessage.type) {
    case 'QUEUE_STATUS_UPDATE':
      return { type: 'STATUS_UPDATE', payload: rawMessage.payload as QueueStatusPayload };
    case 'QUEUE_PROGRESS_UPDATE':
      return { type: 'PROGRESS_UPDATE', payload: rawMessage.payload as QueueProgressPayload };
    case 'QUEUE_ERROR': {
      const payload = rawMessage.payload as { message?: string };
      return { type: 'ERROR', message: payload?.message ?? 'キューでエラーが発生しました' };
    }
    case 'QUEUE_COMMAND_RESULT': {
      const payload = rawMessage.payload as { error?: string };
      if (payload?.error) {
        return { type: 'COMMAND_RESULT_ERROR', message: payload.error };
      }
      return null;
    }
    default:
      return null;
  }
}
