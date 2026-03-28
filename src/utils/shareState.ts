import type { Theme } from '@/theme';
import type { DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import { columnSignature, sanitizeFilters, sanitizeUserCharts, normalizeFilterRanges } from '@/utils/sanitizeDashboardState';

export type SharePayloadV1 = {
    v: 1;
    sig: string;
    theme: Theme;
    filters: FilterSettings;
    userCharts: UserChartDefinition[];
};

export function buildSharePayload(
    summary: DataSummary,
    theme: Theme,
    filters: FilterSettings,
    userCharts: UserChartDefinition[]
): SharePayloadV1 {
    return {
        v: 1,
        sig: columnSignature(summary),
        theme,
        filters,
        userCharts,
    };
}

export function encodeSharePayload(payload: SharePayloadV1): string {
    const json = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(json)));
}

export function decodeSharePayload(encodedRaw: string): SharePayloadV1 | null {
    let encoded = encodedRaw.trim();
    try {
        encoded = decodeURIComponent(encoded);
    } catch {
        /* use trimmed raw */
    }
    let json: string;
    try {
        json = decodeURIComponent(escape(atob(encoded)));
    } catch {
        return null;
    }
    try {
        const p = JSON.parse(json) as SharePayloadV1;
        if (p?.v !== 1 || typeof p.sig !== 'string') return null;
        if (p.theme !== 'dark' && p.theme !== 'light') return null;
        if (!p.filters || typeof p.filters !== 'object' || !Array.isArray(p.userCharts)) return null;
        return p;
    } catch {
        return null;
    }
}

export function applySharePayload(
    payload: SharePayloadV1,
    summary: DataSummary
): { filters: FilterSettings; userCharts: UserChartDefinition[]; theme: Theme } | null {
    if (payload.sig !== columnSignature(summary)) return null;
    const charts = sanitizeUserCharts(payload.userCharts, summary);
    const filters = normalizeFilterRanges(sanitizeFilters(payload.filters, summary));
    return { filters, userCharts: charts, theme: payload.theme };
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch {
            return false;
        }
    }
}
