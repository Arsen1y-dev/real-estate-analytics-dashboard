import { apiBaseUrl } from '@/auth';
import type { Role } from '@/auth';

export type ManagerUser = {
    id: number;
    username: string;
    role: Role;
    createdAt: string;
};

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

async function authJson<T>(
    token: string,
    path: string,
    init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const resp = await fetch(`${apiBaseUrl()}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
    const json = (await resp.json().catch(() => ({}))) as T & { error?: string };
    if (!resp.ok) {
        return { ok: false, error: json.error ?? resp.statusText };
    }
    return { ok: true, data: json as T };
}

export async function fetchMarketsOverview(token: string): Promise<CityMarketOverview[]> {
    const r = await authJson<{ cities: CityMarketOverview[] }>(token, '/api/manager/markets/overview');
    return r.ok ? r.data.cities : [];
}

export async function fetchManagerUsers(token: string): Promise<ManagerUser[]> {
    const r = await authJson<{ users: ManagerUser[] }>(token, '/api/manager/users');
    return r.ok ? r.data.users : [];
}

export async function createManagerUser(
    token: string,
    payload: { username: string; password: string; role: Role }
): Promise<{ ok: true; user: ManagerUser } | { ok: false; error: string }> {
    const r = await authJson<{ user: ManagerUser }>(token, '/api/manager/users', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, user: r.data.user };
}

export async function updateManagerUserRole(
    token: string,
    id: number,
    role: Role
): Promise<{ ok: true; user: ManagerUser } | { ok: false; error: string }> {
    const r = await authJson<{ user: ManagerUser }>(token, `/api/manager/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, user: r.data.user };
}

export async function resetManagerUserPassword(
    token: string,
    id: number,
    password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await authJson<{ ok: boolean }>(token, `/api/manager/users/${id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true };
}

export async function deleteManagerUser(
    token: string,
    id: number
): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await authJson<{ ok: boolean }>(token, `/api/manager/users/${id}`, { method: 'DELETE' });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true };
}
