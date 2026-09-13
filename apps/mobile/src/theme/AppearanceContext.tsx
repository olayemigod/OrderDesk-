import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

type AppearanceMode = 'system' | 'light' | 'dark';
type TextSize = 'standard' | 'large';

type AppearanceContextValue = {
  mode: AppearanceMode;
  textSize: TextSize;
  dark: boolean;
  fontScale: number;
  ready: boolean;
  setMode: (mode: AppearanceMode) => Promise<void>;
  setTextSize: (size: TextSize) => Promise<void>;
};

const MODE_KEY = 'sellertray.appearance.mode';
const TEXT_KEY = 'sellertray.appearance.text-size';

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [textSize, setTextSizeState] = useState<TextSize>('standard');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void Promise.all([
      AsyncStorage.getItem(MODE_KEY),
      AsyncStorage.getItem(TEXT_KEY),
    ]).then(([savedMode, savedText]) => {
      if (!active) return;
      if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
        setModeState(savedMode);
      }
      if (savedText === 'standard' || savedText === 'large') {
        setTextSizeState(savedText);
      }
      setReady(true);
    }).catch(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  const dark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const fontScale = textSize === 'large' ? 1.12 : 1;

  const value = useMemo<AppearanceContextValue>(() => ({
    mode,
    textSize,
    dark,
    fontScale,
    ready,
    setMode: async (next) => {
      setModeState(next);
      await AsyncStorage.setItem(MODE_KEY, next);
    },
    setTextSize: async (next) => {
      setTextSizeState(next);
      await AsyncStorage.setItem(TEXT_KEY, next);
    },
  }), [mode, textSize, dark, fontScale, ready]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useSellerTrayAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('SellerTray appearance provider is missing.');
  return value;
}
