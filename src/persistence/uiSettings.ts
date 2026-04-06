import type { Theme } from '@/theme';
import type { DataSummary, FilterSettings, UserChartDefinition } from '@/types';
import { columnSignature } from '@/utils/sanitizeDashboardState';
import { THEME_PREF_KEY, UI_SETTINGS_KEY } from '@/persistence/keys';

type V1 = {
    version: 1;
    theme: Theme;
    datasets: Record<string, { filters: FilterSettings; userCharts: UserChartDefinition[] }>;
};

function defaultState(): V1 {
    return { version: 1, theme: 'light', datasets: {} };
}

export function loadUiSettings(): V1 {
    try {
        const raw = localStorage.getItem(UI_SETTINGS_KEY);
        if (!raw) return defaultState();
        const p = JSON.parse(raw) as Partial<V1>;
        if (p.version !== 1 || typeof p.datasets !== 'object' || p.datasets === null) {
            return defaultState();
        }
        const theme: Theme = p.theme === 'dark' || p.theme === 'light' ? p.theme : 'light';
        return { version: 1, theme, datasets: p.datasets as V1['datasets'] };
    } catch {
        return defaultState();
    }
}

export function saveThemePreference(theme: Theme): void {
    try {
        localStorage.setItem(THEME_PREF_KEY, theme);
    } catch {
        /* ignore quota / private mode */
    }
}

export function loadDatasetUiState(summary: DataSummary): { filters: FilterSettings; userCharts: UserChartDefinition[] } | null {
    const sig = columnSignature(summary);
    const entry = loadUiSettings().datasets[sig];
    if (!entry?.filters || !Array.isArray(entry.userCharts)) return null;
    return entry;
}

const MAX_DATASET_KEYS = 14;

export function persistDatasetUiState(summary: DataSummary, filters: FilterSettings, userCharts: UserChartDefinition[]): void {
    try {
        const s = loadUiSettings();
        const sig = columnSignature(summary);
        s.datasets[sig] = { filters, userCharts };
        const keys = Object.keys(s.datasets);
        if (keys.length > MAX_DATASET_KEYS) {
            for (const k of keys.slice(0, keys.length - MAX_DATASET_KEYS + 1)) {
                if (k !== sig) delete s.datasets[k];
            }
        }
        localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(s));
    } catch {
        /* ignore */
    }
}
