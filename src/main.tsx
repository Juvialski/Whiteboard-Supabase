import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import 'katex/dist/katex.min.css';

// Global error logger
const sendLog = (level: string, message: string, data?: any) => {
  if (message && (message.includes('/api/log') || message.includes('Failed to fetch') || message.includes('fetch'))) {
    return;
  }
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, data })
    }).catch(() => {
      // Catch promise rejection to prevent unhandledrejection event
    });
  } catch (e) {
    // Ignore synchronous errors
  }
};

window.addEventListener('error', (event) => {
  if (event.message && (event.message.includes('AbortError') || event.message.includes('QuotaExceededError'))) {
    return;
  }
  sendLog('error', `Uncaught error: ${event.message}`, { filename: event.filename, lineno: event.lineno, colno: event.colno });
});

window.addEventListener('unhandledrejection', (event) => {
  const reasonStr = String(event.reason || '');
  if (
    reasonStr.includes('AbortError') ||
    reasonStr.includes('The user aborted a request') ||
    reasonStr.includes('QuotaExceededError') ||
    (event.reason && typeof event.reason === 'object' && event.reason.name === 'AbortError')
  ) {
    return;
  }
  sendLog('error', `Unhandled promise rejection: ${event.reason}`);
});

const originalConsoleError = console.error;
console.error = (...args) => {
  originalConsoleError(...args);
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  sendLog('error', `Console error: ${message}`);
};

const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  originalConsoleWarn(...args);
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  sendLog('warn', `Console warn: ${message}`);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
