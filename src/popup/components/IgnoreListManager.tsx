import React, { useEffect, useState } from 'react';
import {
  getIgnoredDomains,
  addIgnoredDomain,
  removeIgnoredDomain,
} from '../../shared/utils/storage';
import { ListCard } from './common/ListCard';
import { InputWithButton } from './common/InputWithButton';

type RequestState = 'idle' | 'loading' | 'error';

interface Props {
  onChange?: (domains: string[]) => void;
  initialDomains?: string[];
}

export default function IgnoreListManager({ onChange, initialDomains }: Props = {}) {
  const [domains, setDomains] = useState<string[]>(initialDomains ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestState>('idle');

  useEffect(() => {
    if (initialDomains !== undefined) {
      setDomains(initialDomains);
    }
  }, [initialDomains]);

  useEffect(() => {
    refreshDomains();
  }, []);

  const refreshDomains = async () => {
    try {
      const stored = await getIgnoredDomains();
      setDomains(stored);
      onChange?.(stored);
    } catch (error) {
      console.error('IgnoreListManager: failed to load domains', error);
      setMessage('無視リストの読み込みに失敗しました');
    }
  };

  const handleAdd = async (value: string) => {
    const normalized = normalizeDomain(value);

    if (!normalized) {
      setMessage('有効なドメイン名を入力してください');
      return;
    }

    if (domains.some((domain) => domain.toLowerCase() === normalized.toLowerCase())) {
      setMessage('このドメインは既に登録されています');
      return;
    }

    setStatus('loading');
    setMessage(null);

    try {
      await addIgnoredDomain(normalized);
      await refreshDomains();
    } catch (error) {
      console.error('IgnoreListManager: failed to add domain', error);
      setMessage('ドメインの追加に失敗しました');
      setStatus('error');
      return;
    }

    setStatus('idle');
  };

  const handleRemove = async (domain: string) => {
    setStatus('loading');
    setMessage(null);

    try {
      await removeIgnoredDomain(domain);
      await refreshDomains();
    } catch (error) {
      console.error('IgnoreListManager: failed to remove domain', error);
      setMessage('ドメインの削除に失敗しました');
      setStatus('error');
      return;
    }

    setStatus('idle');
  };

  return (
    <ListCard
      title="無視リスト"
      description="読み上げ対象から除外したいドメインを登録してください。"
    >
      <InputWithButton
        label="ドメイン"
        placeholder="example.com"
        buttonLabel="追加"
        onSubmit={handleAdd}
        message={message}
        disabled={status === 'loading'}
        clearOnSubmit
      />

      <ul className="ignore-list">
        {domains.map((domain) => (
          <li key={domain} className="ignore-item">
            <span className="ignore-domain">{domain}</span>
            <button
              type="button"
              className="ignore-remove-button"
              onClick={() => handleRemove(domain)}
              disabled={status === 'loading'}
              aria-label={`${domain} を削除`}
            >
              削除
            </button>
          </li>
        ))}

        {domains.length === 0 && (
          <li className="ignore-empty" aria-live="polite">
            登録済みの無視ドメインはありません。
          </li>
        )}
      </ul>
    </ListCard>
  );
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes('://') || trimmed.startsWith('.')) {
    return null;
  }

  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!domainPattern.test(trimmed)) {
    return null;
  }

  return trimmed;
}
