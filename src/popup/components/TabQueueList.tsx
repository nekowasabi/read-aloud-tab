import React, { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

interface SortableItemProps {
  tab: SerializedTabInfo;
  index: number;
  currentIndex: number;
  onRemoveTab: (tabId: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>, index: number) => void;
}

function SortableItem({ tab, index, currentIndex, onRemoveTab, onKeyDown }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: tab.tabId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`queue-item${index === currentIndex ? ' is-active' : ''}${tab.isIgnored ? ' is-ignored' : ''}`}
      onKeyDown={(event) => onKeyDown(event, index)}
      aria-current={index === currentIndex ? 'true' : undefined}
      {...attributes}
      {...listeners}
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
  );
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = tabs.findIndex((tab) => tab.tabId === active.id);
    const newIndex = tabs.findIndex((tab) => tab.tabId === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(oldIndex, newIndex);
    }
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabs.map((tab) => tab.tabId)} strategy={verticalListSortingStrategy}>
            <ul className="queue-list">
              {tabs.map((tab, index) => (
                <SortableItem
                  key={tab.tabId}
                  tab={tab}
                  index={index}
                  currentIndex={currentIndex}
                  onRemoveTab={onRemoveTab}
                  onKeyDown={handleKeyDown}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
