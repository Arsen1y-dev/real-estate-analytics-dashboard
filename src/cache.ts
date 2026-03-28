import type { DataRow, DataSummary } from '@/types';

const STORAGE_KEY = 'realty-dashboard-dataset-v2';
const MAX_CACHE_CHARS = 4_500_000;

export interface CachedDataset {
    version: 2;
    fileKey: string;
    data: DataRow[];
    summary: DataSummary;
}

export function makeFileKey(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`;
}

export function loadCachedDataset(): CachedDataset | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw || raw.length > MAX_CACHE_CHARS) {
            return null;
        }
        const parsed = JSON.parse(raw) as CachedDataset;
        if (parsed?.version !== 2 || !Array.isArray(parsed.data) || !parsed.summary || typeof parsed.fileKey !== 'string') {
            return null;
        }
        if (!Array.isArray(parsed.summary.columnOrder) || !Array.isArray(parsed.summary.columns)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/** Быстрая загрузка того же файла (без повторного парсинга CSV). */
export function tryGetDatasetForFile(file: File): CachedDataset | null {
    const cached = loadCachedDataset();
    const key = makeFileKey(file);
    if (cached && cached.fileKey === key) {
        return cached;
    }
    return null;
}

export function saveCachedDataset(file: File, data: DataRow[], summary: DataSummary): void {
    try {
        const payload: CachedDataset = {
            version: 2,
            fileKey: makeFileKey(file),
            data,
            summary,
        };
        const serialized = JSON.stringify(payload);
        if (serialized.length > MAX_CACHE_CHARS) {
            console.warn(
                '[realty-dashboard] Датасет слишком большой для localStorage, кэш не сохранён. Аналитика работает в памяти сессии.'
            );
            return;
        }
        localStorage.setItem(STORAGE_KEY, serialized);
    } catch (e) {
        console.warn('[realty-dashboard] Не удалось записать кэш в localStorage:', e);
    }
}

export function clearCachedDataset(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}
