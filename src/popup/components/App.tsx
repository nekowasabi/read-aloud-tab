import React, { useState, useEffect } from 'react';
import { TTSState, TTSSettings } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';
import ControlButtons from './ControlButtons';
import SettingsPanel from './SettingsPanel';
import StatusDisplay from './StatusDisplay';

export default function App() {
  const [ttsState, setTtsState] = useState<TTSState>({
    isReading: false,
    isPaused: false,
    currentTabId: null,
    progress: 0,
  });

  const [settings, setSettings] = useState<TTSSettings>({
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: '',
  });

  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
    setupMessageListener();

    return () => {
      // クリーンアップ
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const initializeApp = async () => {
    try {
      setIsLoading(true);

      // 現在のタブを取得
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        setCurrentTab(tabs[0]);
      }

      // 設定を読み込み
      const savedSettings = await StorageManager.getSettings();
      setSettings(savedSettings);

      // 現在の状態を取得
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (response && typeof response === 'object') {
        setTtsState(response);
      }

    } catch (error) {
      console.error('Failed to initialize app:', error);
      setError('アプリケーションの初期化に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const setupMessageListener = () => {
    chrome.runtime.onMessage.addListener(handleMessage);
  };

  const handleMessage = (message: any, sender: any, sendResponse: any) => {
    if (message.type === 'STATUS_UPDATE') {
      setTtsState(message.state);
    }
  };

  const handleStart = async () => {
    if (!currentTab?.id) {
      setError('有効なタブが見つかりません');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await chrome.runtime.sendMessage({
        type: 'START_READING',
        tabId: currentTab.id,
        settings: settings,
      });

      if (!response?.success) {
        throw new Error(response?.error || '読み上げの開始に失敗しました');
      }

    } catch (error) {
      console.error('Failed to start reading:', error);
      const errorMessage = error instanceof Error ? error.message : '読み上げの開始に失敗しました';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAUSE_READING' });
      if (!response?.success) {
        throw new Error(response?.error || '一時停止に失敗しました');
      }
    } catch (error) {
      console.error('Failed to pause reading:', error);
      setError('一時停止に失敗しました');
    }
  };

  const handleResume = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RESUME_READING' });
      if (!response?.success) {
        throw new Error(response?.error || '再開に失敗しました');
      }
    } catch (error) {
      console.error('Failed to resume reading:', error);
      setError('再開に失敗しました');
    }
  };

  const handleStop = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_READING' });
      if (!response?.success) {
        throw new Error(response?.error || '停止に失敗しました');
      }
    } catch (error) {
      console.error('Failed to stop reading:', error);
      setError('停止に失敗しました');
    }
  };

  const handleSettingsChange = async (newSettings: TTSSettings) => {
    try {
      const validatedSettings = StorageManager.validateSettings(newSettings);
      setSettings(validatedSettings);
      await StorageManager.saveSettings(validatedSettings);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setError('設定の保存に失敗しました');
    }
  };

  const clearError = () => {
    setError(null);
  };

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
        <div className="error-message">
          <span>{error}</span>
          <button onClick={clearError} className="error-close">×</button>
        </div>
      )}

      {currentTab && (
        <StatusDisplay
          tab={currentTab}
          ttsState={ttsState}
        />
      )}

      <ControlButtons
        isReading={ttsState.isReading}
        isPaused={ttsState.isPaused}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        disabled={isLoading}
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
