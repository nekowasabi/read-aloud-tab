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
  if (!isReading) {
    return (
      <div className="control-section">
        <button
          className="btn btn-primary btn-large"
          onClick={onStart}
          disabled={disabled}
        >
          <span className="btn-icon">▶️</span>
          読み上げ開始
        </button>
      </div>
    );
  }

  return (
    <div className="control-section">
      <div className="control-buttons">
        {isPaused ? (
          <button
            className="btn btn-primary"
            onClick={onResume}
            disabled={disabled}
          >
            <span className="btn-icon">▶️</span>
            再開
          </button>
        ) : (
          <button
            className="btn btn-secondary"
            onClick={onPause}
            disabled={disabled}
          >
            <span className="btn-icon">⏸️</span>
            一時停止
          </button>
        )}

        <button
          className="btn btn-danger"
          onClick={onStop}
          disabled={disabled}
        >
          <span className="btn-icon">⏹️</span>
          停止
        </button>
      </div>
    </div>
  );
}