import type { ColumnInfo, CoreColumnMap, DataRow, DataSummary, Range } from '@/types';
import { looksLikeGeolocationPair } from '../../shared/geolocation';
import { collectRoomFilterOptions, resolveRoomsColumn } from '../../shared/rooms';
import { parseNumber } from '@/utils/parseNumber';

const CORE_PRICE = 'Цена';
const CORE_AREA = 'Общая площадь';
const CORE_YEAR_BUILT = 'Год постройки';
const CORE_DISTANCE_KM = 'Расстояние до центра (км)';
const CORE_FLOOR = 'Этаж_относительный';
const CORE_FIRST_FLOOR = 'Первый_этаж';
const CORE_LAST_FLOOR = 'Последний_этаж';

export function normalizeCell(raw: unknown): string | number {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (s === '') return '';
    if (looksLikeGeolocationPair(s)) return s;
    const n = parseNumber(raw);
    if (Number.isFinite(n)) return n;
    return s;
}

export function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

export function rowHasAnyValue(row: DataRow): boolean {
    return Object.values(row).some(v => v !== '' && v != null && !(typeof v === 'number' && Number.isNaN(v)));
}

function buildCoreMap(columnNames: string[], rows: DataRow[]): CoreColumnMap {
    const set = new Set(columnNames);
    return {
        price: set.has(CORE_PRICE) ? CORE_PRICE : null,
        area: set.has(CORE_AREA) ? CORE_AREA : null,
        rooms: resolveRoomsColumn(columnNames, rows),
        yearBuilt: set.has(CORE_YEAR_BUILT) ? CORE_YEAR_BUILT : null,
        distanceKm: set.has(CORE_DISTANCE_KM) ? CORE_DISTANCE_KM : null,
        floor: set.has(CORE_FLOOR) ? CORE_FLOOR : null,
        firstFloor: set.has(CORE_FIRST_FLOOR) ? CORE_FIRST_FLOOR : null,
        lastFloor: set.has(CORE_LAST_FLOOR) ? CORE_LAST_FLOOR : null,
    };
}

function emptyRange(): Range {
    return { min: 0, max: 0 };
}

function pushRange(range: Range, v: number): void {
    if (range.min === 0 && range.max === 0) {
        range.min = v;
        range.max = v;
        return;
    }
    if (v < range.min) range.min = v;
    if (v > range.max) range.max = v;
}

export function buildDataSummary(rows: DataRow[], columnOrder: string[]): DataSummary {
    const colCount = columnOrder.length;
    const numericHits = new Array<number>(colCount).fill(0);
    const valueHits = new Array<number>(colCount).fill(0);

    const coreColumnMap = buildCoreMap(columnOrder, rows);
    const priceCol = coreColumnMap.price;
    const areaCol = coreColumnMap.area;
    const yearBuiltCol = coreColumnMap.yearBuilt;
    const distanceKmCol = coreColumnMap.distanceKm;
    const floorCol = coreColumnMap.floor;

    const price = emptyRange();
    const area = emptyRange();
    const yearBuilt = emptyRange();
    const distanceKm = emptyRange();
    const floor = emptyRange();

    for (const row of rows) {
        for (let i = 0; i < colCount; i += 1) {
            const name = columnOrder[i];
            const v = row[name];
            if (v === '' || v == null) continue;
            valueHits[i] += 1;
            if (isFiniteNumber(v)) numericHits[i] += 1;
        }
        if (priceCol) {
            const v = row[priceCol];
            if (isFiniteNumber(v)) pushRange(price, v);
        }
        if (areaCol) {
            const v = row[areaCol];
            if (isFiniteNumber(v)) pushRange(area, v);
        }
        if (yearBuiltCol) {
            const v = row[yearBuiltCol];
            if (isFiniteNumber(v)) pushRange(yearBuilt, v);
        }
        if (distanceKmCol) {
            const v = row[distanceKmCol];
            if (isFiniteNumber(v)) pushRange(distanceKm, v);
        }
        if (floorCol) {
            const v = row[floorCol];
            if (isFiniteNumber(v)) pushRange(floor, v);
        }
    }

    const columns: ColumnInfo[] = columnOrder.map((name, i) => {
        if (name.startsWith('тип_дома_')) return { name, kind: 'categorical' as const };
        const total = valueHits[i];
        if (total === 0) return { name, kind: 'categorical' as const };
        const kind = numericHits[i] / total >= 0.85 ? ('numeric' as const) : ('categorical' as const);
        return { name, kind };
    });

    const roomsCol = coreColumnMap.rooms;
    const rooms = roomsCol ? collectRoomFilterOptions(rows, roomsCol) : [];
    const houseTypeCols = columnOrder.filter(k => k.startsWith('тип_дома_'));
    const houseTypes = houseTypeCols.map(c => c.replace('тип_дома_', ''));

    return {
        columnOrder,
        columns,
        coreColumnMap,
        price,
        area,
        rooms,
        houseTypes,
        yearBuilt,
        distanceKm,
        floor,
    };
}

/** Пересчёт комнат и coreColumnMap.rooms (нужно при загрузке из localStorage-кэша). */
export function refreshSummaryFromData(rows: DataRow[], summary: DataSummary): DataSummary {
    const roomsCol = resolveRoomsColumn(summary.columnOrder, rows);
    const rooms = roomsCol ? collectRoomFilterOptions(rows, roomsCol) : [];
    return {
        ...summary,
        coreColumnMap: { ...summary.coreColumnMap, rooms: roomsCol },
        rooms,
    };
}

export function collectHouseType(row: Record<string, unknown>, houseTypeCols: string[]): string {
    for (const col of houseTypeCols) {
        if (String(row[col]).trim() === '1') {
            return col.replace('тип_дома_', '');
        }
    }
    return 'Неизвестно';
}
