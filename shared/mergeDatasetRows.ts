import type { DataRow } from './dashboard';
import { looksLikeGeolocationPair, parseGeolocationCell } from './geolocation';
import { isPollutedParserAddress } from './pollutedAddresses';
import {
    OFFER_ID_COLUMN_KEYS,
    listingUrlFromRowCells,
    offerIdFromIdColumn,
    offerIdFromLinkPath,
    offerIdsFromRow,
} from './listingIds';

export type MergeDatasetStats = {
    inputRows: number;
    outputRows: number;
    mergedGroups: number;
    linksFilledOnCoordRows: number;
    coordsFilledOnLinkRows: number;
};

const ADDRESS_COLUMN_CANDIDATES = ['Расположение', 'Адрес', 'address', 'Address', 'address_full'] as const;
const INVALID_ADDRESS_MARKERS = new Set(['nan', 'none', 'null', 'undefined', 'n/a', 'na', '-']);
const NUMERIC_ONLY_RE = /^[+-]?\d+(?:[.,]\d+)?$/;

function isEmptyValue(v: unknown): boolean {
    return v === '' || v == null;
}

function hasCoords(row: DataRow): boolean {
    const lat = row['Широта'];
    const lng = row['Долгота'];
    if (isEmptyValue(lat) || isEmptyValue(lng)) return false;
    const la = typeof lat === 'number' ? lat : Number.parseFloat(String(lat));
    const ln = typeof lng === 'number' ? lng : Number.parseFloat(String(lng));
    return Number.isFinite(la) && Number.isFinite(ln) && !(la === 0 && ln === 0);
}

function hasHttpLink(row: DataRow): boolean {
    const s = String(row['Ссылка'] ?? '').trim();
    return s.startsWith('http://') || s.startsWith('https://');
}

function sanitizeAddressValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'number') return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    if (INVALID_ADDRESS_MARKERS.has(compact)) return null;
    if (NUMERIC_ONLY_RE.test(normalized)) return null;
    if (looksLikeGeolocationPair(normalized)) return null;
    if (isPollutedParserAddress(normalized)) return null;
    return normalized;
}

function normalizeAddressFields(row: DataRow): void {
    let canonicalAddress: string | null = null;
    for (const key of ADDRESS_COLUMN_CANDIDATES) {
        const sanitized = sanitizeAddressValue(row[key]);
        if (sanitized) {
            canonicalAddress = sanitized;
            break;
        }
    }
    for (const key of ADDRESS_COLUMN_CANDIDATES) {
        const raw = row[key];
        if (raw == null || raw === '') continue;
        if (sanitizeAddressValue(raw) === null) row[key] = '';
    }
    if (!canonicalAddress) return;
    row['Расположение'] = canonicalAddress;
    if (isEmptyValue(row['Адрес'])) row['Адрес'] = canonicalAddress;
}

/** Нормализация ID и координат из «Геолокация» (сырой details CSV). */
export function normalizeDatasetRow(row: DataRow): DataRow {
    const out: DataRow = { ...row };
    normalizeAddressFields(out);

    for (const key of OFFER_ID_COLUMN_KEYS) {
        const v = out[key];
        if (v == null || v === '') continue;
        if (typeof v === 'number' && Number.isFinite(v)) {
            out[key] = String(v);
        }
    }

    const primaryId =
        offerIdFromIdColumn(out['ID объявления']) ??
        offerIdFromIdColumn(out.ID) ??
        offerIdFromLinkPath(out['Ссылка']);
    if (primaryId) {
        if (isEmptyValue(out.ID)) out.ID = primaryId;
        if (isEmptyValue(out['ID объявления'])) out['ID объявления'] = primaryId;
    }

    // Канонизируем ссылку: сохраняем только валидный URL объявления или очищаем мусорные значения (nan/null).
    const normalizedUrl = listingUrlFromRowCells(out);
    if (normalizedUrl) {
        out['Ссылка'] = normalizedUrl;
    } else {
        const rawLink = String(out['Ссылка'] ?? '').trim().toLowerCase();
        if (!rawLink || rawLink === 'nan' || rawLink === 'null' || rawLink === 'undefined') {
            out['Ссылка'] = '';
        }
    }

    if (!hasCoords(out)) {
        const geo = parseGeolocationCell(out['Геолокация']);
        if (geo) {
            out['Широта'] = geo.lat;
            out['Долгота'] = geo.lng;
        }
    }

    return out;
}

export function mergeTwoDatasetRows(target: DataRow, source: DataRow): DataRow {
    return mergeRowFields(normalizeDatasetRow(target), normalizeDatasetRow(source));
}

function mergeRowFields(target: DataRow, source: DataRow): DataRow {
    const out: DataRow = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (isEmptyValue(value)) continue;
        if (isEmptyValue(out[key])) {
            out[key] = value;
            continue;
        }
        if (key === 'Ссылка' && !hasHttpLink(out) && hasHttpLink(source)) {
            out[key] = value;
            continue;
        }
        if (key === 'Геолокация' && looksLikeGeolocationPair(value) && !looksLikeGeolocationPair(out[key])) {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Склеивает строки с одним offer id (отдельные загрузки details без координат и ETL без ссылок).
 */
export function mergeDatasetRows(rows: DataRow[]): { rows: DataRow[]; stats: MergeDatasetStats } {
    const normalized = rows.map(normalizeDatasetRow);
    const groups = new Map<string, DataRow[]>();
    const noId: DataRow[] = [];

    for (const row of normalized) {
        const ids = offerIdsFromRow(row);
        if (!ids.length) {
            noId.push(row);
            continue;
        }
        const key = ids[0];
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
    }

    const merged: DataRow[] = [];
    let mergedGroups = 0;
    let linksFilledOnCoordRows = 0;
    let coordsFilledOnLinkRows = 0;

    for (const group of groups.values()) {
        if (group.length === 1) {
            merged.push(group[0]);
            continue;
        }
        mergedGroups += 1;
        let acc = group[0];
        const hadCoord = hasCoords(acc);
        const hadLink = hasHttpLink(acc);
        for (let i = 1; i < group.length; i++) {
            acc = mergeRowFields(acc, group[i]);
        }
        if (!hadLink && hasHttpLink(acc)) linksFilledOnCoordRows += 1;
        if (!hadCoord && hasCoords(acc)) coordsFilledOnLinkRows += 1;
        merged.push(acc);
    }

    merged.push(...noId);

    return {
        rows: merged,
        stats: {
            inputRows: rows.length,
            outputRows: merged.length,
            mergedGroups,
            linksFilledOnCoordRows,
            coordsFilledOnLinkRows,
        },
    };
}
