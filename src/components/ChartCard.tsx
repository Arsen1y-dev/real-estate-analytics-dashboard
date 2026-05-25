import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

export const ChartCard: React.FC<{
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    resetLabel?: string;
    onReset?: () => void;
    showReset?: boolean;
    theme: Theme;
    onExpand?: () => void;
}> = ({
    title,
    children,
    footer,
    resetLabel = 'Сбросить',
    onReset,
    showReset,
    theme,
    onExpand,
}) => {
    return (
        <div
            role={onExpand ? 'button' : undefined}
            tabIndex={onExpand ? 0 : undefined}
            onClick={onExpand}
            onKeyDown={
                onExpand
                    ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onExpand();
                          }
                      }
                    : undefined
            }
            title={onExpand ? 'Открыть крупнее — экспорт PNG/PDF в полноэкранном окне' : undefined}
            className={`${themeClass(theme, {
                dark: 'group relative flex min-h-[360px] min-w-0 h-[min(28rem,55vh)] flex-col overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/60 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.45)] sm:min-h-[400px] sm:h-[min(32rem,50vh)] sm:p-6',
                light: 'group relative flex min-h-[360px] min-w-0 h-[min(28rem,55vh)] flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.06)] transition hover:border-zinc-300/90 sm:min-h-[400px] sm:h-[min(32rem,50vh)] sm:p-6',
            })} ${onExpand ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent' : ''}`}
        >
            <div
                className={themeClass(theme, {
                    dark: 'pointer-events-none absolute right-4 top-4 z-20 rounded-md border border-zinc-700/80 bg-zinc-900/90 px-2 py-1 text-[10px] font-medium tracking-wide text-zinc-500 opacity-0 transition group-hover:opacity-100 no-export',
                    light: 'pointer-events-none absolute right-4 top-4 z-20 rounded-md border border-zinc-200/90 bg-white/95 px-2 py-1 text-[10px] font-medium tracking-wide text-zinc-500 opacity-0 shadow-sm transition group-hover:opacity-100 no-export',
                })}
            >
                {onExpand ? 'Открыть' : ''}
            </div>
            <div
                className={themeClass(theme, {
                    dark: 'absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-indigo-500/[0.04] no-export',
                    light: 'absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-indigo-500/[0.03] no-export',
                })}
            />
            <div className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div
                    className={`flex min-h-0 flex-1 flex-col overflow-hidden ${themeClass(theme, {
                        dark: 'rounded-2xl bg-zinc-950/40',
                        light: 'rounded-2xl bg-zinc-50/50',
                    })}`}
                >
                    <div className="mb-3 shrink-0 space-y-2 sm:mb-4">
                        <h4
                            className={`font-display min-w-0 ${onExpand ? 'pr-12 sm:pr-14' : ''} ${themeClass(theme, {
                                dark: 'flex items-start gap-2.5 text-base font-semibold tracking-tight text-zinc-100 sm:text-lg',
                                light: 'flex items-start gap-2.5 text-base font-semibold tracking-tight text-zinc-900 sm:text-lg',
                            })}`}
                        >
                            <span
                                className={themeClass(theme, {
                                    dark: 'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400/90',
                                    light: 'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500',
                                })}
                            />
                            <span className="min-w-0 leading-snug">{title}</span>
                        </h4>
                        {showReset && onReset && (
                            <div className="no-export flex justify-end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        onReset();
                                    }}
                                    className={themeClass(theme, {
                                        dark: 'inline-flex items-center gap-1 rounded-lg border border-zinc-700/90 bg-zinc-900/80 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:bg-zinc-800',
                                        light: 'inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-300 hover:bg-white',
                                    })}
                                >
                                    {resetLabel}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="pointer-events-auto relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
                        <div className="flex h-full min-h-[16rem] min-w-0 flex-col gap-2 sm:min-h-[18rem] sm:gap-3">{children}</div>
                    </div>
                </div>
                {footer ? (
                    <div
                        className={`relative z-10 shrink-0 border-t pt-2 ${themeClass(theme, {
                            dark: 'border-zinc-800/80 bg-zinc-950/60',
                            light: 'border-zinc-200/90 bg-white',
                        })}`}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                    >
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>
    );
};
