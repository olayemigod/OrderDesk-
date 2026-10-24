import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminWorkspaceV3 from './AdminWorkspaceV3';
import './styles.css';
import './brand.css';
import './admin-workspace.css';
import './admin-navigation.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminWorkspaceV3 />
  </StrictMode>,
);
