import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QueueAddPayload,
  QueueBroadcastMessage,
  QueueCommandMessage,
  QueueProgressPayload,
  QueueStatusPayload,
  QueueTabInput,
  QueueSettingsUpdatePayload,
} from '../../shared/messages';
import { TTSSettings } from '../../shared/types';

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

const QUEUE_PORT_NAME = 'read-aloud-tab-queue';
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;

export default function useTabQueue(): UseTabQueueResult {
  const [state, setState] = useState<QueueStatusPayload | null>(null);
  const [connectionState, setConnectionState] = useState<TabQueueConnectionState>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [progressByTab, setProgressByTab] = useState<Record<number, number>>({});

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const isUnmountedRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;

    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const handleMessage = (rawMessage: QueueBroadcastMessage | any) => {
      if (isUnmountedRef.current) return;
      if (!rawMessage || typeof rawMessage.type !== 'string') {
        console.warn('[useTabQueue] Received invalid message:', rawMessage);
        return;
      }

      switch (rawMessage.type) {
        case 'QUEUE_STATUS_UPDATE': {
          const payload = rawMessage.payload as QueueStatusPayload;
          setState(payload);
          setConnectionState('connected');
          setProgressByTab((prev) => filterProgressByTabs(prev, payload));
          break;
        }
        case 'QUEUE_PROGRESS_UPDATE': {
          const payload = rawMessage.payload as QueueProgressPayload;
          setProgressByTab((prev) => ({
            ...prev,
            [payload.tabId]: payload.progress,
          }));
          break;
        }
        case 'QUEUE_ERROR': {
          const payload = rawMessage.payload as { message?: string };
          setLastError(payload?.message ?? 'キューでエラーが発生しました');
          break;
        }
        case 'QUEUE_COMMAND_RESULT': {
          const payload = rawMessage.payload as { error?: string };
          if (payload?.error) {
            setLastError(payload.error);
          }
          break;
        }
        default:
          break;
      }
    };

    const scheduleReconnect = () => {
      if (isUnmountedRef.current) {
        return;
      }
      setConnectionState('connecting');
      clearRetryTimer();
      const delay = Math.min(500 * 2 ** retryAttemptRef.current, 5000);
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (isUnmountedRef.current) {
        return;
      }

      try {
        const port = chrome.runtime.connect({ name: QUEUE_PORT_NAME });
        portRef.current = port;
        retryAttemptRef.current = 0;
        setConnectionState('connected');
        setLastError(null);
        clearRetryTimer();

        const handleDisconnect = () => {
          if (isUnmountedRef.current) return;
          portRef.current = null;
          setLastError(chrome.runtime.lastError?.message ?? 'キューとの接続が切断されました');
          scheduleReconnect();
        };

        port.onMessage.addListener(handleMessage);
        port.onDisconnect.addListener(handleDisconnect);

        try {
          port.postMessage({ type: 'REQUEST_QUEUE_STATE' });
        } catch (postError) {
          setLastError((postError as Error)?.message ?? '初期状態の取得に失敗しました');
        }
      } catch (connectError) {
        const errorMsg = connectError instanceof Error
          ? `キューとの接続に失敗しました: ${connectError.message}`
          : 'キューとの接続に失敗しました';
        setLastError(errorMsg);
        setConnectionState('disconnected');
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      isUnmountedRef.current = true;
      clearRetryTimer();
      const port = portRef.current;
      if (port) {
        try {
          port.onMessage.removeListener(handleMessage);
          port.disconnect?.();
        } catch (disconnectError) {
          console.warn('[useTabQueue] Failed to cleanup port:', disconnectError);
        }
      }
      portRef.current = null;
    };
  }, []);

  const sendCommand = useCallback(
    (command: QueueCommandMessage): Promise<void> => {
      const port = portRef.current;

      if (!port) {
        const err = new Error('キューとの接続が確立されていません');
        setLastError(err.message);
        setConnectionState('disconnected');
        return Promise.reject(err);
      }

      try {
        setLastError(null);
        port.postMessage(command);
        return Promise.resolve();
      } catch (postError) {
        const err = postError instanceof Error ? postError : new Error('キューへの送信に失敗しました');
        setLastError(err.message);
        setConnectionState('disconnected');
        return Promise.reject(err);
      }
    },
    [],
  );

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
      const payload: QueueSettingsUpdatePayload = {
        settings,
      };
      return sendCommand({ type: 'QUEUE_UPDATE_SETTINGS', payload });
    },
    [sendCommand],
  );

  const progress = useMemo(() => progressByTab, [progressByTab]);

  return {
    state,
    connectionState,
    lastError,
    progressByTab: progress,
    addTab,
    removeTab,
    clearQueue,
    reorderTabs,
    skipNext,
    skipPrevious,
    control,
    updateSettings,
  };
}

function filterProgressByTabs(prev: Record<number, number>, payload: QueueStatusPayload): Record<number, number> {
  if (!payload?.tabs?.length) {
    return {};
  }

  const allowed = new Set(payload.tabs.map((tab) => tab.tabId));
  return Object.fromEntries(
    Object.entries(prev).filter(([tabId]) => allowed.has(Number(tabId))),
  );
}
