import type { DataRow } from '@/types';
import { httpLinkFromCell, listingUrlFromRowCells, offerIdsFromRow } from '../../shared/listingIds';

export { offerIdsFromRow } from '../../shared/listingIds';

/** Только колонка «Ссылка» с валидным http(s) URL (для карты, без ID и индекса). */
export function mapListingLinkFromRow(row: DataRow): string | null {
    return httpLinkFromCell(row['Ссылка']);
}

function listingLinkFromRowCells(row: DataRow): string | null {
    return listingUrlFromRowCells(row);
}

/**
 * Индекс id объявления → URL по всем строкам датасета (склейка строк с координатами и без).
 */
export function buildListingLinkIndex(rows: DataRow[]): ReadonlyMap<string, string> {
    const index = new Map<string, string>();
    for (const row of rows) {
        const url = listingLinkFromRowCells(row);
        if (!url) continue;
        for (const id of offerIdsFromRow(row)) {
            if (!index.has(id)) index.set(id, url);
        }
    }
    return index;
}

/**
 * URL объявления: «Ссылка» (http или /offer/…), колонки «ID» / «ID объявления»,
 * затем поиск в linkIndex по id из строки.
 */
export function listingLinkFromRow(row: DataRow, linkIndex?: ReadonlyMap<string, string>): string | null {
    const fromRow = listingLinkFromRowCells(row);
    if (fromRow) return fromRow;

    if (!linkIndex?.size) return null;
    for (const id of offerIdsFromRow(row)) {
        const url = linkIndex.get(id);
        if (url) return url;
    }
    return null;
}
