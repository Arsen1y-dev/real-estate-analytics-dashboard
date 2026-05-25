import { loadCachedDataset } from '@/cache';
import type { DataRow, DataSummary, FilterSettings } from '@/types';
import { rowPassesFiltersShared } from '../../shared/filters';
import { mergeDatasetRows } from '../../shared/mergeDatasetRows';
import { refreshSummaryFromData } from '@/domain/dataset';
import { applyListingQualityFilter } from '@/domain/qualityFilter';

type PersonalCacheState = {
    allData: DataRow[] | null;
    dataSummary: DataSummary | null;
    filters: FilterSettings | null;
    baselineFilters: FilterSettings | null;
    fileKey: string | null;
};

let memoizedPersonalState: PersonalCacheState | null = null;
let memoizedPersonalFileKey: string | null = null;

/** Пустой `rooms` = без ограничения по комнатности (все планировки). */
export function isRoomFilterActive(roomsFilter: number[], room: number): boolean {
    return roomsFilter.length === 0 || roomsFilter.includes(room);
}

export function createDefaultFiltersFromSummary(summary: DataSummary): FilterSettings {
    return {
        price: { ...summary.price },
        area: { ...summary.area },
        rooms: [],
        yearBuilt: { ...summary.yearBuilt },
        distanceKm: { ...summary.distanceKm },
        floor: { ...summary.floor },
        houseTypes: [],
        excludeFirstFloor: false,
        excludeLastFloor: false,
        radiusKm: null,
        additionalFilters: [],
    };
}

/** Пороги, как раньше на гистограммах: заметное отличие от базового диапазона файла. */
const PRICE_FILTER_EPSILON = 0.5;
const AREA_FILTER_EPSILON = 0.1;
const YEAR_FILTER_EPSILON = 1;
const DISTANCE_FILTER_EPSILON = 0.1;

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
    const additionalDirty =
        filters.additionalFilters.length !== baseline.additionalFilters.length ||
        filters.additionalFilters.some((item, idx) => {
            const base = baseline.additionalFilters[idx];
            if (!base) return true;
            return (
                item.column !== base.column ||
                item.operator !== base.operator ||
                item.value !== base.value ||
                (item.valueTo ?? '') !== (base.valueTo ?? '')
            );
        });
    return (
        isPriceFilterDirty(filters, baseline) ||
        isAreaFilterDirty(filters, baseline) ||
        isRoomsFilterDirty(filters, baseline) ||
        Math.abs(filters.yearBuilt.min - baseline.yearBuilt.min) > YEAR_FILTER_EPSILON ||
        Math.abs(filters.yearBuilt.max - baseline.yearBuilt.max) > YEAR_FILTER_EPSILON ||
        Math.abs(filters.distanceKm.min - baseline.distanceKm.min) > DISTANCE_FILTER_EPSILON ||
        Math.abs(filters.distanceKm.max - baseline.distanceKm.max) > DISTANCE_FILTER_EPSILON ||
        filters.excludeFirstFloor !== baseline.excludeFirstFloor ||
        filters.excludeLastFloor !== baseline.excludeLastFloor ||
        (filters.radiusKm ?? null) !== (baseline.radiusKm ?? null) ||
        filters.houseTypes.length !== baseline.houseTypes.length ||
        additionalDirty
    );
}

export function rowPassesFilters(row: DataRow, filters: FilterSettings, summary: DataSummary): boolean {
    return rowPassesFiltersShared(row, filters, summary);
}

export function readPersonalCacheState(): {
    allData: DataRow[] | null;
    dataSummary: DataSummary | null;
    filters: FilterSettings | null;
    baselineFilters: FilterSettings | null;
    fileKey: string | null;
} {
    if (typeof window === 'undefined') {
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null, fileKey: null };
    }
    const cached = loadCachedDataset();
    if (!cached) {
        memoizedPersonalState = null;
        memoizedPersonalFileKey = null;
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null, fileKey: null };
    }
    if (memoizedPersonalState && memoizedPersonalFileKey === cached.fileKey) {
        return memoizedPersonalState;
    }
    const { rows: mergedRows } = mergeDatasetRows(cached.data);
    const mergedSummary = refreshSummaryFromData(mergedRows, cached.summary);
    const { rows: qualityRows } = applyListingQualityFilter(mergedRows, mergedSummary);
    const dataSummary = refreshSummaryFromData(qualityRows, mergedSummary);
    const f = createDefaultFiltersFromSummary(dataSummary);
    const computed: PersonalCacheState = {
        allData: qualityRows,
        dataSummary,
        filters: f,
        baselineFilters: f,
        fileKey: cached.fileKey,
    };
    memoizedPersonalFileKey = cached.fileKey;
    memoizedPersonalState = computed;
    return computed;
}

/** Начальное состояние без данных — гидратация после входа по роли и источнику. */
export const INITIAL_APP_STATE = {
    allData: null as DataRow[] | null,
    dataSummary: null as DataSummary | null,
    filters: null as FilterSettings | null,
    baselineFilters: null as FilterSettings | null,
};
