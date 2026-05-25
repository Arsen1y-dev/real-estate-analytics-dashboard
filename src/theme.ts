import { SCHEME_PREF_KEY, THEME_MODE_PREF_KEY, THEME_PREF_KEY, UI_SETTINGS_KEY } from '@/persistence/keys';

export type Theme = 'dark' | 'light';
export type ThemeMode = 'auto' | Theme;
export type ColorScheme = 'standard' | 'helloKitty' | 'green';

export const COLOR_SCHEME_ORDER: ColorScheme[] = ['standard', 'helloKitty', 'green'];

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
    standard: 'Стандарт',
    helloKitty: 'HK',
    green: 'Зелёная',
};

export const THEME_LABELS: Record<Theme, string> = {
    light: 'Светлая',
    dark: 'Тёмная',
};

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
    auto: 'Авто',
    light: 'Светлая',
    dark: 'Тёмная',
};

/** Все 6 комбинаций: 3 схемы × 2 режима яркости */
export const THEME_COMBO_COUNT = COLOR_SCHEME_ORDER.length * 2;

let runtimeColorScheme: ColorScheme = 'standard';

export function setRuntimeColorScheme(scheme: ColorScheme): void {
    runtimeColorScheme = scheme;
}

/** Синхронизация <html data-theme/data-scheme> и runtime (вызывать при каждой смене). */
export function applyThemeToDocument(theme: Theme, scheme: ColorScheme): void {
    if (typeof document === 'undefined') return;
    setRuntimeColorScheme(scheme);
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.scheme = scheme;
    root.classList.toggle('theme-dark', theme === 'dark');
    root.classList.toggle('theme-light', theme === 'light');
}

export function getRuntimeColorScheme(): ColorScheme {
    return runtimeColorScheme;
}

function isColorScheme(value: string): value is ColorScheme {
    return value === 'standard' || value === 'helloKitty' || value === 'green';
}

/** Тема из localStorage, иначе системная (при первом рендере; для SSR — светлая). */
export function readPreferredTheme(): Theme {
    return resolveThemeFromMode(readPreferredThemeMode());
}

export function detectSystemTheme(): Theme {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemeFromMode(mode: ThemeMode): Theme {
    return mode === 'auto' ? detectSystemTheme() : mode;
}

/** Режим темы из localStorage; по умолчанию auto (следовать системе). */
export function readPreferredThemeMode(): ThemeMode {
    if (typeof window === 'undefined') return 'auto';
    try {
        const storedMode = localStorage.getItem(THEME_MODE_PREF_KEY);
        if (storedMode === 'auto' || storedMode === 'dark' || storedMode === 'light') return storedMode;

        const legacyTheme = localStorage.getItem(THEME_PREF_KEY);
        if (legacyTheme === 'dark' || legacyTheme === 'light') return legacyTheme;

        const raw = localStorage.getItem(UI_SETTINGS_KEY);
        if (raw) {
            const p = JSON.parse(raw) as { theme?: string };
            if (p.theme === 'dark' || p.theme === 'light') return p.theme;
        }
    } catch {
        /* ignore */
    }
    return 'auto';
}

export function saveThemeModePreference(mode: ThemeMode): void {
    try {
        localStorage.setItem(THEME_MODE_PREF_KEY, mode);
        if (mode === 'dark' || mode === 'light') {
            // Legacy key is kept for backward compatibility with older builds.
            localStorage.setItem(THEME_PREF_KEY, mode);
        } else {
            localStorage.removeItem(THEME_PREF_KEY);
        }
    } catch {
        /* ignore quota / private mode */
    }
}

/** Цветовая схема из localStorage, иначе standard. */
export function readPreferredColorScheme(): ColorScheme {
    if (typeof window === 'undefined') return 'standard';
    try {
        const raw = localStorage.getItem(SCHEME_PREF_KEY);
        if (raw && isColorScheme(raw)) return raw;
    } catch {
        /* ignore */
    }
    return 'standard';
}

export function saveColorSchemePreference(scheme: ColorScheme): void {
    try {
        localStorage.setItem(SCHEME_PREF_KEY, scheme);
    } catch {
        /* ignore quota / private mode */
    }
}

function applySchemeToClassString(className: string, scheme: ColorScheme): string {
    if (scheme === 'standard') return className;
    let s = className;
    if (scheme === 'helloKitty') {
        s = s
            .replace(/indigo-(\d+)/g, 'pink-$1')
            .replace(/zinc-(\d+)/g, 'rose-$1')
            .replace(/rgba\(99,\s*102,\s*241/g, 'rgba(236,72,153')
            .replace(/rgba\(79,\s*70,\s*229/g, 'rgba(219,39,119')
            .replace(/rgba\(129,\s*140,\s*248/g, 'rgba(244,114,182')
            .replace(/rgba\(63,\s*63,\s*70/g, 'rgba(190,18,60')
            .replace(/rgba\(24,\s*24,\s*27/g, 'rgba(76,5,25')
            .replace(/rgba\(9,\s*9,\s*11/g, 'rgba(62,8,27');
    } else if (scheme === 'green') {
        s = s
            .replace(/indigo-(\d+)/g, 'emerald-$1')
            .replace(/zinc-(\d+)/g, 'emerald-$1')
            .replace(/rgba\(99,\s*102,\s*241/g, 'rgba(16,185,129')
            .replace(/rgba\(79,\s*70,\s*229/g, 'rgba(5,150,105')
            .replace(/rgba\(129,\s*140,\s*248/g, 'rgba(52,211,153')
            .replace(/rgba\(63,\s*63,\s*70/g, 'rgba(6,78,59')
            .replace(/rgba\(24,\s*24,\s*27/g, 'rgba(2,44,34')
            .replace(/rgba\(9,\s*9,\s*11/g, 'rgba(2,44,34');
    }
    return s;
}

export const themeClass = (
    theme: Theme,
    variants: { dark: string; light: string },
    scheme: ColorScheme = getRuntimeColorScheme()
): string => {
    const base = theme === 'dark' ? variants.dark : variants.light;
    return applySchemeToClassString(base, scheme);
};

const CHART_PALETTES: Record<ColorScheme, { dark: string; light: string }> = {
    standard: { dark: '#818cf8', light: '#4f46e5' },
    helloKitty: { dark: '#f472b6', light: '#db2777' },
    green: { dark: '#34d399', light: '#059669' },
};

const CHART_ACTIVE_PALETTES: Record<ColorScheme, { dark: string; light: string }> = {
    standard: { dark: '#a5b4fc', light: '#6366f1' },
    helloKitty: { dark: '#f9a8d4', light: '#ec4899' },
    green: { dark: '#6ee7b7', light: '#10b981' },
};

const CHART_STROKE_PALETTES: Record<ColorScheme, { dark: string; light: string }> = {
    standard: { dark: '#818cf8', light: '#6366f1' },
    helloKitty: { dark: '#f472b6', light: '#ec4899' },
    green: { dark: '#34d399', light: '#10b981' },
};

export function chartFillColor(theme: Theme, scheme: ColorScheme = runtimeColorScheme): string {
    return CHART_PALETTES[scheme][theme];
}

export function chartActiveBarColor(theme: Theme, scheme: ColorScheme = runtimeColorScheme): string {
    return CHART_ACTIVE_PALETTES[scheme][theme];
}

export function chartAccentStroke(theme: Theme, scheme: ColorScheme = runtimeColorScheme): string {
    return CHART_STROKE_PALETTES[scheme][theme];
}

export function sparklineStroke(theme: Theme, scheme: ColorScheme = runtimeColorScheme): string {
    if (scheme === 'helloKitty') {
        return theme === 'dark' ? 'rgba(244, 114, 182, 0.92)' : 'rgba(219, 39, 119, 0.88)';
    }
    if (scheme === 'green') {
        return theme === 'dark' ? 'rgba(52, 211, 153, 0.92)' : 'rgba(5, 150, 105, 0.88)';
    }
    return theme === 'dark' ? 'rgba(129, 140, 248, 0.92)' : 'rgba(79, 70, 229, 0.88)';
}

/** @deprecated Используйте chartFillColor */
export const CHART_FILL = {
    dark: '#818cf8',
    light: '#4f46e5',
} as const;

/** @deprecated Используйте chartActiveBarColor */
export const ACTIVE_BAR_COLOR = {
    dark: '#a5b4fc',
    light: '#6366f1',
} as const;

export const BAR_OPACITY_INACTIVE = 0.6;

export function nextColorScheme(current: ColorScheme): ColorScheme {
    const idx = COLOR_SCHEME_ORDER.indexOf(current);
    return COLOR_SCHEME_ORDER[(idx + 1) % COLOR_SCHEME_ORDER.length];
}
