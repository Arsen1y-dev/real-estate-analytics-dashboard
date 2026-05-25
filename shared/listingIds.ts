import { stripInvisibleChars } from './geolocation';

/** ID объявления в path `/offer/{id}/` и в колонках (10–20 цифр). */
const OFFER_ID_RE = /^\d{10,20}$/;
const OFFER_PATH_RE = /\/offer\/(\d{10,20})\/?/i;

export const OFFER_ID_COLUMN_KEYS = ['ID', 'ID объявления'] as const;

function trimCell(raw: unknown): string {
    return stripInvisibleChars(String(raw ?? '').trim());
}

export function isValidOfferId(id: string): boolean {
    return OFFER_ID_RE.test(id);
}

export function offerUrlFromId(id: string): string {
    return `https://realty.yandex.ru/offer/${id}/`;
}

export function offerIdFromLinkPath(raw: unknown): string | null {
    const v = trimCell(raw);
    if (!v) return null;
    const m = v.match(OFFER_PATH_RE);
    const id = m?.[1];
    return id && isValidOfferId(id) ? id : null;
}

/** Строковое представление ID без отсечения «небезопасных» целых (Yandex id > 2^53). */
export function offerIdFromIdColumn(raw: unknown): string | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return null;
        const s = String(raw);
        return isValidOfferId(s) ? s : null;
    }
    const s = trimCell(raw);
    return isValidOfferId(s) ? s : null;
}

export function offerIdsFromRow(row: Record<string, unknown>): string[] {
    const ids = new Set<string>();
    for (const key of OFFER_ID_COLUMN_KEYS) {
        const id = offerIdFromIdColumn(row[key]);
        if (id) ids.add(id);
    }
    const fromLink = offerIdFromLinkPath(row['Ссылка']);
    if (fromLink) ids.add(fromLink);
    return [...ids];
}

export function httpLinkFromCell(raw: unknown): string | null {
    const v = trimCell(raw);
    if (!v.startsWith('http://') && !v.startsWith('https://')) return null;
    try {
        const url = new URL(v);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch {
        return null;
    }
}

export function listingUrlFromRowCells(row: Record<string, unknown>): string | null {
    const direct = httpLinkFromCell(row['Ссылка']);
    if (direct) return direct;

    const fromPath = offerIdFromLinkPath(row['Ссылка']);
    if (fromPath) return offerUrlFromId(fromPath);

    for (const key of OFFER_ID_COLUMN_KEYS) {
        const fromId = offerIdFromIdColumn(row[key]);
        if (fromId) return offerUrlFromId(fromId);
    }

    return null;
}
