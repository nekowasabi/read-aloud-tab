import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TTSSettings, QueueStatus } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';
import ControlButtons from './ControlButtons';
import SettingsPanel from './SettingsPanel';
import StatusDisplay from './StatusDisplay';
import TabQueueList from './TabQueueList';
import useTabQueue from '../hooks/useTabQueue';
import { SerializedTabInfo } from '../../shared/messages';

const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

export default function App() {
  const {
    state: queueState,
    isConnected,
    error: queueError,
    progressByTab,
    addTab,
    removeTab,
    reorderTabs,
    skipNext,
    skipPrevious,
    control,
    updateSettings,
  } = useTabQueue();

  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (mounted && tabs[0]) {
          setActiveTab(tabs[0]);
        }

        const savedSettings = await StorageManager.getSettings();
        if (mounted) {
          setSettings(savedSettings);
        }
      } catch (initError) {
        console.error('Failed to initialize popup:', initError);
        if (mounted) {
          setError('初期化に失敗しました');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (queueError) {
      setError(queueError);
    }
  }, [queueError]);

  const activeQueueTab: SerializedTabInfo | null = useMemo(() => {
    if (!queueState) return null;
    return queueState.tabs[queueState.currentIndex] ?? null;
  }, [queueState]);

  const activeProgress = useMemo(() => {
    if (!activeQueueTab) return 0;
    return progressByTab[activeQueueTab.tabId] ?? (queueState?.status === 'reading' ? 0 : 0);
  }, [activeQueueTab, progressByTab, queueState?.status]);

  const handleAddCurrentTab = useCallback(async () => {
    if (!activeTab || typeof activeTab.id !== 'number' || !activeTab.url) {
      setError('追加できるタブが見つかりません');
      return;
    }

    try {
      await addTab({
        tabId: activeTab.id,
        url: activeTab.url,
        title: activeTab.title || activeTab.url,
      });
    } catch (commandError) {
      console.error('Failed to add tab to queue:', commandError);
      const message = commandError instanceof Error ? commandError.message : 'キューへの追加に失敗しました';
      setError(message);
    }
  }, [activeTab, addTab]);

  const handleRemoveTab = useCallback(
    async (tabId: number) => {
      try {
        await removeTab(tabId);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : 'キューからの削除に失敗しました';
        setError(message);
      }
    },
    [removeTab],
  );

  const handleReorder = useCallback(
    async (from: number, to: number) => {
      try {
        await reorderTabs(from, to);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : 'キューの並び替えに失敗しました';
        setError(message);
      }
    },
    [reorderTabs],
  );

  const handleControl = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'stop') => {
      try {
        await control(action);
      } catch (commandError) {
        const message = commandError instanceof Error ? commandError.message : '操作に失敗しました';
        setError(message);
      }
    },
    [control],
  );

  const handleSettingsChange = useCallback(
    async (newSettings: TTSSettings) => {
      try {
        const validated = StorageManager.validateSettings(newSettings);
        setSettings(validated);
        await StorageManager.saveSettings(validated);
        await updateSettings(validated);
      } catch (saveError) {
        console.error('Failed to save settings:', saveError);
        const message = saveError instanceof Error ? saveError.message : '設定の保存に失敗しました';
        setError(message);
      }
    },
    [updateSettings],
  );

  const clearError = useCallback(() => setError(null), []);

  const queueStatus: QueueStatus = queueState?.status ?? 'idle';
  const queueTabs = queueState?.tabs ?? [];
  const queueIndex = queueState?.currentIndex ?? 0;

  if (isLoading) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="header">
        <h1>Read Aloud Tab</h1>
        <button
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
          title="設定"
        >
          ⚙️
        </button>
      </header>

      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          <button onClick={clearError} className="error-close">×</button>
        </div>
      )}

      <div className="actions-row">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddCurrentTab}
          disabled={!activeTab}
        >
          キューに追加
        </button>
      </div>

      <StatusDisplay
        activeTab={activeQueueTab}
        fallbackTab={activeTab}
        status={queueStatus}
        progress={activeProgress}
        isConnected={isConnected}
      />

      <ControlButtons
        isReading={queueStatus === 'reading'}
        isPaused={queueStatus === 'paused'}
        onStart={() => handleControl('start')}
        onPause={() => handleControl('pause')}
        onResume={() => handleControl('resume')}
        onStop={() => handleControl('stop')}
        disabled={!isConnected || queueTabs.length === 0}
      />

      <TabQueueList
        tabs={queueTabs}
        currentIndex={queueIndex}
        status={queueStatus}
        onRemoveTab={handleRemoveTab}
        onReorder={handleReorder}
        onSkipNext={() => {
          skipNext().catch((commandError) => {
            const message = commandError instanceof Error ? commandError.message : '次のタブへの移動に失敗しました';
            setError(message);
          });
        }}
        onSkipPrevious={() => {
          skipPrevious().catch((commandError) => {
            const message = commandError instanceof Error ? commandError.message : '前のタブへの移動に失敗しました';
            setError(message);
          });
        }}
      />

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      <footer className="footer">
        <small>Version 1.0.0</small>
      </footer>
    </div>
  );
}
