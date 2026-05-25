import React, { useId, useMemo } from 'react';
import type { DataRow, DataSummary, FilterSettings } from '@/types';
import { collectRoomFilterOptions } from '../../shared/rooms';
import { isAnyFilterDirty } from '@/domain/filters';
import { themeClass, type Theme } from '@/theme';
import { CloseIcon } from '@/components/icons';
import { FilterDualRange, filterSliderStep } from '@/components/FilterDualRange';
import { formatAreaCompactSqM, formatRubCompact } from '@/utils/metricDisplay';
import { formatColumnLabel } from '@/utils/displayLabel';

function formatIntRu(n: number): string {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

let additionalFilterIdCounter = 0;

function nextAdditionalFilterId(): string {
    additionalFilterIdCounter += 1;
    return `af-${Date.now().toString(36)}-${additionalFilterIdCounter.toString(36)}`;
}

export const FilterPanel: React.FC<{
    filters: FilterSettings;
    baselineFilters: FilterSettings;
    summary: DataSummary;
    allData: DataRow[];
    onFilterChange: (newFilters: FilterSettings) => void;
    /** Совпадений текущих фильтров по полному набору строк. */
    matchCount: number;
    totalCount: number;
    onClose?: () => void;
    theme: Theme;
}> = ({ filters, baselineFilters, summary, allData, onFilterChange, matchCount, totalCount, onClose, theme }) => {
    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;
    const roomOptions = useMemo(
        () => (roomsCol ? collectRoomFilterOptions(allData, roomsCol) : []),
        [allData, roomsCol]
    );
    const baseId = useId();

    const priceId = `${baseId}-price`;
    const areaId = `${baseId}-area`;
    const roomsId = `${baseId}-rooms`;
    const yearId = `${baseId}-year`;
    const distanceId = `${baseId}-distance`;
    const floorFlagsId = `${baseId}-floor-flags`;
    const houseTypeId = `${baseId}-housetype`;

    const priceBounds = baselineFilters.price;
    const areaBounds = baselineFilters.area;
    const priceSpan = priceBounds.max - priceBounds.min;
    const areaSpan = areaBounds.max - areaBounds.min;
    const priceStep = useMemo(() => filterSliderStep(priceSpan, 'price'), [priceSpan]);
    const areaStep = useMemo(() => filterSliderStep(areaSpan, 'area'), [areaSpan]);
    const yearBounds = baselineFilters.yearBuilt;
    const distanceBounds = baselineFilters.distanceKm;
    const yearStep = 1;
    const distanceStep = useMemo(() => filterSliderStep(distanceBounds.max - distanceBounds.min, 'area'), [distanceBounds.max, distanceBounds.min]);

    const handlePriceRange = (next: { min: number; max: number }) => {
        onFilterChange({ ...filters, price: { ...next } });
    };

    const handleAreaRange = (next: { min: number; max: number }) => {
        onFilterChange({ ...filters, area: { ...next } });
    };

    const handleRoomToggle = (room: number) => {
        if (filters.rooms.length === 0) {
            onFilterChange({ ...filters, rooms: [room] });
            return;
        }
        const next = filters.rooms.includes(room)
            ? filters.rooms.filter(r => r !== room)
            : [...filters.rooms, room].sort((a, b) => a - b);
        onFilterChange({ ...filters, rooms: next });
    };

    const clearRooms = () => onFilterChange({ ...filters, rooms: [] });

    const resetAllFilters = () => {
        onFilterChange({
            price: { ...baselineFilters.price },
            area: { ...baselineFilters.area },
            rooms: [...baselineFilters.rooms],
            yearBuilt: { ...baselineFilters.yearBuilt },
            distanceKm: { ...baselineFilters.distanceKm },
            floor: { ...baselineFilters.floor },
            houseTypes: [...baselineFilters.houseTypes],
            excludeFirstFloor: baselineFilters.excludeFirstFloor,
            excludeLastFloor: baselineFilters.excludeLastFloor,
            radiusKm: baselineFilters.radiusKm,
            additionalFilters: [...baselineFilters.additionalFilters],
        });
    };

    const filtersDirty = useMemo(() => isAnyFilterDirty(filters, baselineFilters), [filters, baselineFilters]);

    const hasAnyCore = priceCol || areaCol || roomsCol;
    const additionalColumnKind = useMemo(
        () => new Map(summary.columns.map(col => [col.name, col.kind] as const)),
        [summary.columns]
    );
    const additionalColumns = useMemo(
        () => summary.columnOrder.filter(name => additionalColumnKind.has(name)),
        [summary.columnOrder, additionalColumnKind]
    );
    const canAddAdditionalFilter = additionalColumns.length > 0;
    const defaultAdditionalColumn = additionalColumns[0] ?? '';

    const makeConditionForColumn = (column: string, id?: string): FilterSettings['additionalFilters'][number] => {
        const kind = additionalColumnKind.get(column) === 'numeric' ? 'number' : 'text';
        return {
            id: id ?? nextAdditionalFilterId(),
            column,
            operator: kind === 'number' ? 'gte' : 'equals',
            value: '',
            valueTo: kind === 'number' ? '' : undefined,
        };
    };

    const setAdditionalFilters = (next: FilterSettings['additionalFilters']) => {
        onFilterChange({ ...filters, additionalFilters: next });
    };

    const addAdditionalFilter = () => {
        if (!defaultAdditionalColumn) return;
        setAdditionalFilters([...filters.additionalFilters, makeConditionForColumn(defaultAdditionalColumn)]);
    };

    const removeAdditionalFilter = (id: string) => {
        setAdditionalFilters(filters.additionalFilters.filter(item => item.id !== id));
    };

    const updateAdditionalFilterColumn = (id: string, column: string) => {
        setAdditionalFilters(
            filters.additionalFilters.map(item =>
                item.id === id ? makeConditionForColumn(column, item.id) : item
            )
        );
    };

    const updateAdditionalFilterOperator = (id: string, operator: 'gte' | 'lte' | 'between' | 'equals' | 'contains') => {
        setAdditionalFilters(
            filters.additionalFilters.map(item => {
                if (item.id !== id) return item;
                if (operator === 'between') {
                    return { ...item, operator, valueTo: item.valueTo ?? '' };
                }
                return { ...item, operator, valueTo: undefined };
            })
        );
    };

    const updateAdditionalFilterValue = (id: string, key: 'value' | 'valueTo', nextValue: string) => {
        setAdditionalFilters(
            filters.additionalFilters.map(item =>
                item.id === id ? { ...item, [key]: nextValue } : item
            )
        );
    };

    const sectionTitle = themeClass(theme, {
        dark: 'text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500',
        light: 'text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500',
    });
    const sectionStack = 'space-y-2.5';
    const sectionHeader = 'flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5';
    const sectionValueText = themeClass(theme, {
        dark: 'text-right text-xs tabular-nums leading-snug text-zinc-500',
        light: 'text-right text-xs tabular-nums leading-snug text-zinc-500',
    });
    const sectionHint = themeClass(theme, {
        dark: 'mt-1 text-[13px] text-zinc-500',
        light: 'mt-1 text-[13px] text-zinc-600',
    });

    const shell = themeClass(theme, {
        dark: 'flex h-full min-w-0 max-h-[min(100vh-10rem,56rem)] flex-col overflow-x-hidden overflow-y-auto rounded-3xl border border-zinc-800/85 bg-zinc-950/75 shadow-[0_1px_3px_rgba(0,0,0,0.2),0_16px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md lg:max-h-[calc(100vh-8rem)]',
        light: 'flex h-full min-w-0 max-h-[min(100vh-10rem,56rem)] flex-col overflow-x-hidden overflow-y-auto rounded-3xl border border-zinc-200/95 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_16px_48px_-16px_rgba(0,0,0,0.07)] backdrop-blur-md lg:max-h-[calc(100vh-8rem)]',
    });

    const innerPad = 'px-4 pb-5 pt-5 sm:px-5 sm:pb-6 sm:pt-6';

    const chipBase =
        'inline-flex min-h-[2rem] items-center justify-center rounded-lg px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

    const roomChipMuted = themeClass(theme, {
        dark: 'border border-zinc-700/90 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300',
        light: 'border border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100',
    });

    const roomChipOn = themeClass(theme, {
        dark: 'border border-indigo-500/45 bg-indigo-500/[0.12] text-indigo-100 shadow-sm',
        light: 'border border-indigo-200 bg-indigo-50 text-indigo-900 shadow-sm',
    });

    const roomChipOff = themeClass(theme, {
        dark: 'border border-zinc-700/80 bg-transparent text-zinc-500 opacity-75 hover:opacity-100',
        light: 'border border-zinc-200 bg-white text-zinc-400 opacity-85 hover:opacity-100',
    });

    return (
        <div className={shell}>
            <div className={`shrink-0 border-b ${themeClass(theme, { dark: 'border-zinc-800/90', light: 'border-zinc-200/90' })} ${innerPad}`}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                        <h3
                            className={themeClass(theme, {
                            dark: 'font-display text-base font-semibold tracking-tight text-zinc-50',
                            light: 'font-display text-base font-semibold tracking-tight text-zinc-900',
                            })}
                        >
                            Фильтры
                        </h3>
                        <p
                            className={themeClass(theme, {
                                dark: 'text-sm text-zinc-500',
                                light: 'text-sm text-zinc-500',
                            })}
                        >
                            Уточните выборку — графики и KPI обновятся автоматически
                        </p>
                    </div>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className={themeClass(theme, {
                                dark: 'shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100 lg:hidden',
                                light: 'shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 lg:hidden',
                            })}
                            aria-label="Закрыть панель фильтров"
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>

                <div className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div
                        className={themeClass(theme, {
                            dark: 'inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-zinc-900/85 px-3.5 py-2.5 ring-1 ring-zinc-800/90',
                            light: 'inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-zinc-50 px-3.5 py-2.5 ring-1 ring-zinc-200/90',
                        })}
                        role="status"
                        aria-live="polite"
                    >
                        <span
                            className={themeClass(theme, {
                                dark: 'text-lg font-semibold tabular-nums text-zinc-50',
                                light: 'text-lg font-semibold tabular-nums text-zinc-900',
                            })}
                        >
                            {formatIntRu(matchCount)}
                        </span>
                        <span
                            className={themeClass(theme, {
                                dark: 'text-sm text-zinc-500',
                                light: 'text-sm text-zinc-500',
                            })}
                        >
                            из {formatIntRu(totalCount)} объектов после очистки
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={resetAllFilters}
                        disabled={!filtersDirty}
                        className={`w-full shrink-0 rounded-lg px-3 py-2 text-center text-sm font-medium transition sm:w-auto sm:text-left ${
                            filtersDirty
                                ? themeClass(theme, {
                                      dark: 'border border-zinc-700 bg-zinc-900/90 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900',
                                      light: 'border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:border-zinc-300 hover:bg-zinc-50',
                                  })
                                : themeClass(theme, {
                                      dark: 'cursor-not-allowed border border-zinc-800/90 bg-zinc-950/50 text-zinc-600',
                                      light: 'cursor-not-allowed border border-zinc-200/90 bg-zinc-50 text-zinc-400',
                                  })
                        }`}
                    >
                        Сбросить фильтры
                    </button>
                </div>
            </div>

            <div className={`flex-1 space-y-4 ${innerPad} pt-4`}>
                {!hasAnyCore && (
                    <p
                        className={themeClass(theme, {
                            dark: 'rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/25 p-5 text-sm leading-relaxed text-zinc-500',
                            light: 'rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 p-5 text-sm leading-relaxed text-zinc-600',
                        })}
                    >
                        В файле нет колонок «цена», «площадь» и «комнаты» — фильтры скрыты. Данные идут в графики без отсечения.
                    </p>
                )}

                {priceCol && (
                    <section className={sectionStack} aria-labelledby={priceId}>
                        <div className={sectionHeader}>
                            <div>
                                <p id={priceId} className={sectionTitle}>
                                    Цена
                                </p>
                            </div>
                            <p className={`${sectionValueText} max-w-full break-words sm:max-w-[14rem]`}>
                                {formatRubCompact(filters.price.min)} — {formatRubCompact(filters.price.max)}
                            </p>
                        </div>
                        <FilterDualRange
                            theme={theme}
                            boundMin={priceBounds.min}
                            boundMax={priceBounds.max}
                            valueMin={filters.price.min}
                            valueMax={filters.price.max}
                            step={priceStep}
                            onChange={handlePriceRange}
                            ariaLabelledBy={priceId}
                        />
                    </section>
                )}

                {areaCol && (
                    <section className={sectionStack} aria-labelledby={areaId}>
                        <div className={sectionHeader}>
                            <div>
                                <p id={areaId} className={sectionTitle}>
                                    Площадь
                                </p>
                            </div>
                            <p className={sectionValueText}>
                                {formatAreaCompactSqM(filters.area.min)} — {formatAreaCompactSqM(filters.area.max)}
                            </p>
                        </div>
                        <FilterDualRange
                            theme={theme}
                            boundMin={areaBounds.min}
                            boundMax={areaBounds.max}
                            valueMin={filters.area.min}
                            valueMax={filters.area.max}
                            step={areaStep}
                            onChange={handleAreaRange}
                            ariaLabelledBy={areaId}
                        />
                    </section>
                )}

                {roomsCol && roomOptions.length > 0 && (
                    <section className={sectionStack} aria-labelledby={roomsId}>
                        <div>
                            <p id={roomsId} className={sectionTitle}>
                                Комнаты
                            </p>
                            <p className={sectionHint}>
                                {roomsCol}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={clearRooms}
                                className={`w-full ${chipBase} ${
                                    filters.rooms.length === 0 ? `${roomChipOn} ring-1 ring-indigo-500/20` : roomChipMuted
                                }`}
                            >
                                Все планировки
                            </button>
                            {roomOptions.map(room => {
                                const showOn =
                                    filters.rooms.length === 0 ? false : filters.rooms.includes(room);
                                const cls =
                                    filters.rooms.length === 0
                                        ? roomChipMuted
                                        : showOn
                                          ? roomChipOn
                                          : roomChipOff;
                                return (
                                    <button
                                        key={room}
                                        type="button"
                                        onClick={() => handleRoomToggle(room)}
                                        className={`${chipBase} min-w-[2.5rem] ${cls}`}
                                        aria-pressed={filters.rooms.length === 0 ? false : showOn}
                                    >
                                        {room === 0 ? 'Студия' : `${room}`}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}
                {summary.coreColumnMap.yearBuilt && (
                    <section className={sectionStack} aria-labelledby={yearId}>
                        <div className={sectionHeader}>
                            <div>
                                <p id={yearId} className={sectionTitle}>Год постройки</p>
                            </div>
                            <p className={sectionValueText}>
                                {Math.round(filters.yearBuilt.min)} — {Math.round(filters.yearBuilt.max)}
                            </p>
                        </div>
                        <FilterDualRange
                            theme={theme}
                            boundMin={yearBounds.min}
                            boundMax={yearBounds.max}
                            valueMin={filters.yearBuilt.min}
                            valueMax={filters.yearBuilt.max}
                            step={yearStep}
                            onChange={(next) => onFilterChange({ ...filters, yearBuilt: next })}
                            ariaLabelledBy={yearId}
                        />
                    </section>
                )}
                {summary.coreColumnMap.distanceKm && (
                    <section className={sectionStack} aria-labelledby={distanceId}>
                        <div className={sectionHeader}>
                            <div>
                                <p id={distanceId} className={sectionTitle}>Расстояние до центра (км)</p>
                            </div>
                            <p className={sectionValueText}>
                                {filters.distanceKm.min.toFixed(1)} — {filters.distanceKm.max.toFixed(1)}
                            </p>
                        </div>
                        <FilterDualRange
                            theme={theme}
                            boundMin={distanceBounds.min}
                            boundMax={distanceBounds.max}
                            valueMin={filters.distanceKm.min}
                            valueMax={filters.distanceKm.max}
                            step={distanceStep}
                            onChange={(next) => onFilterChange({ ...filters, distanceKm: next, radiusKm: next.max })}
                            ariaLabelledBy={distanceId}
                        />
                    </section>
                )}
                {(summary.coreColumnMap.firstFloor || summary.coreColumnMap.lastFloor) && (
                    <section className={sectionStack} aria-labelledby={floorFlagsId}>
                        <p id={floorFlagsId} className={sectionTitle}>Этажность</p>
                        <div className="grid grid-cols-2 gap-2">
                            {summary.coreColumnMap.firstFloor && (
                                <button type="button" onClick={() => onFilterChange({ ...filters, excludeFirstFloor: !filters.excludeFirstFloor })} className={`${chipBase} ${filters.excludeFirstFloor ? roomChipOn : roomChipMuted}`}>Искл. 1 этаж</button>
                            )}
                            {summary.coreColumnMap.lastFloor && (
                                <button type="button" onClick={() => onFilterChange({ ...filters, excludeLastFloor: !filters.excludeLastFloor })} className={`${chipBase} ${filters.excludeLastFloor ? roomChipOn : roomChipMuted}`}>Искл. последний</button>
                            )}
                        </div>
                    </section>
                )}
                {summary.houseTypes.length > 0 && (
                    <section className={sectionStack} aria-labelledby={houseTypeId}>
                        <p id={houseTypeId} className={sectionTitle}>Тип дома</p>
                        <div className="grid grid-cols-2 gap-2">
                            {summary.houseTypes.map((ht) => {
                                const active = filters.houseTypes.includes(ht);
                                return (
                                    <button key={ht} type="button" onClick={() => {
                                        const next = active ? filters.houseTypes.filter(v => v !== ht) : [...filters.houseTypes, ht];
                                        onFilterChange({ ...filters, houseTypes: next });
                                    }} className={`${chipBase} ${active ? roomChipOn : roomChipMuted}`}>
                                        {ht}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}
                <section className={sectionStack}>
                    <div className={sectionHeader}>
                        <p className={sectionTitle}>Дополнительные фильтры</p>
                        <button
                            type="button"
                            disabled={!canAddAdditionalFilter}
                            onClick={addAdditionalFilter}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                                canAddAdditionalFilter
                                    ? themeClass(theme, {
                                          dark: 'border border-zinc-700 bg-zinc-900/90 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900',
                                          light: 'border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:border-zinc-300 hover:bg-zinc-50',
                                      })
                                    : themeClass(theme, {
                                          dark: 'cursor-not-allowed border border-zinc-800/90 bg-zinc-950/50 text-zinc-600',
                                          light: 'cursor-not-allowed border border-zinc-200/90 bg-zinc-50 text-zinc-400',
                                      })
                            }`}
                        >
                            + Условие
                        </button>
                    </div>
                    {!canAddAdditionalFilter ? (
                        <p className={sectionHint}>В датасете нет доступных признаков для доп. фильтрации.</p>
                    ) : filters.additionalFilters.length === 0 ? (
                        <p className={sectionHint}>Добавьте одно или несколько условий по любым колонкам.</p>
                    ) : (
                        <div className="space-y-2.5">
                            {filters.additionalFilters.map((condition) => {
                                const kind = additionalColumnKind.get(condition.column) === 'numeric' ? 'number' : 'text';
                                return (
                                    <div
                                        key={condition.id}
                                        className={themeClass(theme, {
                                            dark: 'space-y-2 rounded-xl border border-zinc-800/90 bg-zinc-900/35 p-2.5',
                                            light: 'space-y-2 rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-2.5',
                                        })}
                                    >
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                            <select
                                                value={condition.column}
                                                onChange={(e) => updateAdditionalFilterColumn(condition.id, e.target.value)}
                                                className={themeClass(theme, {
                                                    dark: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-700/90 bg-zinc-900/90 px-2.5 text-sm text-zinc-100 focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                                                    light: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15',
                                                })}
                                            >
                                                {additionalColumns.map(col => (
                                                    <option key={col} value={col}>
                                                        {formatColumnLabel(col)}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => removeAdditionalFilter(condition.id)}
                                                className={themeClass(theme, {
                                                    dark: 'min-h-[2.25rem] rounded-lg border border-zinc-700/90 px-2.5 text-xs font-medium text-zinc-300 transition hover:border-red-500/35 hover:text-red-300',
                                                    light: 'min-h-[2.25rem] rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition hover:border-red-300 hover:text-red-700',
                                                })}
                                            >
                                                Удалить
                                            </button>
                                        </div>
                                        <div className={`grid grid-cols-1 gap-2 ${kind === 'number' && condition.operator === 'between' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                                            <select
                                                value={condition.operator}
                                                onChange={(e) => updateAdditionalFilterOperator(condition.id, e.target.value as 'gte' | 'lte' | 'between' | 'equals' | 'contains')}
                                                className={themeClass(theme, {
                                                    dark: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-700/90 bg-zinc-900/90 px-2.5 text-sm text-zinc-100 focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                                                    light: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15',
                                                })}
                                            >
                                                {kind === 'number' ? (
                                                    <>
                                                        <option value="gte">{'>='}</option>
                                                        <option value="lte">{'<='}</option>
                                                        <option value="between">Между</option>
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="equals">Равно</option>
                                                        <option value="contains">Содержит</option>
                                                    </>
                                                )}
                                            </select>
                                            <input
                                                type={kind === 'number' ? 'number' : 'text'}
                                                value={condition.value}
                                                onChange={(e) => updateAdditionalFilterValue(condition.id, 'value', e.target.value)}
                                                placeholder={kind === 'number' ? 'Значение' : 'Введите текст'}
                                                className={themeClass(theme, {
                                                    dark: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-700/90 bg-zinc-900/90 px-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                                                    light: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15',
                                                })}
                                            />
                                            {kind === 'number' && condition.operator === 'between' && (
                                                <input
                                                    type="number"
                                                    value={condition.valueTo ?? ''}
                                                    onChange={(e) => updateAdditionalFilterValue(condition.id, 'valueTo', e.target.value)}
                                                    placeholder="До"
                                                    className={themeClass(theme, {
                                                        dark: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-700/90 bg-zinc-900/90 px-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                                                        light: 'min-h-[2.25rem] w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15',
                                                    })}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};
