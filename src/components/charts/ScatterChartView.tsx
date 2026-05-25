import React, { useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Brush } from 'recharts';
import type { Theme } from '@/theme';
import { themeClass, chartAccentStroke } from '@/theme';
import { formatNumber } from '@/utils/format';
import { axisDomainFromValues } from '@/utils/stats';
import { MeasuredResponsiveContainer } from '@/components/charts/MeasuredResponsiveContainer';

type Point = { x: number; y: number };

function asDomainPair(d: [number, number] | undefined): [number, number] | undefined {
    return d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] < d[1] ? d : undefined;
}

const NON_NEGATIVE_METRIC_HINTS = [
    'price',
    'cost',
    'rub',
    'area',
    'square',
    'sq',
    'rooms',
    'floor',
    'этаж',
    'площад',
    'комнат',
    'цена',
    'стоимость',
];

function isClearlyNonNegativeMetric(label: string): boolean {
    const normalized = label.trim().toLowerCase();
    return NON_NEGATIVE_METRIC_HINTS.some(hint => normalized.includes(hint));
}

function clampDomainLowerBound(domain: [number, number] | undefined, clampToZero: boolean): [number, number] | undefined {
    if (!domain || !clampToZero) return domain;
    const lo = Math.max(0, domain[0]);
    const hi = Math.max(lo + Number.EPSILON, domain[1]);
    return [lo, hi];
}

export const ScatterChartView: React.FC<{
    xLabel: string;
    yLabel: string;
    raw: Point[];
    displayPoints: Point[];
    theme: Theme;
    chartFillColor: string;
    axisTextColor: string;
    scatterGridColor: string;
    tooltipStyle: React.CSSProperties;
    isFullscreen?: boolean;
}> = ({
    xLabel,
    yLabel,
    raw,
    displayPoints,
    theme,
    chartFillColor,
    axisTextColor,
    scatterGridColor,
    tooltipStyle,
    isFullscreen = false,
}) => {
    const sortedScatter = useMemo(() => [...displayPoints].sort((a, b) => a.x - b.x), [displayPoints]);
    const [brushRange, setBrushRange] = useState<{ start: number; end: number } | null>(null);
    const maxBrushIndex = Math.max(0, sortedScatter.length - 1);
    const xNonNegative = isClearlyNonNegativeMetric(xLabel);
    const yNonNegative = isClearlyNonNegativeMetric(yLabel);
    const selectedScatter = useMemo(() => {
        if (!brushRange) return sortedScatter;
        const start = Math.max(0, Math.min(maxBrushIndex, brushRange.start));
        const end = Math.max(start, Math.min(maxBrushIndex, brushRange.end));
        return sortedScatter.slice(start, end + 1);
    }, [brushRange, maxBrushIndex, sortedScatter]);
    const domainSource = selectedScatter.length > 1 ? selectedScatter : raw;
    const xDomain = useMemo(
        () => clampDomainLowerBound(asDomainPair(axisDomainFromValues(domainSource.map(p => p.x))), xNonNegative) ?? (['auto', 'auto'] as const),
        [domainSource, xNonNegative]
    );
    const yDomain = useMemo(
        () => clampDomainLowerBound(asDomainPair(axisDomainFromValues(domainSource.map(p => p.y))), yNonNegative) ?? (['auto', 'auto'] as const),
        [domainSource, yNonNegative]
    );
    const brushFill = theme === 'dark' ? '#111827' : '#eef2ff';
    const resetBrush = () => setBrushRange(null);
    const brushStart = brushRange?.start ?? 0;
    const brushEnd = brushRange?.end ?? maxBrushIndex;
    const trendLine = useMemo(() => {
        const pts = selectedScatter.length >= 2 ? selectedScatter : sortedScatter;
        if (pts.length < 2) return null;
        let sx = 0;
        let sy = 0;
        let sxy = 0;
        let sxx = 0;
        for (const p of pts) {
            sx += p.x;
            sy += p.y;
            sxy += p.x * p.y;
            sxx += p.x * p.x;
        }
        const n = pts.length;
        const den = n * sxx - sx * sx;
        if (Math.abs(den) < 1e-12) return null;
        const slope = (n * sxy - sx * sy) / den;
        const intercept = (sy - slope * sx) / n;
        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x));
        return {
            points: [
                { x: minX, y: slope * minX + intercept },
                { x: maxX, y: slope * maxX + intercept },
            ],
            slope,
        };
    }, [selectedScatter, sortedScatter]);

    return (
        <div className="flex h-full min-h-[18rem] w-full min-w-0 flex-1 flex-col">
            {brushRange && (
                <button
                    type="button"
                    onClick={resetBrush}
                    className={themeClass(theme, {
                        dark: 'mb-1 shrink-0 self-end rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800',
                        light: 'mb-1 shrink-0 self-end rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100',
                    })}
                >
                    Весь диапазон
                </button>
            )}
            <div className="relative h-full min-h-[18rem] min-w-0 flex-1">
                <MeasuredResponsiveContainer minWidth={280} minHeight={280}>
                    <ScatterChart data={sortedScatter} margin={{ top: 12, right: 18, left: 14, bottom: 50 }}>
                        <CartesianGrid stroke={scatterGridColor} strokeDasharray="3 3" />
                        <XAxis
                            type="number"
                            dataKey="x"
                            name={xLabel}
                            stroke={axisTextColor}
                            fontSize={11}
                            tick={{ fill: axisTextColor }}
                            tickMargin={6}
                            tickFormatter={formatNumber}
                            interval="preserveStartEnd"
                            domain={xDomain}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name={yLabel}
                            stroke={axisTextColor}
                            fontSize={11}
                            tickFormatter={formatNumber}
                            tick={{ fill: axisTextColor }}
                            tickMargin={6}
                            width={58}
                            domain={yDomain}
                        />
                        <Tooltip
                            cursor={{ stroke: chartFillColor, strokeWidth: 1, strokeDasharray: '4 4' }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const pt = payload[0]?.payload as Point | undefined;
                                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
                                return (
                                    <div
                                        className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${themeClass(theme, {
                                            dark: 'border-zinc-700 bg-zinc-950/95',
                                            light: 'border-zinc-200 bg-white',
                                        })}`}
                                        style={{ minWidth: '10rem', color: tooltipStyle.color }}
                                    >
                                        <p className="mb-1.5 font-semibold opacity-95">Точка</p>
                                        <div className="space-y-1 tabular-nums">
                                            <div>
                                                <span className="opacity-65">{xLabel}: </span>
                                                <span className="font-medium">{formatNumber(pt.x)}</span>
                                            </div>
                                            <div>
                                                <span className="opacity-65">{yLabel}: </span>
                                                <span className="font-medium">{formatNumber(pt.y)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        <Scatter data={sortedScatter} fill={chartFillColor} fillOpacity={0.72} isAnimationActive={false} />
                        {trendLine && (
                            <Scatter
                                data={trendLine.points}
                                line={{ stroke: '#f59e0b', strokeWidth: 2 }}
                                shape={() => null}
                                isAnimationActive={false}
                            />
                        )}
                        {sortedScatter.length > 1 && (
                            <Brush
                                dataKey="x"
                                height={26}
                                stroke={chartAccentStroke(theme)}
                                fill={brushFill}
                                fillOpacity={0.62}
                                travellerWidth={10}
                                tickFormatter={() => ''}
                                startIndex={brushStart}
                                endIndex={brushEnd}
                                onChange={({ startIndex, endIndex }) => {
                                    if (typeof startIndex !== 'number' || typeof endIndex !== 'number') return;
                                    const start = Math.max(0, Math.min(startIndex, endIndex));
                                    const end = Math.max(start, Math.max(startIndex, endIndex));
                                    if (start === 0 && end >= maxBrushIndex) {
                                        resetBrush();
                                        return;
                                    }
                                    setBrushRange({ start, end });
                                }}
                                ariaLabel="Диапазон точек по X"
                            />
                        )}
                    </ScatterChart>
                </MeasuredResponsiveContainer>
                {trendLine && (
                    <p
                        className={themeClass(theme, {
                            dark: isFullscreen
                                ? 'pointer-events-none absolute right-3 top-3 z-20 rounded-md border border-amber-400/50 bg-zinc-950/88 px-2.5 py-1 text-[11px] font-medium text-amber-200 shadow-[0_1px_2px_rgba(0,0,0,0.55)]'
                                : 'mt-1 text-[11px] text-zinc-400',
                            light: isFullscreen
                                ? 'pointer-events-none absolute right-3 top-3 z-20 rounded-md border border-amber-300/90 bg-white/94 px-2.5 py-1 text-[11px] font-medium text-amber-900 shadow-[0_1px_2px_rgba(0,0,0,0.16)]'
                                : 'mt-1 text-[11px] text-zinc-600',
                        })}
                    >
                        Линия тренда (МНК), наклон: {trendLine.slope.toFixed(4)}
                    </p>
                )}
            </div>
        </div>
    );
};
