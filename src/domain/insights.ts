import type { DataRow, DataSummary } from '@/types';
import { isFiniteNumber } from '@/domain/dataset';
import { mean, quantile } from '@/utils/stats';
import { formatAreaCompactSqM, formatRubCompact, formatRubPerM2Compact } from '@/utils/metricDisplay';

export type MarketInsight = {
    id: string;
    text: string;
};

function pluralObjects(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'объектов';
    if (mod10 === 1) return 'объект';
    if (mod10 >= 2 && mod10 <= 4) return 'объекта';
    return 'объектов';
}

/**
 * Короткие текстовые инсайты по текущей выборке (цена, площадь, комнаты, выбросы).
 */
export function generateMarketInsights(data: DataRow[], summary: DataSummary): MarketInsight[] {
    const out: MarketInsight[] = [];
    if (!data.length) return out;

    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;

    if (priceCol) {
        const prices = data.map(d => d[priceCol]).filter(isFiniteNumber);
        if (prices.length >= 5) {
            const sorted = [...prices].sort((a, b) => a - b);
            const p60 = quantile(sorted, 0.6);
            out.push({
                id: 'price-p60',
                text: `Большинство квартир стоят до ${formatRubCompact(p60)} (около 60% выборки не дороже этой суммы).`,
            });

            const q1 = quantile(sorted, 0.25);
            const q3 = quantile(sorted, 0.75);
            const iqr = q3 - q1;
            if (iqr > 0 && prices.length >= 8) {
                const upper = q3 + 1.5 * iqr;
                const outlierCount = prices.filter(p => p > upper).length;
                if (outlierCount > 0) {
                    out.push({
                        id: 'price-outliers-iqr',
                        text: `Есть выбросы по цене: ${outlierCount} ${pluralObjects(outlierCount)} дороже ${formatRubCompact(upper)} (верхняя граница по методу IQR).`,
                    });
                }
            }
        } else if (prices.length >= 1) {
            const mx = Math.max(...prices);
            out.push({
                id: 'price-max-small-n',
                text: `Максимальная цена в выборке — ${formatRubCompact(mx)}.`,
            });
        }
    }

    if (areaCol) {
        const areas = data.map(d => d[areaCol]).filter(isFiniteNumber);
        if (areas.length >= 1) {
            const m = mean(areas);
            out.push({
                id: 'area-mean',
                text: `Средняя площадь — ${formatAreaCompactSqM(m)}.`,
            });
        }
    }

    if (roomsCol) {
        const counts = new Map<number, number>();
        let withRooms = 0;
        for (const row of data) {
            const v = row[roomsCol];
            const num = typeof v === 'number' ? v : Number.parseFloat(String(v));
            if (!Number.isFinite(num)) continue;
            withRooms += 1;
            const r = Math.round(num);
            counts.set(r, (counts.get(r) ?? 0) + 1);
        }
        const sortedRooms = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const top = sortedRooms[0];
        if (top && withRooms >= 3) {
            const [rooms, cnt] = top;
            const share = (cnt / withRooms) * 100;
            out.push({
                id: 'rooms-mode',
                text: `Наиболее частая планировка — ${rooms} комн. (${share.toFixed(0)}% выборки).`,
            });
        }
    }

    if (priceCol && areaCol) {
        const ratios: number[] = [];
        for (const row of data) {
            const p = row[priceCol];
            const a = row[areaCol];
            if (!isFiniteNumber(p) || !isFiniteNumber(a) || a <= 0) continue;
            ratios.push(p / a);
        }
        if (ratios.length >= 5) {
            const med = quantile([...ratios].sort((a, b) => a - b), 0.5);
            out.push({
                id: 'rpm2-median',
                text: `Медианная цена за м² — ${formatRubPerM2Compact(med)}.`,
            });
        }
    }

    const seen = new Set<string>();
    const deduped: MarketInsight[] = [];
    for (const item of out) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        deduped.push(item);
    }

    return deduped.slice(0, 6);
}
