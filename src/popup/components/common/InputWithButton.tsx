import React, { useState } from 'react';

interface InputWithButtonProps {
  label: string;
  placeholder?: string;
  buttonLabel: string;
  onSubmit: (value: string) => void;
  initialValue?: string;
  message?: string | null;
  disabled?: boolean;
  clearOnSubmit?: boolean;
}

export function InputWithButton({
  label,
  placeholder,
  buttonLabel,
  onSubmit,
  initialValue = '',
  message,
  disabled = false,
  clearOnSubmit = false,
}: InputWithButtonProps) {
  const [value, setValue] = useState(initialValue);

  const handleSubmit = () => {
    if (disabled) {
      return;
    }
    onSubmit(value.trim());
    if (clearOnSubmit) {
      setValue('');
    }
  };

  return (
    <div className="input-with-button">
      <label className="input-with-button__label">
        <span>{label}</span>
        <div className="input-with-button__controls">
          <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSubmit();
              }
            }}
            className="input-with-button__input"
            disabled={disabled}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSubmit}
            disabled={disabled || value.trim().length === 0}
          >
            {buttonLabel}
          </button>
        </div>
      </label>
      {message && <p className="input-with-button__message" role="status">{message}</p>}
    </div>
  );
}
