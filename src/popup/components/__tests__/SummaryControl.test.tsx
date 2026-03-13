import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SummaryControl from '../SummaryControl';

describe('SummaryControl', () => {
  it('renders summary toggle when AI summary is enabled', () => {
    render(<SummaryControl aiEnabled={true} summaryWaitMode="wait" onModeChange={jest.fn()} />);
    expect(screen.getByText(/要約/)).toBeInTheDocument();
  });

  it('does not render when AI summary is disabled', () => {
    const { container } = render(<SummaryControl aiEnabled={false} summaryWaitMode="wait" onModeChange={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "要約完了まで待つ" checkbox when mode is wait', () => {
    render(<SummaryControl aiEnabled={true} summaryWaitMode="wait" onModeChange={jest.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('calls onModeChange when checkbox is toggled', () => {
    const onModeChange = jest.fn();
    render(<SummaryControl aiEnabled={true} summaryWaitMode="wait" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onModeChange).toHaveBeenCalledWith('skip');
  });

  it('shows skip button when waiting for summary', () => {
    render(<SummaryControl aiEnabled={true} summaryWaitMode="wait" isWaiting={true} onSkip={jest.fn()} onModeChange={jest.fn()} />);
    expect(screen.getByText(/要約なしで読む/)).toBeInTheDocument();
  });

  it('calls onSkip when skip button is clicked', () => {
    const onSkip = jest.fn();
    render(<SummaryControl aiEnabled={true} summaryWaitMode="wait" isWaiting={true} onSkip={onSkip} onModeChange={jest.fn()} />);
    fireEvent.click(screen.getByText(/要約なしで読む/));
    expect(onSkip).toHaveBeenCalled();
  });
});
