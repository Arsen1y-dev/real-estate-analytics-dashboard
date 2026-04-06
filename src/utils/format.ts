export function formatNumber(num: number): string {
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    const compact = (value: number, suffix: string): string => {
        const rounded = Number.parseFloat(value.toFixed(1));
        const text = Number.isInteger(rounded) ? String(rounded) : rounded.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
        return `${sign}${text} ${suffix}`;
    };

    if (abs >= 1e6) return compact(abs / 1e6, 'млн');
    if (abs >= 1e3) return compact(abs / 1e3, 'тыс');
    if (abs >= 100) return `${sign}${Math.round(abs).toLocaleString('ru-RU')}`;
    if (abs >= 10) return `${sign}${abs.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}`;
    if (abs >= 1) return `${sign}${abs.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
    return `${sign}${abs.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`;
}

/**
 * Числа в карточках «медиана по столбцу»: без «2.0 тыс» для годов, суффикс для комнат,
 * остальное — группировка разрядов; очень крупные — как {@link formatNumber}.
 */
export function formatDashboardMetric(columnName: string, medianVal: number, values: number[]): string {
    const m = medianVal;
    const rounded = Math.round(m);
    const lower = columnName.toLowerCase();

    if (lower.includes('комнат')) {
        const n = Number.isFinite(m) && Math.abs(m - rounded) > 0.05 ? m : rounded;
        if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
            return `${Math.round(n)} комн.`;
        }
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n)} комн.`;
    }

    /** Площади (жилая, общая и т.д.) — всегда с м², без «тыс» как у крупных сумм. */
    if (lower.includes('площад')) {
        if (Math.abs(m - rounded) > 0.05) {
            return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(m)} м²`;
        }
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rounded)} м²`;
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

    const hasVeryLarge = values.some(v => Math.abs(v) >= 10_000_000);
    if (Math.abs(rounded) >= 1_000_000 || hasVeryLarge) {
        return formatNumber(rounded);
    }

    if (Math.abs(m - rounded) > 0.05) {
        return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(m);
    }
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rounded);
}

export function formatCurrency(num: number): string {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(num);
}
