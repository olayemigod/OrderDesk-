import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MerchantApp from './MerchantApp';
import MerchantPortalRoot from './MerchantPortalRoot';
import './styles.css';
import './products.css';
import './team.css';
import './whatsapp.css';
import './devices.css';
import './reports.css';
import './settings.css';
import './cash-shifts.css';
import './purchasing.css';
import './mobile.css';
import './mobile-features.css';
import './brand.css';
import './qa-convergence.css';
import './shell-layout.css';
import './agreement-documents.css';

const root = document.getElementById('root');
if (!root) throw new Error('SellerTray could not start.');

createRoot(root).render(
  <StrictMode>
    <MerchantPortalRoot>
      <MerchantApp />
    </MerchantPortalRoot>
  </StrictMode>,
);
