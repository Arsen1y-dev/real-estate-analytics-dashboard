/**
 * Кривая по отсортированным значениям (форма распределения в выборке).
 * Минимум 2 точки; иначе null.
 */
export function sparklinePathFromValues(
    values: number[],
    width: number,
    height: number,
    pad = 3
): { d: string; hasStroke: boolean } | null {
    const v = values.filter(x => Number.isFinite(x));
    if (v.length < 2) return null;

    const sorted = [...v].sort((a, b) => a - b);
    const n = Math.min(36, sorted.length);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const range = max - min || 1;

    const innerW = Math.max(1, width - 2 * pad);
    const innerH = Math.max(1, height - 2 * pad);

    let d = '';
    for (let i = 0; i < n; i++) {
        const idx = Math.round((i / Math.max(1, n - 1)) * (sorted.length - 1));
        const val = sorted[idx]!;
        const x = pad + (i / Math.max(1, n - 1)) * innerW;
        const y = pad + innerH - ((val - min) / range) * innerH;
        d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return { d, hasStroke: true };
}
