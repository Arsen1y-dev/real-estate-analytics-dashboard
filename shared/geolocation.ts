/** Строка «широта,долгота» (пробелы вокруг запятой допустимы). */
const GEO_PAIR_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;

export function stripInvisibleChars(s: string): string {
    return s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Не превращать в одно число при импорте CSV (parseNumber съедает запятую). */
export function looksLikeGeolocationPair(raw: unknown): boolean {
    if (raw == null || raw === '') return false;
    if (typeof raw === 'number') return false;
    const s = stripInvisibleChars(String(raw).trim());
    return GEO_PAIR_RE.test(s);
}

/**
 * Парсит ячейку «Геолокация» вида `55.74952300,37.53183840` (lat,lng).
 */
export function parseGeolocationCell(raw: unknown): { lat: number; lng: number } | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return null;

    const s = stripInvisibleChars(String(raw).trim()).replace(/\s+/g, '');
    const m = s.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;

    const lat = Number.parseFloat(m[1]);
    const lng = Number.parseFloat(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
}
