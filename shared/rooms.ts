import type { DataRow } from './dashboard';

/** Максимум комнат для фильтра и проверки столбца (студия = 0). */
export const MAX_ROOM_FILTER = 10;

const CORE_ROOMS = 'Количество комнат';

export function parseRoomCount(raw: unknown): number | null {
    if (raw === '' || raw == null) return null;
    const n =
        typeof raw === 'number'
            ? Math.round(raw)
            : Math.round(Number.parseFloat(String(raw).replace(/\s+/g, '').replace(',', '.')));
    if (!Number.isFinite(n) || n < 0 || n > MAX_ROOM_FILTER) return null;
    return n;
}

export function collectRoomFilterOptions(rows: DataRow[], column: string): number[] {
    const set = new Set<number>();
    for (const row of rows) {
        const n = parseRoomCount(row[column]);
        if (n != null) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
}

function columnLooksLikeRooms(rows: DataRow[], column: string): boolean {
    const options = collectRoomFilterOptions(rows, column);
    if (options.length === 0) return false;
    if (options.length >= 3) return true;

    let valid = 0;
    let invalid = 0;
    for (const row of rows) {
        const raw = row[column];
        if (raw === '' || raw == null) continue;
        if (parseRoomCount(raw) != null) {
            valid += 1;
            continue;
        }
        const n =
            typeof raw === 'number'
                ? Math.round(raw)
                : Math.round(Number.parseFloat(String(raw).replace(/\s+/g, '').replace(',', '.')));
        if (Number.isFinite(n)) invalid += 1;
    }
    const total = valid + invalid;
    if (total < 3) return options.length > 0;
    return valid / total >= 0.6;
}

/** Находит столбец с планировкой; отсекает колонки, где вместо комнат — цены или ID. */
export function resolveRoomsColumn(columnOrder: string[], rows: DataRow[]): string | null {
    const candidates: string[] = [];
    if (columnOrder.includes(CORE_ROOMS)) candidates.push(CORE_ROOMS);
    for (const name of columnOrder) {
        if (name === CORE_ROOMS) continue;
        if (/комнат/i.test(name) && !/площад|цен|м²|м2/i.test(name)) candidates.push(name);
    }
    for (const col of candidates) {
        const options = collectRoomFilterOptions(rows, col);
        if (col === CORE_ROOMS && options.length > 0) return col;
        if (columnLooksLikeRooms(rows, col)) return col;
    }
    return null;
}
