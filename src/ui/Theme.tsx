import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { PREFERENCES_EVENT, readPreferences } from './preferences';

export type Theme = 'light' | 'dark';

interface ThemeCtx {
  theme: Theme;
  themeMode: Theme | 'auto';
  setTheme: (t: Theme) => void;
  setThemeMode: (mode: Theme | 'auto') => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'ce-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setModeState] = useState<Theme | 'auto'>(() => readPreferences().theme);
  const [theme, setThemeState] = useState<Theme>(() => themeMode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : themeMode);

  const setTheme = useCallback((t: Theme) => {
    setModeState(t);
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try { window.localStorage.setItem(STORAGE_KEY, t); window.localStorage.setItem('ce-theme-mode', t); } catch { /* ignore */ }
  }, []);

  const setThemeMode = useCallback((mode: Theme | 'auto') => {
    if (mode !== 'auto') { setTheme(mode); return; }
    setModeState('auto');
    const next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem('ce-theme-mode', 'auto'); } catch { /* ignore */ }
  }, [setTheme]);

  useEffect(() => {
    if (themeMode !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setThemeState(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [themeMode]);

  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-density', readPreferences().density);
    apply();
    window.addEventListener(PREFERENCES_EVENT, apply);
    window.addEventListener('storage', apply);
    return () => { window.removeEventListener(PREFERENCES_EVENT, apply); window.removeEventListener('storage', apply); };
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    // View Transitions API: HW-composited crossfade between snapshots.
    // flushSync ensures the DOM update lands synchronously inside the callback
    // so the browser captures correct before/after snapshots.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        flushSync(() => setTheme(next));
      });
    } else {
      setTheme(next);
    }
  }, [theme, setTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f172a' : '#fafbff');
  }, [theme]);

  const value = useMemo(() => ({ theme, themeMode, setTheme, setThemeMode, toggle }), [theme, themeMode, setTheme, setThemeMode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Hex/rgba values that need to be passed as JS strings (Recharts, SVG attributes). */
export interface ThemeColors {
  accent: string;
  accent2: string;
  accent3: string;
  ok: string;
  warn: string;
  err: string;
  text: string;
  textDim: string;
  textMuted: string;
  chartGrid: string;
  chartCursor: string;
  tooltipBg: string;
  tooltipBorder: string;
  panelSolid: string;
  surfaceDim: string;
  /** Color used for inactive map states / dim SVG fills */
  surfaceFaint: string;
  pinDot: string;
  pinHalo: string;
}

export const colorsByTheme: Record<Theme, ThemeColors> = {
  light: {
    accent:        '#06d6a0',
    accent2:       '#ec4899',
    accent3:       '#9333ea',
    ok:            '#10b981',
    warn:          '#f59e0b',
    err:           '#ef4444',
    text:          '#0f172a',
    textDim:       '#475569',
    textMuted:     '#94a3b8',
    chartGrid:     'rgba(15,23,42,0.08)',
    chartCursor:   'rgba(6,214,160,0.30)',
    tooltipBg:     '#ffffff',
    tooltipBorder: 'rgba(15,23,42,0.10)',
    panelSolid:    '#ffffff',
    surfaceDim:    '#f1f5f9',
    surfaceFaint:  'rgba(15,23,42,0.04)',
    pinDot:        '#0a0a18',
    pinHalo:       '#ffffff',
  },
  dark: {
    accent:        '#38bdf8',
    accent2:       '#a78bfa',
    accent3:       '#7dd3fc',
    ok:            '#4ade80',
    warn:          '#fbbf24',
    err:           '#fb7185',
    text:          '#f1f5f9',
    textDim:       '#cbd5e1',
    textMuted:     '#b8c5d6',
    chartGrid:     'rgba(148,163,184,0.10)',
    chartCursor:   'rgba(56,189,248,0.45)',
    tooltipBg:     'rgba(30,41,59,0.94)',
    tooltipBorder: 'rgba(56,189,248,0.30)',
    panelSolid:    '#1e293b',
    surfaceDim:    'rgba(255,255,255,0.025)',
    surfaceFaint:  'rgba(255,255,255,0.03)',
    pinDot:        'rgba(15,23,42,0.95)',
    pinHalo:       'rgba(15,23,42,0.95)',
  },
};

export function useThemeColors(): ThemeColors {
  const { theme } = useTheme();
  return colorsByTheme[theme];
}
