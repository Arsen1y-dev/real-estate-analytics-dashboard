import { formatNumber } from '@/utils/format';

/** Единое компактное отображение чисел (ru-RU) для карточек метрик */

const fmt1 = (n: number) =>
    new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n);

export function formatRubCompact(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1e9) return `${sign}${fmt1(abs / 1e9)} млрд ₽`;
    if (abs >= 1e6) return `${sign}${fmt1(abs / 1e6)} млн ₽`;
    if (abs >= 1e4) return `${sign}${fmt1(abs / 1e3)} тыс ₽`;
    return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n))} ₽`;
}

/** Цена за м² — те же пороги, суффикс ₽/м² */
export function formatRubPerM2Compact(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1e6) return `${sign}${fmt1(abs / 1e6)} млн ₽/м²`;
    if (abs >= 1e3) return `${sign}${fmt1(abs / 1e3)} тыс ₽/м²`;
    return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n))} ₽/м²`;
}

export function formatCountCompact(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (!Number.isFinite(n)) return '—';
    if (abs >= 1e9) return `${sign}${fmt1(abs / 1e9)} млрд шт`;
    if (abs >= 1e6) return `${sign}${fmt1(abs / 1e6)} млн шт`;
    if (abs >= 1e4) return `${sign}${fmt1(abs / 1e3)} тыс шт`;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n))} шт`;
}

export function formatAreaCompactSqM(n: number): string {
    const rounded = Math.round(n);
    const abs = Math.abs(n);
    if (abs >= 10_000) return `${fmt1(n / 1000)} тыс м²`;
    if (Math.abs(n - rounded) > 0.05) {
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)} м²`;
    }
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rounded)} м²`;
}

/** Доп. медианы: те же правила, что formatDashboardMetric, но везде явные единицы / компактные деньги. */
export function formatExtraMedianCompact(columnName: string, m: number, values: number[]): string {
    const rounded = Math.round(m);
    const lower = columnName.toLowerCase();

    if (lower.includes('комнат')) {
        const n = Number.isFinite(m) && Math.abs(m - rounded) > 0.05 ? m : rounded;
        if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
            return `${Math.round(n)} комн.`;
        }
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n)} комн.`;
    }

    if (lower.includes('площад')) {
        return formatAreaCompactSqM(m);
    }

    const yearishShare = values.filter(v => v >= 1850 && v <= 2035).length / Math.max(values.length, 1);
    const looksLikeYear =
        /\bгод\b/i.test(columnName) ||
        lower.includes('год построй') ||
        lower.includes('год_построй') ||
        (yearishShare >= 0.85 && m >= 1850 && m <= 2035);
    if (looksLikeYear) {
        return String(rounded);
    }

    if (lower.includes('цен') || lower.includes('руб') || lower.includes('price') || lower.includes('стоим')) {
        return formatRubCompact(m);
    }

    const hasVeryLarge = values.some(v => Math.abs(v) >= 10_000_000);
    if (Math.abs(rounded) >= 1_000_000 || hasVeryLarge) {
        return formatNumber(rounded);
    }

    if (Math.abs(m - rounded) > 0.05) {
        return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(m);
    }
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rounded);
}

/** Процент изменения выборки относительно базы; null если нельзя сравнить. */
export function percentChange(current: number, baseline: number): number | null {
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null;
    return ((current - baseline) / baseline) * 100;
}

export function formatPercentDelta(pct: number): string {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Math.abs(pct));
}
