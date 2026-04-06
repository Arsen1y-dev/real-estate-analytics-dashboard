import React, { useMemo, useState } from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { highlightSearchMatches } from '@/utils/highlightSearch';

const labelClass = (theme: Theme) =>
    themeClass(theme, {
        dark: 'mb-2 block text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500',
        light: 'mb-2 block text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500',
    });

export type ColumnQuickPick = { label: string; column: string };

export const ColumnSearchSelect: React.FC<{
    id: string;
    label: string;
    options: string[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    theme: Theme;
    /** Плейсхолдер поля поиска */
    searchPlaceholder?: string;
    /** Текст, если список после фильтра пуст */
    emptyText?: string;
    /** Быстрый доступ (сверху списка): только столбцы из `options` */
    quickPicks?: ColumnQuickPick[];
    /** Формат отображаемого названия опции (сырой ключ не меняется) */
    renderOptionLabel?: (name: string) => string;
}> = ({
    id,
    label,
    options,
    value,
    onChange,
    disabled,
    theme,
    searchPlaceholder = 'Поиск по названию…',
    emptyText = 'Нет совпадений',
    quickPicks = [],
    renderOptionLabel,
}) => {
    const [query, setQuery] = useState('');
    const toDisplayLabel = (name: string) => renderOptionLabel?.(name) ?? name;

    const visibleQuickPicks = useMemo(() => {
        const q = query.trim().toLowerCase();
        return quickPicks.filter(p => {
            if (!options.includes(p.column)) return false;
            if (!q) return true;
            return p.label.toLowerCase().includes(q) || p.column.toLowerCase().includes(q);
        });
    }, [quickPicks, options, query]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = !q
            ? [...options]
            : options.filter(o => {
                  const display = toDisplayLabel(o).toLowerCase();
                  return o.toLowerCase().includes(q) || display.includes(q);
              });
        if (value && options.includes(value) && !list.includes(value)) {
            return [value, ...list];
        }
        return list;
    }, [options, query, value, renderOptionLabel]);

    const mainList = useMemo(() => {
        if (visibleQuickPicks.length === 0) return filtered;
        const quickSet = new Set(visibleQuickPicks.map(p => p.column));
        return filtered.filter(name => !quickSet.has(name));
    }, [filtered, visibleQuickPicks]);

    const markCls = themeClass(theme, {
        dark: 'rounded-[3px] bg-indigo-500/35 px-0.5 text-[inherit] [box-decoration-break:clone]',
        light: 'rounded-[3px] bg-indigo-200/90 px-0.5 text-[inherit] [box-decoration-break:clone]',
    });

    const searchId = `${id}-search`;

    return (
        <div>
            <label className={labelClass(theme)} htmlFor={searchId}>
                {label}
            </label>
            <div
                className={themeClass(theme, {
                    dark: 'overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900/90 shadow-sm',
                    light: 'overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm',
                })}
            >
                <input
                    id={searchId}
                    type="search"
                    role="searchbox"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className={themeClass(theme, {
                        dark: 'w-full border-b border-zinc-800/90 bg-zinc-950/50 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50',
                        light: 'w-full border-b border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-50',
                    })}
                />
                {visibleQuickPicks.length > 0 && (
                    <div
                        className={themeClass(theme, {
                            dark: 'border-b border-zinc-800/80 px-3 pb-3 pt-2.5',
                            light: 'border-b border-zinc-200/95 px-3 pb-3 pt-2.5',
                        })}
                    >
                        <p
                            className={themeClass(theme, {
                                dark: 'mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500',
                                light: 'mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500',
                            })}
                        >
                            Популярные поля
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {visibleQuickPicks.map(pick => {
                                const selected = value === pick.column;
                                return (
                                    <button
                                        key={pick.column}
                                        type="button"
                                        disabled={disabled}
                                        title={pick.column}
                                        onClick={() => {
                                            onChange(pick.column);
                                            setQuery('');
                                        }}
                                        className={`max-w-full truncate rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                                            selected
                                                ? themeClass(theme, {
                                                      dark: 'bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-500/45',
                                                      light: 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-300/80',
                                                  })
                                                : themeClass(theme, {
                                                      dark: 'bg-zinc-800/90 text-zinc-200 hover:bg-zinc-800 hover:ring-1 hover:ring-zinc-600/60',
                                                      light: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200/90 hover:ring-1 hover:ring-zinc-300/80',
                                                  })
                                        } disabled:cursor-not-allowed disabled:opacity-45`}
                                    >
                                        {pick.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <ul role="listbox" aria-label={label} className="p-1">
                    {filtered.length === 0 && visibleQuickPicks.length === 0 ? (
                        <li
                            className={themeClass(theme, {
                                dark: 'px-3 py-3 text-center text-sm text-zinc-500',
                                light: 'px-3 py-3 text-center text-sm text-zinc-500',
                            })}
                        >
                            {emptyText}
                        </li>
                    ) : mainList.length === 0 && visibleQuickPicks.length > 0 ? (
                        <li
                            className={themeClass(theme, {
                                dark: 'px-3 py-2 text-center text-[11px] text-zinc-500',
                                light: 'px-3 py-2 text-center text-[11px] text-zinc-500',
                            })}
                        >
                            Все совпадения — в блоке выше
                        </li>
                    ) : (
                        mainList.map(name => {
                            const selected = value === name;
                            return (
                                <li key={name}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        disabled={disabled}
                                        onClick={() => {
                                            onChange(name);
                                            setQuery('');
                                        }}
                                        className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                                            selected
                                                ? themeClass(theme, {
                                                      dark: 'bg-indigo-500/20 font-medium text-indigo-100 ring-1 ring-indigo-500/40',
                                                      light: 'bg-indigo-50 font-medium text-indigo-900 ring-1 ring-indigo-200/90',
                                                  })
                                                : themeClass(theme, {
                                                      dark: 'text-zinc-200 hover:bg-zinc-800/80',
                                                      light: 'text-zinc-800 hover:bg-zinc-100',
                                                  })
                                        } disabled:cursor-not-allowed disabled:opacity-45`}
                                    >
                                        <span className="break-words">{highlightSearchMatches(toDisplayLabel(name), query, markCls)}</span>
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </div>
        </div>
    );
};
