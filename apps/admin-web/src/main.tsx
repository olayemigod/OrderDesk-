import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SubscriptionAccess from './SubscriptionAccess';
import './styles.css';
import './brand.css';
import './subscription.css';

const LOCAL_SELLERTRAY_LOGO = '/brand/sellertray-admin-logo.webp';

type AdminSection = 'notifications' | 'subscription';

function currentSection(): AdminSection {
  return window.location.hash === '#subscription-access' ? 'subscription' : 'notifications';
}

function AdminRoot() {
  const [section, setSection] = useState<AdminSection>(currentSection);

  useEffect(() => {
    const handleHashChange = () => setSection(currentSection());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
      <nav className="admin-section-nav" aria-label="SellerTray administration sections">
        <a className={section === 'notifications' ? 'admin-section-link active' : 'admin-section-link'} href="#">Notifications</a>
        <a className={section === 'subscription' ? 'admin-section-link active' : 'admin-section-link'} href="#subscription-access">Subscription access</a>
      </nav>
      {section === 'subscription' ? <SubscriptionAccess /> : <App />}
    </>
  );
}

function applyLocalBrandAssets(root: ParentNode = document) {
  root.querySelectorAll<HTMLImageElement>('img.brand-logo, img.brand-icon').forEach((image) => {
    if (image.getAttribute('src') !== LOCAL_SELLERTRAY_LOGO) {
      image.setAttribute('src', LOCAL_SELLERTRAY_LOGO);
    }
  });
}

// App.tsx still contains legacy external brand URLs in a few render branches.
// Correct them at the DOM boundary so every current/future render uses the
// bundled, same-origin SellerTray logo that ships with this admin deployment.
const brandObserver = new MutationObserver(() => applyLocalBrandAssets());
brandObserver.observe(document.documentElement, { childList: true, subtree: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminRoot />
  </StrictMode>,
);

queueMicrotask(() => applyLocalBrandAssets());
