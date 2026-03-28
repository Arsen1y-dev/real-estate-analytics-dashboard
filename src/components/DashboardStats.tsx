import React, { useMemo } from 'react';
import type { DataRow, DataSummary } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { mean, median } from '@/utils/stats';
import { isFiniteNumber } from '@/domain/dataset';
import { statCardSurface, type StatGradientKey } from '@/components/dashboardStatGradients';
import { MetricSparkline, type MetricSparklineSize } from '@/components/MetricSparkline';
import {
    formatAreaCompactSqM,
    formatCountCompact,
    formatExtraMedianCompact,
    formatPercentDelta,
    formatRubCompact,
    formatRubPerM2Compact,
    percentChange,
} from '@/utils/metricDisplay';
import { generateMarketInsights } from '@/domain/insights';

const MAX_STAT_CARDS = 7;

function columnExcludedFromExtraMedian(name: string): boolean {
    const l = name.toLowerCase();
    if (l.includes('срок') && (l.includes('сдач') || l.includes('сдачи'))) return true;
    if (l.includes('срок_сдач')) return true;
    if (l.includes('год построй') || l.includes('год_построй')) return true;
    if (l.includes('широт')) return true;
    if (l.includes('долгот')) return true;
    if (isPricePerSquareMeterColumnName(name)) return true;
    if (l.includes('возраст') && l.includes('дом')) return true;
    if (l.includes('возраст_дом')) return true;
    if (l.includes('ремонт')) return true;
    if (l.includes('расстоян') && (l.includes('центр') || l.includes('км'))) return true;
    if (l.includes('distance') && l.includes('center')) return true;
    return false;
}

function isPricePerSquareMeterColumnName(name: string): boolean {
    const l = name.toLowerCase();
    const hasM2 = l.includes('м²') || l.includes('м2') || l.includes('кв.м') || l.includes('кв м');
    if (!hasM2) return false;
    return l.includes('цен') || l.includes('price') || l.includes('руб');
}

function sparklineFromCount(n: number): number[] {
    if (n < 2) return [];
    const steps = Math.min(36, n);
    return Array.from({ length: steps }, (_, i) => Math.round(((i + 1) / steps) * n));
}

/** Индекс главного KPI: медиана цены → медиана ₽/м² → медиана площади → первый не «количество». */
function pickHeroCardIndex(items: BuiltCard[]): number {
    if (items.length <= 1) return 0;
    const byKey = (k: StatGradientKey) => items.findIndex(i => i.gradientKey === k);
    const priceMed = byKey('priceMedian');
    if (priceMed >= 0) return priceMed;
    const rpm2Med = byKey('rpm2Median');
    if (rpm2Med >= 0) return rpm2Med;
    const area = byKey('area');
    if (area >= 0) return area;
    const nonCount = items.findIndex(i => i.gradientKey !== 'count');
    return nonCount >= 0 ? nonCount : 0;
}

export type DashboardStatsProps = {
    data: DataRow[];
    /** Полный файл — для сравнения «к файлу» и базовых медиан. */
    baselineData?: DataRow[];
    summary: DataSummary;
    theme: Theme;
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
    variant: 'hero' | 'secondary';
};

function isMarketHeroKey(k: StatGradientKey): boolean {
    return k === 'priceMedian' || k === 'priceMean' || k === 'rpm2Median' || k === 'rpm2Mean' || k === 'area';
}

function KpiStatCard({ item, theme, variant }: KpiCardProps) {
    const showDelta = item.deltaPct != null && Number.isFinite(item.deltaPct);
    const smallDelta = showDelta && Math.abs(item.deltaPct!) < 0.05;
    const isHero = variant === 'hero';
    const sparkSize: MetricSparklineSize = isHero ? 'hero' : 'default';
    const showHeroBadge = isHero && isMarketHeroKey(item.gradientKey);

    const shell = themeClass(theme, {
        dark: isHero
            ? 'relative flex min-h-[10.5rem] flex-col overflow-hidden rounded-3xl border border-zinc-800/90 shadow-[0_1px_2px_rgba(0,0,0,0.2),0_12px_40px_-12px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.04]'
            : 'relative flex min-h-[7.25rem] flex-col overflow-hidden rounded-2xl border border-zinc-800/80 shadow-sm shadow-black/25',
        light: isHero
            ? 'relative flex min-h-[10.5rem] flex-col overflow-hidden rounded-3xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.08)] ring-1 ring-zinc-950/[0.03]'
            : 'relative flex min-h-[7.25rem] flex-col overflow-hidden rounded-2xl border border-zinc-200/85 bg-white/90 shadow-sm shadow-zinc-900/5',
    });

    const labelCls = themeClass(theme, {
        dark: isHero
            ? 'text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500'
            : 'text-[10px] font-medium uppercase tracking-wide text-zinc-500/90',
        light: isHero
            ? 'text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500'
            : 'text-[10px] font-medium uppercase tracking-wide text-zinc-500',
    });

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
                    {showHeroBadge && (
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
                            <span
                                className={`inline-flex items-center gap-1 rounded-md tabular-nums ${
                                    isHero ? 'px-2.5 py-1 text-xs font-semibold' : 'px-2 py-0.5 text-[11px] font-semibold'
                                } ${
                                    smallDelta
                                        ? themeClass(theme, {
                                              dark: 'bg-zinc-800/90 text-zinc-400',
                                              light: 'bg-zinc-100 text-zinc-500',
                                          })
                                        : item.deltaPct! > 0
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
                                {!smallDelta && <span aria-hidden>{item.deltaPct! > 0 ? '↑' : '↓'}</span>}
                                {smallDelta
                                    ? '≈ 0%'
                                    : `${item.deltaPct! > 0 ? '+' : '−'}${formatPercentDelta(item.deltaPct!)}%`}
                            </span>
                            <span
                                className={themeClass(theme, {
                                    dark: `font-medium text-zinc-500 ${isHero ? 'text-[11px]' : 'text-[10px]'}`,
                                    light: `font-medium text-zinc-500 ${isHero ? 'text-[11px]' : 'text-[10px]'}`,
                                })}
                            >
                                к полному файлу
                            </span>
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

export const DashboardStats: React.FC<DashboardStatsProps> = ({ data, baselineData, summary, theme }) => {
    const insights = useMemo(() => generateMarketInsights(data, summary), [data, summary]);

    const items = useMemo((): BuiltCard[] => {
        if (!data.length) return [];

        const base = baselineData?.length ? baselineData : data;
        const compare = baselineData && baselineData.length > 0 && baselineData !== data;

        const list: BuiltCard[] = [
            {
                label: 'Объектов в выборке',
                display: formatCountCompact(data.length),
                gradientKey: 'count',
                sparkline: sparklineFromCount(data.length),
                deltaPct: compare ? percentChange(data.length, base.length) : null,
            },
        ];

        const priceCol = summary.coreColumnMap.price;
        const areaCol = summary.coreColumnMap.area;

        if (priceCol) {
            const prices = data.map(d => d[priceCol]).filter(isFiniteNumber);
            const basePrices = base.map(d => d[priceCol]).filter(isFiniteNumber);
            if (prices.length) {
                const mCur = mean(prices);
                const mBase = basePrices.length ? mean(basePrices) : NaN;
                list.push({
                    label: `Среднее: ${priceCol}`,
                    display: formatRubCompact(mCur),
                    gradientKey: 'priceMean',
                    sparkline: prices,
                    deltaPct: compare && basePrices.length ? percentChange(mCur, mBase) : null,
                });
                const medCur = median(prices);
                const medBase = basePrices.length ? median(basePrices) : NaN;
                list.push({
                    label: `Медиана: ${priceCol}`,
                    display: formatRubCompact(medCur),
                    gradientKey: 'priceMedian',
                    sparkline: prices,
                    deltaPct: compare && basePrices.length ? percentChange(medCur, medBase) : null,
                });
            }
        }

        if (areaCol) {
            const areas = data.map(d => d[areaCol]).filter(isFiniteNumber);
            const baseAreas = base.map(d => d[areaCol]).filter(isFiniteNumber);
            if (areas.length) {
                const medCur = median(areas);
                const medBase = baseAreas.length ? median(baseAreas) : NaN;
                list.push({
                    label: `Медиана: ${areaCol}`,
                    display: formatAreaCompactSqM(medCur),
                    gradientKey: 'area',
                    sparkline: areas,
                    deltaPct: compare && baseAreas.length ? percentChange(medCur, medBase) : null,
                });
            }
        }

        if (priceCol && areaCol) {
            const ratios = data
                .map(d => {
                    const p = d[priceCol];
                    const a = d[areaCol];
                    if (!isFiniteNumber(p) || !isFiniteNumber(a) || a <= 0) return NaN;
                    return p / a;
                })
                .filter(v => Number.isFinite(v));
            const baseRatios = base
                .map(d => {
                    const p = d[priceCol];
                    const a = d[areaCol];
                    if (!isFiniteNumber(p) || !isFiniteNumber(a) || a <= 0) return NaN;
                    return p / a;
                })
                .filter(v => Number.isFinite(v));
            if (ratios.length) {
                const meanCur = mean(ratios);
                const meanBase = baseRatios.length ? mean(baseRatios) : NaN;
                list.push({
                    label: 'Средняя цена за м²',
                    display: formatRubPerM2Compact(meanCur),
                    gradientKey: 'rpm2Mean',
                    sparkline: ratios,
                    deltaPct: compare && baseRatios.length ? percentChange(meanCur, meanBase) : null,
                });
                const medCur = median(ratios);
                const medBase = baseRatios.length ? median(baseRatios) : NaN;
                list.push({
                    label: 'Медиана цены за м²',
                    display: formatRubPerM2Compact(medCur),
                    gradientKey: 'rpm2Median',
                    sparkline: ratios,
                    deltaPct: compare && baseRatios.length ? percentChange(medCur, medBase) : null,
                });
            }
        }

        const roomsCol = summary.coreColumnMap.rooms;
        const extraNumeric = summary.columns
            .filter(
                c =>
                    c.kind === 'numeric' &&
                    c.name !== priceCol &&
                    c.name !== areaCol &&
                    c.name !== roomsCol &&
                    c.name !== 'houseType' &&
                    !columnExcludedFromExtraMedian(c.name)
            )
            .slice(0, 3);

        const extraKeys: StatGradientKey[] = ['extra0', 'extra1', 'extra2'];
        let extraIdx = 0;
        for (const col of extraNumeric) {
            const vals = data.map(d => d[col.name]).filter(isFiniteNumber);
            const baseVals = base.map(d => d[col.name]).filter(isFiniteNumber);
            if (vals.length) {
                const medCur = median(vals);
                const medBase = baseVals.length ? median(baseVals) : NaN;
                list.push({
                    label: `Медиана: ${col.name}`,
                    display: formatExtraMedianCompact(col.name, medCur, vals),
                    gradientKey: extraKeys[extraIdx % extraKeys.length]!,
                    sparkline: vals,
                    deltaPct: compare && baseVals.length ? percentChange(medCur, medBase) : null,
                });
                extraIdx += 1;
            }
        }

        return list.slice(0, MAX_STAT_CARDS);
    }, [data, baselineData, summary]);

    const sectionShell = themeClass(theme, {
        dark: 'rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/50 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:p-8 md:p-10',
        light: 'rounded-[1.75rem] border border-zinc-200/90 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_32px_-8px_rgba(0,0,0,0.06)] backdrop-blur-sm sm:p-8 md:p-10',
    });

    if (!items.length) {
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
                    <p
                        className={themeClass(theme, {
                            dark: 'mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400',
                            light: 'mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600',
                        })}
                    >
                        Ключевые показатели по текущей выборке и сравнение с полным файлом после фильтрации.
                    </p>
                </header>
                <div
                    className={themeClass(theme, {
                        dark: 'rounded-2xl border border-dashed border-zinc-700/60 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500',
                        light: 'rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-8 text-center text-sm text-zinc-500',
                    })}
                >
                    Загрузите данные, чтобы увидеть статистику
                </div>
            </section>
        );
    }

    const heroIdx = pickHeroCardIndex(items);
    const heroItem = items[heroIdx]!;
    const secondaryItems = items.filter((_, i) => i !== heroIdx);

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
                <p
                    className={themeClass(theme, {
                        dark: 'mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400',
                        light: 'mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600',
                    })}
                >
                    Ключевые показатели по текущей выборке. Главный показатель выделен; остальные метрики — для
                    контекста.
                </p>
                {insights.length > 0 && (
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
                )}
            </header>

            <div
                className={
                    secondaryItems.length === 0
                        ? 'space-y-0'
                        : 'flex flex-col gap-6 xl:flex-row xl:items-stretch xl:gap-8'
                }
            >
                <div className={secondaryItems.length === 0 ? 'w-full' : 'min-w-0 shrink-0 xl:w-[42%] xl:max-w-xl'}>
                    <KpiStatCard item={heroItem} theme={theme} variant="hero" />
                </div>
                {secondaryItems.length > 0 && (
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-2">
                        {secondaryItems.map((item, idx) => (
                            <KpiStatCard key={`${item.label}-${idx}`} item={item} theme={theme} variant="secondary" />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
};
