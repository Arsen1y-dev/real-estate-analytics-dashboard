export const REVERSE_GEOCODE_KEY_PRECISION = 5;

function rounded(value: number, precision: number): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

export function hasValidReverseGeocodeCoords(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
}

export function buildCanonicalReverseGeocodeKey(
    latRaw: number,
    lngRaw: number,
): { cacheKey: string; lat: number; lng: number } | null {
    if (!hasValidReverseGeocodeCoords(latRaw, lngRaw)) return null;
    const lat = rounded(latRaw, REVERSE_GEOCODE_KEY_PRECISION);
    const lng = rounded(lngRaw, REVERSE_GEOCODE_KEY_PRECISION);
    return {
        cacheKey: `${lat.toFixed(REVERSE_GEOCODE_KEY_PRECISION)},${lng.toFixed(REVERSE_GEOCODE_KEY_PRECISION)}`,
        lat,
        lng,
    };
}

function parseLegacyCoords(raw: string): { lat: number; lng: number } | null {
    const normalized = raw.trim();
    if (!normalized) return null;

    const strictPair = normalized.match(
        /^(-?\d+(?:\.\d+)?)\s*[,;|/]\s*(-?\d+(?:\.\d+)?)$/,
    );
    if (strictPair) {
        const lat = Number.parseFloat(strictPair[1]);
        const lng = Number.parseFloat(strictPair[2]);
        if (hasValidReverseGeocodeCoords(lat, lng)) {
            return { lat, lng };
        }
    }

    const numericParts = normalized.match(/-?\d+(?:\.\d+)?/g);
    if (!numericParts || numericParts.length < 2) return null;
    const lat = Number.parseFloat(numericParts[0]);
    const lng = Number.parseFloat(numericParts[1]);
    if (!hasValidReverseGeocodeCoords(lat, lng)) return null;
    return { lat, lng };
}

export function normalizeReverseGeocodeKey(raw: string): { cacheKey: string; lat: number; lng: number } | null {
    const parsed = parseLegacyCoords(String(raw ?? ''));
    if (!parsed) return null;
    return buildCanonicalReverseGeocodeKey(parsed.lat, parsed.lng);
}
