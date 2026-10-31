import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminWorkspace from './AdminWorkspace';
import './styles.css';
import './brand.css';
import './admin-workspace.css';
import './admin-navigation.css';
import './admin-redesign.css';
import './admin-workspaces-redesign.css';
import './admin-responsive-hardening.css';
import './admin-portfolio-revenue-redesign.css';
import './admin-workspace-composition-v2.css';
import './admin-console-v3.css';
import './admin-context-convergence.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminWorkspace />
  </StrictMode>,
);
