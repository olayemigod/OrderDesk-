import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminWorkspace from './AdminWorkspace';
import './styles.css';
import './brand.css';
import './admin-workspace.css';
import './admin-navigation.css';
import './admin-redesign.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminWorkspace />
  </StrictMode>,
);
