import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import type { CityId } from '@/domain/city';
import type { DatasetMeta } from '@/types';
import { CitySwitcher } from '@/components/CitySwitcher';
import { AdminServerPanel } from '@/components/AdminServerPanel';
import { AdminParserPanel } from '@/components/AdminParserPanel';
import { roleLabel } from '@/roles';
import type { Role } from '@/auth';

export function AdminSetupView({
    theme,
    role,
    cityId,
    cityLabel,
    cities,
    meta,
    onCityChange,
    onMetaChange,
    onToast,
    onServerChanged,
    onIngested,
    onLogout,
}: {
    theme: Theme;
    role: Role;
    cityId: CityId;
    cityLabel: string;
    cities: { id: CityId; label: string; hasData: boolean }[];
    meta: DatasetMeta | null;
    onCityChange: (id: CityId) => void;
    onMetaChange: (meta: DatasetMeta) => void;
    onToast: (message: string) => void;
    onServerChanged: () => void;
    onIngested: () => void;
    onLogout: () => void;
}) {
    return (
        <div
            className={themeClass(theme, {
                dark: 'min-h-screen bg-zinc-950 text-zinc-200',
                light: 'min-h-screen bg-zinc-50 text-zinc-900',
            })}
        >
            <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8">
                <header className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h1
                            className={themeClass(theme, {
                                dark: 'font-display text-xl font-semibold text-zinc-50',
                                light: 'font-display text-xl font-semibold text-zinc-900',
                            })}
                        >
                            Управление серверным датасетом
                        </h1>
                        <button
                            type="button"
                            onClick={onLogout}
                            className={themeClass(theme, {
                                dark: 'rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900',
                                light: 'rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm shadow-sm hover:bg-zinc-50',
                            })}
                        >
                            Выйти
                        </button>
                    </div>
                    <p
                        className={themeClass(theme, {
                            dark: 'text-sm text-zinc-400',
                            light: 'text-sm text-zinc-600',
                        })}
                    >
                        {roleLabel(role)} · для города «{cityLabel}» на сервере пока нет объявлений. Загрузите CSV или
                        переключитесь на город с данными.
                    </p>
                    <CitySwitcher theme={theme} cities={cities} value={cityId} onChange={onCityChange} />
                </header>

                <AdminParserPanel theme={theme} cityId={cityId} onToast={onToast} onIngested={onIngested} />
                <AdminServerPanel
                    theme={theme}
                    cityId={cityId}
                    meta={meta}
                    onMetaChange={onMetaChange}
                    onToast={onToast}
                    onServerChanged={onServerChanged}
                />
            </div>
        </div>
    );
}
