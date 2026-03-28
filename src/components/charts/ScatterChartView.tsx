import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ResponsiveContainer,
    ScatterChart,
    Scatter,
    XAxis,
    YAxis,
    ZAxis,
    CartesianGrid,
    Tooltip,
    Brush,
} from 'recharts';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';
import { axisDomainFromValues } from '@/utils/stats';

type Point = { x: number; y: number };

function asDomainPair(d: [number, number] | undefined): [number, number] | undefined {
    return d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] < d[1] ? d : undefined;
}

function zoomDomainPair([a, b]: [number, number], scale: number): [number, number] {
    const c = (a + b) / 2;
    const half = ((b - a) / 2) * scale;
    const lo = c - half;
    const hi = c + half;
    return lo < hi ? [lo, hi] : [a, b];
}

function panDomainPair([a, b]: [number, number], delta: number): [number, number] {
    return [a + delta, b + delta];
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
    tooltipCursor: { fill: string; opacity: number };
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
    tooltipCursor,
}) => {
    const sortedScatter = useMemo(() => [...displayPoints].sort((a, b) => a.x - b.x), [displayPoints]);

    const xBase = useMemo(() => asDomainPair(axisDomainFromValues(raw.map(p => p.x))), [raw]);
    const yBase = useMemo(() => asDomainPair(axisDomainFromValues(raw.map(p => p.y))), [raw]);

    /** Ручной масштаб / выбор кистью (null = авто по выборке). */
    const [nav, setNav] = useState<{ x: [number, number]; y: [number, number] } | null>(null);

    const xDomain = nav?.x ?? xBase ?? (['auto', 'auto'] as const);
    const yDomain = nav?.y ?? yBase ?? (['auto', 'auto'] as const);

    const resetView = useCallback(() => setNav(null), []);

    const onBrushChange = useCallback(
        ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
            const n = sortedScatter.length;
            if (n === 0) return;
            if (startIndex <= 0 && endIndex >= n - 1) {
                setNav(null);
                return;
            }
            const slice = sortedScatter.slice(startIndex, endIndex + 1).filter(Boolean);
            if (!slice.length) return;
            const xs = slice.map(p => p.x);
            const ys = slice.map(p => p.y);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            const yMin = Math.min(...ys);
            const yMax = Math.max(...ys);
            const xPad = (xMax - xMin) * 0.04 || Math.abs(xMin) * 0.02 || 1;
            const yPad = (yMax - yMin) * 0.04 || Math.abs(yMin) * 0.02 || 1;
            setNav({
                x: [xMin - xPad, xMax + xPad],
                y: [yMin - yPad, yMax + yPad],
            });
        },
        [sortedScatter]
    );

    const wrapRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ px0: number; py0: number; x0: [number, number]; y0: [number, number] } | null>(null);

    const effectiveX = (nav?.x ?? xBase) as [number, number] | undefined;
    const effectiveY = (nav?.y ?? yBase) as [number, number] | undefined;

    const onWheel = useCallback(
        (e: React.WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const ex = effectiveX;
            const ey = effectiveY;
            if (!ex || !ey) return;
            const scale = e.deltaY > 0 ? 1.1 : 1 / 1.1;
            setNav({
                x: zoomDomainPair(ex, scale),
                y: zoomDomainPair(ey, scale),
            });
        },
        [effectiveX, effectiveY]
    );

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (!e.altKey) return;
            const ex = nav?.x ?? xBase;
            const ey = nav?.y ?? yBase;
            if (!ex || !ey) return;
            e.preventDefault();
            panRef.current = {
                px0: e.clientX,
                py0: e.clientY,
                x0: [...ex] as [number, number],
                y0: [...ey] as [number, number],
            };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        },
        [nav, xBase, yBase]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            const p = panRef.current;
            if (!p) return;
            const el = wrapRef.current;
            if (!el) return;
            const w = el.clientWidth;
            const h = el.clientHeight;
            if (w < 40 || h < 40) return;
            const dx = e.clientX - p.px0;
            const dy = e.clientY - p.py0;
            const spanX = p.x0[1] - p.x0[0];
            const spanY = p.y0[1] - p.y0[0];
            const shiftX = (-dx / w) * spanX;
            const shiftY = (dy / h) * spanY;
            setNav({
                x: panDomainPair(p.x0, shiftX),
                y: panDomainPair(p.y0, shiftY),
            });
        },
        []
    );

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        panRef.current = null;
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }, []);

    const brushFill = theme === 'dark' ? '#18181b' : '#fafafa';

    const hintBar = themeClass(theme, {
        dark: 'mb-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500',
        light: 'mb-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500',
    });

    return (
        <div className="flex h-full min-h-0 flex-col gap-1">
            <div className={hintBar}>
                <span>Ctrl/⌘ + колёсико — масштаб</span>
                <span className="opacity-60">·</span>
                <span>Alt + перетаскивание — сдвиг (pan)</span>
                <span className="opacity-60">·</span>
                <span>Ползунок внизу — выбор диапазона по X</span>
                {nav && (
                    <button
                        type="button"
                        onClick={resetView}
                        className={themeClass(theme, {
                            dark: 'ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-indigo-300 hover:bg-zinc-800',
                            light: 'ml-auto rounded-md border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-zinc-100',
                        })}
                    >
                        Сброс масштаба
                    </button>
                )}
            </div>
            <div
                ref={wrapRef}
                className="min-h-[220px] flex-1 touch-none"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => {
                    panRef.current = null;
                }}
            >
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart data={sortedScatter} margin={{ top: 8, right: 16, left: 8, bottom: 44 }}>
                        <CartesianGrid stroke={scatterGridColor} strokeDasharray="3 3" />
                        <XAxis
                            type="number"
                            dataKey="x"
                            name={xLabel}
                            stroke={axisTextColor}
                            fontSize={11}
                            tick={{ fill: axisTextColor }}
                            domain={xDomain}
                            label={{ value: xLabel, position: 'insideBottom', offset: -2, fill: axisTextColor, fontSize: 10 }}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name={yLabel}
                            stroke={axisTextColor}
                            fontSize={11}
                            tickFormatter={formatNumber}
                            tick={{ fill: axisTextColor }}
                            domain={yDomain}
                            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: axisTextColor, fontSize: 10 }}
                        />
                        <ZAxis type="number" range={[24, 120]} />
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
                        <Brush
                            dataKey="x"
                            height={32}
                            stroke={axisTextColor}
                            fill={brushFill}
                            fillOpacity={0.5}
                            tickFormatter={(v: number | string) => formatNumber(typeof v === 'number' ? v : Number(v))}
                            onChange={onBrushChange}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
