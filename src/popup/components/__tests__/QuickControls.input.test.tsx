import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import QuickControls from '../QuickControls';
import SettingsPanel from '../SettingsPanel';
import type { TTSSettings } from '../../../shared/types';

const baseSettings: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

describe('QuickControls input (§7)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('change rate -> label shows new value at t=0, onChange fires once at 300ms', () => {
    const onChange = jest.fn();
    render(<QuickControls settings={baseSettings} onChange={onChange} />);

    const sliders = screen.getAllByRole('slider');
    // volume first, rate second
    const rateInput = sliders[1] as HTMLInputElement;

    fireEvent.change(rateInput, { target: { value: '2.0' } });

    // Label shows the new value immediately, before any timer advance.
    expect(screen.getByText('⚡ 速度: 2.0x')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rate: 2.0 }));
  });

  test('in-flight drag is not overwritten by a prop echo', () => {
    const onChange = jest.fn();
    const { rerender } = render(<QuickControls settings={baseSettings} onChange={onChange} />);

    const sliders = screen.getAllByRole('slider');
    const rateInput = sliders[1] as HTMLInputElement;

    fireEvent.change(rateInput, { target: { value: '1.5' } });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    fireEvent.change(rateInput, { target: { value: '2.0' } });

    // Parent echoes the first value back through props while debounce is pending.
    rerender(<QuickControls settings={{ ...baseSettings, rate: 1.5 }} onChange={onChange} />);
    expect(screen.getByText('⚡ 速度: 2.0x')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rate: 2.0 }));
  });
});

describe('SettingsPanel pending guard (§7)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('change twice 100ms apart, rerender with first value keeps second value', () => {
    const onChange = jest.fn();
    const onClose = jest.fn();
    const { rerender } = render(
      <SettingsPanel settings={baseSettings} onChange={onChange} onClose={onClose} />
    );

    const sliders = screen.getAllByRole('slider');
    const rateInput = sliders[0] as HTMLInputElement;

    fireEvent.change(rateInput, { target: { value: '1.5' } });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    fireEvent.change(rateInput, { target: { value: '2.0' } });

    // Feed the first value back through props (parent echo).
    rerender(
      <SettingsPanel
        settings={{ ...baseSettings, rate: 1.5 }}
        onChange={onChange}
        onClose={onClose}
      />
    );

    expect(screen.getByText('読み上げ速度: 2.0x')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rate: 2.0 }));
  });
});
