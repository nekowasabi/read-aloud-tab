import React from 'react';

interface SummaryControlProps {
  aiEnabled: boolean;
  summaryWaitMode: 'wait' | 'skip';
  isWaiting?: boolean;
  onModeChange: (mode: 'wait' | 'skip') => void;
  onSkip?: () => void;
}

const SummaryControl: React.FC<SummaryControlProps> = ({
  aiEnabled,
  summaryWaitMode,
  isWaiting = false,
  onModeChange,
  onSkip,
}) => {
  if (!aiEnabled) return null;

  return (
    <div className="summary-control">
      <label className="summary-control__label">
        <input
          type="checkbox"
          checked={summaryWaitMode === 'wait'}
          onChange={() => onModeChange(summaryWaitMode === 'wait' ? 'skip' : 'wait')}
        />
        <span>要約完了まで待つ</span>
      </label>
      {isWaiting && onSkip && (
        <button
          className="summary-control__skip-btn"
          onClick={onSkip}
        >
          要約なしで読む
        </button>
      )}
    </div>
  );
};

export default SummaryControl;
