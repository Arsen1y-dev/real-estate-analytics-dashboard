import type Database from 'better-sqlite3';
import {
    REVERSE_GEOCODE_KEY_PRECISION,
    buildCanonicalReverseGeocodeKey,
    hasValidReverseGeocodeCoords,
    normalizeReverseGeocodeKey,
} from '../shared/reverseGeocodeKey';

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7_000;

type ReverseGeocodeSource = 'cache' | 'online' | 'fallback';
type FallbackReason =
    | 'no_api_key'
    | 'invalid-key'
    | 'upstream_error'
    | 'rate_limited'
    | 'network_error'
    | 'api-error'
    | 'parse_error'
    | 'public_fallback_error'
    | 'all_fallbacks_failed';

type ReverseProvider = 'cache' | 'yandex-key' | 'yandex-public' | 'nominatim-public';

export type ReverseGeocodeResponse = {
    cacheKey: string;
    address: string | null;
    source: ReverseGeocodeSource;
    fallbackReason: FallbackReason | null;
    provider: ReverseProvider;
};

type CacheRow = {
    cache_key: string;
    address: string;
    expires_at: number;
};

type ProgressSnapshot = {
    total: number;
    processed: number;
    resolved: number;
    cache: number;
    fallback: number;
    queued: number;
    byKey: Record<string, { address: string; source: 'cache' | 'queued' }>;
};

type SaveOutcome = 'ok' | 'failed';

function parseTtlMs(raw: string | undefined): number {
    const parsedDays = Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) return DEFAULT_TTL_MS;
    return Math.round(parsedDays * 24 * 60 * 60 * 1000);
}

function parseYandexAddress(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const root = payload as {
        response?: {
            GeoObjectCollection?: {
                featureMember?: Array<{
                    GeoObject?: {
                        metaDataProperty?: {
                            GeocoderMetaData?: {
                                text?: string;
                                Address?: { formatted?: string };
                            };
                        };
                        description?: string;
                        name?: string;
                    };
                }>;
            };
        };
    };
    const first = root.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text = first?.metaDataProperty?.GeocoderMetaData?.text?.trim();
    if (text) return text;
    const formatted = first?.metaDataProperty?.GeocoderMetaData?.Address?.formatted?.trim();
    if (formatted) return formatted;
    const compound = [first?.description, first?.name].filter(Boolean).join(', ').trim();
    return compound || null;
}

function parseNominatimAddress(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const root = payload as { display_name?: unknown };
    const displayName = typeof root.display_name === 'string' ? root.display_name.trim() : '';
    return displayName || null;
}

function looksLikeInvalidApiKey(status: number, payloadText: string): boolean {
    if (status === 401 || status === 403) return true;
    if (!payloadText) return false;
    const normalized = payloadText.toLowerCase();
    const mentionsApiKey = normalized.includes('apikey') || normalized.includes('api key') || normalized.includes('api-key');
    const mentionsInvalidity =
        normalized.includes('invalid') ||
        normalized.includes('denied') ||
        normalized.includes('forbidden') ||
        normalized.includes('unauthorized');
    return mentionsApiKey && mentionsInvalidity;
}

function summarizePayload(payloadText: string): string {
    return payloadText.replace(/\s+/g, ' ').trim().slice(0, 280);
}

export class ReverseGeocoderService {
    private readonly apiKey: string;
    private readonly ttlMs: number;
    private readonly precision: number;
    private readonly memoryCache = new Map<string, { address: string; expiresAt: number }>();
    private readonly inFlight = new Map<string, Promise<ReverseGeocodeResponse>>();
    private readonly selectCacheStmt;
    private readonly selectCacheByCoordsStmt;
    private readonly upsertCacheStmt;

    constructor(db: Database.Database) {
        this.apiKey = String(process.env.YANDEX_GEOCODER_API_KEY ?? '').trim();
        this.ttlMs = parseTtlMs(process.env.REVERSE_GEOCODE_TTL_DAYS);
        this.precision = REVERSE_GEOCODE_KEY_PRECISION;
        db.exec(`
CREATE TABLE IF NOT EXISTS reverse_geocode_cache (
  cache_key TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reverse_geocode_expires_at
  ON reverse_geocode_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_reverse_geocode_lat_lng
  ON reverse_geocode_cache(lat, lng);
`);
        this.selectCacheStmt = db.prepare(
            'SELECT cache_key, address, expires_at FROM reverse_geocode_cache WHERE cache_key = ? LIMIT 1'
        );
        this.selectCacheByCoordsStmt = db.prepare(`
SELECT cache_key, address, expires_at
FROM reverse_geocode_cache
WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
ORDER BY expires_at DESC
LIMIT 1
`);
        this.upsertCacheStmt = db.prepare(`
INSERT INTO reverse_geocode_cache(cache_key, lat, lng, address, updated_at, expires_at)
VALUES(@cache_key, @lat, @lng, @address, @updated_at, @expires_at)
ON CONFLICT(cache_key) DO UPDATE SET
  address = excluded.address,
  updated_at = excluded.updated_at,
  expires_at = excluded.expires_at;
`);
    }

    private logDev(event: string, payload: Record<string, unknown>): void {
        if (process.env.NODE_ENV === 'production') return;
        const details = Object.entries(payload)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(' ');
        // eslint-disable-next-line no-console
        console.info(`[reverse-geocode] ${event}${details ? ` ${details}` : ''}`);
    }

    getDebugState(): { hasApiKey: boolean; apiKeyLength: number } {
        return {
            hasApiKey: Boolean(this.apiKey),
            apiKeyLength: this.apiKey.length,
        };
    }

    buildCacheKey(latRaw: number, lngRaw: number): { cacheKey: string; lat: number; lng: number } {
        const canonical = buildCanonicalReverseGeocodeKey(latRaw, lngRaw);
        if (!canonical) {
            throw new Error('Некорректные координаты');
        }
        return canonical;
    }

    normalizeCacheKey(raw: string): { cacheKey: string; lat: number; lng: number } | null {
        return normalizeReverseGeocodeKey(raw);
    }

    getProgressSnapshot(rawKeys: string[]): ProgressSnapshot {
        const uniqueKeys = new Set<string>();
        for (const raw of rawKeys) {
            const normalized = this.normalizeCacheKey(raw);
            if (!normalized) continue;
            uniqueKeys.add(normalized.cacheKey);
        }
        const now = Date.now();
        const byKey: Record<string, { address: string; source: 'cache' | 'queued' }> = {};
        let cache = 0;
        let queued = 0;
        for (const cacheKey of uniqueKeys) {
            const normalized = this.normalizeCacheKey(cacheKey);
            if (!normalized) continue;
            const fromMemory = this.memoryCache.get(cacheKey);
            if (fromMemory?.address && fromMemory.expiresAt > now) {
                byKey[cacheKey] = { address: fromMemory.address, source: 'cache' };
                cache += 1;
                continue;
            }
            const dbRow = this.lookupCacheRow(cacheKey, normalized.lat, normalized.lng);
            if (dbRow?.address && dbRow.expires_at > now) {
                this.memoryCache.set(cacheKey, { address: dbRow.address, expiresAt: dbRow.expires_at });
                byKey[cacheKey] = { address: dbRow.address, source: 'cache' };
                cache += 1;
                continue;
            }
            byKey[cacheKey] = { address: '', source: 'queued' };
            queued += 1;
        }
        const total = uniqueKeys.size;
        const processed = cache;
        this.logDev('snapshot', { total, cacheHits: cache, queueRemainder: queued });
        return {
            total,
            processed,
            resolved: 0,
            cache,
            fallback: 0,
            queued,
            byKey,
        };
    }

    async reverse(latRaw: number, lngRaw: number): Promise<ReverseGeocodeResponse> {
        if (!hasValidReverseGeocodeCoords(latRaw, lngRaw)) {
            throw new Error('Некорректные координаты');
        }
        const { cacheKey, lat, lng } = this.buildCacheKey(latRaw, lngRaw);
        const fromMemory = this.memoryCache.get(cacheKey);
        const now = Date.now();
        if (fromMemory && fromMemory.expiresAt > now) {
            return { cacheKey, address: fromMemory.address, source: 'cache', fallbackReason: null, provider: 'cache' };
        }
        const pending = this.inFlight.get(cacheKey);
        if (pending) return pending;
        const run = this.reverseWithCache(lat, lng, cacheKey);
        this.inFlight.set(cacheKey, run);
        try {
            return await run;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    private async reverseWithCache(lat: number, lng: number, cacheKey: string): Promise<ReverseGeocodeResponse> {
        const now = Date.now();
        const dbRow = this.lookupCacheRow(cacheKey, lat, lng);
        if (dbRow?.address) {
            this.memoryCache.set(cacheKey, { address: dbRow.address, expiresAt: dbRow.expires_at });
            if (dbRow.expires_at > now) {
                return { cacheKey, address: dbRow.address, source: 'cache', fallbackReason: null, provider: 'cache' };
            }
        }
        let lastFailure: FallbackReason = this.apiKey ? 'api-error' : 'no_api_key';

        if (this.apiKey) {
            const yandexWithKey = await this.fetchYandexAddress(lat, lng, this.apiKey);
            if (yandexWithKey.address) {
                this.saveCache(cacheKey, lat, lng, yandexWithKey.address);
                return { cacheKey, address: yandexWithKey.address, source: 'online', fallbackReason: null, provider: 'yandex-key' };
            }
            lastFailure = yandexWithKey.reason;
        }

        const yandexWithoutKey = await this.fetchYandexAddress(lat, lng, null);
        if (yandexWithoutKey.address) {
            this.saveCache(cacheKey, lat, lng, yandexWithoutKey.address);
            return { cacheKey, address: yandexWithoutKey.address, source: 'online', fallbackReason: null, provider: 'yandex-public' };
        }
        lastFailure = yandexWithoutKey.reason;

        const nominatim = await this.fetchNominatimAddress(lat, lng);
        if (nominatim.address) {
            this.saveCache(cacheKey, lat, lng, nominatim.address);
            return {
                cacheKey,
                address: nominatim.address,
                source: 'online',
                fallbackReason: null,
                provider: 'nominatim-public',
            };
        }
        lastFailure = nominatim.reason;

        if (dbRow?.address) {
            return {
                cacheKey,
                address: dbRow.address,
                source: 'cache',
                fallbackReason: lastFailure,
                provider: 'cache',
            };
        }
        return {
            cacheKey,
            address: null,
            source: 'fallback',
            fallbackReason: lastFailure || 'all_fallbacks_failed',
            provider: 'nominatim-public',
        };
    }

    private async fetchYandexAddress(
        lat: number,
        lng: number,
        apiKey: string | null
    ): Promise<{ address: string | null; reason: FallbackReason }> {
        const url = new URL('https://geocode-maps.yandex.ru/v1/');
        if (apiKey) url.searchParams.set('apikey', apiKey);
        url.searchParams.set('geocode', `${lng},${lat}`);
        url.searchParams.set('format', 'json');
        url.searchParams.set('lang', 'ru_RU');
        url.searchParams.set('results', '1');

        try {
            const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (!resp.ok) {
                const bodyText = await resp.text().catch(() => '');
                const reason: FallbackReason =
                    resp.status === 429
                        ? 'rate_limited'
                        : looksLikeInvalidApiKey(resp.status, bodyText)
                          ? 'invalid-key'
                          : resp.status >= 500
                            ? 'upstream_error'
                            : 'api-error';
                if (process.env.NODE_ENV !== 'production') {
                    // eslint-disable-next-line no-console
                    console.warn(
                        `[reverse-geocode] yandex(${apiKey ? 'key' : 'public'}) status=${resp.status} reason=${reason} body="${summarizePayload(bodyText)}"`
                    );
                }
                return { address: null, reason };
            }
            const json = (await resp.json()) as unknown;
            const address = parseYandexAddress(json);
            if (!address) return { address: null, reason: 'parse_error' };
            return { address, reason: 'api-error' };
        } catch {
            return { address: null, reason: 'network_error' };
        }
    }

    private async fetchNominatimAddress(lat: number, lng: number): Promise<{ address: string | null; reason: FallbackReason }> {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lng));
        url.searchParams.set('accept-language', 'ru');

        try {
            const resp = await fetch(url.toString(), {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: {
                    'User-Agent': 'real-estate-analytics-dashboard/1.0 (reverse geocoder fallback)',
                },
            });
            if (!resp.ok) {
                return { address: null, reason: 'public_fallback_error' };
            }
            const json = (await resp.json()) as unknown;
            const address = parseNominatimAddress(json);
            if (!address) return { address: null, reason: 'parse_error' };
            return { address, reason: 'public_fallback_error' };
        } catch {
            return { address: null, reason: 'public_fallback_error' };
        }
    }

    private saveCache(cacheKey: string, lat: number, lng: number, address: string): void {
        const now = Date.now();
        const expiresAt = now + this.ttlMs;
        this.memoryCache.set(cacheKey, { address, expiresAt });
        try {
            const result = this.upsertCacheStmt.run({
                cache_key: cacheKey,
                lat,
                lng,
                address,
                updated_at: now,
                expires_at: expiresAt,
            });
            const outcome: SaveOutcome = 'ok';
            this.logDev('save', { outcome, key: cacheKey, changes: result.changes, expiresAt });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.logDev('save', { outcome: 'failed', key: cacheKey, error: message });
        }
    }

    private lookupCacheRow(cacheKey: string, lat: number, lng: number): CacheRow | undefined {
        const directRow = this.selectCacheStmt.get(cacheKey) as CacheRow | undefined;
        if (directRow?.address) return directRow;
        // Legacy rows may keep slightly different precision, keep compatibility window around canonical point.
        const epsilon = 0.5 * 10 ** -this.precision + 1e-9;
        const fallbackRow = this.selectCacheByCoordsStmt.get(
            lat - epsilon,
            lat + epsilon,
            lng - epsilon,
            lng + epsilon
        ) as CacheRow | undefined;
        if (!fallbackRow?.address) return undefined;
        if (fallbackRow.cache_key !== cacheKey) {
            this.upsertCacheStmt.run({
                cache_key: cacheKey,
                lat,
                lng,
                address: fallbackRow.address,
                updated_at: Date.now(),
                expires_at: fallbackRow.expires_at,
            });
        }
        return {
            cache_key: cacheKey,
            address: fallbackRow.address,
            expires_at: fallbackRow.expires_at,
        };
    }
}
