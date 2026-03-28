import React, { useEffect, useMemo, useState } from 'react';
import type { DataSummary, UserChartDefinition, UserChartType } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { newChartId } from '@/utils/id';
import {
    ALL_PRESET_IDS,
    CHART_PRESET_LABELS,
    chartFromPreset,
    isPresetAvailable,
    type ChartPresetId,
} from '@/domain/chartPresets';
import { GripVerticalIcon } from '@/components/icons';
import { ColumnSearchSelect, type ColumnQuickPick } from '@/components/ColumnSearchSelect';
import { effectiveHistogramColumn, getPriceColumnRecommendations } from '@/domain/chartRecommendations';

const CHART_TYPE_LABELS: Record<UserChartType, { label: string; hint: string }> = {
    histogram: { label: 'Гистограмма', hint: 'Распределение числового столбца' },
    scatter: { label: 'Точечный', hint: 'Два числовых столбца' },
    categoryBars: { label: 'Категории', hint: 'Количество по категориям' },
};

const controlBase = (theme: Theme) =>
    themeClass(theme, {
        dark: 'min-h-[2.5rem] w-full rounded-xl border border-zinc-700/90 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-100 shadow-sm transition focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
        light: 'min-h-[2.5rem] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15',
    });

const labelClass = (theme: Theme) =>
    themeClass(theme, {
        dark: 'mb-2 block text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500',
        light: 'mb-2 block text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500',
    });

/** Перемещает элемент с fromIndex на позицию toIndex в итоговом списке (индексы до удаления). */
function reorderCharts(list: UserChartDefinition[], fromIndex: number, toIndex: number): UserChartDefinition[] {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
    const next = [...list];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}

export const ChartSidebar: React.FC<{
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

    const popularQuickPicks = useMemo((): ColumnQuickPick[] => {
        const c = summary.coreColumnMap;
        const picks: ColumnQuickPick[] = [];
        if (c.price) picks.push({ label: 'Цена', column: c.price });
        if (c.area) picks.push({ label: 'Площадь', column: c.area });
        if (c.rooms) picks.push({ label: 'Комнаты', column: c.rooms });
        return picks;
    }, [summary.coreColumnMap]);

    const [chartType, setChartType] = useState<UserChartType>('histogram');
    const [column, setColumn] = useState('');
    const [xColumn, setXColumn] = useState('');
    const [yColumn, setYColumn] = useState('');
    const [title, setTitle] = useState('');
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    /** Смена типа графика — другой набор допустимых столбцов; сбрасываем выбор, чтобы не тянуть числовой столбец в категориальный список и наоборот. */
    useEffect(() => {
        setColumn('');
        setXColumn('');
        setYColumn('');
    }, [chartType]);

    const canAddHistogram = numericCols.length > 0;
    const canAddScatter = numericCols.length >= 2;
    const canAddCategory = categoricalCols.length > 0;

    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const effectiveHistCol = effectiveHistogramColumn(column, numericCols);
    const priceSelectedForReco =
        chartType === 'histogram' &&
        !!priceCol &&
        numericCols.includes(priceCol) &&
        effectiveHistCol === priceCol;

    const priceRecommendations = useMemo(
        () =>
            getPriceColumnRecommendations(summary, {
                areaAvailable: !!(areaCol && numericCols.includes(areaCol)),
                scatterAvailable: canAddScatter,
            }),
        [summary, areaCol, canAddScatter, numericCols]
    );

    const applyScatterPriceAreaForm = () => {
        if (!priceCol || !areaCol || !numericCols.includes(areaCol)) return;
        setChartType('scatter');
        window.setTimeout(() => {
            setXColumn(priceCol);
            setYColumn(areaCol);
        }, 0);
    };

    const addScatterPriceAreaChart = () => {
        if (!priceCol || !areaCol || !canAddScatter) return;
        onChange([
            ...charts,
            {
                id: newChartId(),
                type: 'scatter',
                column: priceCol,
                xColumn: priceCol,
                yColumn: areaCol,
                title: `${priceCol} × ${areaCol}`,
            },
        ]);
    };

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

    const applyPreset = (id: ChartPresetId) => {
        const def = chartFromPreset(id, summary);
        if (!def) return;
        onChange([...charts, def]);
    };

    const addDisabled =
        disabled ||
        (chartType === 'histogram' && !canAddHistogram) ||
        (chartType === 'scatter' && !canAddScatter) ||
        (chartType === 'categoryBars' && !canAddCategory);

    const sel = controlBase(theme);

    const onDragStart = (e: React.DragEvent, id: string) => {
        setDraggingId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    };

    const onDragEnd = () => {
        setDraggingId(null);
        setDragOverId(null);
    };

    const onDragOverRow = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverId(id);
    };

    const onDropRow = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || draggingId;
        setDragOverId(null);
        setDraggingId(null);
        if (!id) return;
        const fromIndex = charts.findIndex(c => c.id === id);
        const toIndex = charts.findIndex(c => c.id === targetId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        onChange(reorderCharts(charts, fromIndex, toIndex));
    };

    const shell = themeClass(theme, {
        dark: 'flex flex-col gap-7 rounded-3xl border border-zinc-800/85 bg-zinc-950/70 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.2)] backdrop-blur-md sm:p-7',
        light: 'flex flex-col gap-7 rounded-3xl border border-zinc-200/95 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(0,0,0,0.06)] backdrop-blur-md sm:p-7',
    });

    return (
        <div className={shell}>
            <header className="space-y-2">
                <h3
                    className={themeClass(theme, {
                        dark: 'font-display text-base font-semibold tracking-tight text-zinc-50',
                        light: 'font-display text-base font-semibold tracking-tight text-zinc-900',
                    })}
                >
                    Панель графиков
                </h3>
                <p
                    className={themeClass(theme, {
                        dark: 'text-sm leading-relaxed text-zinc-500',
                        light: 'text-sm leading-relaxed text-zinc-600',
                    })}
                >
                    Пресеты и порядок листов — как в аналитических BI-инструментах. Перетащите строки за ручку.
                </p>
            </header>

            <div className="space-y-3">
                <p className={labelClass(theme)}>Быстрые пресеты</p>
                <div className="flex flex-col gap-2">
                    {ALL_PRESET_IDS.map(presetId => {
                        const ok = isPresetAvailable(presetId, summary);
                        const meta = CHART_PRESET_LABELS[presetId];
                        return (
                            <button
                                key={presetId}
                                type="button"
                                disabled={disabled || !ok}
                                title={!ok ? 'Нет подходящих столбцов в CSV' : meta.hint}
                                onClick={() => applyPreset(presetId)}
                                className={`w-full rounded-xl border px-3.5 py-3 text-left text-sm transition ${
                                    ok && !disabled
                                        ? themeClass(theme, {
                                              dark: 'border-zinc-700/85 bg-zinc-900/45 text-zinc-200 hover:border-indigo-500/35 hover:bg-zinc-900/80',
                                              light: 'border-zinc-200 bg-zinc-50/90 text-zinc-800 hover:border-indigo-200 hover:bg-white',
                                          })
                                        : themeClass(theme, {
                                              dark: 'cursor-not-allowed border-zinc-800/90 bg-zinc-950/50 text-zinc-600',
                                              light: 'cursor-not-allowed border-zinc-100 bg-zinc-100/90 text-zinc-400',
                                          })
                                }`}
                            >
                                <span className="font-medium">{meta.title}</span>
                                <span
                                    className={themeClass(theme, {
                                        dark: 'mt-1 block text-[11px] font-normal text-zinc-500',
                                        light: 'mt-1 block text-[11px] font-normal text-zinc-500',
                                    })}
                                >
                                    {meta.hint}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <p className={labelClass(theme)}>Порядок на холсте</p>
                    <span
                        className={themeClass(theme, {
                            dark: 'text-[11px] tabular-nums text-zinc-500',
                            light: 'text-[11px] tabular-nums text-zinc-500',
                        })}
                    >
                        {charts.length} шт.
                    </span>
                </div>
                {charts.length === 0 ? (
                    <p
                        className={themeClass(theme, {
                            dark: 'rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500',
                            light: 'rounded-xl border border-dashed border-zinc-200 py-8 text-center text-xs text-zinc-500',
                        })}
                    >
                        Добавьте пресет или график ниже
                    </p>
                ) : (
                    <ul className="space-y-1" role="list">
                        {charts.map(c => (
                            <li
                                key={c.id}
                                onDragOver={e => onDragOverRow(e, c.id)}
                                onDragLeave={() => setDragOverId(null)}
                                onDrop={e => onDropRow(e, c.id)}
                                className={`flex items-center gap-2 rounded-lg border px-2 py-2 transition ${
                                    dragOverId === c.id && draggingId !== c.id
                                        ? themeClass(theme, {
                                              dark: 'border-indigo-500/40 bg-indigo-500/[0.08]',
                                              light: 'border-indigo-200 bg-indigo-50/90',
                                          })
                                        : themeClass(theme, {
                                              dark: 'border-zinc-800/90 bg-zinc-900/50',
                                              light: 'border-zinc-200 bg-zinc-50/90',
                                          })
                                } ${draggingId === c.id ? 'opacity-50' : ''}`}
                            >
                                <button
                                    type="button"
                                    draggable={!disabled}
                                    onDragStart={e => onDragStart(e, c.id)}
                                    onDragEnd={onDragEnd}
                                    disabled={disabled}
                                    className={themeClass(theme, {
                                        dark: 'shrink-0 cursor-grab rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40',
                                        light: 'shrink-0 cursor-grab rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40',
                                    })}
                                    aria-label={`Перетащить: ${c.title}`}
                                >
                                    <GripVerticalIcon />
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p
                                        className={themeClass(theme, {
                                            dark: 'truncate text-sm font-medium text-zinc-100',
                                            light: 'truncate text-sm font-medium text-zinc-900',
                                        })}
                                    >
                                        {c.title}
                                    </p>
                                    <p
                                        className={themeClass(theme, {
                                            dark: 'text-[11px] text-zinc-500',
                                            light: 'text-[11px] text-zinc-500',
                                        })}
                                    >
                                        {CHART_TYPE_LABELS[c.type].label}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => removeChart(c.id)}
                                    className={themeClass(theme, {
                                        dark: 'shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300',
                                        light: 'shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800',
                                    })}
                                >
                                    Удалить
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div
                className={themeClass(theme, {
                    dark: 'space-y-5 border-t border-zinc-800/80 pt-6',
                    light: 'space-y-5 border-t border-zinc-200/90 pt-6',
                })}
            >
                <p className={labelClass(theme)}>Новый график</p>
                <div className="space-y-3">
                    <div>
                        <label className={labelClass(theme)} htmlFor="chart-type-select">
                            Тип
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
                    </div>
                    <div>
                        <label className={labelClass(theme)} htmlFor="chart-title-input">
                            Заголовок
                        </label>
                        <input
                            id="chart-title-input"
                            type="text"
                            value={title}
                            disabled={disabled}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Необязательно"
                            className={sel}
                        />
                    </div>
                </div>

                <div
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-zinc-800/90 bg-zinc-950/50 px-3.5 py-3',
                        light: 'rounded-xl border border-zinc-200/95 bg-zinc-50/90 px-3.5 py-3',
                    })}
                >
                    <p
                        className={themeClass(theme, {
                            dark: 'text-[11px] font-semibold tracking-tight text-zinc-100',
                            light: 'text-[11px] font-semibold tracking-tight text-zinc-900',
                        })}
                    >
                        {chartType === 'histogram' && 'Числовой столбец'}
                        {chartType === 'scatter' && 'Два числовых столбца'}
                        {chartType === 'categoryBars' && 'Категориальный столбец'}
                    </p>
                    <p
                        className={themeClass(theme, {
                            dark: 'mt-1 text-xs leading-relaxed text-zinc-500',
                            light: 'mt-1 text-xs leading-relaxed text-zinc-600',
                        })}
                    >
                        {CHART_TYPE_LABELS[chartType].hint}
                    </p>
                    <p
                        className={themeClass(theme, {
                            dark: 'mt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-indigo-400/95',
                            light: 'mt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-indigo-700',
                        })}
                    >
                        {chartType === 'histogram' && `Список: только числовые · ${numericCols.length} шт.`}
                        {chartType === 'scatter' && `Список: только числовые · ${numericCols.length} шт.`}
                        {chartType === 'categoryBars' &&
                            `Список: только категориальные · ${categoricalCols.length} шт.`}
                    </p>
                </div>

                {chartType === 'histogram' && (
                    <>
                        <ColumnSearchSelect
                            id="histogram-column-select"
                            label="Столбец"
                            options={numericCols}
                            value={column || numericCols[0] || ''}
                            disabled={disabled || !canAddHistogram}
                            onChange={setColumn}
                            theme={theme}
                            searchPlaceholder="Поиск среди числовых столбцов…"
                            quickPicks={popularQuickPicks.filter(p => numericCols.includes(p.column))}
                            emptyText={
                                canAddHistogram ? 'Нет совпадений' : 'Нет числовых столбцов в данных'
                            }
                        />
                        {priceSelectedForReco && priceRecommendations.length > 0 && (
                            <div
                                className={themeClass(theme, {
                                    dark: 'rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-3.5 py-3',
                                    light: 'rounded-xl border border-indigo-200/90 bg-indigo-50/60 px-3.5 py-3',
                                })}
                            >
                                <p
                                    className={themeClass(theme, {
                                        dark: 'text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-300/95',
                                        light: 'text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-800',
                                    })}
                                >
                                    Рекомендации
                                </p>
                                <ul className="mt-2.5 space-y-3">
                                    {priceRecommendations.map(rec => (
                                        <li key={rec.id}>
                                            <p
                                                className={themeClass(theme, {
                                                    dark: 'text-sm font-medium text-zinc-100',
                                                    light: 'text-sm font-medium text-zinc-900',
                                                })}
                                            >
                                                {rec.id === 'histogram-price' && '✓ '}
                                                {rec.title}
                                            </p>
                                            <p
                                                className={themeClass(theme, {
                                                    dark: 'mt-0.5 text-xs leading-relaxed text-zinc-500',
                                                    light: 'mt-0.5 text-xs leading-relaxed text-zinc-600',
                                                })}
                                            >
                                                {rec.description}
                                            </p>
                                            {rec.id === 'scatter-price-area' && areaCol && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={disabled || !canAddScatter}
                                                        onClick={applyScatterPriceAreaForm}
                                                        className={themeClass(theme, {
                                                            dark: 'rounded-lg border border-indigo-500/35 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-medium text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-45',
                                                            light: 'rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-900 shadow-sm transition hover:bg-indigo-50 disabled:opacity-45',
                                                        })}
                                                    >
                                                        Настроить точечный график
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={disabled || !canAddScatter}
                                                        onClick={addScatterPriceAreaChart}
                                                        className={themeClass(theme, {
                                                            dark: 'rounded-lg border border-zinc-600 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45',
                                                            light: 'rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-45',
                                                        })}
                                                    >
                                                        Добавить на холст
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                {chartType === 'scatter' && (
                    <div className="grid grid-cols-1 gap-3">
                        <ColumnSearchSelect
                            id="scatter-x-select"
                            label="Ось X"
                            options={numericCols}
                            value={xColumn || numericCols[0] || ''}
                            disabled={disabled || !canAddScatter}
                            onChange={setXColumn}
                            theme={theme}
                            searchPlaceholder="Поиск среди числовых столбцов…"
                            quickPicks={popularQuickPicks.filter(p => numericCols.includes(p.column))}
                            emptyText={
                                canAddScatter ? 'Нет совпадений' : 'Нужно минимум два числовых столбца'
                            }
                        />
                        <ColumnSearchSelect
                            id="scatter-y-select"
                            label="Ось Y"
                            options={numericCols}
                            value={yColumn || numericCols[1] || numericCols[0] || ''}
                            disabled={disabled || !canAddScatter}
                            onChange={setYColumn}
                            theme={theme}
                            searchPlaceholder="Поиск среди числовых столбцов…"
                            quickPicks={popularQuickPicks.filter(p => numericCols.includes(p.column))}
                            emptyText={
                                canAddScatter ? 'Нет совпадений' : 'Нужно минимум два числовых столбца'
                            }
                        />
                    </div>
                )}

                {chartType === 'categoryBars' && (
                    <ColumnSearchSelect
                        id="category-column-select"
                        label="Категория"
                        options={categoricalCols}
                        value={column || categoricalCols[0] || ''}
                        disabled={disabled || !canAddCategory}
                        onChange={setColumn}
                        theme={theme}
                        searchPlaceholder="Поиск среди категориальных столбцов…"
                        quickPicks={popularQuickPicks.filter(p => categoricalCols.includes(p.column))}
                        emptyText={
                            canAddCategory ? 'Нет совпадений' : 'Нет категориальных столбцов в данных'
                        }
                    />
                )}

                <button
                    type="button"
                    disabled={addDisabled}
                    onClick={addChart}
                    className={themeClass(theme, {
                        dark: 'w-full rounded-xl bg-indigo-600 px-3 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45',
                        light: 'w-full rounded-xl bg-indigo-600 px-3 py-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45',
                    })}
                >
                    Добавить на холст
                </button>
            </div>
        </div>
    );
};
