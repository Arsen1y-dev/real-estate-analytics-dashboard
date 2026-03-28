import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';

export const EmptyChartState: React.FC<{ message?: string; theme: Theme }> = ({ message, theme }) => (
    <div className={themeClass(theme, {
        dark: 'flex h-full items-center justify-center rounded-2xl bg-slate-900/60 border border-dashed border-slate-700/60 p-6 text-center text-sm text-slate-400',
        light: 'flex h-full items-center justify-center rounded-2xl bg-slate-100 border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500',
    })}>
        {message ?? 'Нет данных для отображения. Измените фильтры или загрузите другой файл.'}
    </div>
);
