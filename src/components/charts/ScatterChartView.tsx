import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Brush } from 'recharts';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';
import { axisDomainFromValues } from '@/utils/stats';

type Point = { x: number; y: number };

function asDomainPair(d: [number, number] | undefined): [number, number] | undefined {
    return d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] < d[1] ? d : undefined;
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
}) => {
    const sortedScatter = useMemo(() => [...displayPoints].sort((a, b) => a.x - b.x), [displayPoints]);
    const [brushRange, setBrushRange] = useState<{ start: number; end: number } | null>(null);
    const maxBrushIndex = Math.max(0, sortedScatter.length - 1);
    const selectedScatter = useMemo(() => {
        if (!brushRange) return sortedScatter;
        const start = Math.max(0, Math.min(maxBrushIndex, brushRange.start));
        const end = Math.max(start, Math.min(maxBrushIndex, brushRange.end));
        return sortedScatter.slice(start, end + 1);
    }, [brushRange, maxBrushIndex, sortedScatter]);
    const domainSource = selectedScatter.length > 1 ? selectedScatter : raw;
    const xDomain = useMemo(
        () => asDomainPair(axisDomainFromValues(domainSource.map(p => p.x))) ?? (['auto', 'auto'] as const),
        [domainSource]
    );
    const yDomain = useMemo(
        () => asDomainPair(axisDomainFromValues(domainSource.map(p => p.y))) ?? (['auto', 'auto'] as const),
        [domainSource]
    );
    const brushFill = theme === 'dark' ? '#111827' : '#eef2ff';
    const resetBrush = () => setBrushRange(null);

    return (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
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
            <div className="relative h-full min-h-[12rem] min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
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
                        {sortedScatter.length > 1 && (
                            <Brush
                                dataKey="x"
                                height={26}
                                stroke={theme === 'dark' ? '#818cf8' : '#6366f1'}
                                fill={brushFill}
                                fillOpacity={0.62}
                                travellerWidth={10}
                                tickFormatter={() => ''}
                                startIndex={brushRange?.start}
                                endIndex={brushRange?.end}
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
                </ResponsiveContainer>
            </div>
        </div>
    );
};
