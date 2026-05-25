import { useCallback, useEffect, useState } from 'react';
import type { ColorScheme, Theme, ThemeMode } from '@/theme';
import {
    applyThemeToDocument,
    detectSystemTheme,
    nextColorScheme,
    readPreferredColorScheme,
    readPreferredThemeMode,
    saveColorSchemePreference,
    saveThemeModePreference,
} from '@/theme';

export function useThemePreferences() {
    const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readPreferredThemeMode());
    const [systemTheme, setSystemTheme] = useState<Theme>(() => detectSystemTheme());
    const [colorScheme, setColorScheme] = useState<ColorScheme>(() => readPreferredColorScheme());
    const theme: Theme = themeMode === 'auto' ? systemTheme : themeMode;

    useEffect(() => {
        applyThemeToDocument(theme, colorScheme);
    }, [theme, colorScheme]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const updateSystemTheme = (event?: MediaQueryListEvent) => {
            setSystemTheme(event?.matches ?? media.matches ? 'dark' : 'light');
        };
        updateSystemTheme();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updateSystemTheme);
            return () => media.removeEventListener('change', updateSystemTheme);
        }
        media.addListener(updateSystemTheme);
        return () => media.removeListener(updateSystemTheme);
    }, []);

    const setThemeMode = useCallback((nextMode: ThemeMode) => {
        setThemeModeState(nextMode);
        saveThemeModePreference(nextMode);
    }, []);

    const cycleThemeMode = useCallback(() => {
        setThemeModeState(prev => {
            const next: ThemeMode = prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto';
            saveThemeModePreference(next);
            applyThemeToDocument(next === 'auto' ? systemTheme : next, colorScheme);
            return next;
        });
    }, [colorScheme, systemTheme]);

    const setTheme = useCallback(
        (nextTheme: Theme) => {
            setThemeMode(nextTheme);
            applyThemeToDocument(nextTheme, colorScheme);
        },
        [colorScheme, setThemeMode]
    );

    const cycleColorScheme = useCallback(() => {
        setColorScheme(prev => {
            const next = nextColorScheme(prev);
            saveColorSchemePreference(next);
            applyThemeToDocument(theme, next);
            return next;
        });
    }, [theme]);

    return {
        theme,
        themeMode,
        systemTheme,
        colorScheme,
        setTheme,
        setThemeMode,
        cycleThemeMode,
        cycleColorScheme,
        setColorScheme,
    };
}
