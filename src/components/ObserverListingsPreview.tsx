import React, { useEffect, useMemo, useState } from 'react';
import type { DataRow, DataSummary } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';
import { listingLinkFromRow } from '@/utils/listingLink';

const PAGE_SIZE = 12;

function pickAddress(row: DataRow): string {
    for (const key of ['Адрес', 'address', 'Address']) {
        const v = String(row[key] ?? '').trim();
        if (v) return v;
    }
    return 'Адрес не указан';
}

export function ObserverListingsPreview({
    data,
    summary,
    theme,
}: {
    data: DataRow[];
    summary: DataSummary;
    theme: Theme;
}) {
    const [page, setPage] = useState(1);
    const priceCol = summary.coreColumnMap.price;
    const areaCol = summary.coreColumnMap.area;
    const roomsCol = summary.coreColumnMap.rooms;

    useEffect(() => {
        setPage(1);
    }, [data.length]);

    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    const pageClamped = Math.min(page, totalPages);
    const slice = useMemo(() => {
        const start = (pageClamped - 1) * PAGE_SIZE;
        return data.slice(start, start + PAGE_SIZE);
    }, [data, pageClamped]);

    if (!data.length) {
        return (
            <p
                className={themeClass(theme, {
                    dark: 'text-sm text-zinc-500',
                    light: 'text-sm text-zinc-600',
                })}
            >
                Нет объектов по текущим фильтрам.
            </p>
        );
    }

    return (
        <section className="space-y-4">
            <div>
                <h2
                    className={themeClass(theme, {
                        dark: 'font-display text-lg font-semibold tracking-tight text-zinc-50',
                        light: 'font-display text-lg font-semibold tracking-tight text-zinc-900',
                    })}
                >
                    Объявления
                </h2>
                <p
                    className={themeClass(theme, {
                        dark: 'text-sm text-zinc-500',
                        light: 'text-sm text-zinc-600',
                    })}
                >
                    {data.length.toLocaleString('ru-RU')} в выборке · только просмотр
                </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {slice.map((row, i) => {
                    const price = priceCol ? row[priceCol] : null;
                    const area = areaCol ? row[areaCol] : null;
                    const rooms = roomsCol ? row[roomsCol] : null;
                    const link = listingLinkFromRow(row);
                    return (
                        <article
                            key={`${pageClamped}-${i}`}
                            className={themeClass(theme, {
                                dark: 'rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-4',
                                light: 'rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm',
                            })}
                        >
                            <p
                                className={themeClass(theme, {
                                    dark: 'text-sm font-medium text-zinc-100',
                                    light: 'text-sm font-medium text-zinc-900',
                                })}
                            >
                                {pickAddress(row)}
                            </p>
                            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                {price != null && price !== '' && (
                                    <>
                                        <dt className="text-zinc-500">Цена</dt>
                                        <dd className="font-medium">{formatNumber(price)} ₽</dd>
                                    </>
                                )}
                                {rooms != null && rooms !== '' && (
                                    <>
                                        <dt className="text-zinc-500">Комнаты</dt>
                                        <dd>{String(rooms)}</dd>
                                    </>
                                )}
                                {area != null && area !== '' && (
                                    <>
                                        <dt className="text-zinc-500">Площадь</dt>
                                        <dd>{formatNumber(area)} м²</dd>
                                    </>
                                )}
                            </dl>
                            {link && (
                                <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={themeClass(theme, {
                                        dark: 'mt-3 inline-block text-xs font-medium text-indigo-300 hover:text-indigo-200',
                                        light: 'mt-3 inline-block text-xs font-medium text-indigo-700 hover:text-indigo-900',
                                    })}
                                >
                                    Открыть объявление
                                </a>
                            )}
                        </article>
                    );
                })}
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <button
                        type="button"
                        disabled={pageClamped <= 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        className={themeClass(theme, {
                            dark: 'rounded-lg border border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-40',
                            light: 'rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:opacity-40',
                        })}
                    >
                        Назад
                    </button>
                    <span className="text-sm text-zinc-500">
                        {pageClamped} / {totalPages}
                    </span>
                    <button
                        type="button"
                        disabled={pageClamped >= totalPages}
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        className={themeClass(theme, {
                            dark: 'rounded-lg border border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-40',
                            light: 'rounded-lg border border-zinc-200 px-3 py-1.5 text-sm disabled:opacity-40',
                        })}
                    >
                        Вперёд
                    </button>
                </div>
            )}
        </section>
    );
}
