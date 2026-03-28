import { UI_SETTINGS_KEY } from '@/persistence/keys';

export type Theme = 'dark' | 'light';

/** Тема из localStorage, иначе системная (при первом рендере; для SSR — светлая). */
export function readPreferredTheme(): Theme {
    if (typeof window === 'undefined') return 'light';
    try {
        const raw = localStorage.getItem(UI_SETTINGS_KEY);
        if (raw) {
            const p = JSON.parse(raw) as { theme?: string };
            if (p.theme === 'dark' || p.theme === 'light') return p.theme;
        }
    } catch {
        /* ignore */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const themeClass = (theme: Theme, variants: { dark: string; light: string }): string =>
    theme === 'dark' ? variants.dark : variants.light;

/** Единый акцент (indigo) для графиков. */
export const CHART_FILL = {
    dark: '#818cf8',
    light: '#4f46e5',
} as const;

export const ACTIVE_BAR_COLOR = {
    dark: '#a5b4fc',
    light: '#6366f1',
} as const;

export const BAR_OPACITY_INACTIVE = 0.6;
