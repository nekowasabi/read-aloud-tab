import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

const mockAddTab = jest.fn();
const mockRemoveTab = jest.fn();
const mockReorderTabs = jest.fn();
const mockControl = jest.fn();

beforeEach(() => {
  mockAddTab.mockResolvedValue(undefined);
  mockRemoveTab.mockResolvedValue(undefined);
  mockReorderTabs.mockResolvedValue(undefined);
  mockControl.mockResolvedValue(undefined);
});

jest.mock('../../hooks/useTabQueue', () => ({
  __esModule: true,
  default: () => ({
    state: {
      status: 'idle',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 1,
      tabs: [
        {
          tabId: 1,
          url: 'https://example.com',
          title: 'Example Tab',
          content: 'hello',
          summary: null,
          isIgnored: false,
          position: 0,
          extractedAt: new Date().toISOString(),
        },
      ],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    },
    isConnected: true,
    error: null,
    progressByTab: {},
    addTab: mockAddTab,
    removeTab: mockRemoveTab,
    reorderTabs: mockReorderTabs,
    skipNext: jest.fn().mockResolvedValue(undefined),
    skipPrevious: jest.fn().mockResolvedValue(undefined),
    control: mockControl,
    updateSettings: jest.fn().mockResolvedValue(undefined),
  }),
}));

describe('App integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.tabs.query as jest.Mock).mockResolvedValue([
      { id: 99, url: 'https://active.com', title: 'Active Tab' },
    ]);
  });

  test('アクティブタブをキューに追加する', async () => {
    render(<App />);

    const addButton = await screen.findByRole('button', { name: /キューに追加/ });
    fireEvent.click(addButton);

    expect(mockAddTab).toHaveBeenCalledWith({
      tabId: 99,
      url: 'https://active.com',
      title: 'Active Tab',
    });
  });

  test('リストから削除ボタンを押すと removeTab が呼ばれる', async () => {
    render(<App />);

    const removeButton = await screen.findByLabelText(/削除:/);
    fireEvent.click(removeButton);

    expect(mockRemoveTab).toHaveBeenCalledWith(1);
  });

  test('再生コントロールが control を呼び出す', async () => {
    render(<App />);

    const startButton = await screen.findByRole('button', { name: /読み上げ開始/ });
    fireEvent.click(startButton);

    expect(mockControl).toHaveBeenCalledWith('start');
  });
});
