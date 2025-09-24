import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListCard } from '../common/ListCard';
import { InputWithButton } from '../common/InputWithButton';

describe('Common popup components', () => {
  test('ListCard renders header, actions, and children', () => {
    const action = jest.fn();

    render(
      <ListCard
        title="テストカード"
        description="説明"
        actions={[{ label: 'アクション', onClick: action }]}
      >
        <div>子要素</div>
      </ListCard>
    );

    expect(screen.getByText('テストカード')).toBeInTheDocument();
    expect(screen.getByText('説明')).toBeInTheDocument();
    expect(screen.getByText('子要素')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'アクション' }));
    expect(action).toHaveBeenCalled();
  });

  test('InputWithButton handles submission and validation messaging', () => {
    const handleSubmit = jest.fn();
    render(
      <InputWithButton
        label="ドメイン"
        placeholder="example.com"
        buttonLabel="追加"
        onSubmit={handleSubmit}
        message="メッセージ"
      />
    );

    const input = screen.getByPlaceholderText('example.com');
    fireEvent.change(input, { target: { value: 'foo.example' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(handleSubmit).toHaveBeenCalledWith('foo.example');
    expect(screen.getByText('メッセージ')).toBeInTheDocument();
  });
});
