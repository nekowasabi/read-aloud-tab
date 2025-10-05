import React from 'react';

interface Props {
  isReading: boolean;
  isPaused: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export default function ControlButtons({
  isReading,
  isPaused,
  onStart,
  onPause,
  onResume,
  onStop,
  disabled = false
}: Props) {
  // 状態判定
  const isIdle = !isReading && !isPaused;
  const isPlaying = isReading && !isPaused;

  return (
    <div className="control-section">
      <div className="control-buttons">
        {/* 再生/再開ボタン（常に表示） */}
        <button
          className="btn btn-primary"
          onClick={isPaused ? onResume : onStart}
          disabled={disabled || isPlaying}
          title={isPaused ? "再開" : "再生"}
        >
          <span className="btn-icon">▶️</span>
          {isPaused ? "再開" : "再生"}
        </button>

        {/* 一時停止ボタン（常に表示） */}
        <button
          className="btn btn-secondary"
          onClick={onPause}
          disabled={disabled || !isPlaying}
          title="一時停止"
        >
          <span className="btn-icon">⏸️</span>
          一時停止
        </button>

        {/* 停止ボタン（常に表示） */}
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
