import type { DataRow } from '@/types';

export const ADDRESS_COLUMN_CANDIDATES = ['Расположение', 'Адрес', 'address', 'Address', 'address_full'] as const;

const INVALID_ADDRESS_MARKERS = new Set(['nan', 'none', 'null', 'undefined', 'n/a', 'na', '-']);
const NUMERIC_ONLY_RE = /^[+-]?\d+(?:[.,]\d+)?$/;
const COORD_PAIR_RE = /^[+-]?\d+(?:[.,]\d+)?\s*,\s*[+-]?\d+(?:[.,]\d+)?$/;

export function sanitizeAddressValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'number') return null;

    const normalized = String(value).trim();
    if (!normalized) return null;

    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    if (INVALID_ADDRESS_MARKERS.has(compact)) return null;
    if (NUMERIC_ONLY_RE.test(normalized)) return null;
    if (COORD_PAIR_RE.test(normalized)) return null;
    return normalized;
}

export function firstAddressValue(row: DataRow): unknown {
    for (const key of ADDRESS_COLUMN_CANDIDATES) {
        const value = row[key];
        if (value != null && String(value).trim() !== '') return value;
    }
    return null;
}

export function addressFromRow(row: DataRow): string | null {
    return sanitizeAddressValue(firstAddressValue(row));
}
