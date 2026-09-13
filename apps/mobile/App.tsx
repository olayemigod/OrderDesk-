import ProvisionedApp from './src/ProvisionedApp';
import { AppearanceProvider } from './src/theme/AppearanceContext';

export default function App() {
  return (
    <AppearanceProvider>
      <ProvisionedApp />
    </AppearanceProvider>
  );
}
