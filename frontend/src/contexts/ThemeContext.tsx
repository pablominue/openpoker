import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeId = 'dark' | 'midnight' | 'ocean' | 'poker' | 'light';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  icon: string;
  preview: string; // accent color hex for the swatch
}

export const THEMES: ThemeMeta[] = [
  { id: 'dark',     label: 'Dark',     icon: '◐', preview: '#10b981' },
  { id: 'midnight', label: 'Midnight', icon: '✦', preview: '#818cf8' },
  { id: 'ocean',    label: 'Ocean',    icon: '◈', preview: '#22d3ee' },
  { id: 'poker',    label: 'Poker',    icon: '♠', preview: '#f59e0b' },
  { id: 'light',    label: 'Light',    icon: '○', preview: '#0ea5e9' },
];

interface ThemeCtx {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', setTheme: () => {} });

const STORAGE_KEY = 'texassolver-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeId | null) ?? 'dark';
  });

  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  };

  useEffect(() => {
    const root = document.documentElement;
    // Trigger smooth transition
    root.classList.add('theme-transition');
    root.setAttribute('data-theme', theme);
    const timer = setTimeout(() => root.classList.remove('theme-transition'), 300);
    return () => clearTimeout(timer);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
