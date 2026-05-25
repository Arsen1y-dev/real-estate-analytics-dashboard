import { apiBaseUrl } from '@/auth';
import type { CityId } from '@/domain/city';
import type { DataRow, DataSummary } from '@/types';
import type { DatasetMeta } from '../../shared/datasetServer';
import { createLruTtlCache } from '@/utils/memoCache';

export type CityListItem = {
    id: CityId;
    label: string;
    rowCount: number;
    updatedAt: string;
    hasData: boolean;
};

export type DatasetBootstrap = {
    city: CityId;
    rows: DataRow[];
    summary: DataSummary;
    total: number;
};

export type DatasetMetaResponse = {
    city: CityId;
    meta: DatasetMeta;
    hasData: boolean;
};

export type AdminUploadResult = {
    ok: boolean;
    city: CityId;
    mode: 'append' | 'replace';
    totalRows: number;
    added: number;
    skippedDuplicates: number;
    tooFarFiltered: number;
    droppedInvalid: number;
    hadIdColumn: boolean;
    duplicateByOfferId: number;
    meta: DatasetMeta;
};

const DATASET_API_CACHE_MAX = 64;
const DATASET_API_TTL_MS = 15_000;

const datasetApiCache = createLruTtlCache<string, unknown>({
    max: DATASET_API_CACHE_MAX,
    ttlMs: DATASET_API_TTL_MS,
});
const datasetApiInFlight = new Map<string, Promise<unknown>>();

function datasetCacheKey(token: string, path: string): string {
    return `${token}::${path}`;
}

function clearDatasetApiCache(): void {
    datasetApiCache.clear();
    datasetApiInFlight.clear();
}

async function authJson<T>(
    token: string,
    path: string,
    init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    const resp = await fetch(`${apiBaseUrl()}${path}`, {
        ...init,
        headers: {
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
    const json = (await resp.json().catch(() => ({}))) as T & { error?: string };
    if (!resp.ok) {
        return { ok: false, status: resp.status, error: (json as { error?: string }).error ?? resp.statusText };
    }
    return { ok: true, data: json as T };
}

async function cachedAuthGet<T>(
    token: string,
    path: string
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    const key = datasetCacheKey(token, path);
    const cached = datasetApiCache.get(key) as
        | { ok: true; data: T }
        | { ok: false; status: number; error: string }
        | undefined;
    if (cached) return cached;

    const inFlight = datasetApiInFlight.get(key) as Promise<
        { ok: true; data: T } | { ok: false; status: number; error: string }
    > | undefined;
    if (inFlight) return inFlight;

    const request = authJson<T>(token, path)
        .then(result => {
            if (result.ok) {
                datasetApiCache.set(key, result);
            } else if (result.status < 500) {
                // Кратко кэшируем клиентские ошибки, чтобы не спамить API одинаковыми запросами.
                datasetApiCache.set(key, result);
            }
            return result;
        })
        .finally(() => {
            datasetApiInFlight.delete(key);
        });
    datasetApiInFlight.set(key, request as Promise<unknown>);
    return request;
}

export async function fetchDatasetCities(token: string): Promise<CityListItem[]> {
    const r = await cachedAuthGet<{ cities: CityListItem[] }>(token, '/api/dataset/cities');
    return r.ok ? r.data.cities : [];
}

export async function fetchDatasetMeta(token: string, city: CityId): Promise<DatasetMetaResponse | null> {
    const r = await cachedAuthGet<DatasetMetaResponse>(token, `/api/dataset/meta?city=${city}`);
    return r.ok ? r.data : null;
}

export async function fetchServerBootstrap(
    token: string,
    city: CityId
): Promise<{ ok: true; data: DatasetBootstrap } | { ok: false; status: number; error: string }> {
    return cachedAuthGet<DatasetBootstrap>(token, `/api/dataset/bootstrap?city=${city}`);
}

export async function uploadAdminDataset(
    token: string,
    city: CityId,
    file: File,
    mode: 'append' | 'replace'
): Promise<{ ok: true; data: AdminUploadResult } | { ok: false; error: string }> {
    const body = new FormData();
    body.append('file', file);
    const resp = await fetch(`${apiBaseUrl()}/api/admin/dataset?city=${city}&mode=${mode}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
    const json = (await resp.json()) as AdminUploadResult & { error?: string };
    if (!resp.ok) return { ok: false, error: json.error ?? 'Не удалось загрузить файл' };
    clearDatasetApiCache();
    return { ok: true, data: json };
}

export async function ingestPipelineDataset(
    token: string,
    city: CityId,
    mode: 'append' | 'replace'
): Promise<{ ok: true; data: AdminUploadResult & { source?: string } } | { ok: false; error: string }> {
    const r = await authJson<AdminUploadResult & { source?: string }>(token, `/api/admin/dataset/ingest-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ city, mode }),
    });
    if (!r.ok) return { ok: false, error: r.error };
    clearDatasetApiCache();
    return { ok: true, data: r.data };
}

export async function deleteAdminBatch(
    token: string,
    city: CityId,
    batchId: string
): Promise<{ ok: true; removed: number; meta: DatasetMeta } | { ok: false; error: string }> {
    const r = await authJson<{ ok: boolean; removed: number; meta: DatasetMeta }>(
        token,
        `/api/admin/dataset/batch/${encodeURIComponent(batchId)}?city=${city}`,
        { method: 'DELETE' }
    );
    if (!r.ok) return { ok: false, error: r.error };
    clearDatasetApiCache();
    return { ok: true, removed: r.data.removed, meta: r.data.meta };
}

export async function clearAdminDataset(
    token: string,
    city: CityId
): Promise<{ ok: true; meta: DatasetMeta } | { ok: false; error: string }> {
    const r = await authJson<{ ok: boolean; meta: DatasetMeta }>(token, `/api/admin/dataset?city=${city}`, {
        method: 'DELETE',
    });
    if (!r.ok) return { ok: false, error: r.error };
    clearDatasetApiCache();
    return { ok: true, meta: r.data.meta };
}

export function adminDatasetExportUrl(city: CityId): string {
    return `${apiBaseUrl()}/api/admin/dataset/export?city=${city}`;
}
