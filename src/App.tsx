import React, { useState, useCallback, useMemo, useTransition, useDeferredValue, useEffect, useRef } from 'react';
import type { DataRow, DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import { INITIAL_APP_STATE, createDefaultFiltersFromSummary, rowPassesFilters } from '@/domain/filters';
import { defaultChartsForSummary } from '@/domain/chartDefaults';
import type { Theme } from '@/theme';
import { readPreferredTheme, themeClass } from '@/theme';
import { importCsvFile } from '@/utils/csvImport';
import { FileUpload } from '@/components/FileUpload';
import { FilterPanel } from '@/components/FilterPanel';
import { ChartBuilderPanel } from '@/components/ChartBuilderPanel';
import { DashboardStats } from '@/components/DashboardStats';
import { DynamicChartGrid } from '@/components/DynamicChartGrid';
import { FilterIcon } from '@/components/icons';

function App() {
    const [theme, setTheme] = useState<Theme>(() => readPreferredTheme());
    const replaceFileInputRef = useRef<HTMLInputElement>(null);
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

    const toggleTheme = useCallback(() => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    }, []);

    const handleDataLoaded = useCallback((data: DataRow[], summary: DataSummary) => {
        startTransition(() => {
            const defaultFilters = createDefaultFiltersFromSummary(summary);
            setAllData(data);
            setDataSummary(summary);
            setFilters(defaultFilters);
            setBaselineFilters(defaultFilters);
            setUserCharts(defaultChartsForSummary(summary));
        });
    }, [startTransition]);

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

    const deferredFilteredData = useDeferredValue(filteredData);
    const isChartUpdating =
        isPending ||
        deferredFilteredData !== filteredData ||
        deferredUserCharts !== userCharts;

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
                <div className="flex flex-col items-center gap-4">
                    <svg className="h-10 w-10 animate-spin text-cyan-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-sm font-medium text-slate-300">Обработка данных…</p>
                </div>
            </div>
        );
    }

    if (!allData || !dataSummary || !filters || !baselineFilters) {
        return <FileUpload onDataLoaded={handleDataLoaded} setLoading={setLoading} />;
    }

    return (
        <div className={themeClass(theme, {
            dark: 'relative min-h-screen w-full overflow-hidden bg-slate-950 text-slate-200',
            light: 'relative min-h-screen w-full overflow-hidden bg-slate-100 text-slate-900',
        })}>
            <div className={themeClass(theme, {
                dark: 'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.15),transparent_55%)]',
                light: 'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_60%)]',
            })}></div>
            <div className={themeClass(theme, {
                dark: 'pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.15),transparent_60%)]',
                light: 'pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(165,243,252,0.2),transparent_65%)]',
            })}></div>

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-8 px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
                <header className={themeClass(theme, {
                    dark: 'flex flex-col gap-6 rounded-2xl border border-slate-800/70 bg-slate-950/75 p-6 shadow-lg shadow-black/25 sm:p-8',
                    light: 'flex flex-col gap-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-md shadow-slate-200/80 sm:p-8',
                })}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                        <div className="min-w-0 space-y-2">
                            <h1 className={`font-display ${themeClass(theme, {
                                dark: 'text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl',
                                light: 'text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-4xl',
                            })}`}>
                                Аналитический дашборд недвижимости
                            </h1>
                            <p className={themeClass(theme, {
                                dark: 'max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-[15px]',
                                light: 'max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]',
                            })}>
                                Загрузите CSV и соберите графики из любых столбцов: гистограммы, точечные диаграммы и распределение по категориям.
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
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
                                onClick={() => replaceFileInputRef.current?.click()}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-full border border-slate-600/80 bg-slate-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200 transition hover:border-teal-500/50 hover:bg-slate-900',
                                    light: 'inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-700 transition hover:border-teal-400/60 hover:bg-slate-50',
                                })}
                            >
                                Загрузить другой CSV
                            </button>
                            <button
                                type="button"
                                onClick={toggleTheme}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200 transition hover:border-cyan-500/60 hover:bg-slate-900',
                                    light: 'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-600 transition hover:border-cyan-400/50 hover:bg-slate-50',
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
                                dark: 'inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-1 text-xs uppercase tracking-widest text-cyan-200',
                                light: 'inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-200/40 px-4 py-1 text-xs uppercase tracking-widest text-cyan-700',
                            })}>
                                Произвольные столбцы CSV
                            </div>
                        </div>
                    </div>
                    <DashboardStats data={deferredFilteredData} summary={dataSummary} theme={theme} />
                </header>

                <div className="lg:hidden">
                    <button
                        type="button"
                        onClick={() => setFilterPanelOpen(true)}
                        className={themeClass(theme, {
                            dark: 'w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-3 text-sm font-medium text-white shadow-md shadow-black/20 transition hover:border-cyan-500/70 hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/60',
                            light: 'w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-md shadow-slate-200 transition hover:border-cyan-400/60 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50',
                        })}
                        aria-label="Открыть фильтры"
                    >
                        <FilterIcon />
                        <span>Фильтры</span>
                    </button>
                </div>

                <main className="flex min-h-0 flex-1 flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-8 xl:gap-10">
                    {isFilterPanelOpen && (
                        <div
                            className={themeClass(theme, {
                                dark: 'fixed inset-0 z-40 bg-black/60 backdrop-blur',
                                light: 'fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm',
                            })}
                            onClick={() => setFilterPanelOpen(false)}
                            role="dialog"
                            aria-modal="true"
                        >
                            <div
                                className={themeClass(theme, {
                                    dark: 'absolute inset-y-0 left-0 w-full max-w-sm bg-slate-950/95 p-0 shadow-2xl',
                                    light: 'absolute inset-y-0 left-0 w-full max-w-sm bg-white p-0 shadow-2xl',
                                })}
                                onClick={e => e.stopPropagation()}
                            >
                                <FilterPanel
                                    filters={filters}
                                    baselineFilters={baselineFilters}
                                    summary={dataSummary}
                                    onFilterChange={handleFilterChange}
                                    onClose={() => setFilterPanelOpen(false)}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}

                    <aside className="hidden w-full shrink-0 lg:block lg:w-72 lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
                        <FilterPanel
                            filters={filters}
                            baselineFilters={baselineFilters}
                            summary={dataSummary}
                            onFilterChange={handleFilterChange}
                            theme={theme}
                        />
                    </aside>

                    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-6 lg:overflow-y-auto">
                        <ChartBuilderPanel
                            summary={dataSummary}
                            charts={userCharts}
                            onChange={handleChartsChange}
                            disabled={isPending}
                            theme={theme}
                        />
                        {isChartUpdating && (
                            <div className={themeClass(theme, {
                                dark: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-cyan-500/40 bg-slate-900/70 backdrop-blur-sm',
                                light: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-cyan-400/40 bg-white/80 backdrop-blur-sm',
                            })}>
                                <div className="flex flex-col items-center gap-3 text-slate-200 text-sm">
                                    <svg className={themeClass(theme, {
                                        dark: 'h-7 w-7 animate-spin text-cyan-400',
                                        light: 'h-7 w-7 animate-spin text-cyan-500',
                                    })} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span className={themeClass(theme, {
                                        dark: 'text-xs uppercase tracking-widest text-cyan-200/80',
                                        light: 'text-xs uppercase tracking-widest text-cyan-600/80',
                                    })}>
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
                    </section>
                </main>
            </div>
        </div>
    );
}

export default App;
