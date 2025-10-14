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

export interface UseTabQueueResult {
  state: QueueStatusPayload | null;
  connectionState: 'connecting' | 'connected' | 'disconnected';
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
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [progressByTab, setProgressByTab] = useState<Record<number, number>>({});

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const visibilityStateRef = useRef<'visible' | 'hidden'>(document.visibilityState as 'visible' | 'hidden');
  const disconnectRef = useRef<{ handler: () => void; port: chrome.runtime.Port } | null>(null);
  const connectionStateRef = useRef<'connecting' | 'connected' | 'disconnected'>('connecting');

  const updateConnectionState = useCallback((status: 'connecting' | 'connected' | 'disconnected') => {
    connectionStateRef.current = status;
    setConnectionState(status);
  }, []);

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  useEffect(() => {
    isUnmountedRef.current = false;

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
          updateConnectionState('connected');
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
          console.warn('[useTabQueue] Unknown message type:', rawMessage.type);
          break;
      }
    };

    const scheduleReconnect = (fromDisconnect = false) => {
      if (isUnmountedRef.current) {
        return;
      }

      if (!fromDisconnect && visibilityStateRef.current === 'hidden') {
        return;
      }

      updateConnectionState('connecting');
      clearRetryTimer();
      const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** retryAttemptRef.current, MAX_RETRY_DELAY_MS);
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
          updateConnectionState('connected');
          setLastError(null);
          clearRetryTimer();

        const handleDisconnect = () => {
          if (isUnmountedRef.current) return;
          portRef.current = null;
          setLastError(chrome.runtime.lastError?.message ?? 'キューとの接続が切断されました');
          scheduleReconnect(true);
        };

        port.onMessage.addListener(handleMessage);
        port.onDisconnect.addListener(handleDisconnect);
        disconnectRef.current = { handler: handleDisconnect, port };

        try {
          port.postMessage({ type: 'REQUEST_QUEUE_STATE' });
        } catch (postError) {
          console.error('[useTabQueue] Failed to request initial state:', postError);
          setLastError((postError as Error)?.message ?? '初期状態の取得に失敗しました');
        }
      } catch (connectError) {
        const errorMsg = connectError instanceof Error
          ? `キューとの接続に失敗しました: ${connectError.message}`
          : 'キューとの接続に失敗しました';
        setLastError(errorMsg);
        updateConnectionState('disconnected');
        scheduleReconnect(false);
      }
    };

    const handleVisibilityChange = () => {
      visibilityStateRef.current = document.visibilityState as 'visible' | 'hidden';
      if (visibilityStateRef.current === 'visible' && connectionStateRef.current !== 'connected' && !retryTimerRef.current) {
        retryAttemptRef.current = 0;
        scheduleReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    connect();

    return () => {
      isUnmountedRef.current = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearRetryTimer();
      const stored = disconnectRef.current;
      if (stored?.port) {
        try {
          stored.port.onMessage.removeListener?.(handleMessage);
          if (stored.port.onDisconnect?.removeListener) {
            stored.port.onDisconnect.removeListener(stored.handler as any);
          }
          stored.port.disconnect?.();
        } catch (disconnectError) {
          console.warn('[useTabQueue] Failed to cleanup port:', disconnectError);
        }
      }
      disconnectRef.current = null;
      portRef.current = null;
    };
  }, [updateConnectionState]);

  const sendCommand = useCallback(
    (command: QueueCommandMessage): Promise<void> => {
      const port = portRef.current;

      if (!port) {
        const err = new Error('キューとの接続が確立されていません');
        setLastError(err.message);
        updateConnectionState('disconnected');
        return Promise.reject(err);
      }

      try {
        setLastError(null);
        port.postMessage(command);
        return Promise.resolve();
      } catch (postError) {
        const err = postError instanceof Error ? postError : new Error('キューへの送信に失敗しました');
        setLastError(err.message);
        updateConnectionState('disconnected');
        return Promise.reject(err);
      }
    },
    [updateConnectionState],
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
