import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import type { DataSourceMode } from '@/domain/dataSource';

export function DataSourcePicker({
    theme,
    onChoose,
}: {
    theme: Theme;
    onChoose: (mode: DataSourceMode) => void;
}) {
    return (
        <div
            className={themeClass(theme, {
                dark: 'relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-zinc-950 px-6 text-zinc-200',
                light: 'relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-zinc-50 px-6 text-zinc-900',
            })}
        >
            <div
                className={themeClass(theme, {
                    dark: 'w-full max-w-lg space-y-8 rounded-[1.75rem] border border-zinc-800/80 bg-zinc-950/70 p-10 shadow-[0_1px_3px_rgba(0,0,0,0.2)]',
                    light: 'w-full max-w-lg space-y-8 rounded-[1.75rem] border border-zinc-200/90 bg-white p-10 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.08)]',
                })}
            >
                <div className="space-y-2">
                    <h1
                        className={themeClass(theme, {
                            dark: 'font-display text-2xl font-semibold tracking-tight text-zinc-50',
                            light: 'font-display text-2xl font-semibold tracking-tight text-zinc-900',
                        })}
                    >
                        Источник данных
                    </h1>
                    <p
                        className={themeClass(theme, {
                            dark: 'text-[15px] leading-relaxed text-zinc-400',
                            light: 'text-[15px] leading-relaxed text-zinc-600',
                        })}
                    >
                        Общий рынок с сервера или свой CSV для полного анализа.
                    </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={() => onChoose('server')}
                        className={themeClass(theme, {
                            dark: 'flex-1 rounded-xl border border-indigo-500/35 bg-indigo-500/[0.12] px-5 py-4 text-left text-sm font-medium text-indigo-100 transition hover:border-indigo-400/45 hover:bg-indigo-500/[0.18]',
                            light: 'flex-1 rounded-xl border border-indigo-200 bg-indigo-50/90 px-5 py-4 text-left text-sm font-medium text-indigo-900 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50',
                        })}
                    >
                        <span className="block text-base font-semibold">Сервер · рынок</span>
                        <span className="mt-1 block text-xs opacity-80">Данные, которые публикует администратор</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onChoose('personal')}
                        className={themeClass(theme, {
                            dark: 'flex-1 rounded-xl border border-zinc-700/90 bg-zinc-900/80 px-5 py-4 text-left text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
                            light: 'flex-1 rounded-xl border border-zinc-200 bg-white px-5 py-4 text-left text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
                        })}
                    >
                        <span className="block text-base font-semibold">Свой CSV</span>
                        <span className="mt-1 block text-xs opacity-80">Локальный файл, конструктор и экспорт</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
