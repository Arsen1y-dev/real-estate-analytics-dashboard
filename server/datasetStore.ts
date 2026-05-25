import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { DataRow, DataSummary } from '../shared/dashboard';
import {
    UPLOAD_BATCH_ID_FIELD,
    type DatasetMeta,
    type UploadMode,
    publicColumnOrderFromRows,
} from '../shared/datasetServer';
import { collectRoomFilterOptions, resolveRoomsColumn } from '../shared/rooms';
import { looksLikeGeolocationPair, parseGeolocationCell } from '../shared/geolocation';
import { mergeDatasetRows, mergeTwoDatasetRows } from '../shared/mergeDatasetRows';
import { offerIdsFromRow } from '../shared/listingIds';
import type { CityProfile } from '../shared/cities';
import { getCityDistanceLimitKm } from '../shared/cities';

export type DatasetState = { rows: DataRow[]; summary: DataSummary };

const INTERNAL_LEGACY_BATCH = 'legacy';
const DEFAULT_MAX_DISTANCE_FROM_CITY_CENTER_KM = 400;

function parseNumber(raw: unknown): number {
    if (typeof raw === 'number') return raw;
    const s = String(raw ?? '')
        .replace(/\s+/g, '')
        .replace(',', '.')
        .replace(/[^\d.-]/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : Number.NaN;
}

function normalizeCell(raw: unknown): string | number {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (!s) return '';
    if (looksLikeGeolocationPair(s)) return s;
    const n = parseNumber(raw);
    return Number.isFinite(n) ? n : s;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function rangeFromNumbers(values: number[]): { min: number; max: number } {
    if (!values.length) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
}

function withHouseType(row: DataRow, columnOrder: string[]): DataRow {
    const houseTypeCols = columnOrder.filter(k => k.startsWith('тип_дома_'));
    for (const col of houseTypeCols) {
        if (String(row[col]).trim() === '1') return { ...row, houseType: col.replace('тип_дома_', '') };
    }
    return { ...row, houseType: 'Неизвестно' };
}

function buildSummary(rows: DataRow[]): DataSummary {
    const columnOrder = publicColumnOrderFromRows(rows);
    const inferKind = (name: string): 'numeric' | 'categorical' => {
        if (name.startsWith('тип_дома_')) return 'categorical';
        const vals = rows.map(r => r[name]).filter(v => v !== '' && v != null);
        if (!vals.length) return 'categorical';
        const n = vals.filter(isFiniteNumber).length;
        return n / vals.length >= 0.85 ? 'numeric' : 'categorical';
    };
    const columns = columnOrder.map(name => ({ name, kind: inferKind(name) }));
    const set = new Set(columnOrder);
    const coreColumnMap = {
        price: set.has('Цена') ? 'Цена' : null,
        area: set.has('Общая площадь') ? 'Общая площадь' : null,
        rooms: resolveRoomsColumn(columnOrder, rows),
        yearBuilt: set.has('Год постройки') ? 'Год постройки' : null,
        distanceKm: set.has('Расстояние до центра (км)') ? 'Расстояние до центра (км)' : null,
        floor: set.has('Этаж_относительный') ? 'Этаж_относительный' : null,
        firstFloor: set.has('Первый_этаж') ? 'Первый_этаж' : null,
        lastFloor: set.has('Последний_этаж') ? 'Последний_этаж' : null,
    };
    const houseTypes = columnOrder.filter(v => v.startsWith('тип_дома_')).map(v => v.replace('тип_дома_', ''));
    const priceVals = coreColumnMap.price ? rows.map(r => r[coreColumnMap.price]).filter(isFiniteNumber) : [];
    const areaVals = coreColumnMap.area ? rows.map(r => r[coreColumnMap.area]).filter(isFiniteNumber) : [];
    const rooms = coreColumnMap.rooms ? collectRoomFilterOptions(rows, coreColumnMap.rooms) : [];
    const yearVals = coreColumnMap.yearBuilt ? rows.map(r => r[coreColumnMap.yearBuilt]).filter(isFiniteNumber) : [];
    const distVals = coreColumnMap.distanceKm ? rows.map(r => r[coreColumnMap.distanceKm]).filter(isFiniteNumber) : [];
    const floorVals = coreColumnMap.floor ? rows.map(r => r[coreColumnMap.floor]).filter(isFiniteNumber) : [];

    return {
        columnOrder,
        columns,
        coreColumnMap,
        price: rangeFromNumbers(priceVals),
        area: rangeFromNumbers(areaVals),
        rooms,
        houseTypes,
        yearBuilt: rangeFromNumbers(yearVals),
        distanceKm: rangeFromNumbers(distVals),
        floor: rangeFromNumbers(floorVals),
    };
}

function tagRows(rows: DataRow[], batchId: string): DataRow[] {
    return rows.map(r => ({ ...r, [UPLOAD_BATCH_ID_FIELD]: batchId }));
}

function normalizeRowKeys(row: DataRow, columnOrder: string[]): DataRow {
    const out: DataRow = { [UPLOAD_BATCH_ID_FIELD]: row[UPLOAD_BATCH_ID_FIELD] };
    if (row.houseType != null) out.houseType = row.houseType;
    for (const col of columnOrder) {
        if (!(col in row)) {
            out[col] = '';
            continue;
        }
        out[col] = ADDRESS_KEY_SET.has(col) ? sanitizeAddressCell(row[col]) : row[col];
    }
    return withHouseType(out, columnOrder);
}

function rowIdKey(row: DataRow): string | null {
    return offerIdsFromRow(row)[0] ?? null;
}

function parseCoordinate(raw: unknown): number | null {
    if (raw === '' || raw == null) return null;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).trim().replace(',', '.'));
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

function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const c = sinLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinLng ** 2;
    const arc = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    return 6371 * arc;
}

function filterRowsTooFarFromCityCenter(rows: DataRow[], cityProfile: CityProfile | null): {
    rows: DataRow[];
    tooFarFiltered: number;
} {
    if (!cityProfile) return { rows, tooFarFiltered: 0 };
    const maxDistanceKm = getCityDistanceLimitKm(cityProfile.id) ?? DEFAULT_MAX_DISTANCE_FROM_CITY_CENTER_KM;
    const center = { lat: cityProfile.centerLat, lng: cityProfile.centerLng };
    const filtered: DataRow[] = [];
    let tooFarFiltered = 0;
    for (const row of rows) {
        const coords = coordsFromRow(row);
        if (!coords) {
            filtered.push(row);
            continue;
        }
        const distanceKm = haversineDistanceKm(coords, center);
        if (distanceKm > maxDistanceKm) {
            tooFarFiltered += 1;
            continue;
        }
        filtered.push(row);
    }
    return { rows: filtered, tooFarFiltered };
}

const ADDRESS_KEYS = ['Расположение', 'Адрес', 'address', 'address_full'] as const;
const LINK_KEYS = ['Ссылка', 'URL', 'url', 'link', 'href'] as const;
const INVALID_ADDRESS_MARKERS = new Set(['nan', 'none', 'null', 'undefined', 'n/a', 'na', '-']);
const NUMERIC_ONLY_RE = /^[+-]?\d+(?:[.,]\d+)?$/;
const ADDRESS_KEY_SET = new Set<string>(ADDRESS_KEYS);

function firstNonEmptyValue(row: DataRow, keys: readonly string[]): unknown {
    for (const key of keys) {
        const value = row[key];
        if (value == null) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        return value;
    }
    return null;
}

function hasListingIdentity(row: DataRow): boolean {
    if (rowIdKey(row) != null) return true;
    const maybeLink = firstNonEmptyValue(row, LINK_KEYS);
    if (maybeLink == null) return false;
    return String(maybeLink).trim() !== '';
}

function hasValidAddress(row: DataRow): boolean {
    const rawAddress = firstNonEmptyValue(row, ADDRESS_KEYS);
    if (rawAddress == null) return false;
    const normalized = String(rawAddress).trim();
    if (!normalized) return false;
    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    if (INVALID_ADDRESS_MARKERS.has(compact)) return false;
    if (looksLikeGeolocationPair(normalized)) return false;
    return !NUMERIC_ONLY_RE.test(normalized);
}

function sanitizeAddressCell(raw: unknown): string {
    if (raw == null) return '';
    const normalized = String(raw).trim();
    if (!normalized) return '';
    const compact = normalized.toLowerCase().replace(/\s+/g, '');
    if (INVALID_ADDRESS_MARKERS.has(compact)) return '';
    if (NUMERIC_ONLY_RE.test(normalized)) return '';
    if (looksLikeGeolocationPair(normalized)) return '';
    return normalized;
}

function filterInvalidProductRows(rows: DataRow[]): { rows: DataRow[]; droppedInvalid: number } {
    const filtered: DataRow[] = [];
    let droppedInvalid = 0;
    for (const row of rows) {
        const isInvalid = !hasListingIdentity(row) && !coordsFromRow(row) && !hasValidAddress(row);
        if (isInvalid) {
            droppedInvalid += 1;
            continue;
        }
        filtered.push(row);
    }
    return { rows: filtered, droppedInvalid };
}

function applyRowMerge(state: DatasetState): { state: DatasetState; changed: boolean } {
    const { rows, stats } = mergeDatasetRows(state.rows);
    const changed =
        stats.outputRows !== stats.inputRows ||
        stats.mergedGroups > 0 ||
        stats.linksFilledOnCoordRows > 0 ||
        stats.coordsFilledOnLinkRows > 0;
    if (!changed) return { state, changed: false };
    return { state: { rows, summary: buildSummary(rows) }, changed: true };
}

export function parseCsvText(csvText: string): { rows: DataRow[]; summary: DataSummary } {
    const parsed = Papa.parse<Record<string, unknown>>(csvText, { header: true, skipEmptyLines: true });
    const first = parsed.data[0] || {};
    const columnOrder = Object.keys(first);
    const rows = parsed.data
        .map((row): DataRow => {
            const out: DataRow = {};
            for (const col of columnOrder) {
                const normalizedCell = normalizeCell(row[col]);
                out[col] = ADDRESS_KEY_SET.has(col) ? sanitizeAddressCell(normalizedCell) : normalizedCell;
            }
            return withHouseType(out, columnOrder);
        })
        .filter(row => Object.values(row).some(v => v !== '' && v != null));
    const order = publicColumnOrderFromRows(rows, columnOrder);
    const normalized = rows.map(r => normalizeRowKeys(r, order));
    return { rows: normalized, summary: buildSummary(normalized) };
}

export class DatasetStore {
    private datasetPath: string;
    private metaPath: string;
    private defaultCsvPath: string;
    private cityProfile: CityProfile | null;
    state: DatasetState | null = null;
    meta: DatasetMeta;

    constructor(dataDir: string, defaultCsvPath: string, cityProfile: CityProfile | null = null) {
        this.datasetPath = path.join(dataDir, 'dataset.json');
        this.metaPath = path.join(dataDir, 'dataset-meta.json');
        this.defaultCsvPath = defaultCsvPath;
        this.cityProfile = cityProfile;
        this.meta = { rowCount: 0, updatedAt: new Date(0).toISOString(), lastFileName: null, uploads: [] };
    }

    load(): void {
        this.meta = this.loadMeta();
        const fromDisk = this.loadDatasetFromDisk();
        if (fromDisk) {
            const tagged = this.ensureBatchIds(fromDisk);
            const { state: merged, changed: mergeChanged } = applyRowMerge(tagged);
            const filtered = filterRowsTooFarFromCityCenter(merged.rows, this.cityProfile);
            const validated = filterInvalidProductRows(filtered.rows);
            const tooFarChanged = filtered.tooFarFiltered > 0;
            const invalidChanged = validated.droppedInvalid > 0;
            this.state =
                tooFarChanged || invalidChanged
                    ? { rows: validated.rows, summary: buildSummary(validated.rows) }
                    : merged;
            if (mergeChanged || tooFarChanged || invalidChanged) {
                if (tooFarChanged) {
                    console.info(
                        `[dataset] load filtered ${filtered.tooFarFiltered} rows farther than ${getCityDistanceLimitKm(this.cityProfile?.id) ?? DEFAULT_MAX_DISTANCE_FROM_CITY_CENTER_KM}km`
                    );
                }
                if (invalidChanged) {
                    console.info(`[dataset] load dropped ${validated.droppedInvalid} invalid rows`);
                }
                this.persist();
            }
            this.syncMetaFromState();
            return;
        }
        const fromDefault = this.loadDefaultDataset();
        if (fromDefault) {
            const tagged = this.ensureBatchIds(fromDefault);
            const { state: merged } = applyRowMerge(tagged);
            const filtered = filterRowsTooFarFromCityCenter(merged.rows, this.cityProfile);
            const validated = filterInvalidProductRows(filtered.rows);
            this.state = { rows: validated.rows, summary: buildSummary(validated.rows) };
            if (filtered.tooFarFiltered > 0) {
                console.info(
                    `[dataset] default load filtered ${filtered.tooFarFiltered} rows farther than ${getCityDistanceLimitKm(this.cityProfile?.id) ?? DEFAULT_MAX_DISTANCE_FROM_CITY_CENTER_KM}km`
                );
            }
            if (validated.droppedInvalid > 0) {
                console.info(`[dataset] default load dropped ${validated.droppedInvalid} invalid rows`);
            }
            this.persist();
            this.syncMetaFromState();
        }
    }

    private loadMeta(): DatasetMeta {
        if (!fs.existsSync(this.metaPath)) {
            return { rowCount: 0, updatedAt: new Date(0).toISOString(), lastFileName: null, uploads: [] };
        }
        try {
            return JSON.parse(fs.readFileSync(this.metaPath, 'utf8')) as DatasetMeta;
        } catch {
            return { rowCount: 0, updatedAt: new Date(0).toISOString(), lastFileName: null, uploads: [] };
        }
    }

    private persistMeta(): void {
        fs.writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2));
    }

    private loadDatasetFromDisk(): DatasetState | null {
        if (!fs.existsSync(this.datasetPath)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.datasetPath, 'utf8')) as DatasetState;
        } catch {
            return null;
        }
    }

    private loadDefaultDataset(): DatasetState | null {
        if (!fs.existsSync(this.defaultCsvPath)) return null;
        const csv = fs.readFileSync(this.defaultCsvPath, 'utf8');
        return parseCsvText(csv);
    }

    private ensureBatchIds(state: DatasetState): DatasetState {
        const needsTag = state.rows.some(r => r[UPLOAD_BATCH_ID_FIELD] == null || r[UPLOAD_BATCH_ID_FIELD] === '');
        if (!needsTag) return state;
        const rows = tagRows(state.rows, INTERNAL_LEGACY_BATCH);
        return { rows, summary: buildSummary(rows) };
    }

    persist(): void {
        if (!this.state) return;
        fs.writeFileSync(this.datasetPath, JSON.stringify(this.state));
        this.syncMetaFromState();
        this.persistMeta();
    }

    private syncMetaFromState(): void {
        if (!this.state) {
            this.meta.rowCount = 0;
            return;
        }
        this.meta.rowCount = this.state.rows.length;
        this.meta.updatedAt = new Date().toISOString();
    }

    getExportColumns(): string[] {
        return this.state?.summary.columnOrder ?? [];
    }

    ingestCsv(csvText: string, fileName: string, mode: UploadMode): {
        totalRows: number;
        added: number;
        skippedDuplicates: number;
        tooFarFiltered: number;
        droppedInvalid: number;
        hadIdColumn: boolean;
        duplicateByOfferId: number;
    } {
        const parsed = parseCsvText(csvText);
        const filteredParsed = filterRowsTooFarFromCityCenter(parsed.rows, this.cityProfile);
        const batchId = randomUUID();
        const at = new Date().toISOString();

        if (mode === 'replace') {
            const mergedRows = applyRowMerge({
                rows: filteredParsed.rows,
                summary: buildSummary(filteredParsed.rows),
            }).state.rows;
            const validatedRows = filterInvalidProductRows(mergedRows);
            const rows = tagRows(validatedRows.rows, batchId);
            this.state = { rows, summary: buildSummary(rows) };
            this.meta.uploads = [
                {
                    batchId,
                    at,
                    fileName,
                    added: rows.length,
                    skippedDuplicates: 0,
                    tooFarFiltered: filteredParsed.tooFarFiltered,
                    droppedInvalid: validatedRows.droppedInvalid,
                    mode: 'replace',
                },
            ];
            this.meta.lastFileName = fileName;
            this.persist();
            return {
                totalRows: rows.length,
                added: rows.length,
                skippedDuplicates: 0,
                tooFarFiltered: filteredParsed.tooFarFiltered,
                droppedInvalid: validatedRows.droppedInvalid,
                hadIdColumn: rows.some(r => rowIdKey(r) != null),
                duplicateByOfferId: 0,
            };
        }

        const existing = this.state?.rows ?? [];
        const order = publicColumnOrderFromRows([...existing, ...filteredParsed.rows], parsed.summary.columnOrder);
        let hadId = false;
        for (const row of existing) {
            const id = rowIdKey(row);
            if (id != null) {
                hadId = true;
            }
        }

        const merged: DataRow[] = existing.map(r => normalizeRowKeys(r, order));
        let added = 0;
        let skipped = 0;
        let duplicateByOfferId = 0;

        const indexByOfferId = new Map<string, number>();
        for (let i = 0; i < merged.length; i++) {
            const id = rowIdKey(merged[i]);
            if (id != null) indexByOfferId.set(id, i);
        }

        for (const raw of filteredParsed.rows) {
            const base = normalizeRowKeys(raw, order);
            const id = rowIdKey(base);
            if (id != null) {
                hadId = true;
                const existingIdx = indexByOfferId.get(id);
                if (existingIdx != null) {
                    merged[existingIdx] = mergeTwoDatasetRows(merged[existingIdx], {
                        ...base,
                        [UPLOAD_BATCH_ID_FIELD]: batchId,
                    });
                    skipped += 1;
                    duplicateByOfferId += 1;
                    continue;
                }
                indexByOfferId.set(id, merged.length);
            }
            merged.push({ ...base, [UPLOAD_BATCH_ID_FIELD]: batchId });
            added += 1;
        }

        const combined = applyRowMerge({ rows: merged, summary: buildSummary(merged) }).state;
        const validatedCombined = filterInvalidProductRows(combined.rows);
        const finalState =
            validatedCombined.droppedInvalid > 0
                ? { rows: validatedCombined.rows, summary: buildSummary(validatedCombined.rows) }
                : combined;
        this.state = finalState;
        this.meta.uploads.push({
            batchId,
            at,
            fileName,
            added,
            skippedDuplicates: skipped,
            tooFarFiltered: filteredParsed.tooFarFiltered,
            droppedInvalid: validatedCombined.droppedInvalid,
            mode: 'append',
        });
        this.meta.lastFileName = fileName;
        this.persist();

        return {
            totalRows: finalState.rows.length,
            added,
            skippedDuplicates: skipped,
            tooFarFiltered: filteredParsed.tooFarFiltered,
            droppedInvalid: validatedCombined.droppedInvalid,
            hadIdColumn: hadId,
            duplicateByOfferId,
        };
    }

    clearAll(): void {
        this.state = null;
        this.meta = { rowCount: 0, updatedAt: new Date().toISOString(), lastFileName: null, uploads: [] };
        if (fs.existsSync(this.datasetPath)) fs.unlinkSync(this.datasetPath);
        this.persistMeta();
    }

    deleteBatch(batchId: string): { removed: number } | null {
        if (!this.state) return null;
        const upload = this.meta.uploads.find(u => u.batchId === batchId);
        if (!upload) return null;
        const before = this.state.rows.length;
        const rows = this.state.rows.filter(r => String(r[UPLOAD_BATCH_ID_FIELD] ?? '') !== batchId);
        const removed = before - rows.length;
        this.state = rows.length ? { rows, summary: buildSummary(rows) } : null;
        this.meta.uploads = this.meta.uploads.filter(u => u.batchId !== batchId);
        if (this.state) this.persist();
        else this.clearAll();
        return { removed };
    }

    toCsv(rows?: DataRow[]): string {
        if (!this.state) return '';
        const cols = this.getExportColumns();
        const data = rows ?? this.state.rows;
        return Papa.unparse(data, { columns: cols });
    }
}
