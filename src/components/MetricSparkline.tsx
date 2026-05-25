import React from 'react';
import type { Theme } from '@/theme';
import { themeClass, sparklineStroke } from '@/theme';
import { sparklinePathFromValues } from '@/utils/sparkline';

export type MetricSparklineSize = 'default' | 'hero';

const SIZE: Record<MetricSparklineSize, { w: number; h: number; maxW: string; strokeWidth: number }> = {
    default: { w: 120, h: 32, maxW: 'max-w-[140px]', strokeWidth: 1.35 },
    hero: { w: 180, h: 44, maxW: 'max-w-[220px]', strokeWidth: 1.5 },
};

export const MetricSparkline: React.FC<{ values: number[]; theme: Theme; size?: MetricSparklineSize }> = ({
    values,
    theme,
    size = 'default',
}) => {
    const { w, h, maxW, strokeWidth } = SIZE[size];
    const path = sparklinePathFromValues(values, w, h);
    if (!path) {
        return (
            <div
                className={`w-full rounded-md ${maxW} ${themeClass(theme, {
                    dark: 'bg-zinc-800/50',
                    light: 'bg-zinc-200/70',
                })}`}
                style={{ height: h }}
            />
        );
    }

    const strokeColor = sparklineStroke(theme);

    return (
        <svg
            width="100%"
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            className={`block w-full ${maxW} ${size === 'hero' ? 'opacity-95' : 'opacity-90'}`}
            aria-hidden
        >
            <path
                d={path.d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
};
