import React, { useMemo } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
  DraggableProvided,
  DroppableProvided,
} from 'react-beautiful-dnd';
import { QueueStatus } from '../../shared/types';
import { SerializedTabInfo } from '../../shared/messages';
import { ListCard } from './common/ListCard';

export interface TabQueueListProps {
  tabs: SerializedTabInfo[];
  currentIndex: number;
  status: QueueStatus;
  onRemoveTab: (tabId: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSkipNext: () => void;
  onSkipPrevious: () => void;
}

export default function TabQueueList({
  tabs,
  currentIndex,
  status,
  onRemoveTab,
  onReorder,
  onSkipNext,
  onSkipPrevious,
}: TabQueueListProps) {
  const isQueueEmpty = tabs.length === 0;

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'reading':
        return '読み上げ中';
      case 'paused':
        return '一時停止中';
      case 'error':
        return 'エラー';
      default:
        return '待機中';
    }
  }, [status]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }
    const { source, destination } = result;
    if (destination.index === null || source.index === destination.index) {
      return;
    }
    onReorder(source.index, destination.index);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>, index: number) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      onReorder(index, index - 1);
    }
    if (event.key === 'ArrowDown' && index < tabs.length - 1) {
      event.preventDefault();
      onReorder(index, index + 1);
    }
  };

  return (
    <ListCard
      title="読み上げキュー"
      description={`${tabs.length} 件 / 状態: ${statusLabel}`}
      actions={[
        { label: '◀ 前へ', onClick: onSkipPrevious, disabled: isQueueEmpty },
        { label: '次へ ▶', onClick: onSkipNext, disabled: isQueueEmpty },
      ]}
    >
      <div className="queue-status-chip" aria-live="polite">
        <span className={`status-dot status-${status}`}></span>
        <span>{statusLabel}</span>
      </div>

      {isQueueEmpty ? (
        <p className="queue-empty">キューにタブが追加されていません</p>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="tabQueue">
            {(provided: DroppableProvided) => (
              <ul
                className="queue-list"
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {tabs.map((tab, index) => (
                  <Draggable key={tab.tabId} draggableId={tab.tabId.toString()} index={index}>
                    {(dragProvided: DraggableProvided) => (
                      <li
                        className={`queue-item${index === currentIndex ? ' is-active' : ''}${tab.isIgnored ? ' is-ignored' : ''}`}
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        role="listitem"
                        tabIndex={0}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        aria-current={index === currentIndex ? 'true' : undefined}
                      >
                        <div className="queue-item-body">
                          <div className="queue-item-title" title={tab.title || tab.url}>
                            {tab.title || 'タイトル未取得'}
                          </div>
                          <div className="queue-item-url" title={tab.url}>
                            {safeHostname(tab.url)}
                          </div>
                        </div>
                        <div className="queue-item-actions">
                          {tab.isIgnored && <span className="queue-item-badge">無視</span>}
                          <button
                            type="button"
                            className="queue-item-button"
                            onClick={() => onRemoveTab(tab.tabId)}
                            aria-label={`削除: ${tab.title || tab.url}`}
                          >
                            削除
                          </button>
                        </div>
                      </li>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </ListCard>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url;
  }
}
