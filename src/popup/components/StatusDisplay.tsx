import React from 'react';
import { TTSState } from '../../shared/types';

interface Props {
  tab: chrome.tabs.Tab;
  ttsState: TTSState;
}

export default function StatusDisplay({ tab, ttsState }: Props) {
  const getStatusText = (): string => {
    if (ttsState.isReading) {
      return ttsState.isPaused ? '一時停止中' : '読み上げ中';
    }
    return '待機中';
  };

  const getStatusIcon = (): string => {
    if (ttsState.isReading) {
      return ttsState.isPaused ? '⏸️' : '🔊';
    }
    return '⭕';
  };

  const truncateTitle = (title: string, maxLength: number = 35): string => {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + '...';
  };

  return (
    <div className="status-section">
      <div className="current-tab">
        <div className="tab-info">
          <div className="tab-favicon">
            {tab.favIconUrl ? (
              <img src={tab.favIconUrl} alt="" className="favicon" />
            ) : (
              <div className="favicon-placeholder">🌐</div>
            )}
          </div>
          <div className="tab-details">
            <div className="tab-title" title={tab.title}>
              {truncateTitle(tab.title || 'Untitled')}
            </div>
            <div className="tab-url" title={tab.url}>
              {new URL(tab.url || '').hostname}
            </div>
          </div>
        </div>
      </div>

      <div className="status-info">
        <div className="status-indicator">
          <span className="status-icon">{getStatusIcon()}</span>
          <span className="status-text">{getStatusText()}</span>
        </div>

        {ttsState.isReading && (
          <div className="progress-section">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${ttsState.progress}%` }}
              />
            </div>
            <div className="progress-text">
              {Math.round(ttsState.progress)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}