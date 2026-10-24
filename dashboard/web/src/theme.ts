import { useEffect, useState } from 'react';

// Club 32's tokens (app/frontend/src/theme/tokens.ts), copied not imported so the
// dashboard never couples to the app build. Series colors are the brand hues
// stepped to pass the dataviz validator (chroma, CVD, contrast) on the card
// surface, light and dark each validated on its own.

export interface ChartTheme {
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  actual: string;      // slot 1 — forest
  forecast: string;    // slot 2 — slate blue
  persistence: string; // slot 3 — amber
  typical: string;     // reference lines (not a series)
}

const LIGHT: ChartTheme = {
  surface: '#FFFFFF',
  ink: '#1A3530',
  inkSecondary: '#5C6E68',
  muted: '#8A9E98',
  grid: 'rgba(10,107,90,0.09)',
  axis: 'rgba(10,107,90,0.20)',
  actual: '#08805F',
  forecast: '#3A63C9',
  persistence: '#C07A00',
  typical: '#8A9E98',
};

const DARK: ChartTheme = {
  surface: '#1B2925',
  ink: '#EEF2EF',
  inkSecondary: '#B5C4BE',
  muted: '#7E918B',
  grid: 'rgba(238,242,239,0.08)',
  axis: 'rgba(238,242,239,0.18)',
  actual: '#2FA37E',
  forecast: '#6C88E8',
  persistence: '#C4871C',
  typical: '#7E918B',
};

const query = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return dark ? DARK : LIGHT;
}
