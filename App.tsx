import React, { useState, useCallback, useMemo, useTransition, useDeferredValue, useEffect } from 'react';
import type { ApartmentData, FilterSettings, DataSummary, Range } from './types';
import Papa from 'papaparse';
import { loadCachedDataset, tryGetDatasetForFile, saveCachedDataset } from './cache';
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ScatterChart,
    Scatter,
    ZAxis,
    Cell,
} from 'recharts';

// --- Helper Functions & Constants ---
type ChartKey =
    | 'priceDistribution'
    | 'areaDistribution'
    | 'priceVsArea'
    | 'roomDistribution'
    | 'priceVsDistance'
    | 'avgPriceByType'
    | 'pricePerSqmDistribution'
    | 'avgPriceByRooms';

interface ChartOption {
    key: ChartKey;
    title: string;
    description: string;
}

const CHART_OPTIONS: ChartOption[] = [
    {
        key: 'priceDistribution',
        title: 'Распределение цен',
        description: 'Гистограмма распределения цен по выбранным объектам',
    },
    {
        key: 'areaDistribution',
        title: 'Распределение площадей',
        description: 'Распределение общей площади квартир',
    },
    {
        key: 'priceVsArea',
        title: 'Зависимость цены от площади',
        description: 'Точки показывают соотношение цены и площади',
    },
    {
        key: 'roomDistribution',
        title: 'Распределение по количеству комнат',
        description: 'Сколько квартир попадает в каждый формат по комнатности',
    },
    {
        key: 'priceVsDistance',
        title: 'Цена vs Расстояние до центра',
        description: 'Как меняется цена при удалении от центра города',
    },
    {
        key: 'avgPriceByType',
        title: 'Средняя цена по типу дома',
        description: 'Сравнение среднего ценника для разных типов домов',
    },
    {
        key: 'pricePerSqmDistribution',
        title: 'Цена за м²',
        description: 'Распределение цены за квадратный метр',
    },
    {
        key: 'avgPriceByRooms',
        title: 'Средняя цена по комнатам',
        description: 'Сравнение среднего ценника по количеству комнат',
    },
];

const CHART_OPTION_MAP: Record<ChartKey, ChartOption> = CHART_OPTIONS.reduce((acc, option) => {
    acc[option.key] = option;
    return acc;
}, {} as Record<ChartKey, ChartOption>);

const DEFAULT_CHART_SELECTION: ChartKey[] = [CHART_OPTIONS[0].key];

type Theme = 'dark' | 'light';

const numericFieldKeys: Array<keyof ApartmentData> = [
    'Цена',
    'Количество комнат',
    'Общая площадь',
    'Расстояние до центра (км)',
];

const MAX_SCATTER_POINTS = 1200;

const sampleArray = <T,>(array: readonly T[], limit: number): T[] => {
    if (array.length <= limit) {
        return array.slice() as T[];
    }

    const step = array.length / limit;
    const sampled: T[] = [];
    for (let i = 0; i < limit; i += 1) {
        sampled.push(array[Math.floor(i * step)]);
    }

    return sampled;
};

const parseNumber = (value: unknown): number => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value === 'string') {
        const cleaned = value
            .replace(/\u00A0/g, ' ')
            .replace(/[a-zA-Zа-яА-Я%₽$]/g, '')
            .replace(/\s+/g, '')
            .replace(',', '.');

        if (cleaned === '') {
            return NaN;
        }

        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    return NaN;
};

const formatNumber = (num: number) => {
    if (num >= 1e6) {
        return `${(num / 1e6).toFixed(1)} млн`;
    }
    if (num >= 1e3) {
        return `${(num / 1e3).toFixed(1)} тыс`;
    }
    return num.toString();
};

const formatCurrency = (num: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(num);

const CHART_FILL = {
    dark: '#0891b2',
    light: '#0284c7',
} as const;

// --- SVG Icons ---
const CloseIcon = () => (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const FilterIcon = () => (
    <svg className="h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
    </svg>
);

// --- Child Components ---

const FileUploadComponent: React.FC<{
    onDataLoaded: (data: ApartmentData[], summary: DataSummary) => void;
    setLoading: (loading: boolean) => void;
}> = ({ onDataLoaded, setLoading }) => {
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const fromCache = tryGetDatasetForFile(file);
            if (fromCache) {
                onDataLoaded(fromCache.data, fromCache.summary);
                return;
            }
            setLoading(true);
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                worker: true,
                fastMode: true,
                complete: (results: any) => {
                    const rawData = results.data;
                    const houseTypeCols = Object.keys(rawData[0] || {}).filter(k => k.startsWith('тип_дома_'));
                    const houseTypes = houseTypeCols.map(c => c.replace('тип_дома_', ''));

                    const processedData: ApartmentData[] = rawData.map((row: any) => {
                        let houseType = 'Неизвестно';
                        for (const col of houseTypeCols) {
                            if (String(row[col]).trim() === '1') {
                                houseType = col.replace('тип_дома_', '');
                                break;
                            }
                        }

                        const price = parseNumber(row['Цена']);
                        const rooms = parseNumber(row['Количество комнат']);
                        const area = parseNumber(row['Общая площадь']);
                        const distance = parseNumber(row['Расстояние до центра (км)']);

                        return {
                            'Цена': price,
                            'Количество комнат': Number.isNaN(rooms) ? NaN : Math.round(rooms),
                            'Общая площадь': area,
                            'Расстояние до центра (км)': distance,
                            'houseType': houseType,
                        };
                    }).filter(d => numericFieldKeys.every(key => Number.isFinite(d[key])));
                    
                    if (processedData.length > 0) {
                        const prices = processedData.map(d => d['Цена']);
                        const areas = processedData.map(d => d['Общая площадь']);
                        const rooms = [...new Set(processedData.map(d => d['Количество комнат']))].sort((a,b) => a - b);

                        const summary: DataSummary = {
                            price: { min: Math.min(...prices), max: Math.max(...prices) },
                            area: { min: Math.min(...areas), max: Math.max(...areas) },
                            rooms,
                            houseTypes,
                        };
                        saveCachedDataset(file, processedData, summary);
                        onDataLoaded(processedData, summary);
                    } else {
                         alert("Не удалось обработать данные. Проверьте формат CSV файла.");
                    }
                    setLoading(false);
                },
                error: (error: any) => {
                    setLoading(false);
                    alert(`Ошибка при парсинге файла: ${error.message}`);
                }
            });
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
            <div className="text-center p-6 sm:p-8 border-2 border-dashed border-gray-600 rounded-xl max-w-md w-full">
                <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <h2 className="mt-4 text-lg sm:text-xl font-semibold text-white font-display">Загрузите ваш CSV файл</h2>
                <p className="mt-2 text-sm text-gray-400">Перетащите файл сюда или нажмите для выбора.</p>
                <div className="mt-6">
                    <label htmlFor="file-upload" className="cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500">
                        <span>Выбрать файл</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".csv" onChange={handleFileChange} />
                    </label>
                </div>
            </div>
        </div>
    );
};

const FilterPanel: React.FC<{
    filters: FilterSettings;
    summary: DataSummary;
    onFilterChange: (newFilters: FilterSettings) => void;
    onClose?: () => void; // Optional: for mobile close button
    theme: Theme;
}> = ({ filters, summary, onFilterChange, onClose, theme }) => {

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

    return (
        <div className={themeClass(theme, {
            dark: 'rounded-2xl bg-slate-900/70 backdrop-blur border border-slate-700/50 shadow-xl p-5 sm:p-6 lg:rounded-3xl h-full overflow-y-auto space-y-6',
            light: 'rounded-2xl bg-white border border-slate-200 shadow-xl p-5 sm:p-6 lg:rounded-3xl h-full overflow-y-auto space-y-6',
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
                        dark: 'text-xs uppercase tracking-[0.35em] text-slate-400',
                        light: 'text-xs uppercase tracking-[0.35em] text-slate-500',
                    })}>Уточните параметры выборки</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className={themeClass(theme, {
                        dark: 'mt-1 text-slate-400 hover:text-white lg:hidden',
                        light: 'mt-1 text-slate-500 hover:text-slate-900 lg:hidden',
                    })}>
                        <CloseIcon />
                    </button>
                )}
            </div>
            <div className="space-y-5">
                <div className="space-y-2">
                    <label className={themeClass(theme, {
                        dark: 'block text-xs uppercase tracking-[0.3em] text-cyan-400 font-semibold',
                        light: 'block text-xs uppercase tracking-[0.3em] text-cyan-600 font-semibold',
                    })}>Диапазон цены (руб.)</label>
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

                <div className="space-y-2">
                    <label className={themeClass(theme, {
                        dark: 'block text-xs uppercase tracking-[0.3em] text-cyan-400 font-semibold',
                        light: 'block text-xs uppercase tracking-[0.3em] text-cyan-600 font-semibold',
                    })}>Общая площадь (м²)</label>
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

                <div className="space-y-3">
                    <label className={themeClass(theme, {
                        dark: 'block text-xs uppercase tracking-[0.3em] text-cyan-400 font-semibold',
                        light: 'block text-xs uppercase tracking-[0.3em] text-cyan-600 font-semibold',
                    })}>Количество комнат</label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                    {summary.rooms.map(room => (
                        <button key={room} onClick={() => handleRoomToggle(room)}
                                className={`${
                                filters.rooms.includes(room)
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
                    })}>Нажмите, чтобы включить или исключить определённые планировки.</p>
                </div>
            </div>
        </div>
    );
};

const ChartSelector: React.FC<{
    options: ChartOption[];
    selected: ChartKey[];
    onChange: (next: ChartKey[]) => void;
    disabled?: boolean;
    theme: Theme;
}> = ({ options, selected, onChange, disabled, theme }) => {
    const handleToggle = (key: ChartKey) => {
        const isSelected = selected.includes(key);
        if (isSelected) {
            const next = selected.filter(item => item !== key);
            onChange(next);
        } else {
            onChange([...selected, key]);
        }
    };

    return (
        <div className={themeClass(theme, {
            dark: 'mb-6 rounded-3xl border border-slate-700/60 bg-slate-900/60 backdrop-blur px-6 py-5 shadow-xl shadow-cyan-900/20',
            light: 'mb-6 rounded-3xl border border-slate-200 bg-white/80 backdrop-blur px-6 py-5 shadow-xl shadow-slate-200',
        })}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className={`font-display ${themeClass(theme, {
                    dark: 'text-xl font-semibold text-white tracking-tight',
                    light: 'text-xl font-semibold text-slate-900 tracking-tight',
                })}`}>Отображаемые визуализации</h3>
                <p className={themeClass(theme, {
                    dark: 'text-xs uppercase tracking-widest text-slate-400',
                    light: 'text-xs uppercase tracking-widest text-slate-500',
                })}>Выберите интересующие графики</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {options.map(option => {
                    const isChecked = selected.includes(option.key);
                    return (
                        <label
                            key={option.key}
                            className={`${themeClass(theme, {
                                dark: 'flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-800/50 bg-slate-950/70 p-4 transition-all hover:border-cyan-500/60 hover:shadow-lg hover:shadow-cyan-900/25',
                                light: 'flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-200/40',
                            })} ${isChecked ? themeClass(theme, {
                                dark: 'border-cyan-500/80 shadow-lg shadow-cyan-900/30',
                                light: 'border-cyan-500/80 shadow-lg shadow-cyan-200/60',
                            }) : ''} ${disabled ? 'pointer-events-none opacity-60' : ''}`}
                        >
                            <input
                                type="checkbox"
                                className={themeClass(theme, {
                                    dark: 'mt-1 h-4 w-4 cursor-pointer rounded border-slate-700 bg-slate-800 text-cyan-400 focus:ring-cyan-500',
                                    light: 'mt-1 h-4 w-4 cursor-pointer rounded border-slate-300 bg-white text-cyan-500 focus:ring-cyan-500',
                                })}
                                checked={isChecked}
                                disabled={disabled}
                                onChange={() => handleToggle(option.key)}
                            />
                            <div>
                                <span className={`font-display ${themeClass(theme, {
                                    dark: 'text-sm font-semibold text-white',
                                    light: 'text-sm font-semibold text-slate-900',
                                })}`}>{option.title}</span>
                                <p className={themeClass(theme, {
                                    dark: 'text-xs text-slate-400 leading-relaxed',
                                    light: 'text-xs text-slate-500 leading-relaxed',
                                })}>{option.description}</p>
                            </div>
                        </label>
                    );
                })}
            </div>
            {selected.length === 0 && (
                <p className={themeClass(theme, {
                    dark: 'mt-4 text-sm text-amber-300',
                    light: 'mt-4 text-sm text-amber-500',
                })}>
                    Выберите хотя бы одну визуализацию, чтобы увидеть аналитические графики.
                </p>
            )}
        </div>
    );
};

const ChartCard: React.FC<{ title: string; children: React.ReactNode; resetLabel?: string; onReset?: () => void; showReset?: boolean; theme: Theme }> = ({ title, children, resetLabel = 'Сбросить', onReset, showReset, theme }) => (
  <div className={themeClass(theme, {
      dark: 'group relative h-[320px] sm:h-[360px] md:h-[420px] xl:h-[440px] overflow-hidden rounded-3xl border border-slate-700/40 bg-slate-950/70 p-4 sm:p-5 shadow-xl shadow-black/20 transition-transform hover:-translate-y-1 hover:border-cyan-500/60',
      light: 'group relative h-[320px] sm:h-[360px] md:h-[420px] xl:h-[440px] overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xl shadow-slate-200 transition-transform hover:-translate-y-1 hover:border-cyan-500/50',
  })}>
    <div className={themeClass(theme, {
        dark: 'absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-40 bg-gradient-to-br from-cyan-500/10 via-transparent to-purple-500/20',
        light: 'absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-40 bg-gradient-to-br from-cyan-400/10 via-transparent to-purple-400/10',
    })}></div>
    <div className="relative z-10 flex h-full flex-col">
        <div className="mb-3 flex items-start justify-between gap-2">
            <h4 className={`font-display ${themeClass(theme, {
                dark: 'flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white',
                light: 'flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-slate-900',
            })}`}>
                <span className={themeClass(theme, {
                    dark: 'inline-block h-2 w-2 rounded-full bg-cyan-400/80 group-hover:animate-pulse',
                    light: 'inline-block h-2 w-2 rounded-full bg-cyan-500/80 group-hover:animate-pulse',
                })}></span>
                <span className="leading-tight">{title}</span>
            </h4>
            {showReset && onReset && (
                <button
                    type="button"
                    onClick={onReset}
                    className={themeClass(theme, {
                        dark: 'inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-200 transition hover:border-cyan-400/70 hover:bg-cyan-500/20',
                        light: 'inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-600 transition hover:border-cyan-500/60 hover:bg-cyan-300/30',
                    })}
                >
                    {resetLabel}
                </button>
            )}
        </div>
        <div className="flex flex-1 min-h-0 flex-col gap-3 sm:gap-4">
      {children}
        </div>
    </div>
  </div>
);

const EmptyChartState: React.FC<{ message?: string; theme: Theme }> = ({ message, theme }) => (
    <div className={themeClass(theme, {
        dark: 'flex h-full items-center justify-center rounded-2xl bg-slate-900/60 border border-dashed border-slate-700/60 p-6 text-center text-sm text-slate-400',
        light: 'flex h-full items-center justify-center rounded-2xl bg-slate-100 border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500',
    })}>
        {message ?? 'Нет данных для отображения. Измените фильтры или загрузите другой файл.'}
    </div>
);
    
const DashboardStats: React.FC<{ data: ApartmentData[]; theme: Theme }> = ({ data, theme }) => {
    const stats = useMemo(() => {
        if (!data.length) return null;
        const prices = data.map(d => d['Цена']);
        const areas = data.map(d => d['Общая площадь']);
        const pricePerSqm = data
            .map(d => (d['Общая площадь'] > 0 ? d['Цена'] / d['Общая площадь'] : NaN))
            .filter(v => Number.isFinite(v));

        return {
            total: data.length,
            priceAverage: mean(prices),
            priceMedian: median(prices),
            areaMedian: median(areas),
            pricePerSqmMedian: median(pricePerSqm),
        };
    }, [data]);

    if (!stats) {
        return (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className={themeClass(theme, {
                    dark: 'rounded-2xl border border-dashed border-slate-700/60 bg-slate-950/50 p-4 text-slate-400 text-sm text-center',
                    light: 'rounded-2xl border border-dashed border-slate-300 bg-slate-100 p-4 text-slate-500 text-sm text-center',
                })}>
                    Загрузите данные, чтобы увидеть статистику
                </div>
            </div>
        );
    }

    const items = [
        {
            label: 'Объектов в выборке',
            value: stats.total.toLocaleString('ru-RU'),
            accent: theme === 'dark' ? 'from-cyan-500/20 to-transparent' : 'from-cyan-400/20 to-transparent',
        },
        {
            label: 'Средняя цена',
            value: formatCurrency(stats.priceAverage),
            accent: theme === 'dark' ? 'from-purple-500/20 to-transparent' : 'from-purple-400/20 to-transparent',
        },
        {
            label: 'Медиана цены',
            value: formatCurrency(stats.priceMedian),
            accent: theme === 'dark' ? 'from-blue-500/20 to-transparent' : 'from-blue-400/20 to-transparent',
        },
        {
            label: 'Медиана площади',
            value: `${Math.round(stats.areaMedian)} м²`,
            accent: theme === 'dark' ? 'from-emerald-500/20 to-transparent' : 'from-emerald-400/20 to-transparent',
        },
        {
            label: 'Медиана цены за м²',
            value: stats.pricePerSqmMedian ? formatCurrency(stats.pricePerSqmMedian) : '—',
            accent: theme === 'dark' ? 'from-pink-500/20 to-transparent' : 'from-pink-400/20 to-transparent',
        },
    ];

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {items.map((item, idx) => (
                <div key={idx} className={themeClass(theme, {
                    dark: 'relative overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-950/70 p-5 shadow-lg shadow-black/10',
                    light: 'relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200',
                })}>
                    <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.accent} opacity-60`}></div>
                    <div className="relative z-10 space-y-2">
                        <p className={themeClass(theme, {
                            dark: 'text-xs uppercase tracking-widest text-slate-400',
                            light: 'text-xs uppercase tracking-widest text-slate-500',
                        })}>{item.label}</p>
                        <p className={`font-display font-tabular ${themeClass(theme, {
                            dark: 'text-xl font-semibold text-white',
                            light: 'text-xl font-semibold text-slate-900',
                        })}`}>{item.value}</p>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface NumericRange {
    min: number;
    max: number;
}

const ACTIVE_BAR_COLOR = {
    dark: '#22d3ee',
    light: '#0ea5e9',
} as const;
const BAR_OPACITY_INACTIVE = 0.6;

const themeClass = (theme: Theme, variants: { dark: string; light: string }) =>
    theme === 'dark' ? variants.dark : variants.light;

const createDefaultFiltersFromSummary = (summary: DataSummary): FilterSettings => ({
    price: { ...summary.price },
    area: { ...summary.area },
    rooms: summary.rooms.includes(1) ? [1] : (summary.rooms.length ? [summary.rooms[0]] : []),
});

function readInitialAppState(): {
    allData: ApartmentData[] | null;
    dataSummary: DataSummary | null;
    filters: FilterSettings | null;
    baselineFilters: FilterSettings | null;
} {
    if (typeof window === 'undefined') {
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null };
    }
    const cached = loadCachedDataset();
    if (!cached) {
        return { allData: null, dataSummary: null, filters: null, baselineFilters: null };
    }
    const f = createDefaultFiltersFromSummary(cached.summary);
    return {
        allData: cached.data,
        dataSummary: cached.summary,
        filters: f,
        baselineFilters: f,
    };
}

const INITIAL_APP_STATE = readInitialAppState();

const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (arr: number[], q: number) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return s[base] + (s[base + 1] - s[base]) * rest || s[base] || 0;
};

const ChartGrid: React.FC<{
    data: ApartmentData[];
    selectedCharts: ChartKey[];
    filters: FilterSettings | null;
    baselineFilters: FilterSettings | null;
    theme: Theme;
    onFilterChange: (next: FilterSettings) => void;
}> = ({ data, selectedCharts, filters, baselineFilters, theme, onFilterChange }) => {
    const scatterSource = useMemo(() => sampleArray(data, MAX_SCATTER_POINTS), [data]);

    const chartFillColor = CHART_FILL[theme];
    const activeBarColor = ACTIVE_BAR_COLOR[theme];
    const axisTextColor = theme === 'dark' ? '#9ca3af' : '#475569';
    const gridColor = theme === 'dark' ? '#374151' : '#e2e8f0';
    const tooltipStyle = theme === 'dark'
        ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e2e8f0' }
        : { backgroundColor: '#ffffff', border: '1px solid #bfdbfe', color: '#1f2937' };
    const tooltipCursor = theme === 'dark' ? { fill: '#374151', opacity: 0.15 } : { fill: '#e2e8f0', opacity: 0.6 };
    const scatterGridColor = theme === 'dark' ? '#374151' : '#dbeafe';

    const rangesOverlap = (range: NumericRange, filterRange: NumericRange) =>
        range.min <= filterRange.max && range.max >= filterRange.min;

    const getBinRange = (start: number, binSize: number, index: number, bins: number, max: number): NumericRange => {
        const min = start + index * binSize;
        const maxBoundary = index === bins - 1 ? max : min + binSize;
        return { min, max: maxBoundary };
    };

    const clampRange = (range: NumericRange): NumericRange => ({
        min: Math.max(Math.floor(range.min), 0),
        max: Math.ceil(range.max),
    });

    const handlePriceRangeSelect = (range: NumericRange) => {
        if (!filters) return;
        const nextRange = clampRange(range);
        const nextFilters: FilterSettings = {
            ...filters,
            price: {
                min: nextRange.min,
                max: Math.max(nextRange.max, nextRange.min + 1),
            },
        };
        onFilterChange(nextFilters);
    };

    const handleAreaRangeSelect = (range: NumericRange) => {
        if (!filters) return;
        const nextRange = clampRange(range);
        const nextFilters: FilterSettings = {
            ...filters,
            area: {
                min: nextRange.min,
                max: Math.max(nextRange.max, nextRange.min + 1),
            },
        };
        onFilterChange(nextFilters);
    };

    const handleRoomToggle = (room: number) => {
        if (!filters) return;
        const rooms = filters.rooms.includes(room)
            ? filters.rooms.filter(r => r !== room)
            : [...filters.rooms, room];
        onFilterChange({ ...filters, rooms });
    };

    const resetPriceFilter = () => {
        if (!filters || !baselineFilters) return;
        onFilterChange({ ...filters, price: { ...baselineFilters.price } });
    };

    const resetAreaFilter = () => {
        if (!filters || !baselineFilters) return;
        onFilterChange({ ...filters, area: { ...baselineFilters.area } });
    };

    const resetRoomFilter = () => {
        if (!filters || !baselineFilters) return;
        onFilterChange({ ...filters, rooms: [...baselineFilters.rooms] });
    };

    const isPriceZoomed = useMemo(() => {
        if (!filters || !baselineFilters) return false;
        return Math.abs(filters.price.min - baselineFilters.price.min) > 0.5 || Math.abs(filters.price.max - baselineFilters.price.max) > 0.5;
    }, [filters, baselineFilters]);

    const isAreaZoomed = useMemo(() => {
        if (!filters || !baselineFilters) return false;
        return Math.abs(filters.area.min - baselineFilters.area.min) > 0.1 || Math.abs(filters.area.max - baselineFilters.area.max) > 0.1;
    }, [filters, baselineFilters]);

    const isRoomsFiltered = useMemo(() => {
        if (!filters || !baselineFilters) return false;
        if (filters.rooms.length !== baselineFilters.rooms.length) return true;
        const a = [...filters.rooms].sort();
        const b = [...baselineFilters.rooms].sort();
        return a.some((val, idx) => val !== b[idx]);
    }, [filters, baselineFilters]);
    
    const priceDistributionData = useMemo(() => {
        if (!selectedCharts.includes('priceDistribution') || !data.length) return [];
        const prices = data.map(d => d['Цена']);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const bins = 20;
        const range = max - min || 1;
        const binSize = range / bins;

        const distribution = Array.from({ length: bins }, (_, index) => {
            const binRange = getBinRange(min, binSize, index, bins, max);
            return {
                name: `${formatNumber(binRange.min)}`,
                count: 0,
                range: binRange,
                active: !!filters && rangesOverlap(binRange, filters.price),
            };
        });

        for (const price of prices) {
            const rawIndex = binSize === 0 ? 0 : Math.floor((price - min) / binSize);
            const binIndex = Number.isFinite(rawIndex) ? Math.min(bins - 1, Math.max(0, rawIndex)) : 0;
            distribution[binIndex].count += 1;
        }

        return distribution;
    }, [data, selectedCharts, filters]);

    const areaDistributionData = useMemo(() => {
        if (!selectedCharts.includes('areaDistribution') || !data.length) return [];
        const areas = data.map(d => d['Общая площадь']);
        const min = Math.min(...areas);
        const max = Math.max(...areas);
        const bins = 20;
        const range = max - min || 1;
        const binSize = range / bins;

        const distribution = Array.from({ length: bins }, (_, index) => {
            const binRange = getBinRange(min, binSize, index, bins, max);
            return {
                name: `${Math.round(binRange.min)} м²`,
                count: 0,
                range: binRange,
                active: !!filters && rangesOverlap(binRange, filters.area),
            };
        });

        for (const area of areas) {
            const rawIndex = binSize === 0 ? 0 : Math.floor((area - min) / binSize);
            const binIndex = Number.isFinite(rawIndex) ? Math.min(bins - 1, Math.max(0, rawIndex)) : 0;
            distribution[binIndex].count += 1;
        }

        return distribution;
    }, [data, selectedCharts, filters]);

    const pricePerSqmDistributionData = useMemo(() => {
        if (!selectedCharts.includes('pricePerSqmDistribution') || !data.length) return [];
        const ratios = data
            .map(d => (d['Общая площадь'] > 0 ? d['Цена'] / d['Общая площадь'] : NaN))
            .filter(value => Number.isFinite(value));

        if (!ratios.length) return [];

        const min = Math.min(...ratios);
        const max = Math.max(...ratios);
        const bins = 20;
        const range = max - min || 1;
        const binSize = range / bins;

        const distribution = Array.from({ length: bins }, (_, index) => {
            const binRange = getBinRange(min, binSize, index, bins, max);
            return {
                name: `${formatNumber(binRange.min)} ₽/м²`,
                count: 0,
                range: binRange,
                active: false,
            };
        });

        for (const ratio of ratios) {
            const rawIndex = binSize === 0 ? 0 : Math.floor((ratio - min) / binSize);
            const binIndex = Number.isFinite(rawIndex) ? Math.min(bins - 1, Math.max(0, rawIndex)) : 0;
            distribution[binIndex].count += 1;
        }

        return distribution;
    }, [data, selectedCharts]);

    const roomDistributionData = useMemo(() => {
        if (!selectedCharts.includes('roomDistribution') || !data.length) return [];
        const roomCounts = data.reduce((acc, d) => {
            const rooms = d['Количество комнат'];
            acc[rooms] = (acc[rooms] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);

        return Object.entries(roomCounts)
            .map(([room, count]) => {
                const roomNumber = Number(room);
                return {
                    room: roomNumber,
                    name: `${roomNumber} комн.`,
                    count,
                    active: !!filters && filters.rooms.includes(roomNumber),
                };
            })
            .sort((a, b) => a.room - b.room);
    }, [data, selectedCharts, filters]);

    const priceByTypeData = useMemo(() => {
        if (!selectedCharts.includes('avgPriceByType') || !data.length) return [];
        const typePriceSum: Record<string, { sum: number; count: number }> = {};
        data.forEach(d => {
            if (!typePriceSum[d.houseType]) {
                typePriceSum[d.houseType] = { sum: 0, count: 0 };
            }
            typePriceSum[d.houseType].sum += d['Цена'];
            typePriceSum[d.houseType].count += 1;
        });
        
        return Object.entries(typePriceSum).map(([type, { sum, count }]) => ({
            name: type,
            avgPrice: sum / count,
        }));
    }, [data, selectedCharts]);

    const avgPriceByRoomsData = useMemo(() => {
        if (!selectedCharts.includes('avgPriceByRooms') || !data.length) return [];
        const roomsMap: Record<number, { sum: number; count: number }> = {};
        data.forEach(d => {
            const room = d['Количество комнат'];
            if (!roomsMap[room]) {
                roomsMap[room] = { sum: 0, count: 0 };
            }
            roomsMap[room].sum += d['Цена'];
            roomsMap[room].count += 1;
        });

        return Object.entries(roomsMap)
            .map(([room, value]) => ({
                room: Number(room),
                name: `${room} комн.`,
                avgPrice: value.sum / value.count,
                active: !!filters && filters.rooms.includes(Number(room)),
            }))
            .sort((a, b) => a.room - b.room);
    }, [data, selectedCharts, filters]);

    const charts = useMemo(() => {
        const list: Array<{ key: ChartKey; content: React.ReactNode; hasData: boolean; analysis?: string; resetLabel?: string; onReset?: () => void; showReset?: boolean }> = [];

        if (selectedCharts.includes('priceDistribution')) {
            const pricesAll = data.map(d => d['Цена']);
            const analysisPrice = pricesAll.length
                ? `Объектов: ${pricesAll.length}. Медиана: ${formatNumber(Math.round(median(pricesAll)))} ₽, ` +
                  `IQR: ${formatNumber(Math.round(quantile(pricesAll, 0.75) - quantile(pricesAll, 0.25)))} ₽.`
                : undefined;
            list.push({
                key: 'priceDistribution',
                content: (
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priceDistributionData} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                            <XAxis dataKey="name" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <YAxis stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                            <Tooltip
                                contentStyle={tooltipStyle}
                                formatter={(value: number, _key, payload) => [value, `${payload?.payload?.range?.min.toFixed(0)} — ${payload?.payload?.range?.max.toFixed(0)} ₽`]}
                                cursor={tooltipCursor}
                            />
                            <Bar dataKey="count" onClick={({ payload }) => payload && handlePriceRangeSelect(payload.range)}>
                                {priceDistributionData.map((entry, index) => (
                                    <Cell
                                        key={`price-cell-${index}`}
                                        cursor="pointer"
                                        fill={entry.active ? activeBarColor : chartFillColor}
                                        fillOpacity={entry.active ? 0.95 : BAR_OPACITY_INACTIVE}
                                    />
                                ))}
                            </Bar>
                    </BarChart>
                </ResponsiveContainer>
                ),
                hasData: priceDistributionData.length > 0,
                analysis: analysisPrice,
                resetLabel: 'Сбросить диапазон',
                onReset: resetPriceFilter,
                showReset: isPriceZoomed,
            });
        }

        if (selectedCharts.includes('areaDistribution')) {
            const areasAll = data.map(d => d['Общая площадь']);
            const analysisArea = areasAll.length
                ? `Площадь: медиана ${Math.round(median(areasAll))} м², ` +
                  `IQR: ${Math.round(quantile(areasAll, 0.75) - quantile(areasAll, 0.25))} м².`
                : undefined;
            list.push({
                key: 'areaDistribution',
                content: (
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={areaDistributionData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                            <XAxis dataKey="name" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <YAxis stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                            <Tooltip
                                contentStyle={tooltipStyle}
                                formatter={(value: number, _key, payload) => [value, `${payload?.payload?.range?.min.toFixed(0)} — ${payload?.payload?.range?.max.toFixed(0)} м²`]}
                                cursor={tooltipCursor}
                            />
                            <Bar dataKey="count" onClick={({ payload }) => payload && handleAreaRangeSelect(payload.range)}>
                                {areaDistributionData.map((entry, index) => (
                                    <Cell
                                        key={`area-cell-${index}`}
                                        cursor="pointer"
                                        fill={entry.active ? activeBarColor : chartFillColor}
                                        fillOpacity={entry.active ? 0.95 : BAR_OPACITY_INACTIVE}
                                    />
                                ))}
                            </Bar>
                    </BarChart>
                </ResponsiveContainer>
                ),
                hasData: areaDistributionData.length > 0,
                analysis: analysisArea,
                resetLabel: 'Сбросить площадь',
                onReset: resetAreaFilter,
                showReset: isAreaZoomed,
            });
        }

        if (selectedCharts.includes('priceVsArea')) {
            const ratio = scatterSource
                .filter(d => d['Общая площадь'] > 0)
                .map(d => d['Цена'] / d['Общая площадь']);
            const analysisPvsA = ratio.length
                ? `Цена/м²: медиана ${formatNumber(Math.round(median(ratio)))} ₽/м².`
                : undefined;
            list.push({
                key: 'priceVsArea',
                content: (
                 <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                            <CartesianGrid stroke={scatterGridColor} />
                            <XAxis type="number" dataKey="Общая площадь" name="Площадь" unit=" м²" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <YAxis type="number" dataKey="Цена" name="Цена" stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                        <ZAxis type="number" range={[20, 100]} />
                            <Tooltip cursor={tooltipCursor} contentStyle={tooltipStyle} />
                            <Scatter data={scatterSource} fill={chartFillColor} fillOpacity={0.6} />
                    </ScatterChart>
                </ResponsiveContainer>
                ),
                hasData: scatterSource.length > 0,
                analysis: analysisPvsA,
            });
        }

        if (selectedCharts.includes('roomDistribution')) {
            const total = roomDistributionData.reduce((a, b) => a + b.count, 0);
            const analysisRooms = total ? `Объектов: ${total}. Топ: ${(roomDistributionData.slice().sort((a,b)=>b.count-a.count)[0]?.name) || ''}.` : undefined;
            list.push({
                key: 'roomDistribution',
                content: (
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={roomDistributionData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                            <XAxis dataKey="name" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <YAxis stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
                            <Bar dataKey="count" onClick={({ payload }) => payload && handleRoomToggle(payload.room)}>
                                {roomDistributionData.map((entry, index) => (
                                    <Cell
                                        key={`rooms-cell-${index}`}
                                        cursor="pointer"
                                        fill={entry.active ? activeBarColor : chartFillColor}
                                        fillOpacity={entry.active ? 0.95 : BAR_OPACITY_INACTIVE}
                                    />
                                ))}
                            </Bar>
                    </BarChart>
                </ResponsiveContainer>
                ),
                hasData: roomDistributionData.length > 0,
                analysis: analysisRooms,
                resetLabel: 'Сбросить выбор',
                onReset: resetRoomFilter,
                showReset: isRoomsFiltered,
            });
        }

        if (selectedCharts.includes('avgPriceByRooms')) {
            const analysisAvgRooms = avgPriceByRoomsData.length
                ? `Средняя цена от ${avgPriceByRoomsData[0].name}: ${formatNumber(Math.round(avgPriceByRoomsData[0].avgPrice))} ₽.`
                : undefined;
            list.push({
                key: 'avgPriceByRooms',
                content: (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={avgPriceByRoomsData} margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                <XAxis dataKey="name" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                                <YAxis stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(value: number) => formatNumber(value)} />
                                <Bar dataKey="avgPrice" onClick={({ payload }) => payload && handleRoomToggle(payload.room)}>
                                    {avgPriceByRoomsData.map((entry, index) => (
                                        <Cell
                                            key={`avg-room-cell-${index}`}
                                            cursor="pointer"
                                            fill={entry.active ? activeBarColor : chartFillColor}
                                            fillOpacity={entry.active ? 0.95 : BAR_OPACITY_INACTIVE}
                                        />
                                    ))}
                                </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ),
                hasData: avgPriceByRoomsData.length > 0,
                analysis: analysisAvgRooms,
                resetLabel: 'Сбросить выбор',
                onReset: resetRoomFilter,
                showReset: isRoomsFiltered,
            });
        }

        if (selectedCharts.includes('priceVsDistance')) {
            const analysisPvsD = scatterSource.length
                ? `Макс. расстояние: ${Math.round(Math.max(...scatterSource.map(d => d['Расстояние до центра (км)'])))} км.`
                : undefined;
            list.push({
                key: 'priceVsDistance',
                content: (
                 <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                            <CartesianGrid stroke={scatterGridColor} />
                            <XAxis type="number" dataKey="Расстояние до центра (км)" name="Расстояние" unit=" км" stroke={axisTextColor} fontSize={12} tick={{ fill: axisTextColor }} />
                            <YAxis type="number" dataKey="Цена" name="Цена" stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                        <ZAxis type="number" range={[20, 100]} />
                            <Tooltip cursor={tooltipCursor} contentStyle={tooltipStyle} />
                            <Scatter data={scatterSource} fill={chartFillColor} fillOpacity={0.6} />
                    </ScatterChart>
                </ResponsiveContainer>
                ),
                hasData: scatterSource.length > 0,
                analysis: analysisPvsD,
            });
        }

        if (selectedCharts.includes('avgPriceByType')) {
            const analysisAvgType = priceByTypeData.length
                ? `Дороже всего: ${priceByTypeData.slice().sort((a,b)=>b.avgPrice-a.avgPrice)[0].name}.`
                : undefined;
            list.push({
                key: 'avgPriceByType',
                content: (
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priceByTypeData} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                            <XAxis type="number" stroke={axisTextColor} fontSize={12} tickFormatter={formatNumber} tick={{ fill: axisTextColor }} />
                            <YAxis type="category" dataKey="name" stroke={axisTextColor} fontSize={12} width={80} tick={{ fill: axisTextColor }} />
                            <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} formatter={(value: number) => formatNumber(value)} />
                            <Bar dataKey="avgPrice" fill={chartFillColor} fillOpacity={BAR_OPACITY_INACTIVE + 0.2} />
                    </BarChart>
                </ResponsiveContainer>
                ),
                hasData: priceByTypeData.length > 0,
                analysis: analysisAvgType,
            });
        }

        return list;
    }, [
        selectedCharts,
        data,
        priceDistributionData,
        areaDistributionData,
        pricePerSqmDistributionData,
        scatterSource,
        roomDistributionData,
        avgPriceByRoomsData,
        priceByTypeData,
        chartFillColor,
        activeBarColor,
        gridColor,
        axisTextColor,
        tooltipStyle,
        tooltipCursor,
        scatterGridColor,
        isPriceZoomed,
        isAreaZoomed,
        isRoomsFiltered,
    ]);

    if (!data.length) {
        return <EmptyChartState message="Нет данных для отображения. Измените фильтры или загрузите другой файл." theme={theme} />;
    }

    if (!charts.length) {
        return (
            <div className={themeClass(theme, {
                dark: 'flex h-full items-center justify-center p-6 text-center text-sm text-slate-400',
                light: 'flex h-full items-center justify-center p-6 text-center text-sm text-slate-500',
            })}>
                Выберите визуализации в панели выше, чтобы построить аналитические графики.
            </div>
        );
    }

    return (
        <div className="grid auto-rows-[minmax(320px,1fr)] grid-cols-1 gap-4 p-1 sm:gap-5 sm:p-2 md:grid-cols-2 md:p-3 xl:grid-cols-3 2xl:grid-cols-4 lg:overflow-y-auto">
            {charts.map(chart => {
                const { title } = CHART_OPTION_MAP[chart.key];
                return (
                    <ChartCard
                        key={chart.key}
                        title={title}
                        resetLabel={chart.resetLabel}
                        onReset={chart.onReset}
                        showReset={chart.showReset}
                        theme={theme}
                    >
                        {chart.hasData ? chart.content : <EmptyChartState theme={theme} />}
                        {chart.analysis && (
                            <div className={themeClass(theme, {
                                dark: 'mt-4 text-sm leading-6 text-slate-200/85',
                                light: 'mt-4 text-sm leading-6 text-slate-600',
                            })}>
                                {chart.analysis}
                            </div>
                        )}
            </ChartCard>
                );
            })}
        </div>
    );
};


// --- Main App Component ---

function App() {
    const [theme, setTheme] = useState<Theme>('dark');
    const [isLoading, setLoading] = useState<boolean>(false);
    const [allData, setAllData] = useState<ApartmentData[] | null>(INITIAL_APP_STATE.allData);
    const [dataSummary, setDataSummary] = useState<DataSummary | null>(INITIAL_APP_STATE.dataSummary);
    const [filters, setFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.filters);
    const [baselineFilters, setBaselineFilters] = useState<FilterSettings | null>(INITIAL_APP_STATE.baselineFilters);
    const [isFilterPanelOpen, setFilterPanelOpen] = useState(false);
    const [selectedCharts, setSelectedCharts] = useState<ChartKey[]>(DEFAULT_CHART_SELECTION);
    const [isPending, startTransition] = useTransition();
    
    useEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.classList.toggle('theme-dark', theme === 'dark');
        root.classList.toggle('theme-light', theme === 'light');
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    }, []);

    const handleDataLoaded = useCallback((data: ApartmentData[], summary: DataSummary) => {
        startTransition(() => {
            const defaultFilters = createDefaultFiltersFromSummary(summary);
            setAllData(data);
            setDataSummary(summary);
            setFilters(defaultFilters);
            setBaselineFilters(defaultFilters);
        });
    }, [startTransition]);

    const handleFilterChange = useCallback((newFilters: FilterSettings) => {
        startTransition(() => {
            setFilters(newFilters);
        });
    }, [startTransition]);

    const handleChartSelectionChange = useCallback((next: ChartKey[]) => {
        startTransition(() => {
            setSelectedCharts(next);
        });
    }, [startTransition]);

    const deferredFilters = useDeferredValue(filters);
    const deferredSelectedCharts = useDeferredValue(selectedCharts);

    const filteredData = useMemo(() => {
        if (!allData || !deferredFilters) {
            return [];
        }
        return allData.filter(
            d =>
                d['Цена'] >= deferredFilters.price.min &&
                d['Цена'] <= deferredFilters.price.max &&
                d['Общая площадь'] >= deferredFilters.area.min &&
                d['Общая площадь'] <= deferredFilters.area.max &&
                (deferredFilters.rooms.length === 0 || deferredFilters.rooms.includes(d['Количество комнат']))
        );
    }, [allData, deferredFilters]);

    const deferredFilteredData = useDeferredValue(filteredData);
    const isChartUpdating =
        isPending ||
        deferredFilteredData !== filteredData ||
        deferredSelectedCharts !== selectedCharts;

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-900">
                <div className="flex flex-col items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-10 w-10 text-cyan-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="mt-4 text-white">Обработка данных...</p>
                </div>
            </div>
        );
    }
    
    if (!allData || !dataSummary || !filters || !baselineFilters) {
        return <FileUploadComponent onDataLoaded={handleDataLoaded} setLoading={setLoading}/>;
    }
    
    return (
        <div className={themeClass(theme, {
            dark: 'relative min-h-screen w-full overflow-hidden bg-slate-950 text-slate-200',
            light: 'relative min-h-screen w-full overflow-hidden bg-slate-100 text-slate-900',
        })}>
            <div className={themeClass(theme, {
                dark: 'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.15),transparent_55%)]',
                light: 'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_60%)]',
            })}></div>
            <div className={themeClass(theme, {
                dark: 'pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.15),transparent_60%)]',
                light: 'pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(165,243,252,0.2),transparent_65%)]',
            })}></div>

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-6 px-2 pb-10 pt-6 sm:px-4 lg:px-6 xl:px-8">
                <header className={themeClass(theme, {
                    dark: 'flex flex-col gap-4 rounded-3xl border border-slate-800/60 bg-slate-950/60 p-6 shadow-lg shadow-black/20 sm:p-8',
                    light: 'flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200 sm:p-8',
                })}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                            <h1 className={`font-display ${themeClass(theme, {
                                dark: 'text-3xl sm:text-4xl font-bold tracking-tight text-white',
                                light: 'text-3xl sm:text-4xl font-bold tracking-tight text-slate-900',
                            })}`}>
                                Аналитический дашборд недвижимости
                            </h1>
                            <p className={themeClass(theme, {
                                dark: 'text-sm sm:text-base text-slate-300/90',
                                light: 'text-sm sm:text-base text-slate-600',
                            })}>Исследуйте цены, площади и типы жилья через интерактивные визуализации.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={toggleTheme}
                                className={themeClass(theme, {
                                    dark: 'inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-200 transition hover:border-cyan-500/60 hover:bg-slate-900',
                                    light: 'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-600 transition hover:border-cyan-400/50 hover:bg-slate-50',
                                })}
                                aria-label="Переключить тему"
                            >
                                {theme === 'dark' ? (
                                    <>
                                        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.11-8.11 8 8 0 0 1 .25-2A1 1 0 0 0 8.36 2 10.14 10.14 0 1 0 22 14.64 1 1 0 0 0 21.64 13Z"/></svg>
                                        Тёмная тема
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M6.76 4.84 5.35 3.43 3.93 4.84l1.41 1.41ZM1 11h3v2H1zm10-9h2v3h-2zm9.07 1.43-1.41 1.41 1.41 1.41 1.41-1.41ZM17.24 4.84 15.83 6.25l1.41 1.41L18.65 6.25ZM12 5a7 7 0 1 0 7 7 7 7 0 0 0-7-7Zm6 8h3v-2h-3ZM4.22 17.66l-1.41 1.41 1.41 1.41 1.41-1.41Zm15.56 0-1.41 1.41 1.41 1.41 1.41-1.41ZM11 19h2v3h-2ZM6.76 19.16l-1.41 1.41 1.41 1.41 1.41-1.41Z"/></svg>
                                        Светлая тема
                                    </>
                                )}
                            </button>
                            <div className={themeClass(theme, {
                                dark: 'inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-1 text-xs uppercase tracking-widest text-cyan-200',
                                light: 'inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-200/40 px-4 py-1 text-xs uppercase tracking-widest text-cyan-700',
                            })}>
                                Обновлено • Реальный CSV анализ
                            </div>
                        </div>
                    </div>
                    <DashboardStats data={deferredFilteredData} theme={theme} />
            </header>

            {/* Filter Button for Mobile */}
            <div className="lg:hidden">
                <button
                    onClick={() => setFilterPanelOpen(true)}
                    className={themeClass(theme, {
                        dark: 'w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-3 text-sm font-medium text-white shadow-md shadow-black/20 transition hover:border-cyan-500/70 hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/60',
                        light: 'w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-md shadow-slate-200 transition hover:border-cyan-400/60 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50',
                    })}
                    aria-label="Открыть фильтры"
                >
                    <FilterIcon />
                    <span>Фильтры</span>
                </button>
            </div>
            
            <main className="flex-grow flex flex-col gap-6 lg:flex-row lg:items-start xl:gap-8 lg:overflow-hidden">
                {/* Mobile Filter Panel (Overlay) */}
                {isFilterPanelOpen && (
                    <div
                        className={themeClass(theme, {
                            dark: 'fixed inset-0 z-40 bg-black/60 backdrop-blur',
                            light: 'fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm',
                        })}
                        onClick={() => setFilterPanelOpen(false)}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div
                            className={themeClass(theme, {
                                dark: 'absolute inset-y-0 left-0 w-full max-w-sm bg-slate-950/95 p-0 shadow-2xl',
                                light: 'absolute inset-y-0 left-0 w-full max-w-sm bg-white p-0 shadow-2xl',
                            })}
                            onClick={e => e.stopPropagation()}
                        >
                            <FilterPanel 
                                filters={filters} 
                                summary={dataSummary} 
                                onFilterChange={handleFilterChange} 
                                onClose={() => setFilterPanelOpen(false)}
                                theme={theme}
                            />
                        </div>
                    </div>
                )}
                
                {/* Desktop Filter Panel */}
                <aside className="hidden lg:block w-full lg:w-80 xl:w-72 2xl:w-80 flex-shrink-0">
                    <FilterPanel filters={filters} summary={dataSummary} onFilterChange={handleFilterChange} theme={theme} />
                </aside>

                <section className="relative flex-grow w-full lg:overflow-hidden">
                    <ChartSelector
                        options={CHART_OPTIONS}
                        selected={selectedCharts}
                        onChange={handleChartSelectionChange}
                        disabled={isPending}
                        theme={theme}
                    />
                    {isChartUpdating && (
                        <div className={themeClass(theme, {
                            dark: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-cyan-500/40 bg-slate-900/70 backdrop-blur-sm',
                            light: 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-cyan-400/40 bg-white/80 backdrop-blur-sm',
                        })}>
                            <div className="flex flex-col items-center gap-3 text-slate-200 text-sm">
                                <svg className={themeClass(theme, {
                                    dark: 'h-7 w-7 animate-spin text-cyan-400',
                                    light: 'h-7 w-7 animate-spin text-cyan-500',
                                })} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className={themeClass(theme, {
                                    dark: 'text-xs uppercase tracking-widest text-cyan-200/80',
                                    light: 'text-xs uppercase tracking-widest text-cyan-600/80',
                                })}>
                                    Обновляем визуализации...
                                </span>
                            </div>
                        </div>
                    )}
                    <ChartGrid
                        data={deferredFilteredData}
                        selectedCharts={deferredSelectedCharts}
                        filters={deferredFilters}
                        baselineFilters={baselineFilters}
                        theme={theme}
                        onFilterChange={handleFilterChange}
                    />
                </section>
            </main>
            </div>
        </div>
    );
}

export default App;
