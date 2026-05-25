import React, { useMemo } from 'react';
import type { DataRow, DataSummary } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';

function isNewBuilding(row: DataRow): boolean {
    const age = Number(row['Возраст дома']);
    if (Number.isFinite(age)) return age <= 3;
    const year = Number(row['Год постройки']);
    const currentYear = new Date().getFullYear();
    if (Number.isFinite(year)) return currentYear - year <= 3;
    const completion = Number(row['Срок сдачи']);
    return Number.isFinite(completion) && completion > 0;
}

function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
    return sorted[mid]!;
}

function collectPrice(data: DataRow[], summary: DataSummary): number[] {
    const col = summary.coreColumnMap.price;
    if (!col) return [];
    return data
        .map(row => (typeof row[col] === 'number' ? row[col] : Number.parseFloat(String(row[col]))))
        .filter(Number.isFinite);
}

export function SegmentComparison({ data, summary, theme }: { data: DataRow[]; summary: DataSummary; theme: Theme }) {
    const [newBuild, resale] = useMemo(() => {
        const left: DataRow[] = [];
        const right: DataRow[] = [];
        for (const row of data) {
            if (isNewBuilding(row)) left.push(row);
            else right.push(row);
        }
        return [left, right];
    }, [data]);
    const newPrices = collectPrice(newBuild, summary);
    const resalePrices = collectPrice(resale, summary);

    return (
        <section className={themeClass(theme, { dark: 'rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5', light: 'rounded-3xl border border-zinc-200 bg-white p-5' })}>
            <h3 className="text-lg font-semibold">Сравнение сегментов</h3>
            <p className={themeClass(theme, { dark: 'mt-1 text-xs text-zinc-400', light: 'mt-1 text-xs text-zinc-600' })}>
                Новостройки (возраст дома ≤ 3 лет) vs вторичка.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className={themeClass(theme, { dark: 'rounded-xl border border-zinc-800 bg-zinc-900/50 p-4', light: 'rounded-xl border border-zinc-200 bg-zinc-50 p-4' })}>
                    <p className="text-sm font-medium">Новостройки</p>
                    <p className="mt-2 text-sm">Объектов: {formatNumber(newBuild.length)}</p>
                    <p className="mt-1 text-sm">Медиана цены: {formatNumber(Math.round(median(newPrices)))}</p>
                </div>
                <div className={themeClass(theme, { dark: 'rounded-xl border border-zinc-800 bg-zinc-900/50 p-4', light: 'rounded-xl border border-zinc-200 bg-zinc-50 p-4' })}>
                    <p className="text-sm font-medium">Вторичка</p>
                    <p className="mt-2 text-sm">Объектов: {formatNumber(resale.length)}</p>
                    <p className="mt-1 text-sm">Медиана цены: {formatNumber(Math.round(median(resalePrices)))}</p>
                </div>
            </div>
        </section>
    );
}
