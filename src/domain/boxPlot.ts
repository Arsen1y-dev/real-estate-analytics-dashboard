import type { ColumnInfo } from '@/types';
import { quantile } from '@/utils/stats';

export const BOX_PLOT_MIN_GROUP_SIZE = 4;
export const BOX_PLOT_MAX_GROUPS = 16;

const BOX_PLOT_MAX_ABS_VALUE = 1e11;
const BOX_PLOT_TECH_COLUMN_RE =
    /(^|[\s_])(id|uuid|guid|url|uri|link|slug|hash|код|ид|id[-\s]*объекта|id[-\s]*объявления|ссылка|адрес|address|latitude|longitude|lat|lng|широт[аы]?|долгот[аы]?)([\s_]|$)/i;

function normalizeColumnName(name: string): string {
    return name
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isTechnicalBoxPlotColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return BOX_PLOT_TECH_COLUMN_RE.test(normalized);
}

export function isBoxPlotValueColumn(column: Pick<ColumnInfo, 'name' | 'kind'>): boolean {
    return column.kind === 'numeric' && !isTechnicalBoxPlotColumn(column.name);
}

export function isBoxPlotGroupColumn(column: Pick<ColumnInfo, 'name' | 'kind'>): boolean {
    return column.kind === 'categorical' && column.name !== 'houseType' && !isTechnicalBoxPlotColumn(column.name);
}

export function parseStrictBoxPlotNumber(raw: unknown): number | null {
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return null;
        if (Math.abs(raw) > BOX_PLOT_MAX_ABS_VALUE) return null;
        return raw;
    }
    if (typeof raw !== 'string') return null;

    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return null;

    const normalized = trimmed.replace(/\u00A0/g, ' ').replace(/\s+/g, '').replace(',', '.');
    if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > BOX_PLOT_MAX_ABS_VALUE) return null;
    return parsed;
}

export function stripExtremeOutliers(values: number[]): { filtered: number[]; removed: number } {
    if (values.length < 8) return { filtered: [...values], removed: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    if (!(iqr > 0)) return { filtered: sorted, removed: 0 };

    const lower = q1 - 3 * iqr;
    const upper = q3 + 3 * iqr;
    const filtered = sorted.filter(v => v >= lower && v <= upper);
    if (filtered.length < BOX_PLOT_MIN_GROUP_SIZE) {
        return { filtered: sorted, removed: 0 };
    }
    return { filtered, removed: sorted.length - filtered.length };
}

export function formatBoxPlotNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    const maximumFractionDigits = abs >= 100 ? 0 : abs >= 1 ? 2 : 3;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value);
}
