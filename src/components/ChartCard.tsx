import React, { useCallback, useRef, useState } from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { exportElementToPdf, exportElementToPng, slugifyFilenamePart } from '@/utils/chartExport';

export const ChartCard: React.FC<{
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    resetLabel?: string;
    onReset?: () => void;
    showReset?: boolean;
    theme: Theme;
    onExpand?: () => void;
    /** Имя файла при экспорте (без расширения). */
    exportFilenameSlug?: string;
}> = ({
    title,
    children,
    footer,
    resetLabel = 'Сбросить',
    onReset,
    showReset,
    theme,
    onExpand,
    exportFilenameSlug,
}) => {
    const exportRootRef = useRef<HTMLDivElement>(null);
    const [exportBusy, setExportBusy] = useState(false);
    const baseName = slugifyFilenamePart(exportFilenameSlug ?? title);

    const runExport = useCallback(
        async (kind: 'png' | 'pdf') => {
            const el = exportRootRef.current;
            if (!el || exportBusy) return;
            setExportBusy(true);
            try {
                if (kind === 'png') {
                    await exportElementToPng(el, baseName, theme);
                } else {
                    await exportElementToPdf(el, baseName, theme);
                }
            } catch (e) {
                console.warn('[chart export]', e);
            } finally {
                setExportBusy(false);
            }
        },
        [baseName, exportBusy, theme]
    );

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
            title={onExpand ? 'Нажмите, чтобы открыть крупнее' : undefined}
            className={`${themeClass(theme, {
                dark: 'group relative flex min-h-[360px] h-[min(28rem,55vh)] flex-col overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/60 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.45)] sm:min-h-[400px] sm:h-[min(32rem,50vh)] sm:p-6',
                light: 'group relative flex min-h-[360px] h-[min(28rem,55vh)] flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.06)] transition hover:border-zinc-300/90 sm:min-h-[400px] sm:h-[min(32rem,50vh)] sm:p-6',
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
            <div className="relative z-10 flex h-full min-h-0 flex-col">
                <div
                    ref={exportRootRef}
                    className={`flex min-h-0 flex-1 flex-col ${themeClass(theme, {
                        dark: 'rounded-2xl bg-zinc-950/40',
                        light: 'rounded-2xl bg-zinc-50/50',
                    })}`}
                >
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <h4
                            className={`font-display min-w-0 flex-1 ${themeClass(theme, {
                                dark: 'flex items-center gap-2.5 text-base font-semibold tracking-tight text-zinc-100 sm:text-lg',
                                light: 'flex items-center gap-2.5 text-base font-semibold tracking-tight text-zinc-900 sm:text-lg',
                            })}`}
                        >
                            <span
                                className={themeClass(theme, {
                                    dark: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400/90',
                                    light: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500',
                                })}
                            />
                            <span className="leading-tight">{title}</span>
                        </h4>
                        <div
                            className="no-export flex shrink-0 flex-wrap items-center justify-end gap-1.5"
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                        >
                            {showReset && onReset && (
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
                            )}
                            <button
                                type="button"
                                disabled={exportBusy}
                                onClick={e => {
                                    e.stopPropagation();
                                    void runExport('png');
                                }}
                                className={themeClass(theme, {
                                    dark: 'rounded-lg border border-zinc-700/90 bg-zinc-900/80 px-2 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:bg-zinc-800 disabled:opacity-50',
                                    light: 'rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:border-indigo-300 disabled:opacity-50',
                                })}
                            >
                                PNG
                            </button>
                            <button
                                type="button"
                                disabled={exportBusy}
                                onClick={e => {
                                    e.stopPropagation();
                                    void runExport('pdf');
                                }}
                                className={themeClass(theme, {
                                    dark: 'rounded-lg border border-zinc-700/90 bg-zinc-900/80 px-2 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:bg-zinc-800 disabled:opacity-50',
                                    light: 'rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:border-indigo-300 disabled:opacity-50',
                                })}
                            >
                                PDF
                            </button>
                        </div>
                    </div>
                    <div className="pointer-events-auto flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">{children}</div>
                </div>
                {footer}
            </div>
        </div>
    );
};
