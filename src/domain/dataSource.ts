import { DATA_SOURCE_KEY } from '@/persistence/keys';

export type DataSourceMode = 'server' | 'personal';

export function loadDataSourceMode(): DataSourceMode | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DATA_SOURCE_KEY);
        if (raw === 'server' || raw === 'personal') return raw;
    } catch {
        /* ignore */
    }
    return null;
}

export function saveDataSourceMode(mode: DataSourceMode): void {
    try {
        localStorage.setItem(DATA_SOURCE_KEY, mode);
    } catch {
        /* ignore */
    }
}

export function clearDataSourceMode(): void {
    try {
        localStorage.removeItem(DATA_SOURCE_KEY);
    } catch {
        /* ignore */
    }
}
