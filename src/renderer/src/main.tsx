/**
 * React 挂载入口。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/tokens.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
