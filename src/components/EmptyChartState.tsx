import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

export const EmptyChartState: React.FC<{ message?: string; theme: Theme }> = ({ message, theme }) => (
    <div className={themeClass(theme, {
        dark: 'flex h-full items-center justify-center rounded-3xl bg-zinc-950/50 border border-dashed border-zinc-700/70 p-8 text-center text-sm text-zinc-500',
        light: 'flex h-full items-center justify-center rounded-3xl bg-zinc-50 border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500',
    })}>
        {message ?? 'Нет данных для отображения. Измените фильтры или загрузите другой файл.'}
    </div>
);
