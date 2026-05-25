import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

export type ReverseGeocodePanelProgress = {
    total: number;
    resolved: number;
    queued: number;
    inFlight: number;
};

export function ReverseGeocodePanel({
    theme,
    progress,
    running,
    onStart,
    onStop,
}: {
    theme: Theme;
    progress: ReverseGeocodePanelProgress;
    running: boolean;
    onStart: () => void;
    onStop: () => void;
}) {
    if (progress.total <= 0) return null;

    const pending = Math.max(0, progress.total - progress.resolved);
    const doneForBar = progress.resolved;
    const pct = progress.total > 0 ? Math.round((doneForBar / progress.total) * 100) : 0;

    return (
        <div
            className={themeClass(theme, {
                dark: 'mb-3 rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3',
                light: 'mb-3 rounded-xl border border-zinc-200 bg-zinc-50/90 p-3',
            })}
        >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className={themeClass(theme, { dark: 'text-xs text-zinc-300', light: 'text-xs text-zinc-700' })}>
                    Адреса по координатам: {progress.resolved} / {progress.total}
                    {running && (progress.inFlight > 0 || progress.queued > 0) && (
                        <span className="opacity-75">
                            {' '}
                            · в работе {progress.inFlight + progress.queued}
                        </span>
                    )}
                    {!running && pending > 0 && (
                        <span className="opacity-75"> · ожидает {pending}</span>
                    )}
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={running || pending === 0}
                        onClick={onStart}
                        className={themeClass(theme, {
                            dark: 'rounded-lg border border-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40',
                            light: 'rounded-lg border border-indigo-200 px-2.5 py-1 text-xs text-indigo-800 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40',
                        })}
                    >
                        Запустить геокодинг
                    </button>
                    <button
                        type="button"
                        disabled={!running}
                        onClick={onStop}
                        className={themeClass(theme, {
                            dark: 'rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40',
                            light: 'rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40',
                        })}
                    >
                        Остановить
                    </button>
                </div>
            </div>
            <div
                className={themeClass(theme, {
                    dark: 'h-1.5 overflow-hidden rounded-full bg-zinc-800',
                    light: 'h-1.5 overflow-hidden rounded-full bg-zinc-200',
                })}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className={themeClass(theme, {
                        dark: 'h-full rounded-full bg-indigo-500/90 transition-[width] duration-300',
                        light: 'h-full rounded-full bg-indigo-500 transition-[width] duration-300',
                    })}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
