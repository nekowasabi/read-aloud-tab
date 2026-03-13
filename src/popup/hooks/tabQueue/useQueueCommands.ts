/**
 * useQueueCommands.ts
 * Extracted from useTabQueue.ts (Process 100)
 *
 * Exposes typed command functions built on top of a raw sendCommand callback.
 */
import { useCallback } from 'react';
import {
  QueueAddPayload,
  QueueCommandMessage,
  QueueSettingsUpdatePayload,
  QueueTabInput,
} from '../../../shared/messages';
import { TTSSettings } from '../../../shared/types';

type ControlAction = 'start' | 'pause' | 'resume' | 'stop';

interface CommandOptions {
  position?: 'start' | 'end' | number;
  autoStart?: boolean;
}

export interface UseQueueCommandsResult {
  addTab: (tab: QueueTabInput, options?: CommandOptions) => Promise<void>;
  removeTab: (tabId: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrevious: () => Promise<void>;
  control: (action: ControlAction) => Promise<void>;
  updateSettings: (settings: Partial<TTSSettings>) => Promise<void>;
}

export function useQueueCommands(
  sendCommand: (command: QueueCommandMessage) => Promise<void>,
): UseQueueCommandsResult {
  const addTab = useCallback(
    (tab: QueueTabInput, options: CommandOptions = {}): Promise<void> => {
      const payload: QueueAddPayload = {
        tab,
        position: options.position,
        autoStart: options.autoStart,
      };
      return sendCommand({ type: 'QUEUE_ADD', payload });
    },
    [sendCommand],
  );

  const removeTab = useCallback(
    (tabId: number): Promise<void> => sendCommand({ type: 'QUEUE_REMOVE', payload: { tabId } }),
    [sendCommand],
  );

  const clearQueue = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_CLEAR' }),
    [sendCommand],
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number): Promise<void> =>
      sendCommand({ type: 'QUEUE_REORDER', payload: { fromIndex, toIndex } }),
    [sendCommand],
  );

  const skipNext = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_SKIP', payload: { direction: 'next' } }),
    [sendCommand],
  );

  const skipPrevious = useCallback(
    (): Promise<void> => sendCommand({ type: 'QUEUE_SKIP', payload: { direction: 'previous' } }),
    [sendCommand],
  );

  const control = useCallback(
    (action: ControlAction): Promise<void> =>
      sendCommand({ type: 'QUEUE_CONTROL', payload: { action } }),
    [sendCommand],
  );

  const updateSettings = useCallback(
    (settings: Partial<TTSSettings>): Promise<void> => {
      const payload: QueueSettingsUpdatePayload = { settings };
      return sendCommand({ type: 'QUEUE_UPDATE_SETTINGS', payload });
    },
    [sendCommand],
  );

  return { addTab, removeTab, clearQueue, reorderTabs, skipNext, skipPrevious, control, updateSettings };
}
