import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TabQueueList, { TabQueueListProps } from '../TabQueueList';
import { SerializedTabInfo } from '../../../shared/messages';

const mockListeners: { onDragEnd?: (result: any) => void } = {};

jest.mock('react-beautiful-dnd', () => {
  return {
    DragDropContext: ({ children, onDragEnd }: any) => {
      mockListeners.onDragEnd = onDragEnd;
      return <div data-testid="drag-context">{children}</div>;
    },
    Droppable: ({ children }: any) => children({
      droppableProps: { 'data-testid': 'droppable' },
      innerRef: jest.fn(),
      placeholder: null,
    }),
    Draggable: ({ children, draggableId, index }: any) => children({
      draggableProps: { 'data-testid': `draggable-${draggableId}`, 'data-index': index },
      dragHandleProps: {},
      innerRef: jest.fn(),
    }, null),
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
      source: { index: 0 },
      destination: { index: 1 },
    });

    expect(props.onReorder).toHaveBeenCalledWith(0, 1);
  });
});
