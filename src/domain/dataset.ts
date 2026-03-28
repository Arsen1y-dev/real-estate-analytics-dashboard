import type { ColumnInfo, CoreColumnMap, DataRow, DataSummary, Range } from '@/types';
import { parseNumber } from '@/utils/parseNumber';

const CORE_PRICE = 'Цена';
const CORE_AREA = 'Общая площадь';
const CORE_ROOMS = 'Количество комнат';

export function normalizeCell(raw: unknown): string | number {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (s === '') return '';
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

function inferColumnKind(name: string, values: unknown[]): 'numeric' | 'categorical' {
    if (name.startsWith('тип_дома_')) return 'categorical';
    let numeric = 0;
    let total = 0;
    for (const v of values) {
        if (v === '' || v == null) continue;
        total += 1;
        if (isFiniteNumber(v)) numeric += 1;
    }
    if (total === 0) return 'categorical';
    return numeric / total >= 0.85 ? 'numeric' : 'categorical';
}

function buildCoreMap(columnNames: string[]): CoreColumnMap {
    const set = new Set(columnNames);
    return {
        price: set.has(CORE_PRICE) ? CORE_PRICE : null,
        area: set.has(CORE_AREA) ? CORE_AREA : null,
        rooms: set.has(CORE_ROOMS) ? CORE_ROOMS : null,
    };
}

function rangeFromNumbers(values: number[]): Range {
    if (!values.length) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
}

export function buildDataSummary(rows: DataRow[], columnOrder: string[]): DataSummary {
    const columns: ColumnInfo[] = columnOrder.map(name => {
        const vals = rows.map(r => r[name]);
        return { name, kind: inferColumnKind(name, vals) };
    });

    const coreColumnMap = buildCoreMap(columnOrder);

    const priceCol = coreColumnMap.price;
    const areaCol = coreColumnMap.area;
    const roomsCol = coreColumnMap.rooms;

    const prices = priceCol ? rows.map(r => r[priceCol]).filter(isFiniteNumber) : [];
    const areas = areaCol ? rows.map(r => r[areaCol]).filter(isFiniteNumber) : [];
    const roomsRaw = roomsCol ? rows.map(r => r[roomsCol]).filter(v => isFiniteNumber(v) || (typeof v === 'string' && v !== '')) : [];
    const rooms = [
        ...new Set(
            roomsRaw.map(v => (typeof v === 'number' ? Math.round(v) : Math.round(Number.parseFloat(String(v)))))
        ),
    ]
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);

    const houseTypeCols = columnOrder.filter(k => k.startsWith('тип_дома_'));
    const houseTypes = houseTypeCols.map(c => c.replace('тип_дома_', ''));

    return {
        columnOrder,
        columns,
        coreColumnMap,
        price: rangeFromNumbers(prices),
        area: rangeFromNumbers(areas),
        rooms,
        houseTypes,
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
