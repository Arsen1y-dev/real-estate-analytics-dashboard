export type Theme = 'dark' | 'light';

/** Тема из системных настроек (только при первом рендере; для SSR — светлая). */
export function readPreferredTheme(): Theme {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const themeClass = (theme: Theme, variants: { dark: string; light: string }): string =>
    theme === 'dark' ? variants.dark : variants.light;

export const CHART_FILL = {
    dark: '#0891b2',
    light: '#0284c7',
} as const;

export const ACTIVE_BAR_COLOR = {
    dark: '#22d3ee',
    light: '#0ea5e9',
} as const;

export const BAR_OPACITY_INACTIVE = 0.6;
