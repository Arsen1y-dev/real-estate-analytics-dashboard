import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

type Props = {
    theme: Theme;
    /** Границы трека (полный диапазон файла). */
    boundMin: number;
    boundMax: number;
    valueMin: number;
    valueMax: number;
    onChange: (next: { min: number; max: number }) => void;
    step: number;
    ariaLabelledBy?: string;
};

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}

export const FilterDualRange: React.FC<Props> = ({
    theme,
    boundMin,
    boundMax,
    valueMin,
    valueMax,
    onChange,
    step,
    ariaLabelledBy,
}) => {
    const [focus, setFocus] = useState<'low' | 'high' | null>(null);

    useEffect(() => {
        const clear = () => setFocus(null);
        window.addEventListener('pointerup', clear);
        window.addEventListener('blur', clear);
        return () => {
            window.removeEventListener('pointerup', clear);
            window.removeEventListener('blur', clear);
        };
    }, []);

    const span = boundMax - boundMin;
    const degenerate = !Number.isFinite(span) || span <= 0;

    const low = clamp(valueMin, boundMin, boundMax);
    const high = clamp(valueMax, boundMin, boundMax);
    const safeLow = Math.min(low, high);
    const safeHigh = Math.max(low, high);

    const pct = useMemo(() => {
        if (degenerate) return { left: 0, width: 100 };
        const left = ((safeLow - boundMin) / span) * 100;
        const width = ((safeHigh - safeLow) / span) * 100;
        return { left, width: Math.max(width, 0) };
    }, [boundMin, degenerate, safeHigh, safeLow, span]);

    const onLowInput = useCallback(
        (raw: number) => {
            const v = clamp(raw, boundMin, boundMax);
            const nextMin = Math.min(v, safeHigh);
            onChange({ min: nextMin, max: safeHigh });
        },
        [boundMax, boundMin, onChange, safeHigh]
    );

    const onHighInput = useCallback(
        (raw: number) => {
            const v = clamp(raw, boundMin, boundMax);
            const nextMax = Math.max(v, safeLow);
            onChange({ min: safeLow, max: nextMax });
        },
        [boundMax, boundMin, onChange, safeLow]
    );

    const trackIdle = themeClass(theme, { dark: 'bg-zinc-700/80', light: 'bg-zinc-200' });
    const trackActive = themeClass(theme, { dark: 'bg-indigo-500/40', light: 'bg-indigo-500/30' });

    if (degenerate) {
        return (
            <div
                className={`h-6 rounded-full ${trackIdle} opacity-60`}
                role="presentation"
                aria-hidden
            />
        );
    }

    return (
        <div className="filter-dual-range relative h-7 w-full touch-none">
            <div
                className={`pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full ${trackIdle}`}
                aria-hidden
            />
            <div
                className={`pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${trackActive}`}
                style={{ left: `${pct.left}%`, width: `${pct.width}%` }}
                aria-hidden
            />
            <input
                type="range"
                min={boundMin}
                max={boundMax}
                step={step}
                value={safeLow}
                aria-label="Минимум диапазона"
                aria-labelledby={ariaLabelledBy}
                className="absolute inset-0 z-[3] w-full"
                style={{ zIndex: focus === 'low' ? 5 : 3 }}
                onPointerDown={() => setFocus('low')}
                onChange={e => onLowInput(Number(e.target.value))}
            />
            <input
                type="range"
                min={boundMin}
                max={boundMax}
                step={step}
                value={safeHigh}
                aria-label="Максимум диапазона"
                aria-labelledby={ariaLabelledBy}
                className="absolute inset-0 z-[4] w-full"
                style={{ zIndex: focus === 'high' ? 5 : 4 }}
                onPointerDown={() => setFocus('high')}
                onChange={e => onHighInput(Number(e.target.value))}
            />
        </div>
    );
};

export function filterSliderStep(span: number, kind: 'price' | 'area'): number {
    if (!Number.isFinite(span) || span <= 0) {
        return kind === 'price' ? 1 : 0.1;
    }
    if (kind === 'area') {
        const s = span / 72;
        if (s <= 0.15) return 0.1;
        if (s <= 0.6) return 0.5;
        if (s <= 2) return 1;
        return Math.max(1, Math.round(s / 2) * 2);
    }
    const target = span / 72;
    const exp = 10 ** Math.floor(Math.log10(Math.max(target, 1000)));
    const normalized = target / exp;
    let mult = 1;
    if (normalized <= 1) mult = 1;
    else if (normalized <= 2) mult = 2;
    else if (normalized <= 5) mult = 5;
    else mult = 10;
    return Math.max(1000, mult * exp);
}
