import React, { useMemo } from 'react';
import type { DataSummary, FilterSettings } from '@/types';
import { isAreaFilterDirty, isPriceFilterDirty, isRoomFilterActive } from '@/domain/filters';
import { themeClass, type Theme } from '@/theme';
import { CloseIcon } from '@/components/icons';

export const FilterPanel: React.FC<{
    filters: FilterSettings;
    baselineFilters: FilterSettings;
    summary: DataSummary;
    onFilterChange: (newFilters: FilterSettings) => void;
    onClose?: () => void;
    theme: Theme;
}> = ({ filters, baselineFilters, summary, onFilterChange, onClose, theme }) => {
    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;

    const handlePriceChange = (field: 'min' | 'max', value: number) => {
        const newPrice = { ...filters.price, [field]: value };
        if (newPrice.min > newPrice.max) {
            if (field === 'min') newPrice.max = newPrice.min;
            else newPrice.min = newPrice.max;
        }
        onFilterChange({ ...filters, price: newPrice });
    };

    const handleAreaChange = (field: 'min' | 'max', value: number) => {
        const newArea = { ...filters.area, [field]: value };
        if (newArea.min > newArea.max) {
            if (field === 'min') newArea.max = newArea.min;
            else newArea.min = newArea.max;
        }
        onFilterChange({ ...filters, area: newArea });
    };

    const handleRoomToggle = (room: number) => {
        const newRooms = filters.rooms.includes(room)
            ? filters.rooms.filter(r => r !== room)
            : [...filters.rooms, room];
        onFilterChange({ ...filters, rooms: newRooms });
    };

    const resetPriceFilter = () => {
        onFilterChange({ ...filters, price: { ...baselineFilters.price } });
    };

    const resetAreaFilter = () => {
        onFilterChange({ ...filters, area: { ...baselineFilters.area } });
    };

    const showPriceReset = useMemo(() => isPriceFilterDirty(filters, baselineFilters), [filters, baselineFilters]);
    const showAreaReset = useMemo(() => isAreaFilterDirty(filters, baselineFilters), [filters, baselineFilters]);

    const hasAnyCore = priceCol || areaCol || roomsCol;

    return (
        <div className={themeClass(theme, {
            dark: 'flex h-full max-h-[min(100vh-10rem,56rem)] flex-col gap-6 overflow-y-auto rounded-2xl border border-slate-700/50 bg-slate-900/75 p-5 shadow-lg backdrop-blur sm:p-6 lg:max-h-[calc(100vh-8rem)]',
            light: 'flex h-full max-h-[min(100vh-10rem,56rem)] flex-col gap-6 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-lg sm:p-6 lg:max-h-[calc(100vh-8rem)]',
        })}>
            <div className={themeClass(theme, {
                dark: 'flex items-start justify-between border-b border-slate-700/70 pb-3',
                light: 'flex items-start justify-between border-b border-slate-200 pb-3',
            })}>
                <div className="space-y-1">
                    <h3 className={`font-display ${themeClass(theme, {
                        dark: 'text-lg sm:text-xl font-semibold text-white tracking-tight',
                        light: 'text-lg sm:text-xl font-semibold text-slate-900 tracking-tight',
                    })}`}>Фильтры</h3>
                    <p className={themeClass(theme, {
                        dark: 'text-sm text-slate-400',
                        light: 'text-sm text-slate-500',
                    })}>Уточните параметры выборки</p>
                </div>
                {onClose && (
                    <button type="button" onClick={onClose} className={themeClass(theme, {
                        dark: 'mt-1 text-slate-400 hover:text-white lg:hidden',
                        light: 'mt-1 text-slate-500 hover:text-slate-900 lg:hidden',
                    })}>
                        <CloseIcon />
                    </button>
                )}
            </div>

            {!hasAnyCore && (
                <p className={themeClass(theme, {
                    dark: 'text-sm text-slate-400',
                    light: 'text-sm text-slate-600',
                })}>
                    В файле нет колонок «Цена», «Общая площадь» и «Количество комнат» — боковые фильтры по ним скрыты. Графики строятся по всем строкам после загрузки.
                </p>
            )}

            <div className="flex-1 space-y-5">
                {priceCol && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className={themeClass(theme, {
                                dark: 'block text-sm font-medium text-cyan-300',
                                light: 'block text-sm font-medium text-cyan-700',
                            })}>{priceCol} (руб.)</label>
                            {showPriceReset && (
                                <button
                                    type="button"
                                    onClick={resetPriceFilter}
                                    className={themeClass(theme, {
                                        dark: 'shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-500/20',
                                        light: 'shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-700 hover:bg-cyan-300/30',
                                    })}
                                >
                                    Сбросить
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <input type="number" value={filters.price.min} onChange={e => handlePriceChange('min', +e.target.value)}
                                className={themeClass(theme, {
                                    dark: 'w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/70 focus:border-cyan-400/60 transition',
                                    light: 'w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/70 transition',
                                })} />
                            <span className={themeClass(theme, {
                                dark: 'text-slate-500',
                                light: 'text-slate-400',
                            })}>—</span>
                            <input type="number" value={filters.price.max} onChange={e => handlePriceChange('max', +e.target.value)}
                                className={themeClass(theme, {
                                    dark: 'w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/70 focus:border-cyan-400/60 transition',
                                    light: 'w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/70 transition',
                                })} />
                        </div>
                    </div>
                )}

                {areaCol && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className={themeClass(theme, {
                                dark: 'block text-sm font-medium text-cyan-300',
                                light: 'block text-sm font-medium text-cyan-700',
                            })}>{areaCol} (м²)</label>
                            {showAreaReset && (
                                <button
                                    type="button"
                                    onClick={resetAreaFilter}
                                    className={themeClass(theme, {
                                        dark: 'shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-500/20',
                                        light: 'shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-cyan-700 hover:bg-cyan-300/30',
                                    })}
                                >
                                    Сбросить
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <input type="number" value={filters.area.min} onChange={e => handleAreaChange('min', +e.target.value)}
                                className={themeClass(theme, {
                                    dark: 'w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/70 focus:border-cyan-400/60 transition',
                                    light: 'w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/70 transition',
                                })} />
                            <span className={themeClass(theme, {
                                dark: 'text-slate-500',
                                light: 'text-slate-400',
                            })}>—</span>
                            <input type="number" value={filters.area.max} onChange={e => handleAreaChange('max', +e.target.value)}
                                className={themeClass(theme, {
                                    dark: 'w-full bg-slate-900/70 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/70 focus:border-cyan-400/60 transition',
                                    light: 'w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/70 transition',
                                })} />
                        </div>
                    </div>
                )}

                {roomsCol && summary.rooms.length > 0 && (
                    <div className="space-y-3">
                        <label className={themeClass(theme, {
                            dark: 'block text-sm font-medium text-cyan-300',
                            light: 'block text-sm font-medium text-cyan-700',
                        })}>{roomsCol}</label>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                            {summary.rooms.map(room => (
                                <button key={room} type="button" onClick={() => handleRoomToggle(room)}
                                    className={`${
                                        isRoomFilterActive(filters.rooms, room)
                                            ? themeClass(theme, {
                                                dark: 'bg-cyan-500/80 text-white font-semibold shadow-cyan-800/40',
                                                light: 'bg-cyan-500/90 text-white font-semibold shadow-cyan-200/80',
                                            })
                                            : themeClass(theme, {
                                                dark: 'bg-slate-800/70 text-slate-300 hover:bg-slate-700/70',
                                                light: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                                            })
                                    } px-3 py-2 text-sm rounded-xl transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70`}>
                                    {room}
                                </button>
                            ))}
                        </div>
                        <p className={themeClass(theme, {
                            dark: 'text-xs text-slate-400',
                            light: 'text-xs text-slate-500',
                        })}>Нажмите, чтобы включить или исключить значения.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
