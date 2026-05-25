import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import type { CityId } from '@/domain/city';
import { CitySwitcher } from '@/components/CitySwitcher';

export function ServerDataEmpty({
    theme,
    cityLabel,
    cities,
    selectedCityId,
    onCityChange,
    onUsePersonalCsv,
    onLogout,
}: {
    theme: Theme;
    cityLabel?: string | null;
    cities?: { id: CityId; label: string; hasData: boolean }[];
    selectedCityId?: CityId | null;
    onCityChange?: (id: CityId) => void;
    onUsePersonalCsv?: () => void;
    onLogout: () => void;
}) {
    return (
        <div
            className={themeClass(theme, {
                dark: 'flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-200',
                light: 'flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 text-zinc-900',
            })}
        >
            <div
                className={themeClass(theme, {
                    dark: 'max-w-md space-y-4 rounded-[1.75rem] border border-zinc-800/80 bg-zinc-950/70 p-10 text-center',
                    light: 'max-w-md space-y-4 rounded-[1.75rem] border border-zinc-200/90 bg-white p-10 text-center shadow-sm',
                })}
            >
                <h1
                    className={themeClass(theme, {
                        dark: 'font-display text-xl font-semibold text-zinc-50',
                        light: 'font-display text-xl font-semibold text-zinc-900',
                    })}
                >
                    Данные рынка ещё не опубликованы
                </h1>
                <p
                    className={themeClass(theme, {
                        dark: 'text-sm leading-relaxed text-zinc-400',
                        light: 'text-sm leading-relaxed text-zinc-600',
                    })}
                >
                    {cityLabel
                        ? `Для города «${cityLabel}» на сервере пока нет объявлений. Обратитесь к администратору.`
                        : 'Обратитесь к администратору, чтобы загрузить объявления на сервер.'}
                </p>
                {cities && cities.length > 0 && selectedCityId && onCityChange && (
                    <div className="flex justify-center pt-2">
                        <CitySwitcher
                            theme={theme}
                            cities={cities}
                            value={selectedCityId}
                            onChange={onCityChange}
                        />
                    </div>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
                {onUsePersonalCsv && (
                    <button
                        type="button"
                        onClick={onUsePersonalCsv}
                        className={themeClass(theme, {
                            dark: 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500',
                            light: 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500',
                        })}
                    >
                        Работать со своим CSV
                    </button>
                )}
                <button
                    type="button"
                    onClick={onLogout}
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-600',
                        light: 'rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300',
                    })}
                >
                    Выйти
                </button>
            </div>
        </div>
    );
}
