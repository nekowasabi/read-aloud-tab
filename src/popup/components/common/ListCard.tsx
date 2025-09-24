import React from 'react';

interface CardAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ListCardProps {
  title: string;
  description?: string;
  actions?: CardAction[];
  children?: React.ReactNode;
}

export function ListCard({ title, description, actions = [], children }: ListCardProps) {
  return (
    <article className="list-card">
      <header className="list-card__header">
        <div className="list-card__title-group">
          <h3 className="list-card__title">{title}</h3>
          {description && <p className="list-card__description">{description}</p>}
        </div>
        {actions.length > 0 && (
          <div className="list-card__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="btn btn-secondary"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="list-card__body">{children}</div>
    </article>
  );
}
