import { loadCachedDataset } from '@/cache';
import type { DataRow, DataSummary, FilterSettings } from '@/types';
import { isFiniteNumber } from '@/domain/dataset';

/** Пустой `rooms` = без ограничения по комнатности (все планировки). */
export function isRoomFilterActive(roomsFilter: number[], room: number): boolean {
    return roomsFilter.length === 0 || roomsFilter.includes(room);
}

export function createDefaultFiltersFromSummary(summary: DataSummary): FilterSettings {
    return {
        price: { ...summary.price },
        area: { ...summary.area },
        rooms: [],
    };
}

/** Пороги, как раньше на гистограммах: заметное отличие от базового диапазона файла. */
const PRICE_FILTER_EPSILON = 0.5;
const AREA_FILTER_EPSILON = 0.1;

export function isPriceFilterDirty(filters: FilterSettings, baseline: FilterSettings): boolean {
    return (
        Math.abs(filters.price.min - baseline.price.min) > PRICE_FILTER_EPSILON ||
        Math.abs(filters.price.max - baseline.price.max) > PRICE_FILTER_EPSILON
    );
}

export function isAreaFilterDirty(filters: FilterSettings, baseline: FilterSettings): boolean {
    return (
        Math.abs(filters.area.min - baseline.area.min) > AREA_FILTER_EPSILON ||
        Math.abs(filters.area.max - baseline.area.max) > AREA_FILTER_EPSILON
    );
}

/** Отличается от базового (пустой массив = все комнатности). */
export function isRoomsFilterDirty(filters: FilterSettings, baseline: FilterSettings): boolean {
    if (filters.rooms.length !== baseline.rooms.length) return true;
    if (filters.rooms.length === 0) return false;
    const a = [...filters.rooms].sort((x, y) => x - y);
    const b = [...baseline.rooms].sort((x, y) => x - y);
    return a.some((v, i) => v !== b[i]);
}

export function isAnyFilterDirty(filters: FilterSettings, baseline: FilterSettings): boolean {
    return (
        isPriceFilterDirty(filters, baseline) ||
        isAreaFilterDirty(filters, baseline) ||
        isRoomsFilterDirty(filters, baseline)
    );
}

export function rowPassesFilters(row: DataRow, filters: FilterSettings, summary: DataSummary): boolean {
    const c = summary.coreColumnMap;

    if (c.price) {
        const v = row[c.price];
        if (!isFiniteNumber(v)) return false;
        if (v < filters.price.min || v > filters.price.max) return false;
    }

    if (c.area) {
        const v = row[c.area];
        if (!isFiniteNumber(v)) return false;
        if (v < filters.area.min || v > filters.area.max) return false;
    }

    if (c.rooms) {
        const v = row[c.rooms];
        const num = typeof v === 'number' ? v : Number.parseFloat(String(v));
        if (!Number.isFinite(num)) return false;
        const rounded = Math.round(num);
        if (filters.rooms.length > 0 && !filters.rooms.includes(rounded)) return false;
    }

    return true;
}

export function readInitialAppState(): {
    allData: DataRow[] | null;
    dataSummary: DataSummary | null;
    filters: FilterSettings | null;
    baselineFilters: FilterSettings | null;
} {
    if (typeof window === 'undefined') {
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null };
    }
    const cached = loadCachedDataset();
    if (!cached) {
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null };
    }
    const f = createDefaultFiltersFromSummary(cached.summary);
    return {
        allData: cached.data,
        dataSummary: cached.summary,
        filters: f,
        baselineFilters: f,
    };
}

export const INITIAL_APP_STATE = readInitialAppState();
