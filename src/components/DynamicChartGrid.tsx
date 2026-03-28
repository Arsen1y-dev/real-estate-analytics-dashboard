import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Brush } from 'recharts';
import { ScatterChartView } from '@/components/charts/ScatterChartView';
import type { DataRow, DataSummary, UserChartDefinition } from '@/types';
import type { Theme } from '@/theme';
import { themeClass, CHART_FILL, BAR_OPACITY_INACTIVE } from '@/theme';
import { formatNumber } from '@/utils/format';
import { median, quantile } from '@/utils/stats';
import { sampleArray, MAX_SCATTER_POINTS } from '@/utils/sample';
import { isFiniteNumber } from '@/domain/dataset';
import { ChartCard } from '@/components/ChartCard';
import { EmptyChartState } from '@/components/EmptyChartState';
import { CloseIcon } from '@/components/icons';
import { exportElementToPdf, exportElementToPng, slugifyFilenamePart } from '@/utils/chartExport';

const CATEGORY_DISPLAY_LIMIT = 35;

interface BinRange {
    min: number;
    max: number;
}

function getBinRange(start: number, binSize: number, index: number, bins: number, max: number): BinRange {
    const min = start + index * binSize;
    const maxBoundary = index === bins - 1 ? max : min + binSize;
    return { min, max: maxBoundary };
}

function formatBinTick(min: number, max: number): string {
    const span = max - min;
    if (span <= 0) return formatNumber(min);
    if (span < 0.5) return min.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
    if (span < 50) return min.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    return formatNumber(Math.round(min));
}

const HIST_BINS = 20;

function buildHistogram(
    values: number[],
    zoom: { min: number; max: number } | undefined
): { distribution: Array<{ name: string; count: number; range: BinRange }>; analysis: string; empty: boolean; coreHint: string } {
    if (!values.length) {
        return { distribution: [], analysis: '', empty: true, coreHint: '' };
    }

    if (zoom) {
        const { min: zMin, max: zMax } = zoom;
        const inRange = values.filter(v => v >= zMin && v <= zMax);
        if (!inRange.length) {
            return { distribution: [], analysis: '', empty: true, coreHint: '' };
        }
        const binStart = zMin;
        const binEnd = zMax;
        const range = binEnd - binStart || 1;
        const binSize = range / HIST_BINS;
        const distribution = Array.from({ length: HIST_BINS }, (_, index) => {
            const binRange = getBinRange(binStart, binSize, index, HIST_BINS, binEnd);
            return {
                name: formatBinTick(binRange.min, binRange.max),
                count: 0,
                range: binRange,
            };
        });
        for (const value of inRange) {
            const clamped = Math.min(binEnd, Math.max(binStart, value));
            const rawIndex = binSize === 0 ? 0 : Math.floor((clamped - binStart) / binSize);
            const binIndex = Math.min(HIST_BINS - 1, Math.max(0, rawIndex));
            distribution[binIndex].count += 1;
        }
        const med = median(inRange);
        const iqr = quantile(inRange, 0.75) - quantile(inRange, 0.25);
        const lo = zMin.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
        const hi = zMax.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
        const analysis =
            `Увеличенный интервал: ${lo} — ${hi}. ` +
            `Объектов: ${inRange.length}. Медиана: ${formatNumber(Math.round(med))}. IQR: ${formatNumber(Math.round(iqr))}.`;
        return { distribution, analysis, empty: false, coreHint: '' };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const qLo = quantile(values, 0.02);
    const qHi = quantile(values, 0.98);
    const spanCore = qHi - qLo;
    const useCore = spanCore > 0 && spanCore < (max - min || 1) * 0.95;
    const binStart = useCore ? qLo : min;
    const binEnd = useCore ? qHi : max;
    const range = binEnd - binStart || 1;
    const binSize = range / HIST_BINS;
    const distribution = Array.from({ length: HIST_BINS }, (_, index) => {
        const binRange = getBinRange(binStart, binSize, index, HIST_BINS, binEnd);
        return {
            name: formatNumber(binRange.min),
            count: 0,
            range: binRange,
        };
    });
    for (const value of values) {
        let binIndex: number;
        if (value < binStart) binIndex = 0;
        else if (value > binEnd) binIndex = HIST_BINS - 1;
        else {
            const rawIndex = binSize === 0 ? 0 : Math.floor((value - binStart) / binSize);
            binIndex = Number.isFinite(rawIndex) ? Math.min(HIST_BINS - 1, Math.max(0, rawIndex)) : 0;
        }
        distribution[binIndex].count += 1;
    }
    const coreHint = useCore ? ' Интервалы по 2–98% выборки, крайние столбцы — хвосты распределения.' : '';
    const analysis =
        `Объектов: ${values.length}. Медиана: ${formatNumber(Math.round(median(values)))}. IQR: ${formatNumber(Math.round(quantile(values, 0.75) - quantile(values, 0.25)))}.${coreHint}`;
    return { distribution, analysis, empty: false, coreHint };
}

export const DynamicChartGrid: React.FC<{
    data: DataRow[];
    charts: UserChartDefinition[];
    summary: DataSummary;
    theme: Theme;
}> = ({ data, charts, summary, theme }) => {
    const [expanded, setExpanded] = useState<UserChartDefinition | null>(null);
    const expandedExportRef = useRef<HTMLDivElement>(null);
    const [expandedExportBusy, setExpandedExportBusy] = useState(false);
    /** Клик по столбцу гистограммы — приближение к интервалу этого бина. */
    const [histZoomById, setHistZoomById] = useState<Record<string, { min: number; max: number }>>({});

    useEffect(() => {
        if (!expanded) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setExpanded(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [expanded]);

    const exportExpanded = useCallback(
        async (kind: 'png' | 'pdf') => {
            const el = expandedExportRef.current;
            if (!el || expandedExportBusy) return;
            const base = slugifyFilenamePart(expanded?.title ?? 'chart');
            setExpandedExportBusy(true);
            try {
                if (kind === 'png') await exportElementToPng(el, base, theme);
                else await exportElementToPdf(el, base, theme);
            } catch (e) {
                console.warn('[chart export]', e);
            } finally {
                setExpandedExportBusy(false);
            }
        },
        [expanded?.title, expandedExportBusy, theme]
    );

    const chartFillColor = CHART_FILL[theme];
    const axisTextColor = theme === 'dark' ? '#a1a1aa' : '#52525b';
    const gridColor = theme === 'dark' ? '#27272a' : '#e4e4e7';
    const tooltipStyle = theme === 'dark'
        ? { backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#e4e4e7' }
        : { backgroundColor: '#ffffff', border: '1px solid #e4e4e7', color: '#18181b' };
    const tooltipCursor = theme === 'dark' ? { fill: '#3f3f46', opacity: 0.12 } : { fill: '#f4f4f5', opacity: 0.85 };
    const scatterGridColor = theme === 'dark' ? '#27272a' : '#e4e4e7';

    const kindByColumn = useMemo(() => {
        const m = new Map<string, 'numeric' | 'categorical'>();
        for (const c of summary.columns) m.set(c.name, c.kind);
        return m;
    }, [summary.columns]);

    const renderChart = (def: UserChartDefinition): { content: React.ReactNode; analysis?: string; hasData: boolean } => {
        if (def.type === 'histogram') {
            const col = def.column;
            if (kindByColumn.get(col) !== 'numeric') {
                return { content: <EmptyChartState theme={theme} message={`Столбец «${col}» не числовой`} />, hasData: false };
            }
            const values = data.map(d => d[col]).filter(isFiniteNumber);
            if (!values.length) {
                return { content: <EmptyChartState theme={theme} />, hasData: false };
            }
            const zoom = histZoomById[def.id];
            const { distribution, analysis, empty, coreHint } = buildHistogram(values, zoom);
            const resetZoom = () => {
                setHistZoomById(prev => {
                    const next = { ...prev };
                    delete next[def.id];
                    return next;
                });
            };
            if (empty) {
                return {
                    hasData: false,
                    content: (
                        <div className="flex h-full min-h-[200px] flex-col gap-2">
                            {zoom && (
                                <button
                                    type="button"
                                    onClick={resetZoom}
                                    className={themeClass(theme, {
                                        dark: 'self-end rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800',
                                        light: 'self-end rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100',
                                    })}
                                >
                                    Весь диапазон
                                </button>
                            )}
                            <EmptyChartState theme={theme} message="В выбранном интервале нет значений. Сбросьте масштаб." />
                        </div>
                    ),
                };
            }
            const zoomHint = zoom
                ? ' Повторный клик по столбцу — ещё глубже. «Весь диапазон» — сброс.'
                : ' Клик по столбцу — приблизить к этому интервалу. Ползунок внизу — выбор диапазона бинов.';
            const fullAnalysis = `${analysis}${zoom ? '' : coreHint}${zoomHint}`;
            const histTotal = values.length;
            const brushFillHist = theme === 'dark' ? '#18181b' : '#fafafa';
            return {
                hasData: true,
                analysis: fullAnalysis,
                content: (
                    <div className="flex h-full min-h-[200px] flex-col gap-1">
                        {zoom && (
                            <button
                                type="button"
                                onClick={resetZoom}
                                className={themeClass(theme, {
                                    dark: 'self-end rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800',
                                    light: 'self-end rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100',
                                })}
                            >
                                Весь диапазон
                            </button>
                        )}
                        <div className="min-h-0 flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={distribution} margin={{ top: 8, right: 16, left: 8, bottom: 36 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                    <XAxis dataKey="name" stroke={axisTextColor} fontSize={11} tick={{ fill: axisTextColor }} interval="preserveStartEnd" />
                                    <YAxis stroke={axisTextColor} fontSize={11} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                                    <Tooltip
                                        cursor={tooltipCursor}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const row = payload[0]?.payload as { count?: number; range?: BinRange; name?: string };
                                            const r = row.range;
                                            const c = row.count ?? 0;
                                            const pct = histTotal > 0 ? ((c / histTotal) * 100).toFixed(1) : '0';
                                            const rangeLabel = r
                                                ? `${r.min.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} — ${r.max.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
                                                : String(row.name ?? '');
                                            return (
                                                <div
                                                    className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                                                    style={{ ...tooltipStyle, minWidth: '11rem' }}
                                                >
                                                    <p className="mb-1 font-semibold">Бин гистограммы</p>
                                                    <p className="mb-2 opacity-90">{rangeLabel}</p>
                                                    <p className="tabular-nums">
                                                        <span className="opacity-75">Объектов: </span>
                                                        <span className="font-medium">{formatNumber(c)}</span>
                                                        <span className="opacity-75"> ({pct}% от выборки)</span>
                                                    </p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar
                                        dataKey="count"
                                        fill={chartFillColor}
                                        fillOpacity={BAR_OPACITY_INACTIVE + 0.15}
                                        cursor="pointer"
                                        radius={[4, 4, 0, 0]}
                                        onClick={barItem => {
                                            const r = barItem?.payload?.range as BinRange | undefined;
                                            if (r && Number.isFinite(r.min) && Number.isFinite(r.max)) {
                                                setHistZoomById(prev => ({ ...prev, [def.id]: { min: r.min, max: r.max } }));
                                            }
                                        }}
                                    />
                                    <Brush
                                        dataKey="name"
                                        height={28}
                                        stroke={axisTextColor}
                                        fill={brushFillHist}
                                        fillOpacity={0.45}
                                        tickFormatter={(v: string | number) => (typeof v === 'string' ? v : String(v))}
                                        ariaLabel="Выбор диапазона по бинам"
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ),
            };
        }

        if (def.type === 'scatter') {
            const xCol = def.xColumn ?? def.column;
            const yCol = def.yColumn;
            if (!yCol || kindByColumn.get(xCol) !== 'numeric' || kindByColumn.get(yCol) !== 'numeric') {
                return { content: <EmptyChartState theme={theme} message="Нужны два числовых столбца" />, hasData: false };
            }
            const raw = data
                .map(d => {
                    const x = d[xCol];
                    const y = d[yCol];
                    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
                    return { x, y };
                })
                .filter(Boolean) as Array<{ x: number; y: number }>;
            const scatterData = sampleArray(raw, MAX_SCATTER_POINTS);
            const analysis = raw.length
                ? `Точек в выборке: ${raw.length}. На графике — до ${MAX_SCATTER_POINTS} точек (равномерная подвыборка). Оси по основной массе значений; масштаб и сдвиг — см. подсказки над графиком.`
                : undefined;
            return {
                hasData: scatterData.length > 0,
                analysis,
                content: (
                    <ScatterChartView
                        xLabel={xCol}
                        yLabel={yCol}
                        raw={raw}
                        displayPoints={scatterData}
                        theme={theme}
                        chartFillColor={chartFillColor}
                        axisTextColor={axisTextColor}
                        scatterGridColor={scatterGridColor}
                        tooltipStyle={tooltipStyle}
                        tooltipCursor={tooltipCursor}
                    />
                ),
            };
        }

        const col = def.column;
        if (kindByColumn.get(col) !== 'categorical') {
            return { content: <EmptyChartState theme={theme} message={`Столбец «${col}» не категориальный (по авто-оценке)`} />, hasData: false };
        }
        const counts: Record<string, number> = {};
        for (const row of data) {
            const v = row[col];
            const key = v === '' || v == null ? '(пусто)' : String(v);
            counts[key] = (counts[key] || 0) + 1;
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        let barData: { name: string; count: number }[];
        if (entries.length > CATEGORY_DISPLAY_LIMIT) {
            const head = entries.slice(0, CATEGORY_DISPLAY_LIMIT - 1);
            const tail = entries.slice(CATEGORY_DISPLAY_LIMIT - 1);
            const otherCount = tail.reduce((s, [, n]) => s + n, 0);
            barData = [
                ...head.map(([name, count]) => ({ name: name.length > 40 ? `${name.slice(0, 37)}…` : name, count })),
                { name: `+ ещё ${tail.length} знач.`, count: otherCount },
            ];
        } else {
            barData = entries.map(([name, count]) => ({ name: name.length > 40 ? `${name.slice(0, 37)}…` : name, count }));
        }
        const totalRows = data.length;
        const analysis = `Категорий: ${entries.length}. Чаще всего: ${entries[0]?.[0] ?? '—'}. Ползунок внизу — выбор подмножества категорий на экране.`;
        const brushFillCat = theme === 'dark' ? '#18181b' : '#fafafa';
        return {
            hasData: barData.length > 0,
            analysis,
            content: (
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 36 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis type="number" stroke={axisTextColor} fontSize={11} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                        <YAxis type="category" dataKey="name" stroke={axisTextColor} fontSize={10} width={118} tick={{ fill: axisTextColor }} />
                        <Tooltip
                            cursor={tooltipCursor}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const row = payload[0]?.payload as { name?: string; count?: number };
                                const cnt = row.count ?? 0;
                                const pctAll = totalRows > 0 ? ((cnt / totalRows) * 100).toFixed(1) : '0';
                                return (
                                    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ ...tooltipStyle, maxWidth: '18rem' }}>
                                        <p className="mb-1 font-semibold">Категория</p>
                                        <p className="mb-2 break-words opacity-95">{row.name}</p>
                                        <p className="tabular-nums">
                                            <span className="opacity-75">Строк: </span>
                                            <span className="font-medium">{formatNumber(cnt)}</span>
                                            <span className="opacity-75"> ({pctAll}% от выборки)</span>
                                        </p>
                                    </div>
                                );
                            }}
                        />
                        <Bar dataKey="count" fill={chartFillColor} fillOpacity={BAR_OPACITY_INACTIVE + 0.2} radius={[0, 4, 4, 0]} />
                        <Brush
                            dataKey="name"
                            height={28}
                            stroke={axisTextColor}
                            fill={brushFillCat}
                            fillOpacity={0.45}
                            tickFormatter={(v: string | number) => (typeof v === 'string' && v.length > 14 ? `${v.slice(0, 12)}…` : String(v))}
                            ariaLabel="Диапазон категорий"
                        />
                    </BarChart>
                </ResponsiveContainer>
            ),
        };
    };

    if (!data.length) {
        return <EmptyChartState message="Нет данных для отображения. Измените фильтры или загрузите другой файл." theme={theme} />;
    }

    if (!charts.length) {
        return (
            <div className={themeClass(theme, {
                dark: 'flex h-full min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500',
                light: 'flex h-full min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500',
            })}>
                Добавьте график в правой панели: пресет или свой тип визуализации.
            </div>
        );
    }

    const expandedRendered = expanded ? renderChart(expanded) : null;

    return (
        <>
            <div className="grid auto-rows-[minmax(340px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {charts.map(def => {
                    const { content, analysis, hasData } = renderChart(def);
                    return (
                        <ChartCard
                            key={def.id}
                            title={def.title}
                            theme={theme}
                            exportFilenameSlug={def.title}
                            onExpand={() => setExpanded(def)}
                            footer={
                                analysis && hasData ? (
                                    <div className={themeClass(theme, {
                                        dark: 'mt-5 text-sm leading-relaxed text-zinc-400',
                                        light: 'mt-5 text-sm leading-relaxed text-zinc-600',
                                    })}>
                                        {analysis}
                                    </div>
                                ) : null
                            }
                        >
                            {content}
                        </ChartCard>
                    );
                })}
            </div>

            {expanded && expandedRendered && (
                <div
                    className={themeClass(theme, {
                        dark: 'fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm sm:p-8',
                        light: 'fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/25 p-4 backdrop-blur-sm sm:p-8',
                    })}
                    role="presentation"
                    onClick={() => setExpanded(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="chart-expand-title"
                        className={themeClass(theme, {
                            dark: 'flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-zinc-950 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.55)]',
                            light: 'flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/95 bg-white shadow-[0_24px_64px_-16px_rgba(0,0,0,0.12)]',
                        })}
                        onClick={e => e.stopPropagation()}
                    >
                        <div
                            className={`no-export ${themeClass(theme, {
                                dark: 'flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4 sm:px-6',
                                light: 'flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:px-6',
                            })}`}
                        >
                            <h2 id="chart-expand-title" className={`font-display text-base font-semibold sm:text-lg ${themeClass(theme, {
                                dark: 'text-zinc-50',
                                light: 'text-zinc-900',
                            })}`}>
                                {expanded.title}
                            </h2>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={expandedExportBusy}
                                    onClick={() => void exportExpanded('png')}
                                    className={themeClass(theme, {
                                        dark: 'rounded-lg border border-zinc-700/90 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50',
                                        light: 'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 disabled:opacity-50',
                                    })}
                                >
                                    PNG
                                </button>
                                <button
                                    type="button"
                                    disabled={expandedExportBusy}
                                    onClick={() => void exportExpanded('pdf')}
                                    className={themeClass(theme, {
                                        dark: 'rounded-lg border border-zinc-700/90 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50',
                                        light: 'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 disabled:opacity-50',
                                    })}
                                >
                                    PDF
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExpanded(null)}
                                    className={themeClass(theme, {
                                        dark: 'rounded-xl p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100',
                                        light: 'rounded-xl p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900',
                                    })}
                                    aria-label="Закрыть"
                                >
                                    <CloseIcon />
                                </button>
                            </div>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 sm:p-7">
                            <div
                                ref={expandedExportRef}
                                className={`h-[min(82vh,900px)] min-h-[380px] w-full shrink-0 ${themeClass(theme, {
                                    dark: 'rounded-2xl bg-zinc-950/40 p-3',
                                    light: 'rounded-2xl bg-zinc-50/80 p-3',
                                })}`}
                            >
                                {expandedRendered.content}
                            </div>
                            {expandedRendered.analysis && expandedRendered.hasData && (
                                <p className={themeClass(theme, {
                                    dark: 'text-sm leading-relaxed text-zinc-400',
                                    light: 'text-sm leading-relaxed text-zinc-600',
                                })}>
                                    {expandedRendered.analysis}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
