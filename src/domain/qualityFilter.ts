import type { DataRow, DataSummary } from '@/types';
import { sanitizeAddressValue } from '@/domain/address';
import { parseNumber } from '@/utils/parseNumber';
import { parseGeolocationCell } from '../../shared/geolocation';
import { listingUrlFromRowCells, offerIdsFromRow } from '../../shared/listingIds';

const ADDRESS_KEYS = ['Адрес', 'address', 'Address'] as const;
const AREA_KEYS = ['Общая площадь', 'area'] as const;
const ROOMS_KEYS = ['Количество комнат', 'Комнаты', 'rooms'] as const;
function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

function isMeaningfulAddress(value: unknown): boolean {
    return sanitizeAddressValue(value) != null;
}

function firstNonEmpty(row: DataRow, keys: readonly string[]): unknown {
    for (const key of keys) {
        const value = row[key];
        if (normalizeText(value)) return value;
    }
    return null;
}

function hasValidCoords(row: DataRow): boolean {
    const lat = parseNumber(row['Широта']);
    const lng = parseNumber(row['Долгота']);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const inRange = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
        const nonZero = lat !== 0 || lng !== 0;
        if (inRange && nonZero) return true;
    }
    return parseGeolocationCell(row['Геолокация']) != null;
}

function hasValidPrice(row: DataRow, summary: DataSummary): boolean {
    const priceCol = summary.coreColumnMap.price ?? 'Цена';
    const price = parseNumber(row[priceCol]);
    return Number.isFinite(price) && price > 0;
}

function hasAreaOrRooms(row: DataRow, summary: DataSummary): boolean {
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;
    if (areaCol) {
        const area = parseNumber(row[areaCol]);
        if (Number.isFinite(area) && area > 0) return true;
    }
    if (roomsCol) {
        const rooms = parseNumber(row[roomsCol]);
        if (Number.isFinite(rooms) && rooms >= 0) return true;
    }

    const fallbackArea = parseNumber(firstNonEmpty(row, AREA_KEYS));
    if (Number.isFinite(fallbackArea) && fallbackArea > 0) return true;
    const fallbackRooms = parseNumber(firstNonEmpty(row, ROOMS_KEYS));
    if (Number.isFinite(fallbackRooms) && fallbackRooms >= 0) return true;
    return false;
}

function hasKeyListingFields(row: DataRow, summary: DataSummary): boolean {
    if (listingUrlFromRowCells(row)) return true;
    if (offerIdsFromRow(row).length > 0) return true;
    if (hasValidPrice(row, summary)) return true;
    return hasAreaOrRooms(row, summary);
}

export function isLowQualityListingRow(row: DataRow, summary: DataSummary): boolean {
    const address = firstNonEmpty(row, ADDRESS_KEYS);
    const hasAddress = isMeaningfulAddress(address);
    const hasCoords = hasValidCoords(row);
    const hasKeyFields = hasKeyListingFields(row, summary);
    return !hasAddress && !hasCoords && !hasKeyFields;
}

export function applyListingQualityFilter(rows: DataRow[], summary: DataSummary): {
    rows: DataRow[];
    droppedCount: number;
} {
    if (!rows.length) return { rows, droppedCount: 0 };
    const cleaned = rows.filter(row => !isLowQualityListingRow(row, summary));
    return { rows: cleaned, droppedCount: Math.max(0, rows.length - cleaned.length) };
}
