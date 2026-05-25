import React from 'react';
import type { CityId } from '@/domain/city';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { CONTROL_SELECT_BASE, CONTROL_TEXT } from '@/components/controlStyles';

export type CityOption = {
    id: CityId;
    label: string;
    hasData: boolean;
};

export function CitySwitcher({
    theme,
    cities,
    value,
    onChange,
    disabled,
}: {
    theme: Theme;
    cities: CityOption[];
    value: CityId | null;
    onChange: (cityId: CityId) => void;
    disabled?: boolean;
}) {
    if (!cities.length) return null;
    return (
        <label className="inline-flex h-11 shrink-0 items-center gap-2">
            <span
                className={themeClass(theme, {
                    dark: `${CONTROL_TEXT} text-zinc-400`,
                    light: `${CONTROL_TEXT} text-zinc-600`,
                })}
            >
                Город
            </span>
            <select
                value={value ?? ''}
                disabled={disabled}
                onChange={e => onChange(e.target.value as CityId)}
                className={themeClass(theme, {
                    dark: `${CONTROL_SELECT_BASE} border border-zinc-700 bg-zinc-900 text-zinc-100`,
                    light: `${CONTROL_SELECT_BASE} border border-zinc-200 bg-white text-zinc-900 shadow-sm`,
                })}
                aria-label="Выбор города"
            >
                {cities.map(c => (
                    <option key={c.id} value={c.id}>
                        {c.label}
                        {!c.hasData ? ' (нет данных)' : ''}
                    </option>
                ))}
            </select>
        </label>
    );
}
