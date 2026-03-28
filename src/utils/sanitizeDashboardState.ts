import type { DataSummary, FilterSettings, UserChartDefinition } from '@/types';

export function columnSignature(summary: DataSummary): string {
    return summary.columnOrder.join('\x1e');
}

export function normalizeFilterRanges(filters: FilterSettings): FilterSettings {
    const out: FilterSettings = {
        price: { ...filters.price },
        area: { ...filters.area },
        rooms: [...filters.rooms],
    };
    if (out.price.min > out.price.max) {
        [out.price.min, out.price.max] = [out.price.max, out.price.min];
    }
    if (out.area.min > out.area.max) {
        [out.area.min, out.area.max] = [out.area.max, out.area.min];
    }
    return out;
}

export function sanitizeFilters(filters: FilterSettings, summary: DataSummary): FilterSettings {
    const { price: p, area: a, rooms: roomOpts } = summary;
    const next: FilterSettings = {
        price: {
            min: Math.min(Math.max(filters.price.min, p.min), p.max),
            max: Math.max(Math.min(filters.price.max, p.max), p.min),
        },
        area: {
            min: Math.min(Math.max(filters.area.min, a.min), a.max),
            max: Math.max(Math.min(filters.area.max, a.max), a.min),
        },
        rooms: filters.rooms.filter(r => roomOpts.includes(r)),
    };
    return normalizeFilterRanges(next);
}

export function sanitizeUserCharts(charts: UserChartDefinition[], summary: DataSummary): UserChartDefinition[] {
    const names = new Set(summary.columnOrder);
    const kindBy = new Map(summary.columns.map(c => [c.name, c.kind] as const));
    return charts.filter(c => {
        if (!names.has(c.column)) return false;
        if (c.type === 'histogram') {
            return kindBy.get(c.column) === 'numeric';
        }
        if (c.type === 'categoryBars') {
            return kindBy.get(c.column) === 'categorical';
        }
        if (c.type === 'scatter') {
            const x = c.xColumn ?? c.column;
            const y = c.yColumn;
            if (!y || !names.has(x) || !names.has(y)) return false;
            return kindBy.get(x) === 'numeric' && kindBy.get(y) === 'numeric';
        }
        return false;
    });
}
