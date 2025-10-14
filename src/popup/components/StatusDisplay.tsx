import React from 'react';
import { SerializedTabInfo } from '../../shared/messages';
import { QueueStatus } from '../../shared/types';

interface Props {
  activeTab: SerializedTabInfo | null;
  fallbackTab?: chrome.tabs.Tab | null;
  status: QueueStatus;
  progress: number;
  connectionState: 'connecting' | 'connected' | 'disconnected';
}

export default function StatusDisplay({
  activeTab,
  fallbackTab = null,
  status,
  progress,
  connectionState,
}: Props) {
  const displayTitle = activeTab?.title || fallbackTab?.title || 'タブが選択されていません';
  const displayUrl = activeTab?.url || fallbackTab?.url || '';

  const statusText = getStatusText(status, connectionState);
  const statusIcon = getStatusIcon(status, connectionState);

  return (
    <div className="status-section">
      <div className="current-tab">
        <div className="tab-info">
          <div className="tab-favicon">
            {fallbackTab?.favIconUrl ? (
              <img src={fallbackTab.favIconUrl} alt="" className="favicon" />
            ) : (
              <div className="favicon-placeholder">🌐</div>
            )}
          </div>
          <div className="tab-details">
            <div className="tab-title" title={displayTitle}>
              {truncate(displayTitle, 40)}
            </div>
            <div className="tab-url" title={displayUrl}>
              {safeHostname(displayUrl)}
            </div>
          </div>
        </div>
      </div>

      <div className="status-info">
        <div className="status-indicator">
          <span className="status-icon">{statusIcon}</span>
          <span className="status-text">{statusText}</span>
        </div>

        {status === 'reading' && (
          <div className="progress-section">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="progress-text">{Math.round(progress)}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusText(status: QueueStatus, connectionState: 'connecting' | 'connected' | 'disconnected'): string {
  if (connectionState === 'connecting') {
    return '再接続中';
  }
  if (connectionState === 'disconnected') {
    return '未接続';
  }
  switch (status) {
    case 'reading':
      return '読み上げ中';
    case 'paused':
      return '一時停止中';
    case 'error':
      return 'エラー';
    default:
      return '待機中';
  }
}

function getStatusIcon(status: QueueStatus, connectionState: 'connecting' | 'connected' | 'disconnected'): string {
  if (connectionState === 'connecting') {
    return '🕒';
  }
  if (connectionState === 'disconnected') {
    return '⚠️';
  }
  switch (status) {
    case 'reading':
      return '🔊';
    case 'paused':
      return '⏸️';
    case 'error':
      return '❌';
    default:
      return '⭕';
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

function safeHostname(url: string): string {
  if (!url) {
    return '-';
  }
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url;
  }
}
