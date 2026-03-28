export const mean = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export const median = (arr: number[]): number => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const quantile = (arr: number[], q: number): number => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return s[base] + (s[base + 1] - s[base]) * rest || s[base] || 0;
};

/** Домен оси по «плотной» части данных: обрезает длинные хвосты выбросов, добавляет мягкий отступ. */
export function axisDomainFromValues(values: number[], lowQ = 0.03, highQ = 0.97, padRatio = 0.04): [number, number] | undefined {
    const finite = values.filter(v => Number.isFinite(v));
    if (finite.length < 2) return undefined;
    let lo = quantile(finite, lowQ);
    let hi = quantile(finite, highQ);
    if (!(lo < hi)) {
        const mn = Math.min(...finite);
        const mx = Math.max(...finite);
        const span = mx - mn || Math.max(Math.abs(mn) * 0.02, 1);
        lo = mn - span * 0.05;
        hi = mx + span * 0.05;
    } else {
        const span = hi - lo;
        lo -= span * padRatio;
        hi += span * padRatio;
    }
    return [lo, hi];
}
