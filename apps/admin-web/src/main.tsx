import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminWorkspace from './AdminWorkspace';
import './styles.css';
import './brand.css';
import './admin-workspace.css';
import './admin-navigation.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminWorkspace />
  </StrictMode>,
);
