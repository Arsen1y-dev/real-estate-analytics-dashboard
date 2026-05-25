import { CITY_PREF_KEY } from '@/persistence/keys';

export type CityId = 'moscow' | 'saratov';

export type CityListItem = {
    id: CityId;
    label: string;
    rowCount: number;
    updatedAt: string;
    hasData: boolean;
};

export function loadPreferredCityId(): CityId | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(CITY_PREF_KEY);
        if (raw === 'moscow' || raw === 'saratov') return raw;
    } catch {
        /* ignore */
    }
    return null;
}

export function savePreferredCityId(cityId: CityId): void {
    try {
        localStorage.setItem(CITY_PREF_KEY, cityId);
    } catch {
        /* ignore */
    }
}

export function pickInitialCityId(
    cities: CityListItem[],
    preferred: CityId | null
): CityId | null {
    if (preferred && cities.some(c => c.id === preferred)) return preferred;
    const withData = cities.find(c => c.hasData);
    if (withData) return withData.id;
    return cities[0]?.id ?? null;
}
