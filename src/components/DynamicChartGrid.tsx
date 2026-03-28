import React, { useEffect, useMemo, useState } from 'react';
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ScatterChart,
    Scatter,
    ZAxis,
    Brush,
} from 'recharts';
import type { DataRow, DataSummary, UserChartDefinition } from '@/types';
import type { Theme } from '@/theme';
import { themeClass, CHART_FILL, BAR_OPACITY_INACTIVE } from '@/theme';
import { formatNumber } from '@/utils/format';
import { median, quantile, axisDomainFromValues } from '@/utils/stats';
import { sampleArray, MAX_SCATTER_POINTS } from '@/utils/sample';
import { isFiniteNumber } from '@/domain/dataset';
import { ChartCard } from '@/components/ChartCard';
import { EmptyChartState } from '@/components/EmptyChartState';
import { CloseIcon } from '@/components/icons';

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

    const chartFillColor = CHART_FILL[theme];
    const axisTextColor = theme === 'dark' ? '#9ca3af' : '#475569';
    const gridColor = theme === 'dark' ? '#374151' : '#e2e8f0';
    const tooltipStyle = theme === 'dark'
        ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e2e8f0' }
        : { backgroundColor: '#ffffff', border: '1px solid #bfdbfe', color: '#1f2937' };
    const tooltipCursor = theme === 'dark' ? { fill: '#374151', opacity: 0.15 } : { fill: '#e2e8f0', opacity: 0.6 };
    const scatterGridColor = theme === 'dark' ? '#374151' : '#dbeafe';

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
                                        dark: 'self-end rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800',
                                        light: 'self-end rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100',
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
                : ' Клик по столбцу — приблизить к этому интервалу.';
            const fullAnalysis = `${analysis}${zoom ? '' : coreHint}${zoomHint}`;
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
                                    dark: 'self-end rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800',
                                    light: 'self-end rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100',
                                })}
                            >
                                Весь диапазон
                            </button>
                        )}
                        <div className="min-h-0 flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={distribution} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                    <XAxis dataKey="name" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                                    <YAxis stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                                    <Tooltip
                                        contentStyle={tooltipStyle}
                                        formatter={(value: number, _k, payload) => {
                                            const r = payload?.payload?.range as BinRange | undefined;
                                            const label = r
                                                ? `${r.min.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} — ${r.max.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
                                                : '';
                                            return [value, label];
                                        }}
                                        cursor={tooltipCursor}
                                    />
                                    <Bar
                                        dataKey="count"
                                        fill={chartFillColor}
                                        fillOpacity={BAR_OPACITY_INACTIVE + 0.15}
                                        cursor="pointer"
                                        onClick={barItem => {
                                            const r = barItem?.payload?.range as BinRange | undefined;
                                            if (r && Number.isFinite(r.min) && Number.isFinite(r.max)) {
                                                setHistZoomById(prev => ({ ...prev, [def.id]: { min: r.min, max: r.max } }));
                                            }
                                        }}
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
            const sortedScatter = [...scatterData].sort((a, b) => a.x - b.x);
            const xDomain = axisDomainFromValues(raw.map(p => p.x));
            const yDomain = axisDomainFromValues(raw.map(p => p.y));
            const brushFill = theme === 'dark' ? '#1f2937' : '#f1f5f9';
            const analysis = raw.length
                ? `Точек (в выборке): ${raw.length}. На графике — равномерная выборка до ${MAX_SCATTER_POINTS}. Масштаб осей — по основной массе точек. Ползунок внизу — выбор интервала по оси X (как лупа).`
                : undefined;
            return {
                hasData: scatterData.length > 0,
                analysis,
                content: (
                    <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart data={sortedScatter} margin={{ top: 5, right: 20, left: 30, bottom: 36 }}>
                            <CartesianGrid stroke={scatterGridColor} />
                            <XAxis
                                type="number"
                                dataKey="x"
                                name={xCol}
                                stroke={axisTextColor}
                                fontSize={12}
                                tick={{ fill: axisTextColor }}
                                domain={xDomain ?? ['auto', 'auto']}
                            />
                            <YAxis
                                type="number"
                                dataKey="y"
                                name={yCol}
                                stroke={axisTextColor}
                                fontSize={12}
                                tickFormatter={formatNumber}
                                tick={{ fill: axisTextColor }}
                                domain={yDomain ?? ['auto', 'auto']}
                            />
                            <ZAxis type="number" range={[20, 100]} />
                            <Tooltip cursor={tooltipCursor} contentStyle={tooltipStyle} />
                            <Scatter data={sortedScatter} fill={chartFillColor} fillOpacity={0.65} />
                            <Brush
                                dataKey="x"
                                height={28}
                                stroke={axisTextColor}
                                fill={brushFill}
                                fillOpacity={0.45}
                                tickFormatter={(v: number | string) => formatNumber(typeof v === 'number' ? v : Number(v))}
                            />
                        </ScatterChart>
                    </ResponsiveContainer>
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
        const analysis = `Категорий: ${entries.length}. Чаще всего: ${entries[0]?.[0] ?? '—'}.`;
        return {
            hasData: barData.length > 0,
            analysis,
            content: (
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 20, left: 12, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis type="number" stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                        <YAxis type="category" dataKey="name" stroke={axisTextColor} fontSize={11} width={120} tick={{ fill: axisTextColor }} />
                        <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(v: number) => [v, 'шт.']} />
                        <Bar dataKey="count" fill={chartFillColor} fillOpacity={BAR_OPACITY_INACTIVE + 0.2} />
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
                dark: 'flex h-full min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400',
                light: 'flex h-full min-h-[200px] items-center justify-center rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500',
            })}>
                Добавьте хотя бы один график в панели выше: выберите тип и столбцы из вашего CSV.
            </div>
        );
    }

    const expandedRendered = expanded ? renderChart(expanded) : null;

    return (
        <>
            <div className="grid auto-rows-[minmax(300px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {charts.map(def => {
                    const { content, analysis, hasData } = renderChart(def);
                    return (
                        <ChartCard key={def.id} title={def.title} theme={theme} onExpand={() => setExpanded(def)}>
                            {content}
                            {analysis && hasData && (
                                <div className={themeClass(theme, {
                                    dark: 'mt-4 text-sm leading-6 text-slate-200/85',
                                    light: 'mt-4 text-sm leading-6 text-slate-600',
                                })}>
                                    {analysis}
                                </div>
                            )}
                        </ChartCard>
                    );
                })}
            </div>

            {expanded && expandedRendered && (
                <div
                    className={themeClass(theme, {
                        dark: 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6',
                        light: 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6',
                    })}
                    role="presentation"
                    onClick={() => setExpanded(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="chart-expand-title"
                        className={themeClass(theme, {
                            dark: 'flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-600/80 bg-slate-950 shadow-2xl shadow-black/40',
                            light: 'flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-400/20',
                        })}
                        onClick={e => e.stopPropagation()}
                    >
                        <div
                            className={themeClass(theme, {
                                dark: 'flex items-center justify-between gap-3 border-b border-slate-700/80 px-4 py-3 sm:px-5',
                                light: 'flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5',
                            })}
                        >
                            <h2 id="chart-expand-title" className={`font-display text-base font-semibold sm:text-lg ${themeClass(theme, {
                                dark: 'text-white',
                                light: 'text-slate-900',
                            })}`}>
                                {expanded.title}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setExpanded(null)}
                                className={themeClass(theme, {
                                    dark: 'rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white',
                                    light: 'rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                                })}
                                aria-label="Закрыть"
                            >
                                <CloseIcon />
                            </button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
                            <div className="h-[75vh] max-h-[780px] min-h-[320px] w-full shrink-0">
                                {expandedRendered.content}
                            </div>
                            {expandedRendered.analysis && expandedRendered.hasData && (
                                <p className={themeClass(theme, {
                                    dark: 'text-sm leading-6 text-slate-300',
                                    light: 'text-sm leading-6 text-slate-600',
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
