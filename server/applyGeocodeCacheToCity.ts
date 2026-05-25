/**
 * Переносит адреса из SQLite-кэша reverse geocoding в датасет города.
 * Запуск: npx tsx server/applyGeocodeCacheToCity.ts moscow
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildCanonicalReverseGeocodeKey } from '../shared/reverseGeocodeKey';
import { isKnownCityId } from '../shared/cities';
import type { DataRow } from '../shared/dashboard';
import { parseGeolocationCell } from '../shared/geolocation';
import { sanitizeAddressValue } from '../shared/mergeDatasetRows';

const ROOT = process.cwd();
const SERVER_DATA_DIR = path.join(ROOT, 'server', 'data');
const DB_PATH = path.join(SERVER_DATA_DIR, 'app.db');

const ADDRESS_KEYS = ['Адрес', 'Расположение', 'address', 'address_full'] as const;

type CacheRow = { cache_key: string; lat: number; lng: number; address: string };
type CacheEntry = { cacheKey: string; lat: number; lng: number; address: string };

function parseCoordinate(raw: unknown): number | null {
    if (raw === '' || raw == null) return null;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function coordsFromRow(row: DataRow): { lat: number; lng: number } | null {
    const lat = parseCoordinate(row['Широта']);
    const lng = parseCoordinate(row['Долгота']);
    if (lat != null && lng != null) {
        const inRange = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
        const nonZero = lat !== 0 || lng !== 0;
        if (inRange && nonZero) return { lat, lng };
    }
    return parseGeolocationCell(row['Геолокация']);
}

function rowAddress(row: DataRow): string {
    for (const key of ADDRESS_KEYS) {
        const sanitized = sanitizeAddressValue(row[key]);
        if (sanitized) return sanitized;
    }
    return '';
}

function clearInvalidAddressFields(row: DataRow): void {
    for (const key of ADDRESS_KEYS) {
        const raw = row[key];
        if (raw == null || raw === '') continue;
        if (sanitizeAddressValue(raw) === null) row[key] = '';
    }
}

function loadCache(db: Database.Database): Map<string, CacheEntry> {
    const out = new Map<string, CacheEntry>();
    for (const row of db
        .prepare('SELECT cache_key, lat, lng, address FROM reverse_geocode_cache WHERE length(trim(address)) > 0')
        .iterate() as Iterable<CacheRow>) {
        out.set(row.cache_key, {
            cacheKey: row.cache_key,
            lat: row.lat,
            lng: row.lng,
            address: row.address,
        });
    }
    return out;
}

function lookupAddress(
    cache: Map<string, CacheEntry>,
    lat: number,
    lng: number,
): string | null {
    const canonical = buildCanonicalReverseGeocodeKey(lat, lng);
    if (!canonical) return null;
    const direct = cache.get(canonical.cacheKey);
    if (direct?.address) return direct.address.trim();
    const epsilon = 0.5 * 10 ** -5 + 1e-9;
    for (const entry of cache.values()) {
        if (
            Math.abs(entry.lat - canonical.lat) <= epsilon &&
            Math.abs(entry.lng - canonical.lng) <= epsilon
        ) {
            return entry.address.trim();
        }
    }
    return null;
}

function main(): void {
    const cityId = String(process.argv[2] ?? 'moscow').trim();
    if (!isKnownCityId(cityId)) {
        console.error(`Неизвестный город: ${cityId}`);
        process.exit(1);
    }

    const cityDir = path.join(SERVER_DATA_DIR, 'cities', cityId);
    const datasetPath = path.join(cityDir, 'dataset.json');
    if (!fs.existsSync(datasetPath)) {
        console.error(`Нет датасета: ${datasetPath}`);
        process.exit(1);
    }

    const db = new Database(DB_PATH, { readonly: true });
    const cache = loadCache(db);
    db.close();

    const state = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as { rows: DataRow[]; summary?: unknown };
    const rows = state.rows;
    let alreadyHadAddress = 0;
    let filledFromCache = 0;
    let stillMissing = 0;
    let noCoords = 0;
    const applied: Array<{ lat: number; lng: number; address: string }> = [];

    for (const row of rows) {
        clearInvalidAddressFields(row);
        if (rowAddress(row)) {
            alreadyHadAddress += 1;
            continue;
        }
        const coords = coordsFromRow(row);
        if (!coords) {
            noCoords += 1;
            stillMissing += 1;
            continue;
        }
        const address = lookupAddress(cache, coords.lat, coords.lng);
        if (!address) {
            stillMissing += 1;
            continue;
        }
        row['Адрес'] = address;
        if ('Расположение' in row) row['Расположение'] = address;
        filledFromCache += 1;
        applied.push({ lat: coords.lat, lng: coords.lng, address });
    }

    const exportPath = path.join(cityDir, 'geocode-cache-applied.json');
    fs.writeFileSync(
        exportPath,
        JSON.stringify(
            {
                cityId,
                exportedAt: new Date().toISOString(),
                cacheEntries: cache.size,
                appliedCount: applied.length,
                applied,
            },
            null,
            2,
        ),
    );

    fs.writeFileSync(datasetPath, JSON.stringify({ ...state, rows }));
    const metaPath = path.join(cityDir, 'dataset-meta.json');
    if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    console.info(
        [
            `[geocode-apply] city=${cityId}`,
            `cache=${cache.size}`,
            `rows=${rows.length}`,
            `alreadyHadAddress=${alreadyHadAddress}`,
            `filledFromCache=${filledFromCache}`,
            `stillMissing=${stillMissing}`,
            `noCoords=${noCoords}`,
            `export=${exportPath}`,
        ].join(' '),
    );
}

main();
