import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminWorkspaceV2 from './AdminWorkspaceV2';
import './styles.css';
import './brand.css';
import './admin-workspace.css';
import './admin-navigation.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminWorkspaceV2 />
  </StrictMode>,
);
