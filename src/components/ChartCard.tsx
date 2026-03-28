import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

export const ChartCard: React.FC<{
    title: string;
    children: React.ReactNode;
    resetLabel?: string;
    onReset?: () => void;
    showReset?: boolean;
    theme: Theme;
    /** Клик по карточке открывает увеличенный вид (вся карточка — как кнопка). */
    onExpand?: () => void;
}> = ({ title, children, resetLabel = 'Сбросить', onReset, showReset, theme, onExpand }) => (
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
        title={onExpand ? 'Нажмите, чтобы открыть крупнее' : undefined}
        className={`${themeClass(theme, {
            dark: 'group relative flex h-80 min-h-[280px] flex-col overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-950/80 p-4 shadow-lg shadow-black/20 transition hover:border-cyan-500/50 sm:h-96 sm:min-h-[300px] sm:p-5',
            light: 'group relative flex h-80 min-h-[280px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-md shadow-slate-200/90 transition hover:border-cyan-400/60 sm:h-96 sm:min-h-[300px] sm:p-5',
        })} ${onExpand ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80' : ''}`}
    >
        <div className={themeClass(theme, {
            dark: 'pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-slate-600/80 bg-slate-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 opacity-0 transition group-hover:opacity-100',
            light: 'pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-slate-300 bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 opacity-0 transition group-hover:opacity-100',
        })}>
            {onExpand ? 'Увеличить' : ''}
        </div>
        <div className={themeClass(theme, {
            dark: 'absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-40 bg-gradient-to-br from-cyan-500/10 via-transparent to-purple-500/20',
            light: 'absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-40 bg-gradient-to-br from-cyan-400/10 via-transparent to-purple-400/10',
        })}></div>
        <div className="relative z-10 flex h-full flex-col">
            <div className="mb-3 flex items-start justify-between gap-2">
                <h4 className={`font-display ${themeClass(theme, {
                    dark: 'flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white',
                    light: 'flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-slate-900',
                })}`}>
                    <span className={themeClass(theme, {
                        dark: 'inline-block h-2 w-2 rounded-full bg-cyan-400/80 group-hover:animate-pulse',
                        light: 'inline-block h-2 w-2 rounded-full bg-cyan-500/80 group-hover:animate-pulse',
                    })}></span>
                    <span className="leading-tight">{title}</span>
                </h4>
                {showReset && onReset && (
                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation();
                            onReset();
                        }}
                        className={themeClass(theme, {
                            dark: 'inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-200 transition hover:border-cyan-400/70 hover:bg-cyan-500/20',
                            light: 'inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-600 transition hover:border-cyan-500/60 hover:bg-cyan-300/30',
                        })}
                    >
                        {resetLabel}
                    </button>
                )}
            </div>
            <div className="pointer-events-auto flex flex-1 min-h-0 flex-col gap-3 sm:gap-4">{children}</div>
        </div>
    </div>
);
