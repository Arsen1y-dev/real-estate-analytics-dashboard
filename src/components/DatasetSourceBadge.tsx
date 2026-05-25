import React from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import type { DataSourceMode } from '@/domain/dataSource';
import type { DatasetMeta } from '@/types';
import type { Role } from '@/auth';
import { CONTROL_BUTTON_BASE, CONTROL_CHIP_BASE } from '@/components/controlStyles';

function formatUpdated(at: string | undefined): string {
    if (!at) return '—';
    try {
        return new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return at;
    }
}

function personalFileLabel(fileKey: string | null): string {
    if (!fileKey) return 'файл не выбран';
    const name = fileKey.split('|')[0];
    return name || fileKey;
}

export function DatasetSourceBadge({
    theme,
    role,
    mode,
    rowCount,
    meta,
    cityLabel,
    personalFileKey,
    onChangeSource,
    onRefreshServer,
    refreshing,
}: {
    theme: Theme;
    role: Role;
    mode: DataSourceMode;
    rowCount: number;
    meta: DatasetMeta | null;
    cityLabel?: string | null;
    personalFileKey: string | null;
    onChangeSource?: () => void;
    onRefreshServer?: () => void;
    refreshing?: boolean;
}) {
    const isObserver = role === 'observer';
    const cityPart = cityLabel ? `${cityLabel} · ` : '';
    const label = isObserver
        ? `Рынок · ${cityPart}${rowCount.toLocaleString('ru-RU')} объектов после очистки · обновлено ${formatUpdated(meta?.updatedAt)}`
        : mode === 'server'
          ? `Сервер · ${cityPart}${rowCount.toLocaleString('ru-RU')} объектов после очистки · ${formatUpdated(meta?.updatedAt)}`
          : `Личный · ${personalFileLabel(personalFileKey)} · ${rowCount.toLocaleString('ru-RU')} объектов после очистки`;

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap">
            <span
                className={themeClass(theme, {
                    dark: `${CONTROL_CHIP_BASE} max-w-full border border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-100/95`,
                    light: `${CONTROL_CHIP_BASE} max-w-full border border-emerald-200/80 bg-emerald-50/90 text-emerald-900`,
                })}
                title={label}
            >
                <span className="min-w-0 max-w-full truncate">{label}</span>
            </span>
            {!isObserver && onChangeSource && (
                <button
                    type="button"
                    onClick={onChangeSource}
                    className={themeClass(theme, {
                        dark: `${CONTROL_BUTTON_BASE} border border-zinc-700/80 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900`,
                        light: `${CONTROL_BUTTON_BASE} border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50`,
                    })}
                >
                    Сменить источник
                </button>
            )}
            {!isObserver && mode === 'server' && onRefreshServer && (
                <button
                    type="button"
                    disabled={refreshing}
                    onClick={onRefreshServer}
                    className={themeClass(theme, {
                        dark: `${CONTROL_BUTTON_BASE} border border-zinc-700/80 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900`,
                        light: `${CONTROL_BUTTON_BASE} border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50`,
                    })}
                >
                    {refreshing ? 'Обновление…' : 'Обновить с сервера'}
                </button>
            )}
        </div>
    );
}
