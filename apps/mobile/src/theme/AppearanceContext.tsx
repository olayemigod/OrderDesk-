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
  setFontScale: (scale: number) => Promise<void>;
};

const MODE_KEY = 'sellertray.appearance.mode';
const LEGACY_TEXT_KEY = 'sellertray.appearance.text-size';
const FONT_SCALE_KEY = 'sellertray.appearance.font-scale';
export const SELLERTRAY_FONT_SCALE_MIN = 0.9;
export const SELLERTRAY_FONT_SCALE_MAX = 1.3;
export const SELLERTRAY_FONT_SCALE_STEP = 0.05;

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const [fontScale, setFontScaleState] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void Promise.all([
      AsyncStorage.getItem(MODE_KEY),
      AsyncStorage.getItem(FONT_SCALE_KEY),
      AsyncStorage.getItem(LEGACY_TEXT_KEY),
    ]).then(([savedMode, savedScale, legacyTextSize]) => {
      if (!active) return;
      if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
        setModeState(savedMode);
      }

      const parsedScale = savedScale === null ? Number.NaN : Number(savedScale);
      if (Number.isFinite(parsedScale)) {
        setFontScaleState(normalizeFontScale(parsedScale));
      } else if (legacyTextSize === 'large') {
        setFontScaleState(1.1);
      } else {
        setFontScaleState(1);
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
  const textSize: TextSize = fontScale > 1.05 ? 'large' : 'standard';

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
      const scale = next === 'large' ? 1.1 : 1;
      setFontScaleState(scale);
      await AsyncStorage.setItem(FONT_SCALE_KEY, String(scale));
      await AsyncStorage.removeItem(LEGACY_TEXT_KEY);
    },
    setFontScale: async (next) => {
      const scale = normalizeFontScale(next);
      setFontScaleState(scale);
      await AsyncStorage.setItem(FONT_SCALE_KEY, String(scale));
      await AsyncStorage.removeItem(LEGACY_TEXT_KEY);
    },
  }), [mode, textSize, dark, fontScale, ready]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useSellerTrayAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('SellerTray appearance provider is missing.');
  return value;
}

function normalizeFontScale(value: number): number {
  const clamped = Math.min(SELLERTRAY_FONT_SCALE_MAX, Math.max(SELLERTRAY_FONT_SCALE_MIN, value));
  return Number((Math.round(clamped / SELLERTRAY_FONT_SCALE_STEP) * SELLERTRAY_FONT_SCALE_STEP).toFixed(2));
}
