import React, { useState, useCallback, useMemo, useTransition, useDeferredValue, useEffect, useRef } from 'react';
import type { DataRow, DataSummary, FilterSettings, UserChartDefinition, DatasetMeta } from '@/types';
import {
    INITIAL_APP_STATE,
    createDefaultFiltersFromSummary,
    readPersonalCacheState,
    rowPassesFilters,
} from '@/domain/filters';
import { refreshSummaryFromData } from '@/domain/dataset';
import { mergeDatasetRows } from '../shared/mergeDatasetRows';
import { defaultChartsForSummary } from '@/domain/chartDefaults';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { useThemePreferences } from '@/hooks/useThemePreferences';
import { ThemeControls } from '@/components/ThemeControls';
import { importCsvFile } from '@/utils/csvImport';
import { FileUpload } from '@/components/FileUpload';
import { FilterPanel } from '@/components/FilterPanel';
import { ChartSidebar } from '@/components/ChartSidebar';
import { DashboardStats } from '@/components/DashboardStats';
import { DynamicChartGrid } from '@/components/DynamicChartGrid';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { FilterIcon } from '@/components/icons';
import { persistDatasetUiState } from '@/persistence/uiSettings';
import { columnSignature } from '@/utils/sanitizeDashboardState';
import { resolveDashboardStateForSummary, buildShareableUrl } from '@/utils/dashboardStateResolve';
import { copyTextToClipboard } from '@/utils/shareState';
import { useAuth } from '@/auth';
import { LoginScreen } from '@/components/LoginScreen';
import { ManagerConsole } from '@/components/ManagerConsole';
import { FilteredListingsTable } from '@/components/FilteredListingsTable';
import { roleLabel } from '@/roles';
import { ObjectsMap } from '@/components/ObjectsMap';
import { SegmentComparison } from '@/components/SegmentComparison';
import type { DataSourceMode } from '@/domain/dataSource';
import { clearDataSourceMode, loadDataSourceMode, saveDataSourceMode } from '@/domain/dataSource';
import { applyListingQualityFilter } from '@/domain/qualityFilter';
import { getRoleCapabilities } from '@/domain/roleCapabilities';
import { fetchDatasetCities, fetchDatasetMeta, fetchServerBootstrap } from '@/api/dataset';
import { DataSourcePicker } from '@/components/DataSourcePicker';
import { DatasetSourceBadge } from '@/components/DatasetSourceBadge';
import { ServerDataEmpty } from '@/components/ServerDataEmpty';
import { AdminSetupView } from '@/components/AdminSetupView';
import { ObserverListingsPreview } from '@/components/ObserverListingsPreview';
import { AdminServerPanel } from '@/components/AdminServerPanel';
import { AdminParserPanel } from '@/components/AdminParserPanel';
import { CitySwitcher } from '@/components/CitySwitcher';
import type { CityId } from '@/domain/city';
import { loadPreferredCityId, pickInitialCityId, savePreferredCityId, type CityListItem } from '@/domain/city';
import { CONTROL_CHIP_BASE } from '@/components/controlStyles';

type LoadPhase = 'idle' | 'loading' | 'pick-source' | 'need-personal' | 'server-empty' | 'admin-setup' | 'ready';
const IS_DEV = import.meta.env.DEV;

function App() {
    const { user, token, logout } = useAuth();
    const caps = useMemo(() => (user ? getRoleCapabilities(user.role) : null), [user]);

    const { theme, themeMode, colorScheme, cycleThemeMode, cycleColorScheme, setTheme } = useThemePreferences();
    const replaceFileInputRef = useRef<HTMLInputElement>(null);
    const dataHydratedSig = useRef<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [isLoading, setLoading] = useState<boolean>(false);
    const [loadPhase, setLoadPhase] = useState<LoadPhase>('idle');
    const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode | null>(null);
    const [serverMeta, setServerMeta] = useState<DatasetMeta | null>(null);
    const [personalFileKey, setPersonalFileKey] = useState<string | null>(null);
    const [refreshingServer, setRefreshingServer] = useState(false);
    const [cityList, setCityList] = useState<CityListItem[]>([]);
    const [selectedCityId, setSelectedCityId] = useState<CityId | null>(null);

    const [allData, setAllData] = useState<DataRow[] | null>(INITIAL_APP_STATE.allData);
    const [dataSummary, setDataSummary] = useState<DataSummary | null>(INITIAL_APP_STATE.dataSummary);
    const [filters, setFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.filters);
    const [baselineFilters, setBaselineFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.baselineFilters);
    const [isFilterPanelOpen, setFilterPanelOpen] = useState(false);
    const [userCharts, setUserCharts] = useState<UserChartDefinition[]>([]);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 3200);
        return () => clearTimeout(t);
    }, [toast]);

    const applyDataset = useCallback(
        (data: DataRow[], summary: DataSummary, fileKey: string | null) => {
            const { rows: mergedRows } = mergeDatasetRows(data);
            const mergedSummary = refreshSummaryFromData(mergedRows, summary);
            const { rows: qualityRows } = applyListingQualityFilter(mergedRows, mergedSummary);
            const refreshed = refreshSummaryFromData(qualityRows, mergedSummary);
            dataHydratedSig.current = columnSignature(refreshed);
            const chosen = resolveDashboardStateForSummary(refreshed);
            const charts =
                caps && !caps.canUseChartConstructor
                    ? defaultChartsForSummary(refreshed)
                    : chosen.userCharts;
            startTransition(() => {
                setAllData(qualityRows);
                setDataSummary(refreshed);
                setFilters(chosen.filters);
                setBaselineFilters(createDefaultFiltersFromSummary(refreshed));
                setUserCharts(charts);
                setPersonalFileKey(fileKey);
                setLoadPhase('ready');
                if (chosen.theme) {
                    setTheme(chosen.theme);
                }
                if (chosen.toast) setToast(chosen.toast);
            });
        },
        [startTransition, caps]
    );

    const loadServerDataset = useCallback(
        async (cityId: CityId, opts?: { silent?: boolean }) => {
            if (!token) return;
            if (!opts?.silent) setLoadPhase('loading');
            else setRefreshingServer(true);
            try {
                const metaResp = await fetchDatasetMeta(token, cityId);
                if (metaResp) setServerMeta(metaResp.meta);

                const boot = await fetchServerBootstrap(token, cityId);
                if (!boot.ok) {
                    setAllData(null);
                    setDataSummary(null);
                    setFilters(null);
                    setBaselineFilters(null);
                    if (caps?.canViewAdminServerPanel) {
                        if (boot.error) setToast(boot.error);
                        setLoadPhase('admin-setup');
                        return;
                    }
                    if (boot.status === 404) {
                        setLoadPhase('server-empty');
                        return;
                    }
                    setToast(boot.error);
                    setLoadPhase('server-empty');
                    return;
                }
                applyDataset(boot.data.rows, boot.data.summary, null);
            } catch {
                setToast('Сервер недоступен — запустите npm run dev:api');
                setLoadPhase(caps?.canViewAdminServerPanel ? 'admin-setup' : 'server-empty');
            } finally {
                if (!opts?.silent) setLoading(false);
                setRefreshingServer(false);
            }
        },
        [token, applyDataset, caps]
    );

    const refreshCityList = useCallback(async () => {
        if (!token) return [];
        const cities = await fetchDatasetCities(token);
        setCityList(cities);
        return cities;
    }, [token]);

    useEffect(() => {
        if (!user) {
            setLoadPhase('idle');
            setDataSourceMode(null);
            setAllData(null);
            setDataSummary(null);
            setFilters(null);
            setBaselineFilters(null);
            setSelectedCityId(null);
            setServerMeta(null);
            setLoading(false);
            return;
        }
        if (!token || !caps) {
            setLoadPhase('idle');
            return;
        }

        let cancelled = false;

        (async () => {
            const cities = await refreshCityList();
            if (cancelled) return;
            const cityId = pickInitialCityId(cities, loadPreferredCityId());
            if (!cityId) {
                setLoadPhase('server-empty');
                return;
            }
            setSelectedCityId(cityId);
            savePreferredCityId(cityId);

            if (caps.forceServerSource) {
                setDataSourceMode('server');
                saveDataSourceMode('server');
                if (!cancelled) await loadServerDataset(cityId);
                return;
            }

            const stored = loadDataSourceMode();
            if (!stored) {
                if (!cancelled) setLoadPhase('pick-source');
                return;
            }

            if (!cancelled) setDataSourceMode(stored);

            if (stored === 'server') {
                if (!cancelled) await loadServerDataset(cityId);
                return;
            }

            const cached = readPersonalCacheState();
            if (cached.allData && cached.dataSummary && cached.filters && cached.baselineFilters) {
                if (!cancelled) {
                    dataHydratedSig.current = columnSignature(cached.dataSummary);
                    const chosen = resolveDashboardStateForSummary(cached.dataSummary);
                    setAllData(cached.allData);
                    setDataSummary(cached.dataSummary);
                    setFilters(cached.filters);
                    setBaselineFilters(cached.baselineFilters);
                    setUserCharts(chosen.userCharts);
                    setPersonalFileKey(cached.fileKey);
                    setLoadPhase('ready');
                }
                return;
            }

            if (!cancelled) setLoadPhase('need-personal');
        })();

        return () => {
            cancelled = true;
        };
    }, [user, token, caps, loadServerDataset, refreshCityList]);

    const handleCityChange = useCallback(
        (cityId: CityId) => {
            setSelectedCityId(cityId);
            savePreferredCityId(cityId);
            if (
                dataSourceMode === 'server' ||
                caps?.forceServerSource ||
                loadPhase === 'server-empty' ||
                loadPhase === 'admin-setup'
            ) {
                void loadServerDataset(cityId);
            }
        },
        [dataSourceMode, caps, loadServerDataset, loadPhase]
    );

    const handleUsePersonalFromEmpty = useCallback(() => {
        saveDataSourceMode('personal');
        setDataSourceMode('personal');
        const cached = readPersonalCacheState();
        if (cached.allData && cached.dataSummary && cached.filters && cached.baselineFilters) {
            setAllData(cached.allData);
            setDataSummary(cached.dataSummary);
            setFilters(cached.filters);
            setBaselineFilters(cached.baselineFilters);
            setPersonalFileKey(cached.fileKey);
            setLoadPhase('ready');
        } else {
            setLoadPhase('need-personal');
        }
    }, []);

    useEffect(() => {
        if (!dataSummary || !allData?.length) return;
        const sig = columnSignature(dataSummary);
        if (dataHydratedSig.current === sig) return;
        dataHydratedSig.current = sig;
        const chosen = resolveDashboardStateForSummary(dataSummary);
        const charts =
            caps && !caps.canUseChartConstructor
                ? defaultChartsForSummary(dataSummary)
                : chosen.userCharts;
        startTransition(() => {
            setFilters(chosen.filters);
            setBaselineFilters(createDefaultFiltersFromSummary(dataSummary));
            setUserCharts(charts);
            if (chosen.theme) {
                setTheme(chosen.theme);
            }
            if (chosen.toast) setToast(chosen.toast);
        });
    }, [dataSummary, allData, startTransition, caps]);

    useEffect(() => {
        if (!dataSummary || !filters || dataSourceMode !== 'personal') return;
        const t = window.setTimeout(() => {
            persistDatasetUiState(dataSummary, filters, userCharts);
        }, 450);
        return () => clearTimeout(t);
    }, [dataSummary, filters, userCharts, dataSourceMode]);

    const handleDataLoaded = useCallback(
        (data: DataRow[], summary: DataSummary, file?: File) => {
            if (file) setPersonalFileKey(`${file.name}|${file.size}|${file.lastModified}`);
            applyDataset(data, summary, file ? `${file.name}|${file.size}|${file.lastModified}` : personalFileKey);
        },
        [applyDataset, personalFileKey]
    );

    const handlePickSource = useCallback(
        (mode: DataSourceMode) => {
            saveDataSourceMode(mode);
            setDataSourceMode(mode);
            if (mode === 'server') {
                const cityId = selectedCityId ?? pickInitialCityId(cityList, loadPreferredCityId());
                if (cityId) void loadServerDataset(cityId);
            } else {
                const cached = readPersonalCacheState();
                if (cached.allData && cached.dataSummary && cached.filters && cached.baselineFilters) {
                    setAllData(cached.allData);
                    setDataSummary(cached.dataSummary);
                    setFilters(cached.filters);
                    setBaselineFilters(cached.baselineFilters);
                    setPersonalFileKey(cached.fileKey);
                    setLoadPhase('ready');
                } else {
                    setLoadPhase('need-personal');
                }
            }
        },
        [loadServerDataset, selectedCityId, cityList]
    );

    const handleChangeSource = useCallback(() => {
        setAllData(null);
        setDataSummary(null);
        setFilters(null);
        setBaselineFilters(null);
        setUserCharts([]);
        clearDataSourceMode();
        setDataSourceMode(null);
        setLoadPhase('pick-source');
    }, []);

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
        }
        const ok = await copyTextToClipboard(url);
        setToast(ok ? 'Ссылка скопирована в буфер обмена' : 'Не удалось скопировать ссылку');
    }, [dataSummary, filters, theme, userCharts]);

    const handleFilterChange = useCallback((newFilters: FilterSettings) => {
        startTransition(() => setFilters(newFilters));
    }, [startTransition]);

    const handleChartsChange = useCallback((next: UserChartDefinition[]) => {
        startTransition(() => setUserCharts(next));
    }, [startTransition]);

    const handleLoadAnotherCsv = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) {
                importCsvFile(file, (data, summary) => handleDataLoaded(data, summary, file), setLoading);
            }
            event.target.value = '';
        },
        [handleDataLoaded]
    );

    const deferredFilters = useDeferredValue(filters);
    const deferredUserCharts = useDeferredValue(userCharts);
    const cityOptions = useMemo(
        () => cityList.map(c => ({ id: c.id, label: c.label, hasData: c.hasData })),
        [cityList]
    );
    const selectedCityLabel = useMemo(
        () => cityList.find(c => c.id === selectedCityId)?.label,
        [cityList, selectedCityId]
    );

    const filteredData = useMemo(() => {
        if (!allData || !deferredFilters || !dataSummary) return [];
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const out: DataRow[] = [];
        for (const row of allData) {
            if (rowPassesFilters(row, deferredFilters, dataSummary)) out.push(row);
        }
        if (IS_DEV) {
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
            if (elapsed > 4) {
                // eslint-disable-next-line no-console
                console.info('[perf] app:filter-pass', {
                    rowsIn: allData.length,
                    rowsOut: out.length,
                    elapsedMs: Number(elapsed.toFixed(1)),
                });
            }
        }
        return out;
    }, [allData, deferredFilters, dataSummary]);

    const filterPanelMatchCount = filteredData.length;

    const deferredFilteredData = useDeferredValue(filteredData);
    const isChartUpdating =
        isPending ||
        deferredFilteredData !== filteredData ||
        deferredUserCharts !== userCharts;

    if (!user) {
        return <LoginScreen />;
    }

    if (user.role === 'manager') {
        return <ManagerConsole />;
    }

    if (loadPhase === 'pick-source' && caps?.canPickDataSource) {
        return <DataSourcePicker theme={theme} onChoose={handlePickSource} />;
    }

    if (loadPhase === 'loading' || isLoading) {
        return <DashboardSkeleton message="Загрузка данных…" />;
    }

    if (loadPhase === 'admin-setup' && caps?.canViewAdminServerPanel && selectedCityId && token) {
        const cityLabel = cityList.find(c => c.id === selectedCityId)?.label ?? selectedCityId;
        return (
            <AdminSetupView
                theme={theme}
                role={user.role}
                cityId={selectedCityId}
                cityLabel={cityLabel}
                cities={cityOptions}
                meta={serverMeta}
                onCityChange={handleCityChange}
                onMetaChange={setServerMeta}
                onToast={setToast}
                onServerChanged={() => {
                    void refreshCityList();
                    void loadServerDataset(selectedCityId, { silent: true });
                }}
                onIngested={() => {
                    void refreshCityList();
                    void loadServerDataset(selectedCityId, { silent: true });
                }}
                onLogout={logout}
            />
        );
    }

    if (loadPhase === 'server-empty') {
        const cityLabel = cityList.find(c => c.id === selectedCityId)?.label;
        return (
            <ServerDataEmpty
                theme={theme}
                cityLabel={cityLabel}
                cities={cityOptions}
                selectedCityId={selectedCityId}
                onCityChange={handleCityChange}
                onUsePersonalCsv={caps?.canPickDataSource ? handleUsePersonalFromEmpty : undefined}
                onLogout={logout}
            />
        );
    }

    if (loadPhase === 'need-personal' && caps?.canUploadPersonalCsv) {
        return <FileUpload onDataLoaded={(d, s) => handleDataLoaded(d, s)} setLoading={setLoading} />;
    }

    if (!allData || !dataSummary || !filters || !baselineFilters || loadPhase !== 'ready') {
        return <DashboardSkeleton message="Подготовка дашборда…" />;
    }

    const headerSubtitle = caps?.forceServerSource
        ? 'Обзор рынка объявлений: фильтры, KPI, карта и карточки объектов.'
        : dataSourceMode === 'server'
          ? 'Анализ серверного снимка рынка с полным набором инструментов.'
          : 'Загрузите CSV и соберите графики из любых столбцов.';

    return (
        <div
            className={themeClass(theme, {
                dark: 'relative min-h-screen w-full overflow-hidden bg-zinc-950 text-zinc-200',
                light: 'relative min-h-screen w-full overflow-hidden bg-zinc-50 text-zinc-900',
            })}
        >
            <div
                className={themeClass(theme, {
                    dark: 'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.07),transparent)]',
                    light: 'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.06),transparent)]',
                })}
            />
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1580px] flex-col gap-10 px-5 pb-14 pt-8 sm:px-8 sm:pt-10 lg:gap-12 lg:px-12 lg:pb-16 lg:pt-12">
                <header
                    className={themeClass(theme, {
                        dark: 'flex flex-col gap-8 rounded-[1.75rem] border border-zinc-800/80 bg-zinc-950/70 p-8 shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:p-10 lg:p-12',
                        light: 'flex flex-col gap-8 rounded-[1.75rem] border border-zinc-200/90 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_20px_50px_-20px_rgba(0,0,0,0.08)] sm:p-10 lg:p-12',
                    })}
                >
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between xl:gap-8">
                        <div className="min-w-0 flex-1 space-y-3">
                            <h1
                                className={`font-display ${themeClass(theme, {
                                    dark: 'text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl lg:text-[2rem]',
                                    light: 'text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl lg:text-[2rem]',
                                })}`}
                            >
                                Аналитический дашборд недвижимости
                            </h1>
                            <p
                                className={themeClass(theme, {
                                    dark: 'max-w-2xl text-[15px] leading-relaxed text-zinc-400',
                                    light: 'max-w-2xl text-[15px] leading-relaxed text-zinc-600',
                                })}
                            >
                                {headerSubtitle}
                            </p>
                            <div className="flex min-w-0 flex-wrap items-center gap-2.5 xl:flex-nowrap xl:items-center xl:gap-3">
                                <span
                                    className={themeClass(theme, {
                                        dark: `${CONTROL_CHIP_BASE} border border-indigo-500/30 bg-indigo-500/10 text-indigo-200`,
                                        light: `${CONTROL_CHIP_BASE} border border-indigo-200 bg-indigo-50 text-indigo-800`,
                                    })}
                                >
                                    {roleLabel(user.role)}
                                </span>
                                <CitySwitcher
                                    theme={theme}
                                    cities={cityOptions}
                                    value={selectedCityId}
                                    onChange={handleCityChange}
                                    disabled={isLoading || loadPhase === 'loading'}
                                />
                                <div className="min-w-0 xl:flex-1">
                                    <DatasetSourceBadge
                                        theme={theme}
                                        role={user.role}
                                        mode={dataSourceMode ?? 'server'}
                                        rowCount={allData.length}
                                        meta={serverMeta}
                                        cityLabel={selectedCityLabel}
                                        personalFileKey={personalFileKey}
                                        onChangeSource={caps?.canPickDataSource ? handleChangeSource : undefined}
                                        onRefreshServer={
                                            caps?.canRefreshFromServer &&
                                            dataSourceMode === 'server' &&
                                            selectedCityId
                                                ? () => void loadServerDataset(selectedCityId, { silent: true })
                                                : undefined
                                        }
                                        refreshing={refreshingServer}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex w-full flex-wrap gap-2.5 xl:w-auto xl:shrink-0 xl:flex-nowrap xl:justify-end">
                            <button
                                type="button"
                                onClick={handleShare}
                                className={themeClass(theme, {
                                    dark: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-500/35 bg-indigo-500/[0.12] px-4 text-sm font-medium text-indigo-100 transition hover:border-indigo-400/45 hover:bg-indigo-500/[0.18]',
                                    light: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 text-sm font-medium text-indigo-900 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50',
                                })}
                            >
                                Поделиться
                            </button>
                            {caps?.canUploadPersonalCsv && dataSourceMode === 'personal' && (
                                <>
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
                                        disabled={isLoading}
                                        onClick={() => replaceFileInputRef.current?.click()}
                                        className={themeClass(theme, {
                                            dark: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-700/90 bg-zinc-900/80 px-4 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
                                            light: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
                                        })}
                                    >
                                        {isLoading ? 'Обработка CSV…' : 'Загрузить другой CSV'}
                                    </button>
                                </>
                            )}
                            <ThemeControls
                                theme={theme}
                                themeMode={themeMode}
                                colorScheme={colorScheme}
                                onCycleScheme={cycleColorScheme}
                                onCycleThemeMode={cycleThemeMode}
                                className="xl:flex-nowrap"
                            />
                            <button type="button" onClick={logout} className={themeClass(theme, {
                                dark: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900',
                                light: 'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50',
                            })}>
                                Выйти
                            </button>
                        </div>
                    </div>
                    {caps?.showMarketOverview && (
                        <DashboardStats
                            data={deferredFilteredData}
                            baselineData={allData}
                            summary={dataSummary}
                            theme={theme}
                            colorScheme={colorScheme}
                        />
                    )}
                </header>

                {caps?.canViewAdminServerPanel && token && selectedCityId && (
                    <>
                        <AdminParserPanel
                            theme={theme}
                            cityId={selectedCityId}
                            onToast={setToast}
                            onIngested={() => {
                                void refreshCityList();
                                if (dataSourceMode === 'server') void loadServerDataset(selectedCityId, { silent: true });
                            }}
                        />
                        <AdminServerPanel
                            theme={theme}
                            cityId={selectedCityId}
                            meta={serverMeta}
                            onMetaChange={setServerMeta}
                            onToast={setToast}
                            onServerChanged={() => {
                                void refreshCityList();
                                if (dataSourceMode === 'server') void loadServerDataset(selectedCityId, { silent: true });
                            }}
                        />
                    </>
                )}

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

                <main className="flex min-h-0 flex-1 flex-col gap-10">
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
                                    allData={allData}
                                    onFilterChange={handleFilterChange}
                                    matchCount={filterPanelMatchCount}
                                    totalCount={allData.length}
                                    onClose={() => setFilterPanelOpen(false)}
                                    theme={theme}
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex min-h-0 flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-8 xl:gap-12">
                        <aside className="hidden w-full shrink-0 lg:block lg:w-[min(100%,20rem)] lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
                            <FilterPanel
                                filters={filters}
                                baselineFilters={baselineFilters}
                                summary={dataSummary}
                                allData={allData}
                                onFilterChange={handleFilterChange}
                                matchCount={filterPanelMatchCount}
                                totalCount={allData.length}
                                theme={theme}
                            />
                        </aside>

                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-8">
                            <section className="relative flex min-h-0 min-w-0 flex-col gap-6">
                                <div className="shrink-0 space-y-2">
                                    <h2
                                        className={themeClass(theme, {
                                            dark: 'font-display text-lg font-semibold tracking-tight text-zinc-50',
                                            light: 'font-display text-lg font-semibold tracking-tight text-zinc-900',
                                        })}
                                    >
                                        {caps?.canUseChartConstructor ? 'Визуализации' : 'Обзор рынка'}
                                    </h2>
                                </div>
                                <div className="relative flex min-h-[min(60vh,28rem)] min-w-0 flex-1 flex-col lg:overflow-y-auto">
                                    {isChartUpdating && (
                                        <div
                                            className={themeClass(theme, {
                                                dark: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm',
                                                light: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-zinc-200/90 bg-white/90 backdrop-blur-sm',
                                            })}
                                        >
                                            <span className="text-xs text-zinc-500">Обновляем визуализации…</span>
                                        </div>
                                    )}
                                    <DynamicChartGrid
                                        key={`${theme}-${colorScheme}`}
                                        data={deferredFilteredData}
                                        charts={deferredUserCharts}
                                        summary={dataSummary}
                                        theme={theme}
                                        colorScheme={colorScheme}
                                    />
                                </div>
                            </section>

                            <SegmentComparison data={deferredFilteredData} summary={dataSummary} theme={theme} />
                        </div>

                        {caps?.canUseChartConstructor && (
                            <aside className="w-full shrink-0 lg:w-[22rem] lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden">
                                <ChartSidebar
                                    summary={dataSummary}
                                    charts={userCharts}
                                    onChange={handleChartsChange}
                                    disabled={isPending}
                                    theme={theme}
                                />
                            </aside>
                        )}
                    </div>

                    <div className="grid min-w-0 gap-8 lg:grid-cols-2">
                        <div className="min-w-0">
                            <ObjectsMap
                                markerData={deferredFilteredData}
                                summary={dataSummary}
                                theme={theme}
                            />
                        </div>
                        <div className="min-w-0">
                            {caps?.showObserverListings && (
                                <ObserverListingsPreview
                                    data={deferredFilteredData}
                                    summary={dataSummary}
                                    theme={theme}
                                />
                            )}
                            {caps?.canUseFilteredTable && selectedCityId && (
                                <FilteredListingsTable
                                    data={deferredFilteredData}
                                    summary={dataSummary}
                                    theme={theme}
                                    filters={deferredFilters ?? filters}
                                    cityId={dataSourceMode === 'server' ? selectedCityId : undefined}
                                    onToast={setToast}
                                />
                            )}
                        </div>
                    </div>
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
