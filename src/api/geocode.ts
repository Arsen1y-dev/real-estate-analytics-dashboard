import { apiBaseUrl } from '@/auth';
import { createLruTtlCache } from '@/utils/memoCache';

export type ReverseGeocodeApiResponse = {
    ok: true;
    cacheKey: string;
    address: string | null;
    source: 'cache' | 'online' | 'fallback';
    provider: 'cache' | 'yandex-key' | 'yandex-public' | 'nominatim-public' | 'photon-public';
    fallbackReason:
        | 'no_api_key'
        | 'invalid-key'
        | 'upstream_error'
        | 'rate_limited'
        | 'network_error'
        | 'api-error'
        | 'parse_error'
        | 'public_fallback_error'
        | 'all_fallbacks_failed'
        | null;
};

export type ReverseGeocodeProgressApiResponse = {
    ok: true;
    total: number;
    processed: number;
    resolved: number;
    cache: number;
    fallback: number;
    queued: number;
    byKey: Record<string, { address: string; source: 'cache' | 'queued' }>;
};

const REVERSE_PROGRESS_CACHE = createLruTtlCache<string, { ok: true; data: ReverseGeocodeProgressApiResponse }>({
    max: 64,
    ttlMs: 5_000,
});
const reverseProgressInFlight = new Map<
    string,
    Promise<{ ok: true; data: ReverseGeocodeProgressApiResponse } | { ok: false; error: string; status: number | null }>
>();

function reverseProgressKey(token: string, keys: string[]): string {
    const uniqueSortedKeys = Array.from(new Set(keys)).sort();
    return `${token}::${uniqueSortedKeys.join('|')}`;
}

export async function reverseGeocodeByCoords(
    token: string,
    lat: number,
    lng: number
): Promise<{ ok: true; data: ReverseGeocodeApiResponse } | { ok: false; error: string; status: number | null }> {
    const url = new URL(`${apiBaseUrl()}/api/geocode/reverse`, window.location.origin);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lng', String(lng));
    try {
        const resp = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        const json = (await resp.json().catch(() => ({}))) as ReverseGeocodeApiResponse & { error?: string };
        if (!resp.ok) {
            return { ok: false, error: json.error ?? `Ошибка ${resp.status}`, status: resp.status };
        }
        return { ok: true, data: json };
    } catch {
        return { ok: false, error: 'Сервис reverse geocoding недоступен', status: null };
    }
}

export async function fetchReverseGeocodeProgress(
    token: string,
    keys: string[]
): Promise<{ ok: true; data: ReverseGeocodeProgressApiResponse } | { ok: false; error: string; status: number | null }> {
    const requestKey = reverseProgressKey(token, keys);
    const cached = REVERSE_PROGRESS_CACHE.get(requestKey);
    if (cached) return cached;
    const inFlight = reverseProgressInFlight.get(requestKey);
    if (inFlight) return inFlight;

    const url = new URL(`${apiBaseUrl()}/api/geocode/progress`, window.location.origin);
    const request = (async () => {
        try {
            const resp = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ keys }),
            });
            const json = (await resp.json().catch(() => ({}))) as ReverseGeocodeProgressApiResponse & { error?: string };
            if (!resp.ok) {
                return { ok: false as const, error: json.error ?? `Ошибка ${resp.status}`, status: resp.status };
            }
            const result = { ok: true as const, data: json };
            REVERSE_PROGRESS_CACHE.set(requestKey, result);
            return result;
        } catch {
            return { ok: false as const, error: 'Сервис прогресса reverse geocoding недоступен', status: null };
        } finally {
            reverseProgressInFlight.delete(requestKey);
        }
    })();
    reverseProgressInFlight.set(requestKey, request);

    return request;
}
