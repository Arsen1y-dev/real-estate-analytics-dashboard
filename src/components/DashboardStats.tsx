import React, { useMemo } from 'react';
import type { DataRow, DataSummary } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatCurrency, formatDashboardMetric } from '@/utils/format';
import { mean, median } from '@/utils/stats';
import { isFiniteNumber } from '@/domain/dataset';
import { statCardGradient, type StatGradientKey } from '@/components/dashboardStatGradients';

const MAX_STAT_CARDS = 8;

/** Колонки, для которых медиана в карточках вводит в заблуждение (нули, смешанные смыслы, координаты). */
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
    return false;
}

/** Дублирует блок «цена / площадь» — среднее и медиана уже выводятся отдельно. */
function isPricePerSquareMeterColumnName(name: string): boolean {
    const l = name.toLowerCase();
    const hasM2 = l.includes('м²') || l.includes('м2') || l.includes('кв.м') || l.includes('кв м');
    if (!hasM2) return false;
    return l.includes('цен') || l.includes('price') || l.includes('руб');
}

export const DashboardStats: React.FC<{ data: DataRow[]; summary: DataSummary; theme: Theme }> = ({ data, summary, theme }) => {
    const { items } = useMemo(() => {
        if (!data.length) return { items: [] as { label: string; value: string; gradientKey: StatGradientKey }[] };

        const list: { label: string; value: string; gradientKey: StatGradientKey }[] = [
            {
                label: 'Объектов в выборке',
                value: data.length.toLocaleString('ru-RU'),
                gradientKey: 'count',
            },
        ];

        const priceCol = summary.coreColumnMap.price;
        const areaCol = summary.coreColumnMap.area;

        if (priceCol) {
            const prices = data.map(d => d[priceCol]).filter(isFiniteNumber);
            if (prices.length) {
                list.push(
                    {
                        label: `Среднее: ${priceCol}`,
                        value: formatCurrency(mean(prices)),
                        gradientKey: 'priceMean',
                    },
                    {
                        label: `Медиана: ${priceCol}`,
                        value: formatCurrency(median(prices)),
                        gradientKey: 'priceMedian',
                    }
                );
            }
        }

        if (areaCol) {
            const areas = data.map(d => d[areaCol]).filter(isFiniteNumber);
            if (areas.length) {
                list.push({
                    label: `Медиана: ${areaCol}`,
                    value: formatDashboardMetric(areaCol, median(areas), areas),
                    gradientKey: 'area',
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
            if (ratios.length) {
                list.push(
                    {
                        label: 'Средняя цена за м²',
                        value: formatCurrency(mean(ratios)),
                        gradientKey: 'rpm2Mean',
                    },
                    {
                        label: 'Медиана цены за м²',
                        value: formatCurrency(median(ratios)),
                        gradientKey: 'rpm2Median',
                    }
                );
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
            if (vals.length) {
                const med = median(vals);
                list.push({
                    label: `Медиана: ${col.name}`,
                    value: formatDashboardMetric(col.name, med, vals),
                    gradientKey: extraKeys[extraIdx % extraKeys.length]!,
                });
                extraIdx += 1;
            }
        }

        return { items: list.slice(0, MAX_STAT_CARDS) };
    }, [data, summary]);

    if (!items.length) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className={themeClass(theme, {
                    dark: 'rounded-2xl border border-dashed border-slate-700/60 bg-slate-950/50 p-4 text-slate-400 text-sm text-center',
                    light: 'rounded-2xl border border-dashed border-slate-300 bg-slate-100 p-4 text-slate-500 text-sm text-center',
                })}>
                    Загрузите данные, чтобы увидеть статистику
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item, idx) => (
                <div key={idx} className={themeClass(theme, {
                    dark: 'relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950/80 p-5 shadow-md shadow-black/20',
                    light: 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-md shadow-slate-200/80',
                })}>
                    <div
                        className="pointer-events-none absolute inset-0 rounded-2xl"
                        style={{ background: statCardGradient(theme, item.gradientKey) }}
                    />
                    <div className="relative z-10 space-y-1.5">
                        <p className={themeClass(theme, {
                            dark: 'text-[11px] font-medium uppercase tracking-wide text-slate-400',
                            light: 'text-[11px] font-medium uppercase tracking-wide text-slate-500',
                        })}>{item.label}</p>
                        <p className={`font-display font-tabular ${themeClass(theme, {
                            dark: 'text-lg font-semibold leading-snug text-white sm:text-xl',
                            light: 'text-lg font-semibold leading-snug text-slate-900 sm:text-xl',
                        })}`}>{item.value}</p>
                    </div>
                </div>
            ))}
        </div>
    );
};
