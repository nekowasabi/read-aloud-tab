import React from 'react';
import { KeepAliveDiagnostics } from '../../shared/types';
import { TabQueueConnectionState } from '../hooks/useTabQueue';

interface DiagnosticsBannerProps {
  connectionState: TabQueueConnectionState;
  lastError: string | null;
  keepAlive?: KeepAliveDiagnostics | null;
}

export default function DiagnosticsBanner({ connectionState, lastError, keepAlive }: DiagnosticsBannerProps) {
  return (
    <div className="diagnostics-banner" role="status">
      <div className="diagnostics-section">
        <strong>接続:</strong> <span>{renderConnectionState(connectionState)}</span>
      </div>
      {lastError && (
        <div className="diagnostics-section">
          <strong>最近のエラー:</strong> <span>{lastError}</span>
        </div>
      )}
      {keepAlive && (
        <div className="diagnostics-grid">
          <div>
            <strong>KeepAlive:</strong> {keepAlive.state === 'running' ? '稼働中' : '停止'}
          </div>
          <div>
            <strong>最終ハートビート:</strong> {formatTimestamp(keepAlive.lastHeartbeatAt)}
          </div>
          <div>
            <strong>最終アラーム:</strong> {formatTimestamp(keepAlive.lastAlarmAt)}
          </div>
          <div>
            <strong>最後のフォールバック:</strong> {formatTimestamp(keepAlive.lastFallbackAt)}
          </div>
          <div>
            <strong>フォールバック回数:</strong> {keepAlive.fallbackCount}
          </div>
        </div>
      )}
    </div>
  );
}

function renderConnectionState(state: TabQueueConnectionState): string {
  switch (state) {
    case 'connected':
      return '接続済み';
    case 'connecting':
      return '再接続中';
    default:
      return '未接続';
  }
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return `${date.toLocaleTimeString()} (${timeAgo(date)})`;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 0) {
    return '未来';
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return `${seconds}秒前`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分前`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}時間前`;
}
