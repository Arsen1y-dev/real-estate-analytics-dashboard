import React, { useCallback, useRef, useState } from 'react';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { useAuth } from '@/auth';
import type { CityId } from '@/domain/city';
import type { DatasetMeta } from '@/types';
import {
    adminDatasetExportUrl,
    clearAdminDataset,
    deleteAdminBatch,
    fetchDatasetMeta,
    uploadAdminDataset,
} from '@/api/dataset';
import { MAX_CSV_BYTES } from '@/utils/csvImport';

function formatAt(at: string): string {
    try {
        return new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return at;
    }
}

export function AdminServerPanel({
    theme,
    cityId,
    meta,
    onMetaChange,
    onToast,
    onServerChanged,
}: {
    theme: Theme;
    cityId: CityId;
    meta: DatasetMeta | null;
    onMetaChange: (meta: DatasetMeta) => void;
    onToast: (message: string) => void;
    onServerChanged?: () => void;
}) {
    const { token } = useAuth();
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const refreshMeta = useCallback(async () => {
        if (!token) return;
        const m = await fetchDatasetMeta(token, cityId);
        if (m) onMetaChange(m.meta);
    }, [token, cityId, onMetaChange]);

    const handleUpload = async (file: File) => {
        if (!token) return;
        if (file.size > MAX_CSV_BYTES) {
            onToast(`Файл слишком большой (макс. ${Math.round(MAX_CSV_BYTES / (1024 * 1024))} МБ)`);
            return;
        }
        setBusy(true);
        try {
            const result = await uploadAdminDataset(token, cityId, file, 'append');
            if (!result.ok) {
                onToast(result.error);
                return;
            }
            onMetaChange(result.data.meta);
            const reasons: string[] = [];
            if (result.data.duplicateByOfferId > 0) reasons.push(`offer_id ${result.data.duplicateByOfferId}`);
            if (result.data.tooFarFiltered > 0) reasons.push(`вне 400км ${result.data.tooFarFiltered}`);
            if (result.data.droppedInvalid > 0) reasons.push(`невалидных ${result.data.droppedInvalid}`);
            onToast(
                `Загружено: +${result.data.added}, дубликатов ${result.data.skippedDuplicates}${reasons.length ? ` (${reasons.join(', ')})` : ''}, всего ${result.data.totalRows.toLocaleString('ru-RU')}`
            );
            onServerChanged?.();
        } catch {
            onToast('API недоступен — запустите npm run dev:api');
        } finally {
            setBusy(false);
        }
    };

    const handleDeleteBatch = async (batchId: string, added: number, at: string) => {
        if (!token) return;
        if (!window.confirm(`Удалить ${added.toLocaleString('ru-RU')} объектов из загрузки от ${formatAt(at)}?`)) return;
        setBusy(true);
        try {
            const result = await deleteAdminBatch(token, cityId, batchId);
            if (!result.ok) {
                onToast(result.error);
                return;
            }
            onMetaChange(result.meta);
            onToast(`Удалено ${result.removed.toLocaleString('ru-RU')} объектов`);
            onServerChanged?.();
        } finally {
            setBusy(false);
        }
    };

    const handleClear = async () => {
        if (!token) return;
        if (!window.confirm('Очистить весь серверный датасет? Это действие нельзя отменить.')) return;
        setBusy(true);
        try {
            const result = await clearAdminDataset(token, cityId);
            if (!result.ok) {
                onToast(result.error);
                return;
            }
            onMetaChange(result.meta);
            onToast('Серверный датасет очищен');
            onServerChanged?.();
        } finally {
            setBusy(false);
        }
    };

    const handleExport = () => {
        if (!token) return;
        const url = adminDatasetExportUrl(cityId);
        const a = document.createElement('a');
        a.href = url;
        a.setAttribute('download', 'server_dataset.csv');
        fetch(url, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => {
                if (!r.ok) throw new Error('export failed');
                return r.blob();
            })
            .then(blob => {
                const obj = URL.createObjectURL(blob);
                a.href = obj;
                a.click();
                URL.revokeObjectURL(obj);
            })
            .catch(() => onToast('Не удалось скачать CSV'));
    };

    return (
        <section
            className={themeClass(theme, {
                dark: 'rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6',
                light: 'rounded-2xl border border-amber-200/80 bg-amber-50/50 p-6',
            })}
        >
            <h2
                className={themeClass(theme, {
                    dark: 'font-display text-lg font-semibold text-amber-100',
                    light: 'font-display text-lg font-semibold text-amber-950',
                })}
            >
                Серверный датасет · {cityId}
            </h2>
            <p
                className={themeClass(theme, {
                    dark: 'mt-1 text-sm text-zinc-400',
                    light: 'mt-1 text-sm text-zinc-600',
                })}
            >
                Всего на сервере: {(meta?.rowCount ?? 0).toLocaleString('ru-RU')} · обновлено{' '}
                {meta?.updatedAt ? formatAt(meta.updatedAt) : '—'}
                {meta?.lastFileName ? ` · последний файл: ${meta.lastFileName}` : ''}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                <input
                    ref={inputRef}
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={e => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleUpload(f);
                    }}
                />
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-amber-500/35 bg-amber-500/[0.12] px-4 py-2 text-sm font-medium text-amber-100 disabled:opacity-60',
                        light: 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 disabled:opacity-60',
                    })}
                >
                    {busy ? 'Загрузка…' : 'Выбрать CSV'}
                </button>
                <button
                    type="button"
                    disabled={busy || !meta?.rowCount}
                    onClick={handleExport}
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50',
                        light: 'rounded-xl border border-zinc-200 px-4 py-2 text-sm disabled:opacity-50',
                    })}
                >
                    Скачать серверный CSV
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleClear()}
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-200 disabled:opacity-50',
                        light: 'rounded-xl border border-red-200 px-4 py-2 text-sm text-red-800 disabled:opacity-50',
                    })}
                >
                    Очистить всё
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void refreshMeta()}
                    className={themeClass(theme, {
                        dark: 'rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200',
                        light: 'rounded-xl border border-zinc-200 px-4 py-2 text-sm',
                    })}
                >
                    Обновить статус
                </button>
            </div>

            {meta && meta.uploads.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-left text-xs">
                        <thead>
                            <tr className={themeClass(theme, { dark: 'text-zinc-500', light: 'text-zinc-600' })}>
                                <th className="py-2 pr-3">Дата</th>
                                <th className="py-2 pr-3">Файл</th>
                                <th className="py-2 pr-3">Режим</th>
                                <th className="py-2 pr-3">Добавлено</th>
                                <th className="py-2 pr-3">Дубликаты</th>
                                <th className="py-2 pr-3">Вне 400км</th>
                                <th className="py-2 pr-3">Невалидные</th>
                                <th className="py-2">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...meta.uploads].reverse().map(u => (
                                <tr
                                    key={u.batchId}
                                    className={themeClass(theme, {
                                        dark: 'border-t border-zinc-800/80',
                                        light: 'border-t border-zinc-200',
                                    })}
                                >
                                    <td className="py-2 pr-3">{formatAt(u.at)}</td>
                                    <td className="py-2 pr-3">{u.fileName}</td>
                                    <td className="py-2 pr-3">{u.mode}</td>
                                    <td className="py-2 pr-3">{u.added}</td>
                                    <td className="py-2 pr-3">{u.skippedDuplicates}</td>
                                    <td className="py-2 pr-3">{u.tooFarFiltered ?? 0}</td>
                                    <td className="py-2 pr-3">{u.droppedInvalid ?? 0}</td>
                                    <td className="py-2">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void handleDeleteBatch(u.batchId, u.added, u.at)}
                                            className="text-red-400 hover:text-red-300 disabled:opacity-50"
                                        >
                                            Удалить партию
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
