import type { DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import {
    isCategoryBarsColumnAllowed,
    isHistogramColumnAllowed,
    isScatterAxisColumnAllowed,
} from '@/domain/chartColumnRules';

export function columnSignature(summary: DataSummary): string {
    return summary.columnOrder.join('\x1e');
}

export function normalizeFilterRanges(filters: FilterSettings): FilterSettings {
    const fallbackRange = { min: 0, max: 0 };
    const safeYear = filters.yearBuilt ?? fallbackRange;
    const safeDistance = filters.distanceKm ?? fallbackRange;
    const safeFloor = filters.floor ?? fallbackRange;
    const out: FilterSettings = {
        price: { ...filters.price },
        area: { ...filters.area },
        rooms: [...filters.rooms],
        yearBuilt: { ...safeYear },
        distanceKm: { ...safeDistance },
        floor: { ...safeFloor },
        houseTypes: [...(filters.houseTypes ?? [])],
        excludeFirstFloor: Boolean(filters.excludeFirstFloor),
        excludeLastFloor: Boolean(filters.excludeLastFloor),
        radiusKm: filters.radiusKm ?? null,
        additionalFilters: Array.isArray(filters.additionalFilters) ? [...filters.additionalFilters] : [],
    };
    if (out.price.min > out.price.max) {
        [out.price.min, out.price.max] = [out.price.max, out.price.min];
    }
    if (out.area.min > out.area.max) {
        [out.area.min, out.area.max] = [out.area.max, out.area.min];
    }
    if (out.yearBuilt.min > out.yearBuilt.max) {
        [out.yearBuilt.min, out.yearBuilt.max] = [out.yearBuilt.max, out.yearBuilt.min];
    }
    if (out.distanceKm.min > out.distanceKm.max) {
        [out.distanceKm.min, out.distanceKm.max] = [out.distanceKm.max, out.distanceKm.min];
    }
    if (out.floor.min > out.floor.max) {
        [out.floor.min, out.floor.max] = [out.floor.max, out.floor.min];
    }
    return out;
}

export function sanitizeFilters(filters: FilterSettings, summary: DataSummary): FilterSettings {
    const columnKinds = new Map(summary.columns.map(col => [col.name, col.kind] as const));
    const sanitizedAdditional = (filters.additionalFilters ?? []).flatMap((condition, index) => {
        const column = String(condition?.column ?? '').trim();
        if (!column || !columnKinds.has(column)) return [];
        const kind = columnKinds.get(column) ?? 'categorical';
        const id = String(condition?.id ?? '').trim() || `af-${index + 1}`;
        const value = String(condition?.value ?? '').trim();
        const valueTo = String(condition?.valueTo ?? '').trim();
        if (kind === 'numeric') {
            const op = condition?.operator;
            if (op !== 'gte' && op !== 'lte' && op !== 'between') return [];
            const from = Number.parseFloat(value);
            if (!Number.isFinite(from)) return [];
            if (op === 'between') {
                const to = Number.parseFloat(valueTo);
                if (!Number.isFinite(to)) return [];
            }
            return [{ id, column, operator: op, value, valueTo: op === 'between' ? valueTo : undefined }];
        }
        const op = condition?.operator;
        if (op !== 'equals' && op !== 'contains') return [];
        if (!value) return [];
        return [{ id, column, operator: op, value }];
    });

    const { price: p, area: a, rooms: roomOpts, yearBuilt: y, distanceKm: d, floor: f } = summary;
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
        yearBuilt: {
            min: Math.min(Math.max(filters.yearBuilt.min, y.min), y.max),
            max: Math.max(Math.min(filters.yearBuilt.max, y.max), y.min),
        },
        distanceKm: {
            min: Math.min(Math.max(filters.distanceKm.min, d.min), d.max),
            max: Math.max(Math.min(filters.distanceKm.max, d.max), d.min),
        },
        floor: {
            min: Math.min(Math.max(filters.floor.min, f.min), f.max),
            max: Math.max(Math.min(filters.floor.max, f.max), f.min),
        },
        houseTypes: filters.houseTypes.filter(v => summary.houseTypes.includes(v)),
        excludeFirstFloor: Boolean(filters.excludeFirstFloor),
        excludeLastFloor: Boolean(filters.excludeLastFloor),
        radiusKm:
            filters.radiusKm == null
                ? null
                : Math.max(
                      d.min,
                      Math.min(filters.radiusKm, d.max)
                  ),
        additionalFilters: sanitizedAdditional,
    };
    return normalizeFilterRanges(next);
}

export function sanitizeUserCharts(charts: UserChartDefinition[], summary: DataSummary): UserChartDefinition[] {
    const names = new Set(summary.columnOrder);
    const columnBy = new Map(summary.columns.map(c => [c.name, c] as const));
    return charts.filter(c => {
        if (c.type !== 'histogram' && c.type !== 'scatter' && c.type !== 'categoryBars') return false;
        if (!names.has(c.column)) return false;
        if (c.type === 'histogram') {
            const col = columnBy.get(c.column);
            return Boolean(col && isHistogramColumnAllowed(col));
        }
        if (c.type === 'categoryBars') {
            const col = columnBy.get(c.column);
            return Boolean(col && isCategoryBarsColumnAllowed(col, summary));
        }
        if (c.type === 'scatter') {
            const x = c.xColumn ?? c.column;
            const y = c.yColumn;
            if (!y || !names.has(x) || !names.has(y)) return false;
            const xCol = columnBy.get(x);
            const yCol = columnBy.get(y);
            return Boolean(xCol && yCol && isScatterAxisColumnAllowed(xCol) && isScatterAxisColumnAllowed(yCol));
        }
        return false;
    });
}
