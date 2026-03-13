import { useCallback, useMemo, useState } from 'react';
import {
  QueueCommandMessage,
  QueueProgressPayload,
  QueueStatusPayload,
  QueueTabInput,
} from '../../shared/messages';
import { TTSSettings } from '../../shared/types';
import { filterProgressByTabs, parseQueueMessage } from './tabQueue/queueMessageReducer';
import { useQueuePort } from './tabQueue/useQueuePort';
import { useQueueCommands } from './tabQueue/useQueueCommands';

type ControlAction = 'start' | 'pause' | 'resume' | 'stop';

interface CommandOptions {
  position?: 'start' | 'end' | number;
  autoStart?: boolean;
}

export type TabQueueConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface UseTabQueueResult {
  state: QueueStatusPayload | null;
  connectionState: TabQueueConnectionState;
  lastError: string | null;
  progressByTab: Record<number, number>;
  addTab: (tab: QueueTabInput, options?: CommandOptions) => Promise<void>;
  removeTab: (tabId: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  reorderTabs: (from: number, to: number) => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrevious: () => Promise<void>;
  control: (action: ControlAction) => Promise<void>;
  updateSettings: (settings: Partial<TTSSettings>) => Promise<void>;
}

export default function useTabQueue(): UseTabQueueResult {
  const [state, setState] = useState<QueueStatusPayload | null>(null);
  const [progressByTab, setProgressByTab] = useState<Record<number, number>>({});

  const handleMessage = useCallback((rawMessage: any) => {
    const action = parseQueueMessage(rawMessage);
    if (!action) {
      if (rawMessage && typeof rawMessage.type === 'string') {
        // known-unknown: no-op
      } else {
        console.warn('[useTabQueue] Received invalid message:', rawMessage);
      }
      return;
    }

    switch (action.type) {
      case 'STATUS_UPDATE': {
        const payload = action.payload as QueueStatusPayload;
        setState(payload);
        setProgressByTab((prev) => filterProgressByTabs(prev, payload));
        break;
      }
      case 'PROGRESS_UPDATE': {
        const payload = action.payload as QueueProgressPayload;
        setProgressByTab((prev) => ({
          ...prev,
          [payload.tabId]: payload.progress,
        }));
        break;
      }
      default:
        // ERROR and COMMAND_RESULT_ERROR are handled via lastError from useQueuePort
        break;
    }
  }, []);

  const { sendCommand, connectionState, lastError } = useQueuePort(handleMessage);

  const commands = useQueueCommands(sendCommand);

  const progress = useMemo(() => progressByTab, [progressByTab]);

  return {
    state,
    connectionState,
    lastError,
    progressByTab: progress,
    ...commands,
  };
}
