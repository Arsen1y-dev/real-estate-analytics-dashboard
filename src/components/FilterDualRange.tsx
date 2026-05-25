import React, { useCallback, useEffect, useState } from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

type Props = {
    theme: Theme;
    /** Полный допустимый диапазон для поля. */
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

function stepDecimals(step: number): number {
    if (!Number.isFinite(step) || step <= 0) return 0;
    const s = step.toString().toLowerCase();
    if (s.includes('e-')) {
        const exp = Number(s.split('e-')[1]);
        return Number.isFinite(exp) ? clamp(exp, 0, 6) : 0;
    }
    const dot = s.indexOf('.');
    if (dot === -1) return 0;
    return clamp(s.length - dot - 1, 0, 6);
}

function roundByDecimals(value: number, decimals: number): number {
    if (!Number.isFinite(value)) return value;
    const factor = 10 ** clamp(decimals, 0, 6);
    return Math.round(value * factor) / factor;
}

function parseDraftNumber(raw: string): number | null {
    const normalized = raw.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
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
    const [isLowEditing, setIsLowEditing] = useState(false);
    const [isHighEditing, setIsHighEditing] = useState(false);

    const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
    const decimals = stepDecimals(safeStep);

    const low = clamp(valueMin, boundMin, boundMax);
    const high = clamp(valueMax, boundMin, boundMax);
    const safeLow = Math.min(low, high);
    const safeHigh = Math.max(low, high);
    const formatValue = useCallback((value: number) => String(roundByDecimals(value, decimals)), [decimals]);
    const [lowDraft, setLowDraft] = useState(() => formatValue(safeLow));
    const [highDraft, setHighDraft] = useState(() => formatValue(safeHigh));

    useEffect(() => {
        if (!isLowEditing) setLowDraft(formatValue(safeLow));
    }, [formatValue, isLowEditing, safeLow]);

    useEffect(() => {
        if (!isHighEditing) setHighDraft(formatValue(safeHigh));
    }, [formatValue, isHighEditing, safeHigh]);

    const commitLowDraft = useCallback(() => {
        const parsed = parseDraftNumber(lowDraft);
        if (parsed === null) {
            setLowDraft(formatValue(safeLow));
            return;
        }
        const clamped = clamp(roundByDecimals(parsed, decimals), boundMin, safeHigh);
        onChange({ min: clamped, max: safeHigh });
        setLowDraft(formatValue(clamped));
    }, [boundMin, decimals, formatValue, lowDraft, onChange, safeHigh, safeLow]);

    const commitHighDraft = useCallback(() => {
        const parsed = parseDraftNumber(highDraft);
        if (parsed === null) {
            setHighDraft(formatValue(safeHigh));
            return;
        }
        const clamped = clamp(roundByDecimals(parsed, decimals), safeLow, boundMax);
        onChange({ min: safeLow, max: clamped });
        setHighDraft(formatValue(clamped));
    }, [boundMax, decimals, formatValue, highDraft, onChange, safeHigh, safeLow]);

    const numberInput = themeClass(theme, {
        dark: 'h-9 w-full min-w-0 rounded-lg border border-zinc-700/80 bg-zinc-950/70 px-2.5 text-[13px] tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/70 focus:outline-none',
        light: 'h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2.5 text-[13px] tabular-nums text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none',
    });
    const rangeLabel = themeClass(theme, {
        dark: 'text-[11px] font-medium text-zinc-500',
        light: 'text-[11px] font-medium text-zinc-500',
    });

    return (
        <div className="filter-dual-range w-full">
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5" aria-labelledby={ariaLabelledBy}>
                <label className="min-w-0 space-y-1">
                    <span className={rangeLabel}>От</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={lowDraft}
                        className={numberInput}
                        aria-label="Минимум диапазона (ввод)"
                        onFocus={() => setIsLowEditing(true)}
                        onChange={e => setLowDraft(e.target.value)}
                        onBlur={() => {
                            setIsLowEditing(false);
                            commitLowDraft();
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.currentTarget as HTMLInputElement).blur();
                            }
                        }}
                    />
                </label>
                <label className="min-w-0 space-y-1">
                    <span className={rangeLabel}>До</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={highDraft}
                        className={numberInput}
                        aria-label="Максимум диапазона (ввод)"
                        onFocus={() => setIsHighEditing(true)}
                        onChange={e => setHighDraft(e.target.value)}
                        onBlur={() => {
                            setIsHighEditing(false);
                            commitHighDraft();
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.currentTarget as HTMLInputElement).blur();
                            }
                        }}
                    />
                </label>
            </div>
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
    const target = span / 240;
    const exp = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
    const normalized = target / exp;
    let mult = 1;
    if (normalized <= 1) mult = 1;
    else if (normalized <= 2) mult = 2;
    else if (normalized <= 5) mult = 5;
    else mult = 10;
    return Math.max(100, mult * exp);
}
