import type { AdditionalFilterCondition, DataRow, DataSummary, FilterSettings } from './dashboard';
import { isBinaryFeatureColumn } from './columnFilterKind';
import { parseRoomCount } from './rooms';

export function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function asNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    const n = Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : Number.NaN;
}

function asBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    const t = String(v).trim().toLowerCase();
    return t === '1' || t === 'true' || t === 'yes';
}

function isRangeFilterActive(
    range: { min: number; max: number },
    baseline: { min: number; max: number },
    epsilon = 1e-9
): boolean {
    return Math.abs(range.min - baseline.min) > epsilon || Math.abs(range.max - baseline.max) > epsilon;
}

function distanceKmFromCoords(row: DataRow, centerLat: number, centerLng: number): number | null {
    const lat = asNumber(row['Широта']);
    const lng = asNumber(row['Долгота']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat - centerLat);
    const dLng = toRad(lng - centerLng);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(centerLat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
}

const summaryColumnKindCache = new WeakMap<DataSummary, Map<string, 'numeric' | 'categorical'>>();

function getSummaryColumnKindMap(summary: DataSummary): Map<string, 'numeric' | 'categorical'> {
    const cached = summaryColumnKindCache.get(summary);
    if (cached) return cached;
    const next = new Map(summary.columns.map(col => [col.name, col.kind] as const));
    summaryColumnKindCache.set(summary, next);
    return next;
}

function rowPassesAdditionalCondition(
    row: DataRow,
    condition: AdditionalFilterCondition,
    columnKinds: Map<string, 'numeric' | 'categorical'>
): boolean {
    const raw = row[condition.column];
    if (isBinaryFeatureColumn(condition.column)) {
        const wantYes = condition.value !== '0';
        return asBool(raw) === wantYes;
    }
    const kind = columnKinds.get(condition.column) ?? 'categorical';
    if (kind === 'numeric') {
        const value = asNumber(raw);
        if (!Number.isFinite(value)) return false;
        const from = asNumber(condition.value);
        if (condition.operator === 'gte') {
            return Number.isFinite(from) && value >= from;
        }
        if (condition.operator === 'lte') {
            return Number.isFinite(from) && value <= from;
        }
        if (condition.operator === 'between') {
            const to = asNumber(condition.valueTo);
            if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
            const min = Math.min(from, to);
            const max = Math.max(from, to);
            return value >= min && value <= max;
        }
        return false;
    }

    const text = String(raw ?? '').trim().toLowerCase();
    const query = String(condition.value ?? '').trim().toLowerCase();
    if (!query) return false;
    if (condition.operator === 'equals') return text === query;
    if (condition.operator === 'contains') return text.includes(query);
    return false;
}

export function rowPassesFiltersShared(row: DataRow, filters: FilterSettings, summary: DataSummary): boolean {
    const c = summary.coreColumnMap;
    const priceActive = isRangeFilterActive(filters.price, summary.price, 0.5);
    const areaActive = isRangeFilterActive(filters.area, summary.area, 0.1);
    const roomsActive = filters.rooms.length > 0;
    const yearBuiltActive = isRangeFilterActive(filters.yearBuilt, summary.yearBuilt, 1);
    const distanceActive = isRangeFilterActive(filters.distanceKm, summary.distanceKm, 0.1);

    if (c.price && priceActive) {
        const v = row[c.price];
        if (!isFiniteNumber(v)) return false;
        if (v < filters.price.min || v > filters.price.max) return false;
    }

    if (c.area && areaActive) {
        const v = row[c.area];
        if (!isFiniteNumber(v)) return false;
        if (v < filters.area.min || v > filters.area.max) return false;
    }

    if (c.rooms) {
        const rounded = parseRoomCount(row[c.rooms]);
        if (roomsActive) {
            if (rounded == null) return false;
            if (!filters.rooms.includes(rounded)) return false;
        }
    }

    if (c.yearBuilt && yearBuiltActive) {
        const v = asNumber(row[c.yearBuilt]);
        if (!Number.isFinite(v)) return false;
        if (v < filters.yearBuilt.min || v > filters.yearBuilt.max) return false;
    }

    if (c.distanceKm && distanceActive) {
        const v = asNumber(row[c.distanceKm]);
        if (!Number.isFinite(v)) return false;
        if (v < filters.distanceKm.min || v > filters.distanceKm.max) return false;
    }

    if (filters.radiusKm != null && c.distanceKm) {
        const v = asNumber(row[c.distanceKm]);
        if (!Number.isFinite(v) || v > filters.radiusKm) return false;
    } else if (filters.radiusKm != null) {
        const center = summary.cityCenter ?? { lat: 55.7558, lng: 37.6176 };
        const d = distanceKmFromCoords(row, center.lat, center.lng);
        if (d == null || d > filters.radiusKm) return false;
    }

    if (filters.houseTypes.length > 0) {
        const ht = String(row.houseType ?? '').trim();
        if (!filters.houseTypes.includes(ht)) return false;
    }

    if (filters.excludeFirstFloor && c.firstFloor && asBool(row[c.firstFloor])) return false;
    if (filters.excludeLastFloor && c.lastFloor && asBool(row[c.lastFloor])) return false;
    if (filters.additionalFilters.length > 0) {
        const columnKinds = getSummaryColumnKindMap(summary);
        for (const condition of filters.additionalFilters) {
            if (!rowPassesAdditionalCondition(row, condition, columnKinds)) return false;
        }
    }

    return true;
}
