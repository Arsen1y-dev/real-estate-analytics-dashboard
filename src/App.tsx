import React, { useState, useCallback, useMemo, useTransition, useDeferredValue, useEffect, useRef } from 'react';
import type { DataRow, DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import { INITIAL_APP_STATE, createDefaultFiltersFromSummary, rowPassesFilters } from '@/domain/filters';
import { defaultChartsForSummary } from '@/domain/chartDefaults';
import type { Theme } from '@/theme';
import { readPreferredTheme, themeClass } from '@/theme';
import { importCsvFile } from '@/utils/csvImport';
import { FileUpload } from '@/components/FileUpload';
import { FilterPanel } from '@/components/FilterPanel';
import { ChartSidebar } from '@/components/ChartSidebar';
import { DashboardStats } from '@/components/DashboardStats';
import { DynamicChartGrid } from '@/components/DynamicChartGrid';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { FilterIcon } from '@/components/icons';
import { persistDatasetUiState, saveThemePreference } from '@/persistence/uiSettings';
import { columnSignature } from '@/utils/sanitizeDashboardState';
import { resolveDashboardStateForSummary, buildShareableUrl } from '@/utils/dashboardStateResolve';
import { copyTextToClipboard } from '@/utils/shareState';

function App() {
    const [theme, setTheme] = useState<Theme>(() => readPreferredTheme());
    const replaceFileInputRef = useRef<HTMLInputElement>(null);
    const dataHydratedSig = useRef<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [isLoading, setLoading] = useState<boolean>(false);
    const [allData, setAllData] = useState<DataRow[] | null>(INITIAL_APP_STATE.allData);
    const [dataSummary, setDataSummary] = useState<DataSummary | null>(INITIAL_APP_STATE.dataSummary);
    const [filters, setFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.filters);
    const [baselineFilters, setBaselineFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.baselineFilters);
    const [isFilterPanelOpen, setFilterPanelOpen] = useState(false);
    const [userCharts, setUserCharts] = useState<UserChartDefinition[]>(() =>
        INITIAL_APP_STATE.dataSummary ? defaultChartsForSummary(INITIAL_APP_STATE.dataSummary) : []
    );
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        const rootEl = document.documentElement;
        rootEl.dataset.theme = theme;
        rootEl.classList.toggle('theme-dark', theme === 'dark');
        rootEl.classList.toggle('theme-light', theme === 'light');
    }, [theme]);

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 3200);
        return () => clearTimeout(t);
    }, [toast]);

    useEffect(() => {
        if (!dataSummary || !allData?.length) return;
        const sig = columnSignature(dataSummary);
        if (dataHydratedSig.current === sig) return;
        dataHydratedSig.current = sig;
        const chosen = resolveDashboardStateForSummary(dataSummary);
        startTransition(() => {
            setFilters(chosen.filters);
            setBaselineFilters(createDefaultFiltersFromSummary(dataSummary));
            setUserCharts(chosen.userCharts);
            if (chosen.theme) {
                setTheme(chosen.theme);
                saveThemePreference(chosen.theme);
            }
            if (chosen.toast) setToast(chosen.toast);
        });
    }, [dataSummary, allData, startTransition]);

    useEffect(() => {
        if (!dataSummary || !filters) return;
        const t = window.setTimeout(() => {
            persistDatasetUiState(dataSummary, filters, userCharts);
        }, 450);
        return () => clearTimeout(t);
    }, [dataSummary, filters, userCharts]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => {
            const next = prev === 'dark' ? 'light' : 'dark';
            saveThemePreference(next);
            return next;
        });
    }, []);

    const handleDataLoaded = useCallback(
        (data: DataRow[], summary: DataSummary) => {
            dataHydratedSig.current = columnSignature(summary);
            const chosen = resolveDashboardStateForSummary(summary);
            startTransition(() => {
                setAllData(data);
                setDataSummary(summary);
                setFilters(chosen.filters);
                setBaselineFilters(createDefaultFiltersFromSummary(summary));
                setUserCharts(chosen.userCharts);
                if (chosen.theme) {
                    setTheme(chosen.theme);
                    saveThemePreference(chosen.theme);
                }
                if (chosen.toast) setToast(chosen.toast);
            });
        },
        [startTransition]
    );

    const handleShare = useCallback(async () => {
        if (!dataSummary || !filters) return;
        let url: string;
        try {
            url = buildShareableUrl(dataSummary, theme, filters, userCharts);
        } catch {
            setToast('Не удалось сформировать ссылку');
            return;
        }
        if (url.length > 7500) {
            setToast('Ссылка слишком длинная — удалите часть графиков');
            return;
        }
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                await navigator.share({
                    title: 'Дашборд недвижимости',
                    text: 'Настройки фильтров и графиков',
                    url,
                });
                setToast('Ссылка отправлена');
                return;
            }
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return;
            /* иначе — копируем */
        }
        const ok = await copyTextToClipboard(url);
        setToast(ok ? 'Ссылка скопирована в буфер обмена' : 'Не удалось скопировать ссылку');
    }, [dataSummary, filters, theme, userCharts]);

    const handleFilterChange = useCallback((newFilters: FilterSettings) => {
        startTransition(() => {
            setFilters(newFilters);
        });
    }, [startTransition]);

    const handleChartsChange = useCallback((next: UserChartDefinition[]) => {
        startTransition(() => {
            setUserCharts(next);
        });
    }, [startTransition]);

    const handleLoadAnotherCsv = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) {
                importCsvFile(file, handleDataLoaded, setLoading);
            }
            event.target.value = '';
        },
        [handleDataLoaded]
    );

    const deferredFilters = useDeferredValue(filters);
    const deferredUserCharts = useDeferredValue(userCharts);

    const filteredData = useMemo(() => {
        if (!allData || !deferredFilters || !dataSummary) {
            return [];
        }
        return allData.filter(d => rowPassesFilters(d, deferredFilters, dataSummary));
    }, [allData, deferredFilters, dataSummary]);

    /** Счётчик для панели фильтров — без отложенного значения, чтобы слайдеры ощущались отзывчивыми. */
    const filterPanelMatchCount = useMemo(() => {
        if (!allData || !filters || !dataSummary) return 0;
        return allData.filter(d => rowPassesFilters(d, filters, dataSummary)).length;
    }, [allData, filters, dataSummary]);

    const deferredFilteredData = useDeferredValue(filteredData);
    const isChartUpdating =
        isPending ||
        deferredFilteredData !== filteredData ||
        deferredUserCharts !== userCharts;

    if (isLoading) {
        return <DashboardSkeleton />;
    }

    if (!allData || !dataSummary || !filters || !baselineFilters) {
        return <FileUpload onDataLoaded={handleDataLoaded} setLoading={setLoading} />;
    }

    return (
        <div className={themeClass(theme, {
            dark: 'relative min-h-screen w-full overflow-hidden bg-zinc-950 text-zinc-200',
            light: 'relative min-h-screen w-full overflow-hidden bg-zinc-50 text-zinc-900',
        })}>
            <div
                className={themeClass(theme, {
                    dark: 'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.07),transparent)]',
                    light: 'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.06),transparent)]',
                })}
            />
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1580px] flex-col gap-10 px-5 pb-14 pt-8 sm:px-8 sm:pt-10 lg:gap-12 lg:px-12 lg:pb-16 lg:pt-12">
                <header className={themeClass(theme, {
                    dark: 'flex flex-col gap-8 rounded-[1.75rem] border border-zinc-800/80 bg-zinc-950/70 p-8 shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:p-10 lg:p-12',
                    light: 'flex flex-col gap-8 rounded-[1.75rem] border border-zinc-200/90 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-20px_rgba(0,0,0,0.08)] sm:p-10 lg:p-12',
                })}>
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
                        <div className="min-w-0 space-y-3">
                            <h1 className={`font-display ${themeClass(theme, {
                                dark: 'text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl lg:text-[2rem]',
                                light: 'text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl lg:text-[2rem]',
                            })}`}>
                                Аналитический дашборд недвижимости
                            </h1>
                            <p className={themeClass(theme, {
                                dark: 'max-w-2xl text-[15px] leading-relaxed text-zinc-400',
                                light: 'max-w-2xl text-[15px] leading-relaxed text-zinc-600',
                            })}>
                                Загрузите CSV и соберите графики из любых столбцов: гистограммы, точечные диаграммы и распределение по категориям.
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 sm:gap-3">
                            <input
                                ref={replaceFileInputRef}
                                type="file"
                                className="sr-only"
                                accept=".csv"
                                aria-hidden
                                onChange={handleLoadAnotherCsv}
                            />
                            <button
                                type="button"
                                onClick={handleShare}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-xl border border-indigo-500/35 bg-indigo-500/[0.12] px-4 py-2.5 text-sm font-medium text-indigo-100 transition hover:border-indigo-400/45 hover:bg-indigo-500/[0.18]',
                                    light: 'inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-2.5 text-sm font-medium text-indigo-900 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50',
                                })}
                            >
                                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                </svg>
                                Поделиться
                            </button>
                            <button
                                type="button"
                                onClick={() => replaceFileInputRef.current?.click()}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-xl border border-zinc-700/90 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
                                    light: 'inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
                                })}
                            >
                                Загрузить другой CSV
                            </button>
                            <button
                                type="button"
                                onClick={toggleTheme}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
                                    light: 'inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
                                })}
                                aria-label="Переключить тему"
                            >
                                {theme === 'dark' ? (
                                    <>
                                        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.11-8.11 8 8 0 0 1 .25-2A1 1 0 0 0 8.36 2 10.14 10.14 0 1 0 22 14.64 1 1 0 0 0 21.64 13Z"/></svg>
                                        Тёмная тема
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M6.76 4.84 5.35 3.43 3.93 4.84l1.41 1.41ZM1 11h3v2H1zm10-9h2v3h-2zm9.07 1.43-1.41 1.41 1.41 1.41 1.41-1.41ZM17.24 4.84 15.83 6.25l1.41 1.41L18.65 6.25ZM12 5a7 7 0 1 0 7 7 7 7 0 0 0-7-7Zm6 8h3v-2h-3ZM4.22 17.66l-1.41 1.41 1.41 1.41 1.41-1.41Zm15.56 0-1.41 1.41 1.41 1.41 1.41-1.41ZM11 19h2v3h-2ZM6.76 19.16l-1.41 1.41 1.41 1.41 1.41-1.41Z"/></svg>
                                        Светлая тема
                                    </>
                                )}
                            </button>
                            <div className={themeClass(theme, {
                                dark: 'inline-flex items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.08] px-3 py-1.5 text-xs font-medium text-indigo-200/95',
                                light: 'inline-flex items-center gap-2 rounded-lg border border-indigo-200/80 bg-indigo-50/90 px-3 py-1.5 text-xs font-medium text-indigo-800',
                            })}>
                                Произвольные столбцы CSV
                            </div>
                        </div>
                    </div>
                    <DashboardStats data={deferredFilteredData} baselineData={allData} summary={dataSummary} theme={theme} />
                </header>

                <div className="lg:hidden">
                    <button
                        type="button"
                        onClick={() => setFilterPanelOpen(true)}
                        className={themeClass(theme, {
                            dark: 'flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-5 py-3.5 text-sm font-medium text-zinc-100 shadow-sm transition hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/35',
                            light: 'flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3.5 text-sm font-medium text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/25',
                        })}
                        aria-label="Открыть фильтры"
                    >
                        <FilterIcon />
                        <span>Фильтры</span>
                    </button>
                </div>

                <main className="flex min-h-0 flex-1 flex-col gap-10 lg:flex-row lg:items-stretch lg:gap-10 xl:gap-12">
                    {isFilterPanelOpen && (
                        <div
                            className={themeClass(theme, {
                                dark: 'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm',
                                light: 'fixed inset-0 z-40 bg-zinc-900/15 backdrop-blur-sm',
                            })}
                            onClick={() => setFilterPanelOpen(false)}
                            role="dialog"
                            aria-modal="true"
                        >
                            <div
                                className={themeClass(theme, {
                                    dark: 'absolute inset-y-0 left-0 w-full max-w-sm border-r border-zinc-800/90 bg-zinc-950/98 p-0 shadow-[8px_0_48px_-8px_rgba(0,0,0,0.5)]',
                                    light: 'absolute inset-y-0 left-0 w-full max-w-sm border-r border-zinc-200/90 bg-white p-0 shadow-[8px_0_48px_-12px_rgba(0,0,0,0.08)]',
                                })}
                                onClick={e => e.stopPropagation()}
                            >
                                <FilterPanel
                                    filters={filters}
                                    baselineFilters={baselineFilters}
                                    summary={dataSummary}
                                    onFilterChange={handleFilterChange}
                                    matchCount={filterPanelMatchCount}
                                    totalCount={allData.length}
                                    onClose={() => setFilterPanelOpen(false)}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}

                    <aside className="hidden w-full shrink-0 lg:block lg:w-[min(100%,20rem)] lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
                        <FilterPanel
                            filters={filters}
                            baselineFilters={baselineFilters}
                            summary={dataSummary}
                            onFilterChange={handleFilterChange}
                            matchCount={filterPanelMatchCount}
                            totalCount={allData.length}
                            theme={theme}
                        />
                    </aside>

                    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-8 lg:overflow-hidden">
                        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-6 lg:overflow-y-auto">
                            <div className="shrink-0 space-y-2">
                                <h2
                                    className={themeClass(theme, {
                                        dark: 'font-display text-lg font-semibold tracking-tight text-zinc-50',
                                        light: 'font-display text-lg font-semibold tracking-tight text-zinc-900',
                                    })}
                                >
                                    Визуализации
                                </h2>
                                <p
                                    className={themeClass(theme, {
                                        dark: 'max-w-xl text-sm leading-relaxed text-zinc-500',
                                        light: 'max-w-xl text-sm leading-relaxed text-zinc-600',
                                    })}
                                >
                                    Холст обновляется по текущим фильтрам. На широком экране панель настроек справа, на узком — ниже холста.
                                </p>
                            </div>
                            <div className="relative min-h-[min(60vh,28rem)] flex-1">
                                {isChartUpdating && (
                                    <div
                                        className={themeClass(theme, {
                                            dark: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm',
                                            light: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-zinc-200/90 bg-white/90 backdrop-blur-sm',
                                        })}
                                    >
                                        <div className="flex flex-col items-center gap-3 text-sm">
                                            <svg
                                                className={themeClass(theme, {
                                                    dark: 'h-7 w-7 animate-spin text-indigo-400',
                                                    light: 'h-7 w-7 animate-spin text-indigo-600',
                                                })}
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                            >
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path
                                                    className="opacity-75"
                                                    fill="currentColor"
                                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                ></path>
                                            </svg>
                                            <span
                                                className={themeClass(theme, {
                                                    dark: 'text-xs font-medium tracking-wide text-zinc-400',
                                                    light: 'text-xs font-medium tracking-wide text-zinc-600',
                                                })}
                                            >
                                                Обновляем визуализации...
                                            </span>
                                        </div>
                                    </div>
                                )}
                                <DynamicChartGrid
                                    data={deferredFilteredData}
                                    charts={deferredUserCharts}
                                    summary={dataSummary}
                                    theme={theme}
                                />
                            </div>
                        </div>
                        <aside className="w-full shrink-0 lg:w-[min(100%,22rem)] lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto xl:w-96">
                            <ChartSidebar
                                summary={dataSummary}
                                charts={userCharts}
                                onChange={handleChartsChange}
                                disabled={isPending}
                                theme={theme}
                            />
                        </aside>
                    </section>
                </main>
            </div>
            {toast && (
                <div
                    role="status"
                    className={themeClass(theme, {
                        dark: 'fixed bottom-8 left-1/2 z-[100] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-center text-sm font-medium text-zinc-100 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.6)]',
                        light: 'fixed bottom-8 left-1/2 z-[100] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-center text-sm font-medium text-zinc-900 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.12)]',
                    })}
                >
                    {toast}
                </div>
            )}
        </div>
    );
}

export default App;
