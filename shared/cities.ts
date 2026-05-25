export type CityProfile = {
    id: string;
    label: string;
    centerLat: number;
    centerLng: number;
    /** Верхний порог дистанции «город + область» для фильтров/очистки данных */
    distanceMaxKm: number;
    /** Относительно корня репозитория дашборда */
    parserConfig: string;
};

export const CITY_PROFILES: CityProfile[] = [
    {
        id: 'moscow',
        label: 'Москва',
        centerLat: 55.7558,
        centerLng: 37.6176,
        distanceMaxKm: 120,
        parserConfig: 'parser/configs/config.moscow.json',
    },
    {
        id: 'saratov',
        label: 'Саратов',
        centerLat: 51.533103,
        centerLng: 46.034266,
        distanceMaxKm: 100,
        parserConfig: 'parser/configs/config.saratov.json',
    },
];

export const DEFAULT_CITY_ID = 'moscow';

export function getCityProfile(cityId: string): CityProfile | undefined {
    return CITY_PROFILES.find(c => c.id === cityId);
}

export function isKnownCityId(cityId: string): boolean {
    return CITY_PROFILES.some(c => c.id === cityId);
}

export function getCityDistanceLimitKm(cityId?: string | null): number | null {
    if (!cityId) return null;
    return getCityProfile(cityId)?.distanceMaxKm ?? null;
}
