import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './brand.css';

const LOCAL_SELLERTRAY_LOGO = '/brand/sellertray-admin-logo.webp';

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
    <App />
  </StrictMode>,
);

queueMicrotask(() => applyLocalBrandAssets());
