import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './products.css';
import './team.css';

const root = document.getElementById('root');
if (!root) throw new Error('SellerTray could not start.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);