import React from 'react';
import { KeepAliveDiagnostics } from '../../shared/types';

interface DiagnosticsBannerProps {
  connectionState: 'connecting' | 'connected' | 'disconnected';
  lastError: string | null;
  keepAlive: KeepAliveDiagnostics | null;
}

export default function DiagnosticsBanner({ connectionState, lastError, keepAlive }: DiagnosticsBannerProps) {
  return (
    <div className="diagnostics-banner" role="status">
      <div className="diagnostics-section">
        <strong>接続状態:</strong> <span>{renderConnectionState(connectionState)}</span>
      </div>
      {lastError && (
        <div className="diagnostics-section">
          <strong>最新エラー:</strong> <span>{lastError}</span>
        </div>
      )}
      {keepAlive && (
        <div className="diagnostics-grid">
          <div>
            <strong>Heartbeat:</strong> {keepAlive.state === 'running' ? '稼働中' : '停止中'}
          </div>
          <div>
            <strong>最終起動:</strong> {formatTimestamp(keepAlive.lastHeartbeatAt)}
          </div>
          <div>
            <strong>最終アラーム:</strong> {formatTimestamp(keepAlive.lastAlarmAt)}
          </div>
          <div>
            <strong>最終フォールバック:</strong> {formatTimestamp(keepAlive.lastFallbackAt)}
          </div>
          <div>
            <strong>フォールバック回数:</strong> {keepAlive.fallbackCount}
          </div>
        </div>
      )}
    </div>
  );
}

function renderConnectionState(state: 'connecting' | 'connected' | 'disconnected'): string {
  switch (state) {
    case 'connected':
      return '接続済み';
    case 'connecting':
      return '再接続中';
    case 'disconnected':
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
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return '未来';
  }
  const seconds = Math.floor(diffMs / 1000);
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
