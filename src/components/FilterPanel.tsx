import React, { useId, useMemo } from 'react';
import type { DataSummary, FilterSettings } from '@/types';
import { isAnyFilterDirty } from '@/domain/filters';
import { themeClass, type Theme } from '@/theme';
import { CloseIcon } from '@/components/icons';
import { FilterDualRange, filterSliderStep } from '@/components/FilterDualRange';
import { formatAreaCompactSqM, formatRubCompact } from '@/utils/metricDisplay';

function formatIntRu(n: number): string {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

export const FilterPanel: React.FC<{
    filters: FilterSettings;
    baselineFilters: FilterSettings;
    summary: DataSummary;
    onFilterChange: (newFilters: FilterSettings) => void;
    /** Совпадений текущих фильтров по полному набору строк. */
    matchCount: number;
    totalCount: number;
    onClose?: () => void;
    theme: Theme;
}> = ({ filters, baselineFilters, summary, onFilterChange, matchCount, totalCount, onClose, theme }) => {
    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;
    const baseId = useId();

    const priceId = `${baseId}-price`;
    const areaId = `${baseId}-area`;
    const roomsId = `${baseId}-rooms`;

    const priceBounds = baselineFilters.price;
    const areaBounds = baselineFilters.area;
    const priceSpan = priceBounds.max - priceBounds.min;
    const areaSpan = areaBounds.max - areaBounds.min;
    const priceStep = useMemo(() => filterSliderStep(priceSpan, 'price'), [priceSpan]);
    const areaStep = useMemo(() => filterSliderStep(areaSpan, 'area'), [areaSpan]);

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
        });
    };

    const filtersDirty = useMemo(() => isAnyFilterDirty(filters, baselineFilters), [filters, baselineFilters]);

    const hasAnyCore = priceCol || areaCol || roomsCol;

    const sectionTitle = themeClass(theme, {
        dark: 'text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500',
        light: 'text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500',
    });

    const shell = themeClass(theme, {
        dark: 'flex h-full max-h-[min(100vh-10rem,56rem)] flex-col overflow-y-auto rounded-3xl border border-zinc-800/85 bg-zinc-950/75 shadow-[0_1px_3px_rgba(0,0,0,0.2),0_16px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md lg:max-h-[calc(100vh-8rem)]',
        light: 'flex h-full max-h-[min(100vh-10rem,56rem)] flex-col overflow-y-auto rounded-3xl border border-zinc-200/95 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_16px_48px_-16px_rgba(0,0,0,0.07)] backdrop-blur-md lg:max-h-[calc(100vh-8rem)]',
    });

    const innerPad = 'px-5 pb-6 pt-6 sm:px-6 sm:pb-7 sm:pt-7';

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

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div
                        className={themeClass(theme, {
                            dark: 'inline-flex w-fit items-baseline gap-2 rounded-xl bg-zinc-900/85 px-3.5 py-2.5 ring-1 ring-zinc-800/90',
                            light: 'inline-flex w-fit items-baseline gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 ring-1 ring-zinc-200/90',
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
                            из {formatIntRu(totalCount)} объектов
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={resetAllFilters}
                        disabled={!filtersDirty}
                        className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
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

            <div className={`flex-1 space-y-6 ${innerPad} pt-5`}>
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
                    <section className="space-y-3" aria-labelledby={priceId}>
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <p id={priceId} className={sectionTitle}>
                                    Цена
                                </p>
                                <p
                                    className={themeClass(theme, {
                                        dark: 'mt-1 text-[13px] text-zinc-500',
                                        light: 'mt-1 text-[13px] text-zinc-600',
                                    })}
                                >
                                    {priceCol}
                                </p>
                            </div>
                            <p
                                className={themeClass(theme, {
                                    dark: 'max-w-[min(100%,14rem)] text-right text-xs tabular-nums leading-snug text-zinc-500',
                                    light: 'max-w-[min(100%,14rem)] text-right text-xs tabular-nums leading-snug text-zinc-500',
                                })}
                            >
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
                    <section className="space-y-3" aria-labelledby={areaId}>
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <p id={areaId} className={sectionTitle}>
                                    Площадь
                                </p>
                                <p
                                    className={themeClass(theme, {
                                        dark: 'mt-1 text-[13px] text-zinc-500',
                                        light: 'mt-1 text-[13px] text-zinc-600',
                                    })}
                                >
                                    {areaCol}
                                </p>
                            </div>
                            <p
                                className={themeClass(theme, {
                                    dark: 'text-right text-xs tabular-nums text-zinc-500',
                                    light: 'text-right text-xs tabular-nums text-zinc-500',
                                })}
                            >
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

                {roomsCol && summary.rooms.length > 0 && (
                    <section className="space-y-3" aria-labelledby={roomsId}>
                        <div>
                            <p id={roomsId} className={sectionTitle}>
                                Комнаты
                            </p>
                            <p
                                className={themeClass(theme, {
                                    dark: 'mt-1 text-[13px] text-zinc-500',
                                    light: 'mt-1 text-[13px] text-zinc-600',
                                })}
                            >
                                {roomsCol}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={clearRooms}
                                className={`${chipBase} ${
                                    filters.rooms.length === 0 ? `${roomChipOn} ring-1 ring-indigo-500/20` : roomChipMuted
                                }`}
                            >
                                Все планировки
                            </button>
                            {[...summary.rooms].sort((a, b) => a - b).map(room => {
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
                                        className={`${chipBase} min-w-[2.75rem] ${cls}`}
                                        aria-pressed={filters.rooms.length === 0 ? false : showOn}
                                    >
                                        {room === 0 ? 'Студия' : `${room}`}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};
