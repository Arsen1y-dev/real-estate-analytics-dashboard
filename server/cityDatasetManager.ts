import fs from 'node:fs';
import path from 'node:path';
import { CITY_PROFILES, getCityProfile, isKnownCityId, type CityProfile } from '../shared/cities';
import type { DatasetMeta } from '../shared/datasetServer';
import { DatasetStore } from './datasetStore';

export type CityDatasetInfo = {
    id: string;
    label: string;
    rowCount: number;
    updatedAt: string;
    hasData: boolean;
};

export class CityDatasetManager {
    private baseDir: string;
    private defaultCsvPath: string;
    private stores = new Map<string, DatasetStore>();

    constructor(baseDir: string, defaultCsvPath: string) {
        this.baseDir = baseDir;
        this.defaultCsvPath = defaultCsvPath;
        fs.mkdirSync(path.join(baseDir, 'cities'), { recursive: true });
        this.migrateLegacy();
        for (const city of CITY_PROFILES) {
            const cityDir = this.cityDir(city.id);
            fs.mkdirSync(cityDir, { recursive: true });
            const fallback =
                city.id === 'moscow' && fs.existsSync(defaultCsvPath) ? defaultCsvPath : path.join(cityDir, '.no-default');
            const store = new DatasetStore(cityDir, fallback, city);
            store.load();
            this.stores.set(city.id, store);
        }
    }

    private cityDir(cityId: string): string {
        return path.join(this.baseDir, 'cities', cityId);
    }

    private migrateLegacy(): void {
        const legacyDataset = path.join(this.baseDir, 'dataset.json');
        const legacyMeta = path.join(this.baseDir, 'dataset-meta.json');
        const moscowDir = this.cityDir('moscow');
        if (!fs.existsSync(legacyDataset)) return;
        fs.mkdirSync(moscowDir, { recursive: true });
        const targetDataset = path.join(moscowDir, 'dataset.json');
        const targetMeta = path.join(moscowDir, 'dataset-meta.json');
        if (!fs.existsSync(targetDataset)) {
            fs.renameSync(legacyDataset, targetDataset);
        }
        if (fs.existsSync(legacyMeta) && !fs.existsSync(targetMeta)) {
            fs.renameSync(legacyMeta, targetMeta);
        }
    }

    getStore(cityId: string): DatasetStore | null {
        if (!isKnownCityId(cityId)) return null;
        return this.stores.get(cityId) ?? null;
    }

    listCities(): CityDatasetInfo[] {
        return CITY_PROFILES.map(city => {
            const store = this.stores.get(city.id)!;
            return {
                id: city.id,
                label: city.label,
                rowCount: store.meta.rowCount,
                updatedAt: store.meta.updatedAt,
                hasData: Boolean(store.state?.rows.length),
            };
        });
    }

    getCityProfile(cityId: string): CityProfile | undefined {
        return getCityProfile(cityId);
    }
}

export type { DatasetMeta };
