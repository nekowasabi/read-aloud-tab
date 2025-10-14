import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TabQueueList, { TabQueueListProps } from '../TabQueueList';
import { SerializedTabInfo } from '../../../shared/messages';

const mockListeners: { onDragEnd?: (result: any) => void } = {};

jest.mock('@dnd-kit/core', () => {
  return {
    DndContext: ({ children, onDragEnd }: any) => {
      mockListeners.onDragEnd = onDragEnd;
      return <div data-testid="dnd-context">{children}</div>;
    },
    closestCenter: jest.fn(),
    PointerSensor: jest.fn(),
    KeyboardSensor: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(() => []),
  };
});

jest.mock('@dnd-kit/sortable', () => {
  return {
    SortableContext: ({ children }: any) => <div data-testid="sortable-context">{children}</div>,
    useSortable: (props: any) => ({
      attributes: { 'data-sortable-id': props.id },
      listeners: { 'data-draggable': 'true' },
      setNodeRef: jest.fn(),
      transform: null,
      transition: null,
    }),
    sortableKeyboardCoordinates: jest.fn(),
    verticalListSortingStrategy: jest.fn(),
  };
});

jest.mock('@dnd-kit/utilities', () => {
  return {
    CSS: {
      Transform: {
        toString: (transform: any) => (transform ? 'transform: translate(0, 0)' : undefined),
      },
    },
  };
});

const createTabs = (): SerializedTabInfo[] => [
  {
    tabId: 1,
    url: 'https://example.com/1',
    title: 'Example 1',
    content: undefined,
    summary: undefined,
    isIgnored: false,
    extractedAt: new Date().toISOString(),
  },
  {
    tabId: 2,
    url: 'https://example.com/2',
    title: 'Example 2',
    content: undefined,
    summary: undefined,
    isIgnored: false,
    extractedAt: new Date().toISOString(),
  },
];

const renderList = (props?: Partial<TabQueueListProps>) => {
  const defaultProps: TabQueueListProps = {
    tabs: createTabs(),
    currentIndex: 0,
    status: 'reading',
    onRemoveTab: jest.fn(),
    onReorder: jest.fn(),
    onSkipNext: jest.fn(),
    onSkipPrevious: jest.fn(),
    prefetchStatuses: [],
    onRetryPrefetch: jest.fn(),
  };

  const merged = { ...defaultProps, ...props };
  const utils = render(<TabQueueList {...merged} />);
  return { ...utils, props: merged };
};

describe('TabQueueList', () => {
  afterEach(() => {
    mockListeners.onDragEnd = undefined;
  });

  test('キュー内のタブをリスト表示し、再生中のタブを強調表示する', () => {
    renderList({ currentIndex: 1 });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(items[1]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).not.toHaveAttribute('aria-current', 'true');
  });

  test('削除ボタンで onRemoveTab が呼ばれる', () => {
    const { props } = renderList();
    const removeButtons = screen.getAllByRole('button', { name: /削除/ });
    fireEvent.click(removeButtons[0]);

    expect(props.onRemoveTab).toHaveBeenCalledWith(1);
  });

  test('ドラッグ終了で onReorder が呼ばれる', () => {
    const { props } = renderList();
    mockListeners.onDragEnd?.({
      active: { id: 1 },
      over: { id: 2 },
    });

    expect(props.onReorder).toHaveBeenCalledWith(0, 1);
  });

  test('ドラッグ終了時に over がない場合は onReorder が呼ばれない', () => {
    const { props } = renderList();
    mockListeners.onDragEnd?.({
      active: { id: 1 },
      over: null,
    });

    expect(props.onReorder).not.toHaveBeenCalled();
  });

  test('同じアイテムにドロップした場合は onReorder が呼ばれない', () => {
    const { props } = renderList();
    mockListeners.onDragEnd?.({
      active: { id: 1 },
      over: { id: 1 },
    });

    expect(props.onReorder).not.toHaveBeenCalled();
  });

  test('prefetch 状態に応じて再試行ボタンを表示しコールバックを呼び出す', () => {
    const onRetryPrefetch = jest.fn();
    renderList({
      prefetchStatuses: [{ tabId: 1, state: 'failed', updatedAt: Date.now(), error: 'API error' }],
      onRetryPrefetch,
    });

    const retryButton = screen.getByRole('button', { name: '再試行' });
    fireEvent.click(retryButton);

    expect(onRetryPrefetch).toHaveBeenCalledWith(1);
  });
});
