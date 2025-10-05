import React from 'react';

interface Props {
  isReading: boolean;
  isPaused: boolean;
  onToggle: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export default function ControlButtons({
  isReading,
  isPaused,
  onToggle,
  onStop,
  disabled = false
}: Props) {
  // 状態判定
  const isIdle = !isReading && !isPaused;
  const isPlaying = isReading && !isPaused;

  return (
    <div className="control-section">
      <div className="control-buttons">
        {/* 再生/一時停止トグルボタン */}
        <button
          className="btn btn-primary"
          onClick={onToggle}
          disabled={disabled}
          title={isPlaying ? "一時停止" : "再生"}
        >
          <span className="btn-icon">{isPlaying ? '⏸️' : '▶️'}</span>
          {isPlaying ? '一時停止' : '再生'}
        </button>

        {/* 停止ボタン */}
        <button
          className="btn btn-danger"
          onClick={onStop}
          disabled={disabled || isIdle}
          title="停止"
        >
          <span className="btn-icon">⏹️</span>
          停止
        </button>
      </div>
    </div>
  );
}
