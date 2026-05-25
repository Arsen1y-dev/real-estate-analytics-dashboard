import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer } from 'recharts';

interface MeasuredResponsiveContainerProps {
    children: React.ReactNode;
    minWidth?: number;
    minHeight?: number;
    className?: string;
}

interface ContainerSize {
    width: number;
    height: number;
}

const INITIAL_SIZE: ContainerSize = { width: 0, height: 0 };

function floorPositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export const MeasuredResponsiveContainer: React.FC<MeasuredResponsiveContainerProps> = ({
    children,
    minWidth,
    minHeight,
    className,
}) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<ContainerSize>(INITIAL_SIZE);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const updateSize = (width: number, height: number) => {
            const nextWidth = floorPositive(width);
            const nextHeight = floorPositive(height);
            setSize(prev => {
                if (prev.width === nextWidth && prev.height === nextHeight) return prev;
                return { width: nextWidth, height: nextHeight };
            });
        };

        const measure = () => {
            const rect = host.getBoundingClientRect();
            updateSize(rect.width, rect.height);
        };

        measure();
        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) {
                measure();
                return;
            }
            updateSize(entry.contentRect.width, entry.contentRect.height);
        });
        observer.observe(host);

        return () => observer.disconnect();
    }, []);

    const resolvedWidth = useMemo(() => {
        if (size.width <= 0) return 0;
        return minWidth && minWidth > 0 ? Math.max(size.width, Math.floor(minWidth)) : size.width;
    }, [minWidth, size.width]);

    const resolvedHeight = useMemo(() => {
        if (size.height <= 0) return 0;
        return minHeight && minHeight > 0 ? Math.max(size.height, Math.floor(minHeight)) : size.height;
    }, [minHeight, size.height]);

    const canRenderChart = resolvedWidth > 0 && resolvedHeight > 0;

    return (
        <div ref={hostRef} className={className ?? 'h-full w-full min-h-0 min-w-0'}>
            {canRenderChart ? (
                <ResponsiveContainer width={resolvedWidth} height={resolvedHeight} minWidth={minWidth} minHeight={minHeight}>
                    {children}
                </ResponsiveContainer>
            ) : (
                <div className="h-full w-full" aria-hidden="true" />
            )}
        </div>
    );
};
