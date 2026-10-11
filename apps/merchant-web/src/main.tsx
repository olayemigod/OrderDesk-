import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MerchantApp from './MerchantApp';
import './styles.css';
import './products.css';
import './team.css';
import './whatsapp.css';
import './devices.css';
import './reports.css';
import './settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('SellerTray could not start.');

createRoot(root).render(
  <StrictMode>
    <MerchantApp />
  </StrictMode>,
);