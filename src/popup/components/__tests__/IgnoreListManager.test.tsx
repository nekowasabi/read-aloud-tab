import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import IgnoreListManager from '../IgnoreListManager';

jest.mock('../../../shared/utils/storage', () => ({
  getIgnoredDomains: jest.fn(),
  addIgnoredDomain: jest.fn(),
  removeIgnoredDomain: jest.fn(),
}));

const storage = require('../../../shared/utils/storage');

describe('IgnoreListManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('初期表示でストレージの無視ドメインを一覧表示する', async () => {
    storage.getIgnoredDomains.mockResolvedValue(['example.com', 'news.site']);

    render(<IgnoreListManager />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
      expect(screen.getByText('news.site')).toBeInTheDocument();
    });
  });

  test('新しいドメインを追加し、ストレージ更新を呼び出す', async () => {
    storage.getIgnoredDomains.mockResolvedValueOnce([]);
    storage.addIgnoredDomain.mockResolvedValue(undefined);
    storage.getIgnoredDomains.mockResolvedValueOnce(['blog.example']);

    render(<IgnoreListManager />);

    const input = await screen.findByPlaceholderText('example.com');
    fireEvent.change(input, { target: { value: 'blog.example' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => {
      expect(storage.addIgnoredDomain).toHaveBeenCalledWith('blog.example');
      expect(screen.getByText('blog.example')).toBeInTheDocument();
    });
  });

  test('重複するドメインを追加しようとするとエラーメッセージを表示', async () => {
    storage.getIgnoredDomains.mockResolvedValue(['example.com']);

    render(<IgnoreListManager />);

    const input = await screen.findByPlaceholderText('example.com');
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('このドメインは既に登録されています')).toBeInTheDocument();
    expect(storage.addIgnoredDomain).not.toHaveBeenCalled();
  });

  test('無効なドメイン形式は拒否する', async () => {
    storage.getIgnoredDomains.mockResolvedValue([]);

    render(<IgnoreListManager />);

    const input = await screen.findByPlaceholderText('example.com');
    fireEvent.change(input, { target: { value: 'http://invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('有効なドメイン名を入力してください')).toBeInTheDocument();
    expect(storage.addIgnoredDomain).not.toHaveBeenCalled();
  });

  test('削除ボタンでドメインを削除する', async () => {
    storage.getIgnoredDomains.mockResolvedValueOnce(['example.com']);
    storage.removeIgnoredDomain.mockResolvedValue(undefined);
    storage.getIgnoredDomains.mockResolvedValueOnce([]);

    render(<IgnoreListManager />);

    const removeButton = await screen.findByRole('button', { name: 'example.com を削除' });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(storage.removeIgnoredDomain).toHaveBeenCalledWith('example.com');
      expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    });
  });
});
