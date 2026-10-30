import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MerchantApp from './MerchantApp';
import MerchantPortalRoot from './MerchantPortalRoot';
import { consumeMerchantWebHandoff } from './merchantHandoff';
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

void start();

async function start() {
  try {
    const handoffTarget = await consumeMerchantWebHandoff();
    createRoot(root!).render(
      <StrictMode>
        <MerchantPortalRoot>
          <MerchantApp handoffTarget={handoffTarget} />
        </MerchantPortalRoot>
      </StrictMode>,
    );
  } catch (cause) {
    const message = cause instanceof Error && cause.message
      ? cause.message
      : 'SellerTray could not continue securely to Merchant Web.';
    createRoot(root!).render(
      <StrictMode>
        <main className="status-page">
          <section className="status-card">
            <p className="eyebrow">SellerTray Merchant Web</p>
            <h1>Continuation link unavailable</h1>
            <p>{message}</p>
            <p>Return to SellerTray mobile and tap Continue in Merchant Web again.</p>
          </section>
        </main>
      </StrictMode>,
    );
  }
}
