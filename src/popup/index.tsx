import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import './styles.css';

// ポップアップの初期化
const initPopup = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('Root element not found');
    return;
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);

  console.log('Read Aloud Tab popup initialized');
};

// DOMが読み込まれたら初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}

// エラーハンドリング
window.addEventListener('error', (event) => {
  console.error('Popup error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in popup:', event.reason);
});