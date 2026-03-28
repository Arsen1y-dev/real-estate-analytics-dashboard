import { createDefaultFiltersFromSummary } from '@/domain/filters';
import { defaultChartsForSummary } from '@/domain/chartDefaults';
import type { DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import { loadDatasetUiState } from '@/persistence/uiSettings';
import { applySharePayload, buildSharePayload, decodeSharePayload, encodeSharePayload } from '@/utils/shareState';
import { sanitizeFilters, sanitizeUserCharts } from '@/utils/sanitizeDashboardState';
import type { Theme } from '@/theme';

export type ResolvedDashboardState = {
    filters: FilterSettings;
    userCharts: UserChartDefinition[];
    theme?: Theme;
    toast?: string;
};

/** Состояние для нового/восстановленного датасета: share в URL > localStorage > значения по умолчанию. */
export function resolveDashboardStateForSummary(summary: DataSummary): ResolvedDashboardState {
    const defaultFilters = createDefaultFiltersFromSummary(summary);
    const defaultCharts = defaultChartsForSummary(summary);

    if (typeof window !== 'undefined') {
        const shareRaw = new URLSearchParams(window.location.search).get('share');
        if (shareRaw) {
            const payload = decodeSharePayload(shareRaw);
            const applied = payload ? applySharePayload(payload, summary) : null;
            if (applied) {
                window.history.replaceState({}, '', window.location.pathname);
                return {
                    filters: applied.filters,
                    userCharts: applied.userCharts.length ? applied.userCharts : defaultCharts,
                    theme: applied.theme,
                    toast: 'Настройки из ссылки применены',
                };
            }
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    const persisted = loadDatasetUiState(summary);
    if (persisted) {
        const charts = sanitizeUserCharts(persisted.userCharts, summary);
        return {
            filters: sanitizeFilters(persisted.filters, summary),
            userCharts: charts.length ? charts : defaultCharts,
        };
    }

    return { filters: defaultFilters, userCharts: defaultCharts };
}

export function buildShareableUrl(summary: DataSummary, theme: Theme, filters: FilterSettings, userCharts: UserChartDefinition[]): string {
    const payload = buildSharePayload(summary, theme, filters, userCharts);
    const enc = encodeSharePayload(payload);
    return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(enc)}`;
}
