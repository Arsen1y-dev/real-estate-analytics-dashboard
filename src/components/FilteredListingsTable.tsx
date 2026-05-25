import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { CityId } from '@/domain/city';
import type { DataRow, DataSummary, FilterSettings } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';
import { apiBaseUrl, useAuth } from '@/auth';
import { firstAddressValue, sanitizeAddressValue } from '@/domain/address';
import { parseGeolocationCell } from '../../shared/geolocation';
import { buildCanonicalReverseGeocodeKey } from '../../shared/reverseGeocodeKey';
import { buildListingLinkIndex, listingLinkFromRow, offerIdsFromRow } from '@/utils/listingLink';
import { createLruTtlCache } from '@/utils/memoCache';
import { useReverseGeocodeAddresses } from '@/hooks/useReverseGeocodeAddresses';
import { ReverseGeocodePanel } from '@/components/ReverseGeocodePanel';

type SortDir = 'asc' | 'desc';

const REQUIRED_COLUMN_IDS = ['__price', '__address', '__link', '__area', '__rooms'] as const;
type RequiredColumnId = (typeof REQUIRED_COLUMN_IDS)[number];
type ColumnId = RequiredColumnId | string;

const REQUIRED_COLUMN_LABELS: Record<RequiredColumnId, string> = {
    __price: 'Цена',
    __address: 'Расположение',
    __link: 'Ссылка',
    __area: 'Общая площадь',
    __rooms: 'Количество комнат',
};

const LINK_CANDIDATES = ['Ссылка', 'URL', 'url', 'link', 'href'] as const;
const AREA_CANDIDATES = ['Общая площадь', 'area'] as const;
const ROOMS_CANDIDATES = ['Количество комнат', 'Комнаты', 'rooms'] as const;
const COMPARABLE_CACHE_SIZE = 30_000;
const COMPARABLE_CACHE_TTL_MS = 10 * 60 * 1000;
const IS_DEV = import.meta.env.DEV;

function isRequiredColumn(col: ColumnId): col is RequiredColumnId {
    return REQUIRED_COLUMN_IDS.includes(col as RequiredColumnId);
}

function inferOptionalColumns(summary: DataSummary): string[] {
    const excluded = new Set<string>([
        'Расположение',
        'Адрес',
        'address',
        ...LINK_CANDIDATES,
        ...AREA_CANDIDATES,
        ...ROOMS_CANDIDATES,
    ]);
    if (summary.coreColumnMap.price) excluded.add(summary.coreColumnMap.price);
    if (summary.coreColumnMap.area) excluded.add(summary.coreColumnMap.area);
    if (summary.coreColumnMap.rooms) excluded.add(summary.coreColumnMap.rooms);
    return summary.columnOrder.filter(col => !excluded.has(col));
}

function formatCellValue(raw: unknown, emptyFallback: string): string {
    if (raw == null || raw === '') return emptyFallback;
    if (typeof raw === 'number') return Number.isFinite(raw) ? formatNumber(raw) : emptyFallback;
    const text = String(raw).trim();
    if (!text) return emptyFallback;
    const numeric = Number.parseFloat(text.replace(',', '.'));
    if (Number.isFinite(numeric) && /^-?\d+([.,]\d+)?$/.test(text)) {
        return formatNumber(numeric);
    }
    return text;
}

function firstValue(row: DataRow, keys: readonly string[]): unknown {
    for (const key of keys) {
        const value = row[key];
        if (value != null && String(value).trim() !== '') return value;
    }
    return null;
}

function resolveCoords(row: DataRow): { lat: number; lng: number } | null {
    const lat = Number(row['Широта']);
    const lng = Number(row['Долгота']);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return parseGeolocationCell(row['Геолокация']);
}

function hasValidCoords(coords: { lat: number; lng: number } | null): coords is { lat: number; lng: number } {
    if (!coords) return false;
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
    if (coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) return false;
    if (coords.lat === 0 && coords.lng === 0) return false;
    return true;
}

function toComparableValue(value: string): string | number {
    const normalized = String(value).trim();
    if (!normalized) return '';
    const compact = normalized.replace(/\s/g, '');
    const numeric = Number.parseFloat(compact.replace(',', '.'));
    if (Number.isFinite(numeric) && /^-?\d+([.,]\d+)?$/.test(compact)) {
        return numeric;
    }
    return normalized;
}

type PreparedRow = {
    key: string;
    row: DataRow;
    link: string;
    mapsLink: string | null;
    reverseGeocodeKey: string | null;
    values: Record<RequiredColumnId, string>;
};

function perfNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function logPerf(label: string, startedAt: number, payload?: Record<string, unknown>): void {
    if (!IS_DEV) return;
    const elapsedMs = perfNow() - startedAt;
    if (elapsedMs < 3) return;
    // eslint-disable-next-line no-console
    console.info(`[perf] ${label}: ${elapsedMs.toFixed(1)}ms`, payload ?? {});
}

function requiredValue(row: DataRow, col: RequiredColumnId, summary: DataSummary, linkIndex: ReadonlyMap<string, string>): string {
    switch (col) {
        case '__price':
            return formatCellValue(
                summary.coreColumnMap.price ? row[summary.coreColumnMap.price] : row['Цена'],
                'Нет цены',
            );
        case '__area':
            return formatCellValue(
                summary.coreColumnMap.area ? row[summary.coreColumnMap.area] : firstValue(row, AREA_CANDIDATES),
                'Нет площади',
            );
        case '__rooms':
            return formatCellValue(
                summary.coreColumnMap.rooms ? row[summary.coreColumnMap.rooms] : firstValue(row, ROOMS_CANDIDATES),
                'Нет данных',
            );
        case '__link':
            return listingLinkFromRow(row, linkIndex) ?? '';
        case '__address':
            return sanitizeAddressValue(firstAddressValue(row)) ?? 'Адрес не определен';
    }
}

function displayCellValue(row: DataRow, col: string): string {
    return formatCellValue(row[col], '');
}

function comparableForSort(
    prepared: PreparedRow,
    col: ColumnId,
): string | number {
    if (isRequiredColumn(col)) return toComparableValue(prepared.values[col]);
    return toComparableValue(displayCellValue(prepared.row, col));
}

function buildRowKey(row: DataRow, fallbackIndex: number, link: string): string {
    const [firstOfferId] = offerIdsFromRow(row);
    if (link && firstOfferId) return `${link}#${firstOfferId}#${fallbackIndex}`;
    if (link) return `${link}#${fallbackIndex}`;
    if (firstOfferId) return `${firstOfferId}#${fallbackIndex}`;
    return `row-${fallbackIndex}`;
}

function buildReverseGeocodeKey(coords: { lat: number; lng: number } | null): string | null {
    if (!hasValidCoords(coords)) return null;
    return buildCanonicalReverseGeocodeKey(coords.lat, coords.lng)?.cacheKey ?? null;
}

function normalizeAddress(row: DataRow, coords: { lat: number; lng: number } | null): {
    displayAddress: string;
    reverseGeocodeKey: string | null;
} {
    const sanitizedAddress = sanitizeAddressValue(firstAddressValue(row));
    if (sanitizedAddress) {
        return {
            displayAddress: sanitizedAddress,
            reverseGeocodeKey: null,
        };
    }
    if (hasValidCoords(coords)) {
        return {
            displayAddress: 'Адрес не определен',
            reverseGeocodeKey: buildReverseGeocodeKey(coords),
        };
    }
    return {
        displayAddress: 'Адрес не определен',
        reverseGeocodeKey: null,
    };
}

function mapsUrlFromCoords(coords: { lat: number; lng: number } | null): string | null {
    if (!hasValidCoords(coords)) return null;
    return `https://yandex.ru/maps/?ll=${coords.lng},${coords.lat}&z=16&pt=${coords.lng},${coords.lat},pm2rdm`;
}

function columnLabel(col: ColumnId): string {
    if (isRequiredColumn(col)) return REQUIRED_COLUMN_LABELS[col];
    return col;
}

function downloadFile(content: string | Blob, filename: string, type?: string): void {
    const blob = typeof content === 'string' ? new Blob([content], { type: type ?? 'text/plain' }) : content;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export const FilteredListingsTable = React.memo(function FilteredListingsTable({
    data,
    summary,
    theme,
    filters,
    cityId,
    onToast,
}: {
    data: DataRow[];
    summary: DataSummary;
    theme: Theme;
    filters: FilterSettings;
    cityId?: CityId;
    onToast?: (message: string) => void;
}) {
    const { user, token } = useAuth();
    const optionalCols = useMemo(() => inferOptionalColumns(summary), [summary]);
    const linkIndex = useMemo(() => buildListingLinkIndex(data), [data]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [sortCol, setSortCol] = useState<ColumnId>(REQUIRED_COLUMN_IDS[0]);
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [visibleCols, setVisibleCols] = useState<ColumnId[]>(() => {
        return [...REQUIRED_COLUMN_IDS];
    });
    const comparableCacheRef = useRef(
        createLruTtlCache<string, string | number>({
            max: COMPARABLE_CACHE_SIZE,
            ttlMs: COMPARABLE_CACHE_TTL_MS,
        })
    );

    useEffect(() => {
        setPage(1);
    }, [data.length, filters]);

    useEffect(() => {
        setVisibleCols(prev => {
            const required = [...REQUIRED_COLUMN_IDS];
            const optional = prev.filter(col => !isRequiredColumn(col) && optionalCols.includes(col));
            return [...required, ...optional];
        });
        setSortCol(prev => {
            if (isRequiredColumn(prev)) return prev;
            return optionalCols.includes(prev) ? prev : REQUIRED_COLUMN_IDS[0];
        });
    }, [optionalCols]);

    const preparedRows = useMemo<PreparedRow[]>(() => {
        const startedAt = perfNow();
        const out: PreparedRow[] = [];
        for (let index = 0; index < data.length; index += 1) {
            const row = data[index];
            const link = listingLinkFromRow(row, linkIndex) ?? '';
            const coords = resolveCoords(row);
            const normalizedAddress = normalizeAddress(row, coords);
            out.push({
                key: buildRowKey(row, index, link),
                row,
                link,
                mapsLink: mapsUrlFromCoords(coords),
                reverseGeocodeKey: normalizedAddress.reverseGeocodeKey,
                values: {
                    __price: requiredValue(row, '__price', summary, linkIndex),
                    __address: normalizedAddress.displayAddress,
                    __area: requiredValue(row, '__area', summary, linkIndex),
                    __rooms: requiredValue(row, '__rooms', summary, linkIndex),
                    __link: link,
                },
            });
        }
        logPerf('table:prepareRows', startedAt, { rows: data.length });
        return out;
    }, [data, summary, linkIndex]);

    const reverseGeocodeCoordsByKey = useMemo(() => {
        const out = new Map<string, { lat: number; lng: number }>();
        for (const row of preparedRows) {
            if (!row.reverseGeocodeKey || out.has(row.reverseGeocodeKey)) continue;
            const coords = resolveCoords(row.row);
            if (!hasValidCoords(coords)) continue;
            out.set(row.reverseGeocodeKey, coords);
        }
        return out;
    }, [preparedRows]);

    const {
        resolveAddress,
        version: reverseAddressVersion,
        running: geocodeRunning,
        setRunning: setGeocodeRunning,
        progress: geocodeProgress,
    } = useReverseGeocodeAddresses(token, reverseGeocodeCoordsByKey, { autoStart: false });

    const sortAddressVersion = reverseAddressVersion;
    const sorted = useMemo(() => {
        const startedAt = perfNow();
        const withSortValue = preparedRows.map(prepared => ({
            prepared,
                    sortValue:
                sortCol === '__address' && prepared.reverseGeocodeKey
                    ? comparableCacheRef.current.getOrCompute(
                        `addr:${prepared.reverseGeocodeKey}:${resolveAddress(prepared.reverseGeocodeKey, prepared.values.__address)}:${reverseAddressVersion}`,
                        () =>
                            toComparableValue(
                                resolveAddress(prepared.reverseGeocodeKey, prepared.values.__address)
                            )
                    )
                    : comparableCacheRef.current.getOrCompute(
                        `col:${sortCol}:${isRequiredColumn(sortCol) ? prepared.values[sortCol] : displayCellValue(prepared.row, sortCol)}`,
                        () => comparableForSort(prepared, sortCol)
                    ),
        }));
        withSortValue.sort((a, b) => {
            const av = a.sortValue;
            const bv = b.sortValue;
            const an = typeof av === 'number' ? av : Number.parseFloat(String(av));
            const bn = typeof bv === 'number' ? bv : Number.parseFloat(String(bv));
            if (Number.isFinite(an) && Number.isFinite(bn)) {
                return sortDir === 'asc' ? an - bn : bn - an;
            }
            const as = String(av ?? '');
            const bs = String(bv ?? '');
            return sortDir === 'asc' ? as.localeCompare(bs, 'ru') : bs.localeCompare(as, 'ru');
        });
        const out = withSortValue.map(item => item.prepared);
        logPerf('table:sortRows', startedAt, { rows: preparedRows.length, sortCol, sortDir });
        return out;
    }, [preparedRows, sortCol, sortDir, sortAddressVersion, resolveAddress, reverseAddressVersion]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const pageData = useMemo(
        () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        [sorted, currentPage, pageSize]
    );

    const getCellText = useCallback((preparedRow: PreparedRow, col: ColumnId): string => {
        if (col === '__address') {
            return resolveAddress(preparedRow.reverseGeocodeKey, preparedRow.values.__address);
        }
        if (isRequiredColumn(col)) return preparedRow.values[col];
        return displayCellValue(preparedRow.row, col);
    }, [resolveAddress, reverseAddressVersion]);

    const exportCsv = useCallback(() => {
        const rows = sorted.map(row => {
            const out: Record<string, unknown> = {};
            for (const col of visibleCols) out[columnLabel(col)] = getCellText(row, col);
            return out;
        });
        const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows), { FS: ',', RS: '\n' });
        downloadFile(`\ufeff${csv}`, 'filtered_listings.csv', 'text/csv;charset=utf-8');
    }, [sorted, visibleCols, getCellText]);

    const exportXlsx = useCallback(() => {
        const rows = sorted.map(row => {
            const out: Record<string, unknown> = {};
            for (const col of visibleCols) out[columnLabel(col)] = getCellText(row, col);
            return out;
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Listings');
        const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        downloadFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'filtered_listings.xlsx');
    }, [sorted, visibleCols, getCellText]);

    const exportFromApi = useCallback(async () => {
        if (!token) return;
        const url = new URL(`${apiBaseUrl()}/api/export.csv`, window.location.origin);
        if (cityId) url.searchParams.set('city', cityId);
        url.searchParams.set('priceMin', String(filters.price.min));
        url.searchParams.set('priceMax', String(filters.price.max));
        url.searchParams.set('areaMin', String(filters.area.min));
        url.searchParams.set('areaMax', String(filters.area.max));
        url.searchParams.set('rooms', filters.rooms.join(','));
        url.searchParams.set('yearBuiltMin', String(filters.yearBuilt.min));
        url.searchParams.set('yearBuiltMax', String(filters.yearBuilt.max));
        url.searchParams.set('distanceKmMin', String(filters.distanceKm.min));
        url.searchParams.set('distanceKmMax', String(filters.distanceKm.max));
        url.searchParams.set('houseTypes', filters.houseTypes.join(','));
        url.searchParams.set('excludeFirstFloor', String(filters.excludeFirstFloor));
        url.searchParams.set('excludeLastFloor', String(filters.excludeLastFloor));
        if (filters.radiusKm != null) url.searchParams.set('radiusKm', String(filters.radiusKm));
        if (filters.additionalFilters.length > 0) {
            url.searchParams.set('additionalFilters', JSON.stringify(filters.additionalFilters));
        }
        try {
            const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
            if (!resp.ok) {
                const err = (await resp.json().catch(() => null)) as { error?: string } | null;
                onToast?.(err?.error ?? `Экспорт с сервера: ошибка ${resp.status}`);
                return;
            }
            const blob = await resp.blob();
            downloadFile(blob, 'filtered_listings_server.csv');
            onToast?.('CSV с сервера скачан');
        } catch {
            onToast?.('API недоступен — запустите npm run dev:api');
        }
    }, [token, cityId, filters, onToast]);

    const handleSortColChange = useCallback((value: string) => setSortCol(value as ColumnId), []);
    const handleSortDirChange = useCallback((value: string) => setSortDir(value as SortDir), []);
    const handlePageSizeChange = useCallback((value: string) => {
        setPageSize(Number(value));
        setPage(1);
    }, []);

    if (user?.role === 'observer') {
        return (
            <section className={themeClass(theme, { dark: 'rounded-3xl border border-zinc-800 bg-zinc-950/60 p-6', light: 'rounded-3xl border border-zinc-200 bg-white p-6' })}>
                <h3 className="text-lg font-semibold">Результаты объектов</h3>
                <p className={themeClass(theme, { dark: 'mt-2 text-sm text-zinc-400', light: 'mt-2 text-sm text-zinc-600' })}>
                    Для роли наблюдателя доступны графики и KPI; таблица строк и экспорт — только для аналитика и администратора.
                </p>
                <p className={themeClass(theme, { dark: 'mt-2 text-sm text-indigo-200/90', light: 'mt-2 text-sm text-indigo-800' })}>
                    По текущим фильтрам: {formatNumber(data.length)} объектов
                </p>
            </section>
        );
    }

    return (
        <section className={themeClass(theme, { dark: 'rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5', light: 'rounded-3xl border border-zinc-200 bg-white p-5' })}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold">Результаты поиска</h3>
                    <p className={themeClass(theme, { dark: 'text-xs text-zinc-400', light: 'text-xs text-zinc-600' })}>
                        {formatNumber(sorted.length)} объектов после очистки
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={exportCsv} className={themeClass(theme, { dark: 'rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800', light: 'rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50' })}>CSV</button>
                    <button type="button" onClick={exportXlsx} className={themeClass(theme, { dark: 'rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800', light: 'rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50' })}>XLSX</button>
                    {(user?.role === 'analyst' || user?.role === 'admin') && (
                        <button type="button" onClick={() => void exportFromApi()} className={themeClass(theme, { dark: 'rounded-lg border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10', light: 'rounded-lg border border-indigo-200 px-3 py-1.5 text-xs text-indigo-800 hover:bg-indigo-50' })}>
                            CSV c сервера
                        </button>
                    )}
                </div>
            </div>

            <ReverseGeocodePanel
                theme={theme}
                progress={geocodeProgress}
                running={geocodeRunning}
                onStart={() => setGeocodeRunning(true)}
                onStop={() => setGeocodeRunning(false)}
            />

            <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <label className="text-xs">
                    <span className="mb-1 block opacity-70">Сортировка</span>
                    <select value={sortCol} onChange={e => handleSortColChange(e.target.value)} className={themeClass(theme, { dark: 'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5', light: 'w-full rounded border border-zinc-200 bg-white px-2 py-1.5' })}>
                        {visibleCols.map(col => <option key={col} value={col}>{columnLabel(col)}</option>)}
                    </select>
                </label>
                <label className="text-xs">
                    <span className="mb-1 block opacity-70">Порядок</span>
                    <select value={sortDir} onChange={e => handleSortDirChange(e.target.value)} className={themeClass(theme, { dark: 'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5', light: 'w-full rounded border border-zinc-200 bg-white px-2 py-1.5' })}>
                        <option value="desc">По убыванию</option>
                        <option value="asc">По возрастанию</option>
                    </select>
                </label>
                <label className="text-xs">
                    <span className="mb-1 block opacity-70">Строк на странице</span>
                    <select value={pageSize} onChange={e => handlePageSizeChange(e.target.value)} className={themeClass(theme, { dark: 'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5', light: 'w-full rounded border border-zinc-200 bg-white px-2 py-1.5' })}>
                        {[20, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                </label>
            </div>

            <details className="mb-3">
                <summary className="cursor-pointer text-xs opacity-80">Видимые столбцы</summary>
                <div className="mt-2 grid max-h-36 grid-cols-2 gap-1 overflow-auto text-xs sm:grid-cols-3">
                    {[...REQUIRED_COLUMN_IDS, ...optionalCols].map(col => {
                        const checked = visibleCols.includes(col);
                        const disabled = isRequiredColumn(col);
                        return (
                            <label key={col} className="inline-flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={() =>
                                        setVisibleCols(prev =>
                                            checked ? prev.filter(v => v !== col) : [...prev, col]
                                        )
                                    }
                                />
                                <span>{columnLabel(col)}</span>
                            </label>
                        );
                    })}
                </div>
            </details>

            <div className="overflow-auto rounded-xl border border-zinc-200/30">
                <table className="min-w-full text-left text-xs">
                    <thead className={themeClass(theme, { dark: 'bg-zinc-900', light: 'bg-zinc-50' })}>
                        <tr>
                            {visibleCols.map(col => <th key={col} className="px-2 py-2">{columnLabel(col)}</th>)}
                            <th className="px-2 py-2">Карта</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageData.map(preparedRow => (
                            <tr key={preparedRow.key} className={themeClass(theme, { dark: 'border-t border-zinc-800', light: 'border-t border-zinc-200/70' })}>
                                {visibleCols.map(col => (
                                    <td key={col} className="max-w-[14rem] truncate px-2 py-1.5">
                                        {col === '__link' ? (
                                            preparedRow.link ? (
                                                <a
                                                    href={preparedRow.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-indigo-500 hover:underline"
                                                >
                                                    Открыть
                                                </a>
                                            ) : <span className="opacity-70">Ссылка недоступна</span>
                                        ) : (
                                            getCellText(preparedRow, col)
                                        )}
                                    </td>
                                ))}
                                <td className="px-2 py-1.5">
                                    {preparedRow.mapsLink ? (
                                        <a href={preparedRow.mapsLink} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Показать на карте</a>
                                    ) : <span className="opacity-70">Нет координат</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
                <span>Стр. {currentPage} из {totalPages}</span>
                <div className="flex gap-2">
                    <button type="button" disabled={currentPage <= 1} onClick={() => setPage(v => Math.max(1, v - 1))} className={themeClass(theme, { dark: 'rounded border border-zinc-700 px-2 py-1 disabled:opacity-50', light: 'rounded border border-zinc-200 px-2 py-1 disabled:opacity-50' })}>Назад</button>
                    <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(v => Math.min(totalPages, v + 1))} className={themeClass(theme, { dark: 'rounded border border-zinc-700 px-2 py-1 disabled:opacity-50', light: 'rounded border border-zinc-200 px-2 py-1 disabled:opacity-50' })}>Вперёд</button>
                </div>
            </div>
        </section>
    );
});
