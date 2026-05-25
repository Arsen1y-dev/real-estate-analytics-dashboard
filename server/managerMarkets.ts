import { CITY_PROFILES } from '../shared/cities';
import type { CityDatasetManager } from './cityDatasetManager';

export type CityKpiSnapshot = {
    priceMedian: number | null;
    priceMin: number | null;
    priceMax: number | null;
    areaMedian: number | null;
};

export type CityMarketOverview = {
    id: string;
    label: string;
    hasData: boolean;
    rowCount: number;
    updatedAt: string;
    lastFileName: string | null;
    uploadCount: number;
    kpi: CityKpiSnapshot | null;
};

function kpiFromSummary(rowCount: number, summary: import('../shared/dashboard').DataSummary | undefined): CityKpiSnapshot | null {
    if (!summary || rowCount === 0) return null;
    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    if (!priceCol && !areaCol) return null;

    const priceMedian =
        priceCol && summary.price.max > summary.price.min
            ? (summary.price.min + summary.price.max) / 2
            : priceCol
              ? summary.price.min
              : null;

    return {
        priceMedian: priceCol ? priceMedian : null,
        priceMin: priceCol ? summary.price.min : null,
        priceMax: priceCol ? summary.price.max : null,
        areaMedian:
            areaCol && summary.area.max > summary.area.min
                ? (summary.area.min + summary.area.max) / 2
                : areaCol
                  ? summary.area.min
                  : null,
    };
}

export function buildMarketsOverview(cityDatasets: CityDatasetManager): CityMarketOverview[] {
    return CITY_PROFILES.map(city => {
        const store = cityDatasets.getStore(city.id);
        const meta = store?.meta ?? {
            rowCount: 0,
            updatedAt: new Date(0).toISOString(),
            lastFileName: null,
            uploads: [],
        };
        const rowCount = store?.state?.rows.length ?? 0;
        const summary = store?.state?.summary;

        return {
            id: city.id,
            label: city.label,
            hasData: rowCount > 0,
            rowCount: meta.rowCount,
            updatedAt: meta.updatedAt,
            lastFileName: meta.lastFileName,
            uploadCount: meta.uploads.length,
            kpi: kpiFromSummary(rowCount, summary),
        };
    });
}
