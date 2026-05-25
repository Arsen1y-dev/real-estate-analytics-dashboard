import React from 'react';
import type { ColorScheme, Theme, ThemeMode } from '@/theme';
import { COLOR_SCHEME_LABELS, THEME_LABELS, THEME_MODE_LABELS, themeClass } from '@/theme';

const btnClass = (theme: Theme, scheme: ColorScheme) =>
    themeClass(
        theme,
        {
            dark: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
            light: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
        },
        scheme
    );

export function ThemeControls({
    theme,
    themeMode,
    colorScheme,
    onCycleScheme,
    onCycleThemeMode,
    className = '',
}: {
    theme: Theme;
    themeMode: ThemeMode;
    colorScheme: ColorScheme;
    onCycleScheme: () => void;
    onCycleThemeMode: () => void;
    className?: string;
}) {
    const themeModeLabel = themeMode === 'auto' ? `${THEME_MODE_LABELS.auto} (${THEME_LABELS[theme]})` : THEME_MODE_LABELS[themeMode];

    return (
        <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
            <button
                type="button"
                onClick={onCycleScheme}
                className={btnClass(theme, colorScheme)}
                title="Следующая палитра: Стандарт → HK → Зелёная"
                aria-label={`Палитра: ${COLOR_SCHEME_LABELS[colorScheme]}. Нажмите для смены`}
            >
                {COLOR_SCHEME_LABELS[colorScheme]}
            </button>
            <button
                type="button"
                onClick={onCycleThemeMode}
                className={btnClass(theme, colorScheme)}
                title="Режим темы: Авто → Светлая → Тёмная"
                aria-label={`Режим: ${themeModeLabel}. Нажмите для смены`}
            >
                {themeModeLabel}
            </button>
        </div>
    );
}
