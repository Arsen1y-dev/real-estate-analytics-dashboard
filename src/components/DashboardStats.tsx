import React, { useMemo } from 'react';
import type { DataRow, DataSummary } from '@/types';
import type { ColorScheme, Theme } from '@/theme';
import { getRuntimeColorScheme, themeClass } from '@/theme';
import { median } from '@/utils/stats';
import { isFiniteNumber } from '@/domain/dataset';
import { statCardSurface, type StatGradientKey } from '@/components/dashboardStatGradients';
import { MetricSparkline, type MetricSparklineSize } from '@/components/MetricSparkline';
import {
    formatAreaCompactSqM,
    formatCountCompact,
    formatPercentDelta,
    formatRubCompact,
    formatRubPerM2Compact,
    percentChange,
} from '@/utils/metricDisplay';
import { generateMarketInsights } from '@/domain/insights';

const LABEL_PRICE_MEDIAN = 'Медиана: цена';
const LABEL_RPM2_MEDIAN = 'Медиана цены за м²';
const LABEL_LIVING_AREA_MEDIAN = 'Медиана: жилая площадь';
const LABEL_TOTAL_AREA_MEDIAN = 'Медиана: общая площадь';
const LABEL_SAMPLE_COUNT = 'Объектов в выборке';

const COL_LIVING_AREA = 'Жилая площадь';
const COL_PRICE_PER_M2 = 'Цена за м²';

function sparklineFromCount(n: number): number[] {
    if (n < 2) return [];
    const steps = Math.min(36, n);
    return Array.from({ length: steps }, (_, i) => Math.round(((i + 1) / steps) * n));
}

function resolveLivingAreaColumn(summary: DataSummary): string | null {
    if (summary.columnOrder.includes(COL_LIVING_AREA)) return COL_LIVING_AREA;
    const col = summary.columns.find(
        c => c.kind === 'numeric' && /жил/i.test(c.name) && /площад/i.test(c.name)
    );
    return col?.name ?? null;
}

function resolvePricePerM2Column(summary: DataSummary): string | null {
    if (summary.columnOrder.includes(COL_PRICE_PER_M2)) return COL_PRICE_PER_M2;
    const col = summary.columns.find(
        c =>
            c.kind === 'numeric' &&
            (/цен/i.test(c.name) || /price/i.test(c.name)) &&
            (/м²|м2|кв\.?\s*м/i.test(c.name))
    );
    return col?.name ?? null;
}

function medianPricePerM2(
    rows: DataRow[],
    priceCol: string,
    areaCol: string
): { values: number[]; median: number } | null {
    const values = rows
        .map(d => {
            const p = d[priceCol];
            const a = d[areaCol];
            if (!isFiniteNumber(p) || !isFiniteNumber(a) || a <= 0) return NaN;
            return p / a;
        })
        .filter(Number.isFinite);
    if (!values.length) return null;
    return { values, median: median(values) };
}

export type DashboardStatsProps = {
    data: DataRow[];
    baselineData?: DataRow[];
    summary: DataSummary;
    theme: Theme;
    colorScheme?: ColorScheme;
};

type BuiltCard = {
    label: string;
    gradientKey: StatGradientKey;
    display: string;
    sparkline: number[];
    deltaPct: number | null;
};

type KpiCardProps = {
    item: BuiltCard;
    theme: Theme;
    colorScheme: ColorScheme;
    variant: 'hero' | 'secondary';
};

function KpiStatCard({ item, theme, colorScheme, variant }: KpiCardProps) {
    const showDelta = item.deltaPct != null && Number.isFinite(item.deltaPct);
    const smallDelta = showDelta && Math.abs(item.deltaPct!) < 0.1;
    const isHero = variant === 'hero';
    const sparkSize: MetricSparklineSize = isHero ? 'hero' : 'default';

    const shell = themeClass(
        theme,
        {
        dark: isHero
            ? 'relative flex min-h-[10.5rem] flex-col overflow-hidden rounded-3xl border border-zinc-800/90 shadow-[0_1px_2px_rgba(0,0,0,0.2),0_12px_40px_-12px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.04]'
            : 'relative flex min-h-[7.25rem] flex-col overflow-hidden rounded-2xl border border-zinc-800/80 shadow-sm shadow-black/25',
        light: isHero
            ? 'relative flex min-h-[10.5rem] flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.08)] ring-1 ring-zinc-950/[0.03]'
            : 'relative flex min-h-[7.25rem] flex-col overflow-hidden rounded-2xl border border-zinc-200/85 bg-white/90 shadow-sm shadow-zinc-900/5',
        },
        colorScheme
    );

    const labelCls = themeClass(
        theme,
        {
            dark: isHero
                ? 'text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500'
                : 'text-[10px] font-medium uppercase tracking-wide text-zinc-500/90',
            light: isHero
                ? 'text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500'
                : 'text-[10px] font-medium uppercase tracking-wide text-zinc-500',
        },
        colorScheme
    );

    const valueCls = themeClass(theme, {
        dark: isHero
            ? 'font-display text-3xl font-semibold tabular-nums tracking-tight text-zinc-50 sm:text-4xl'
            : 'font-display text-lg font-medium tabular-nums tracking-tight text-zinc-200 sm:text-xl',
        light: isHero
            ? 'font-display text-3xl font-semibold tabular-nums tracking-tight text-zinc-900 sm:text-4xl'
            : 'font-display text-lg font-medium tabular-nums tracking-tight text-zinc-700 sm:text-xl',
    });

    const dividerCls = themeClass(theme, {
        dark: isHero ? 'border-zinc-700/50' : 'border-zinc-800/60',
        light: isHero ? 'border-zinc-200/90' : 'border-zinc-200/70',
    });

    const pad = isHero ? 'p-6 sm:p-7 md:p-8' : 'p-4 sm:p-5';

    return (
        <div className={shell}>
            <div
                className="pointer-events-none absolute inset-0 rounded-[inherit]"
                style={{ background: statCardSurface(theme, isHero ? 'hero' : 'secondary') }}
            />
            <div className={`relative z-10 flex flex-1 flex-col justify-between gap-3 ${pad}`}>
                <div className="min-w-0 space-y-1.5">
                    {isHero && (
                        <p
                            className={themeClass(theme, {
                                dark: 'text-[11px] font-medium text-indigo-400/95',
                                light: 'text-[11px] font-medium text-indigo-700',
                            })}
                        >
                            Ключевой показатель
                        </p>
                    )}
                    <p className={labelCls}>{item.label}</p>
                    <p className={`${valueCls} leading-[1.1]`}>{item.display}</p>
                    {showDelta && (
                        <div className={`flex flex-wrap items-center gap-2 ${isHero ? 'pt-1.5' : 'pt-0.5'}`}>
                            {smallDelta ? (
                                <span
                                    className={`inline-flex rounded-md ${
                                        isHero ? 'px-2.5 py-1 text-xs font-medium' : 'px-2 py-0.5 text-[11px] font-medium'
                                    } ${themeClass(theme, {
                                        dark: 'bg-zinc-800/90 text-zinc-400',
                                        light: 'bg-zinc-100 text-zinc-600',
                                    })}`}
                                >
                                    Без заметного отличия от полного файла
                                </span>
                            ) : (
                                <>
                                    <span
                                        className={`inline-flex items-center gap-1 rounded-md tabular-nums ${
                                            isHero ? 'px-2.5 py-1 text-xs font-semibold' : 'px-2 py-0.5 text-[11px] font-semibold'
                                        } ${
                                            item.deltaPct! > 0
                                                ? themeClass(theme, {
                                                      dark: 'bg-indigo-500/15 text-indigo-200',
                                                      light: 'bg-indigo-50 text-indigo-800',
                                                  })
                                                : themeClass(theme, {
                                                      dark: 'bg-zinc-800/80 text-zinc-400',
                                                      light: 'bg-zinc-100 text-zinc-600',
                                                  })
                                        }`}
                                    >
                                        <span aria-hidden>{item.deltaPct! > 0 ? '↑' : '↓'}</span>
                                        {`${item.deltaPct! > 0 ? '+' : '−'}${formatPercentDelta(item.deltaPct!)}%`}
                                    </span>
                                    <span
                                        className={themeClass(theme, {
                                            dark: `font-medium text-zinc-500 ${isHero ? 'text-[11px]' : 'text-[10px]'}`,
                                            light: `font-medium text-zinc-500 ${isHero ? 'text-[11px]' : 'text-[10px]'}`,
                                        })}
                                    >
                                        к базе после очистки
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <div className={`flex items-end justify-between gap-2 border-t pt-2 ${dividerCls}`}>
                    <MetricSparkline values={item.sparkline} theme={theme} size={sparkSize} />
                </div>
            </div>
        </div>
    );
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
    data,
    baselineData,
    summary,
    theme,
    colorScheme: colorSchemeProp,
}) => {
    const colorScheme = colorSchemeProp ?? getRuntimeColorScheme();
    const insights = useMemo(() => generateMarketInsights(data, summary), [data, summary]);

    const { heroItem, secondaryItems } = useMemo(() => {
        if (!data.length) {
            return { heroItem: null as BuiltCard | null, secondaryItems: [] as BuiltCard[] };
        }

        const base = baselineData?.length ? baselineData : data;
        const compare = baselineData && baselineData.length > 0 && baselineData !== data;

        const priceCol = summary.coreColumnMap.price;
        const areaCol = summary.coreColumnMap.area;
        const livingCol = resolveLivingAreaColumn(summary);
        const rpm2Col = resolvePricePerM2Column(summary);

        let heroItem: BuiltCard | null = null;
        const secondaryItems: BuiltCard[] = [];

        if (priceCol) {
            const prices = data.map(d => d[priceCol]).filter(isFiniteNumber);
            const basePrices = base.map(d => d[priceCol]).filter(isFiniteNumber);
            if (prices.length) {
                const medCur = median(prices);
                const medBase = basePrices.length ? median(basePrices) : NaN;
                heroItem = {
                    label: LABEL_PRICE_MEDIAN,
                    display: formatRubCompact(medCur),
                    gradientKey: 'priceMedian',
                    sparkline: prices,
                    deltaPct: compare && basePrices.length ? percentChange(medCur, medBase) : null,
                };
            }
        }

        const rpm2FromCol = rpm2Col
            ? (() => {
                  const vals = data.map(d => d[rpm2Col!]).filter(isFiniteNumber);
                  const baseVals = base.map(d => d[rpm2Col!]).filter(isFiniteNumber);
                  if (!vals.length) return null;
                  const medCur = median(vals);
                  const medBase = baseVals.length ? median(baseVals) : NaN;
                  return {
                      label: LABEL_RPM2_MEDIAN,
                      display: formatRubPerM2Compact(medCur),
                      gradientKey: 'rpm2Median' as StatGradientKey,
                      sparkline: vals,
                      deltaPct: compare && baseVals.length ? percentChange(medCur, medBase) : null,
                  };
              })()
            : null;

        const rpm2Computed =
            !rpm2FromCol && priceCol && areaCol
                ? (() => {
                      const cur = medianPricePerM2(data, priceCol, areaCol);
                      const baseR = medianPricePerM2(base, priceCol, areaCol);
                      if (!cur) return null;
                      return {
                          label: LABEL_RPM2_MEDIAN,
                          display: formatRubPerM2Compact(cur.median),
                          gradientKey: 'rpm2Median' as StatGradientKey,
                          sparkline: cur.values,
                          deltaPct:
                              compare && baseR ? percentChange(cur.median, baseR.median) : null,
                      };
                  })()
                : null;

        const rpm2Card = rpm2FromCol ?? rpm2Computed;
        if (rpm2Card) secondaryItems.push(rpm2Card);

        if (livingCol) {
            const vals = data.map(d => d[livingCol]).filter(isFiniteNumber);
            const baseVals = base.map(d => d[livingCol]).filter(isFiniteNumber);
            if (vals.length) {
                const medCur = median(vals);
                const medBase = baseVals.length ? median(baseVals) : NaN;
                secondaryItems.push({
                    label: LABEL_LIVING_AREA_MEDIAN,
                    display: formatAreaCompactSqM(medCur),
                    gradientKey: 'area',
                    sparkline: vals,
                    deltaPct: compare && baseVals.length ? percentChange(medCur, medBase) : null,
                });
            }
        }

        if (areaCol) {
            const vals = data.map(d => d[areaCol]).filter(isFiniteNumber);
            const baseVals = base.map(d => d[areaCol]).filter(isFiniteNumber);
            if (vals.length) {
                const medCur = median(vals);
                const medBase = baseVals.length ? median(baseVals) : NaN;
                secondaryItems.push({
                    label: LABEL_TOTAL_AREA_MEDIAN,
                    display: formatAreaCompactSqM(medCur),
                    gradientKey: 'extra0',
                    sparkline: vals,
                    deltaPct: compare && baseVals.length ? percentChange(medCur, medBase) : null,
                });
            }
        }

        secondaryItems.push({
            label: LABEL_SAMPLE_COUNT,
            display: formatCountCompact(data.length),
            gradientKey: 'count',
            sparkline: sparklineFromCount(data.length),
            deltaPct: compare ? percentChange(data.length, base.length) : null,
        });

        return { heroItem, secondaryItems };
    }, [data, baselineData, summary]);

    const sectionShell = themeClass(theme, {
        dark: 'rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/50 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:p-8 md:p-10',
        light: 'rounded-[1.75rem] border border-zinc-200/90 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_32px_-8px_rgba(0,0,0,0.06)] backdrop-blur-sm sm:p-8 md:p-10',
    });

    const insightsBlock =
        insights.length > 0 ? (
            <div
                className={themeClass(theme, {
                    dark: 'mt-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-5 py-4 sm:px-6 sm:py-5',
                    light: 'mt-6 rounded-2xl border border-zinc-200/90 bg-zinc-50/90 px-5 py-4 sm:px-6 sm:py-5',
                })}
            >
                <p
                    className={themeClass(theme, {
                        dark: 'text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500',
                        light: 'text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500',
                    })}
                >
                    Автоинсайты
                </p>
                <ul className="mt-3 list-none space-y-2.5 p-0">
                    {insights.map(ins => (
                        <li key={ins.id} className="flex gap-2.5 text-sm leading-relaxed">
                            <span
                                className={themeClass(theme, {
                                    dark: 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400/90',
                                    light: 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500',
                                })}
                                aria-hidden
                            />
                            <span
                                className={themeClass(theme, {
                                    dark: 'text-zinc-300',
                                    light: 'text-zinc-700',
                                })}
                            >
                                {ins.text}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        ) : null;

    if (!heroItem && !secondaryItems.length) {
        return (
            <section className={sectionShell} aria-labelledby="kpi-section-title">
                <header className="mb-8 sm:mb-10">
                    <h2
                        id="kpi-section-title"
                        className={themeClass(theme, {
                            dark: 'text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl',
                            light: 'text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl',
                        })}
                    >
                        Обзор рынка
                    </h2>
                </header>
                <div
                    className={themeClass(theme, {
                        dark: 'rounded-2xl border border-dashed border-zinc-700/60 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500',
                        light: 'rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-8 text-center text-sm text-zinc-500',
                    })}
                >
                    Загрузите данные, чтобы увидеть статистику
                </div>
                {insightsBlock}
            </section>
        );
    }

    return (
        <section className={sectionShell} aria-labelledby="kpi-section-title">
            <header className="mb-8 sm:mb-10 md:mb-12">
                <h2
                    id="kpi-section-title"
                    className={themeClass(theme, {
                        dark: 'text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl',
                        light: 'text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl',
                    })}
                >
                    Обзор рынка
                </h2>
                {insightsBlock}
            </header>

            {heroItem && (
                <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch xl:gap-8">
                    <div className="min-w-0 shrink-0 xl:w-[42%] xl:max-w-xl">
                        <KpiStatCard item={heroItem} theme={theme} colorScheme={colorScheme} variant="hero" />
                    </div>
                    {secondaryItems.length > 0 && (
                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
                            {secondaryItems.map((item, idx) => (
                                <KpiStatCard
                                    key={`${item.label}-${idx}`}
                                    item={item}
                                    theme={theme}
                                    colorScheme={colorScheme}
                                    variant="secondary"
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};
