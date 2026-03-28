import React, { useMemo, useState } from 'react';
import type { DataSummary, UserChartDefinition, UserChartType } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { newChartId } from '@/utils/id';

const CHART_TYPE_LABELS: Record<UserChartType, { label: string; hint: string }> = {
    histogram: { label: 'Гистограмма', hint: 'Распределение числового столбца по интервалам' },
    scatter: { label: 'Точечный (X / Y)', hint: 'Два числовых столбца' },
    categoryBars: { label: 'Категории', hint: 'Количество строк по значениям столбца' },
};

const controlBase = (theme: Theme) =>
    themeClass(theme, {
        dark: 'min-h-[2.75rem] w-full rounded-xl border border-slate-600/90 bg-slate-900/90 px-3.5 py-2 text-sm text-white shadow-sm transition focus:border-cyan-500/70 focus:outline-none focus:ring-2 focus:ring-cyan-500/30',
        light: 'min-h-[2.75rem] w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/25',
    });

const labelClass = (theme: Theme) =>
    themeClass(theme, {
        dark: 'mb-2 block text-sm font-medium leading-tight text-slate-300',
        light: 'mb-2 block text-sm font-medium leading-tight text-slate-700',
    });

export const ChartBuilderPanel: React.FC<{
    summary: DataSummary;
    charts: UserChartDefinition[];
    onChange: (next: UserChartDefinition[]) => void;
    disabled?: boolean;
    theme: Theme;
}> = ({ summary, charts, onChange, disabled, theme }) => {
    const numericCols = useMemo(() => summary.columns.filter(c => c.kind === 'numeric').map(c => c.name), [summary.columns]);
    const categoricalCols = useMemo(
        () => summary.columns.filter(c => c.kind === 'categorical').map(c => c.name),
        [summary.columns]
    );

    const [chartType, setChartType] = useState<UserChartType>('histogram');
    const [column, setColumn] = useState('');
    const [xColumn, setXColumn] = useState('');
    const [yColumn, setYColumn] = useState('');
    const [title, setTitle] = useState('');

    const canAddHistogram = numericCols.length > 0;
    const canAddScatter = numericCols.length >= 2;
    const canAddCategory = categoricalCols.length > 0;

    const addChart = () => {
        if (chartType === 'histogram') {
            const col = column || numericCols[0];
            if (!col) return;
            onChange([
                ...charts,
                {
                    id: newChartId(),
                    type: 'histogram',
                    column: col,
                    title: title.trim() || `Гистограмма: ${col}`,
                },
            ]);
        } else if (chartType === 'scatter') {
            const x = xColumn || numericCols[0];
            const y = yColumn || numericCols[1];
            if (!x || !y || x === y) return;
            onChange([
                ...charts,
                {
                    id: newChartId(),
                    type: 'scatter',
                    column: x,
                    xColumn: x,
                    yColumn: y,
                    title: title.trim() || `${x} × ${y}`,
                },
            ]);
        } else {
            const col = column || categoricalCols[0];
            if (!col) return;
            onChange([
                ...charts,
                {
                    id: newChartId(),
                    type: 'categoryBars',
                    column: col,
                    title: title.trim() || `По категориям: ${col}`,
                },
            ]);
        }
        setTitle('');
    };

    const removeChart = (id: string) => {
        onChange(charts.filter(c => c.id !== id));
    };

    const addDisabled =
        disabled ||
        (chartType === 'histogram' && !canAddHistogram) ||
        (chartType === 'scatter' && !canAddScatter) ||
        (chartType === 'categoryBars' && !canAddCategory);

    const sel = controlBase(theme);

    return (
        <div className={themeClass(theme, {
            dark: 'rounded-2xl border border-slate-700/60 bg-slate-900/70 px-5 py-6 shadow-lg shadow-black/20 backdrop-blur sm:px-7 sm:py-7',
            light: 'rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-md shadow-slate-200/90 sm:px-7 sm:py-7',
        })}>
            <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:pb-6">
                <h3
                    className={`font-display ${themeClass(theme, {
                        dark: 'text-xl font-bold tracking-tight text-white sm:text-2xl',
                        light: 'text-xl font-bold tracking-tight text-slate-900 sm:text-2xl',
                    })}`}
                >
                    Графики по столбцам
                </h3>
                <p
                    className={themeClass(theme, {
                        dark: 'max-w-xl text-sm leading-relaxed text-slate-400',
                        light: 'max-w-xl text-sm leading-relaxed text-slate-600',
                    })}
                >
                    Соберите набор визуализаций из вашего CSV: тип графика, столбцы и при желании свой заголовок.
                </p>
            </div>

            {charts.length > 0 && (
                <ul className="mt-5 space-y-2.5">
                    {charts.map(c => (
                        <li
                            key={c.id}
                            className={themeClass(theme, {
                                dark: 'grid grid-cols-1 items-center gap-3 rounded-xl border border-slate-700/55 bg-slate-950/55 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4',
                                light: 'grid grid-cols-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4',
                            })}
                        >
                            <span className={`min-w-0 text-sm font-medium ${themeClass(theme, { dark: 'text-slate-100', light: 'text-slate-900' })}`}>
                                <span className="block truncate">{c.title}</span>
                            </span>
                            <span
                                className={themeClass(theme, {
                                    dark: 'justify-self-start rounded-full bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 sm:justify-self-center',
                                    light: 'justify-self-start rounded-full bg-slate-200/90 px-3 py-1 text-xs font-medium text-slate-600 sm:justify-self-center',
                                })}
                            >
                                {CHART_TYPE_LABELS[c.type].label}
                            </span>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => removeChart(c.id)}
                                className={themeClass(theme, {
                                    dark: 'justify-self-end whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/15 sm:justify-self-end',
                                    light: 'justify-self-end whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 sm:justify-self-end',
                                })}
                            >
                                Удалить
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div
                className={themeClass(theme, {
                    dark: 'mt-6 space-y-6 rounded-2xl border border-slate-800/70 bg-slate-950/45 p-5 sm:p-6',
                    light: 'mt-6 space-y-6 rounded-2xl border border-slate-200 bg-slate-50/90 p-5 sm:p-6',
                })}
            >
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-0">
                    <div className="flex min-w-0 flex-col">
                        <label className={`${labelClass(theme)}`} htmlFor="chart-type-select">
                            Тип графика
                        </label>
                        <select
                            id="chart-type-select"
                            value={chartType}
                            disabled={disabled}
                            onChange={e => setChartType(e.target.value as UserChartType)}
                            className={sel}
                        >
                            {(Object.keys(CHART_TYPE_LABELS) as UserChartType[]).map(k => (
                                <option key={k} value={k}>
                                    {CHART_TYPE_LABELS[k].label}
                                </option>
                            ))}
                        </select>
                        <p className="mt-3 text-xs leading-relaxed text-balance text-slate-500 dark:text-slate-400">{CHART_TYPE_LABELS[chartType].hint}</p>
                    </div>

                    <div className="flex min-w-0 flex-col">
                        <label className={labelClass(theme)} htmlFor="chart-title-input">
                            Подпись графика <span className="font-normal text-slate-500 dark:text-slate-500">— по желанию</span>
                        </label>
                        <input
                            id="chart-title-input"
                            type="text"
                            value={title}
                            disabled={disabled}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Например: Распределение цены"
                            className={sel}
                        />
                    </div>
                </div>

                <div
                    className={themeClass(theme, {
                        dark: 'border-t border-slate-800/80 pt-6',
                        light: 'border-t border-slate-200/90 pt-6',
                    })}
                >
                    {chartType === 'histogram' && (
                        <div className="flex flex-col">
                            <label className={labelClass(theme)} htmlFor="histogram-column-select">
                                Числовой столбец
                            </label>
                            <select
                                id="histogram-column-select"
                                value={column || numericCols[0] || ''}
                                disabled={disabled || !canAddHistogram}
                                onChange={e => setColumn(e.target.value)}
                                className={sel}
                            >
                                {numericCols.map(name => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {chartType === 'scatter' && (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-x-8">
                            <div>
                                <label className={labelClass(theme)} htmlFor="scatter-x-select">
                                    Ось X
                                </label>
                                <select
                                    id="scatter-x-select"
                                    value={xColumn || numericCols[0] || ''}
                                    disabled={disabled || !canAddScatter}
                                    onChange={e => setXColumn(e.target.value)}
                                    className={sel}
                                >
                                    {numericCols.map(name => (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelClass(theme)} htmlFor="scatter-y-select">
                                    Ось Y
                                </label>
                                <select
                                    id="scatter-y-select"
                                    value={yColumn || numericCols[1] || numericCols[0] || ''}
                                    disabled={disabled || !canAddScatter}
                                    onChange={e => setYColumn(e.target.value)}
                                    className={sel}
                                >
                                    {numericCols.map(name => (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {chartType === 'categoryBars' && (
                        <div>
                            <label className={labelClass(theme)} htmlFor="category-column-select">
                                Категориальный столбец
                            </label>
                            <select
                                id="category-column-select"
                                value={column || categoricalCols[0] || ''}
                                disabled={disabled || !canAddCategory}
                                onChange={e => setColumn(e.target.value)}
                                className={sel}
                            >
                                {categoricalCols.map(name => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    disabled={addDisabled}
                    onClick={addChart}
                    className={themeClass(theme, {
                        dark: 'w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-teal-950/40 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-45',
                        light: 'w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-teal-900/20 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-45',
                    })}
                >
                    Добавить график
                </button>
            </div>
        </div>
    );
};
