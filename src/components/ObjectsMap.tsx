import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon } from '@/components/icons';
import type { DataRow, DataSummary } from '@/types';
import type { Theme } from '@/theme';
import { themeClass } from '@/theme';
import { formatNumber } from '@/utils/format';
import { MAP_POINT_LIMIT_KEY } from '@/persistence/keys';
import { addressFromRow } from '@/domain/address';
import { useAuth } from '@/auth';
import { useReverseGeocodeAddresses } from '@/hooks/useReverseGeocodeAddresses';
import { buildCanonicalReverseGeocodeKey } from '../../shared/reverseGeocodeKey';
import { getCityProfile } from '../../shared/cities';
import { parseGeolocationCell } from '../../shared/geolocation';
import { mapListingLinkFromRow } from '@/utils/listingLink';
import {
    boundsFromLatLng,
    formatYmapsRuntimeError,
    getYandexMapsApiKey,
    latLngPointsForV21,
    loadYandexMaps,
    resetYandexMapsLoader,
    watchMapTileErrors,
    type Ymaps21Global,
    type Ymaps21Map,
    type Ymaps21Placemark,
} from '@/utils/yandexMapsLoader';

const MAP_POINT_LIMIT_LEVELS = [200, 500, 1000, 1500, 2000, 3000, 5000, 7000, 10000] as const;
const DEFAULT_MAP_POINT_LIMIT = 2000;
const MIN_MAP_POINT_LIMIT = MAP_POINT_LIMIT_LEVELS[0];
const MAX_MAP_POINT_LIMIT = MAP_POINT_LIMIT_LEVELS[MAP_POINT_LIMIT_LEVELS.length - 1];
const MAX_DISTANCE_FROM_CITY_CENTER_KM = 400;
const IS_DEV = import.meta.env.DEV;

type MapPoint = {
    lat: number;
    lng: number;
    address?: string;
    price?: string;
    rooms?: string;
    listingUrl?: string;
};

type PointBuildStats = {
    points: MapPoint[];
    rowsWithLink: number;
    missingCoords: number;
    tooFarFiltered: number;
};

function parseCoordinate(raw: unknown): number | null {
    if (raw === '' || raw == null) return null;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function coordsFromRow(row: DataRow): { lat: number; lng: number } | null {
    const lat = parseCoordinate(row['Широта']);
    const lng = parseCoordinate(row['Долгота']);
    if (lat != null && lng != null) {
        const inRange = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
        const nonZero = lat !== 0 || lng !== 0;
        if (inRange && nonZero) return { lat, lng };
    }
    return parseGeolocationCell(row['Геолокация']);
}

function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const c = sinLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinLng ** 2;
    const arc = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    return 6371 * arc;
}

function resolveCityCenter(summary: DataSummary): { lat: number; lng: number } | null {
    if (summary.cityCenter) return summary.cityCenter;
    const profile = summary.cityId ? getCityProfile(summary.cityId) : undefined;
    if (profile) return { lat: profile.centerLat, lng: profile.centerLng };
    return null;
}

function pointsFromRows(
    data: DataRow[],
    summary: DataSummary,
    coordsCache: WeakMap<DataRow, { lat: number; lng: number } | null>
): PointBuildStats {
    const priceCol = summary.coreColumnMap.price;
    const roomsCol = summary.coreColumnMap.rooms;
    const cityCenter = resolveCityCenter(summary);
    const points: MapPoint[] = [];
    let rowsWithLink = 0;
    let missingCoords = 0;
    let tooFarFiltered = 0;

    for (const row of data) {
        const listingUrl = mapListingLinkFromRow(row);
        if (!listingUrl) continue;
        rowsWithLink += 1;

        let coords = coordsCache.get(row);
        if (coords === undefined) {
            coords = coordsFromRow(row);
            coordsCache.set(row, coords);
        }
        if (!coords) {
            missingCoords += 1;
            continue;
        }
        if (cityCenter && haversineDistanceKm(coords, cityCenter) > MAX_DISTANCE_FROM_CITY_CENTER_KM) {
            tooFarFiltered += 1;
            continue;
        }

        const point: MapPoint = { lat: coords.lat, lng: coords.lng, listingUrl };

        const rowAddress = addressFromRow(row);
        point.address = rowAddress ?? undefined;
        if (priceCol) {
            const raw = row[priceCol];
            const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
            point.price = Number.isFinite(num) ? `${formatNumber(num)} ₽` : String(raw ?? '').trim() || undefined;
        }
        if (roomsCol) {
            const raw = row[roomsCol];
            const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
            point.rooms = Number.isFinite(num) ? `${formatNumber(num)} комн.` : String(raw ?? '').trim() || undefined;
        }

        points.push(point);
    }

    return { points, rowsWithLink, missingCoords, tooFarFiltered };
}

function samplePointsWithinLimit(points: MapPoint[], limit: number): MapPoint[] {
    if (points.length <= limit) return points;
    if (limit <= 0) return [];
    if (limit === 1) return [points[0]];
    const lastIndex = points.length - 1;
    const denominator = limit - 1;
    return Array.from({ length: limit }, (_, idx) => {
        const sourceIndex = Math.floor((idx * lastIndex) / denominator);
        return points[sourceIndex];
    });
}

function snapMapPointLimit(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MAP_POINT_LIMIT;
    const clamped = Math.min(MAX_MAP_POINT_LIMIT, Math.max(MIN_MAP_POINT_LIMIT, value));
    return MAP_POINT_LIMIT_LEVELS.reduce((best, level) =>
        Math.abs(level - clamped) < Math.abs(best - clamped) ? level : best,
    );
}

function loadMapPointLimit(): number {
    if (typeof window === 'undefined') return DEFAULT_MAP_POINT_LIMIT;
    try {
        const raw = window.localStorage.getItem(MAP_POINT_LIMIT_KEY);
        if (!raw) return DEFAULT_MAP_POINT_LIMIT;
        const parsed = Number.parseInt(raw, 10);
        return snapMapPointLimit(parsed);
    } catch {
        return DEFAULT_MAP_POINT_LIMIT;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function balloonLinkHtml(listingUrl: string | undefined, theme: Theme): string {
    const muted = theme === 'dark' ? '#71717a' : '#a1a1aa';
    const linkColor = theme === 'dark' ? '#a5b4fc' : '#4338ca';
    if (!listingUrl) {
        return `<div style="margin-top:6px;color:${muted};font-size:11px;">Ссылка недоступна</div>`;
    }
    const href = escapeHtml(listingUrl);
    return (
        `<div style="margin-top:6px;">` +
        `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:${linkColor};font-weight:600;font-size:12px;">Открыть объявление</a>` +
        `</div>`
    );
}

function placemarkHeader(point: MapPoint): string {
    const address = point.address?.trim();
    if (address) return address;
    const parts: string[] = [];
    if (point.price) parts.push(point.price);
    if (point.rooms) parts.push(point.rooms);
    return parts.join(' · ') || 'Объект';
}

function placemarkClusterCaption(point: MapPoint): string {
    const short = [point.price, point.rooms].filter(Boolean).join(' · ');
    if (short) return short;
    if (point.address) {
        return point.address.length > 48 ? `${point.address.slice(0, 45)}…` : point.address;
    }
    return 'Объект';
}

function placemarkBalloonBody(point: MapPoint, theme: Theme): string {
    const lines: string[] = [];
    if (point.address && (point.price || point.rooms)) {
        if (point.price) lines.push(`Цена: ${point.price}`);
        if (point.rooms) lines.push(`Комнаты: ${point.rooms}`);
    } else if (!point.address) {
        if (point.price) lines.push(`Цена: ${point.price}`);
        if (point.rooms) lines.push(`Комнаты: ${point.rooms}`);
    }
    const details = lines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
    return details + balloonLinkHtml(point.listingUrl, theme);
}

function createClusterBalloonLayout(ymaps: Ymaps21Global): unknown {
    return ymaps.templateLayoutFactory.createClass(
        [
            '<ul style="margin:0;padding:0 4px 0 0;list-style:none;max-height:240px;overflow-y:auto;">',
            '{% for geoObject in properties.geoObjects %}',
            '<li style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.08);">',
            '<div style="font-weight:600;font-size:13px;line-height:1.35;">{{ geoObject.properties.balloonContentHeader|raw }}</div>',
            '<div style="font-size:12px;line-height:1.45;margin-top:4px;">{{ geoObject.properties.balloonContentBody|raw }}</div>',
            '</li>',
            '{% endfor %}',
            '</ul>',
        ].join(''),
    );
}

function placemarkProperties(point: MapPoint, theme: Theme) {
    return {
        balloonContentHeader: placemarkHeader(point),
        balloonContentBody: placemarkBalloonBody(point, theme),
        clusterCaption: placemarkClusterCaption(point),
        hintContent: point.address?.trim() || placemarkClusterCaption(point),
    };
}

function initMap(
    host: HTMLDivElement,
    ymaps: Ymaps21Global,
    sampled: MapPoint[],
    bounds: ReturnType<typeof boundsFromLatLng>,
    theme: Theme,
    mapCenter: [number, number],
): { map: Ymaps21Map; clusterer: { removeAll: () => void } | null; placemarks: Ymaps21Placemark[] } {
    const coords = latLngPointsForV21(sampled);
    const center = coords[0] ?? mapCenter;

    const map = new ymaps.Map(
        host,
        { center, zoom: 10, controls: ['zoomControl', 'typeSelector'] },
        { suppressMapOpenBlock: true },
    );

    try {
        map.options.set('type', theme === 'dark' ? 'yandex#dark' : 'yandex#map');
    } catch {
        /* тип карты может быть недоступен для ключа */
    }

    const clusterBalloonContentLayout = createClusterBalloonLayout(ymaps);

    const placemarks = sampled.map(point => {
        return new ymaps.Placemark([point.lat, point.lng], placemarkProperties(point, theme), {
            preset: 'islands#violetDotIcon',
        });
    });

    let clusterer: { removeAll: () => void } | null = null;
    if (placemarks.length > 0) {
        clusterer = new ymaps.Clusterer({
            preset: 'islands#invertedVioletClusterIcons',
            groupByCoordinates: false,
            clusterDisableClickZoom: false,
            clusterDisableBalloon: false,
            clusterOpenBalloonOnClick: true,
            clusterBalloonPanelMaxMapArea: 0,
            clusterBalloonMaxHeight: 280,
            clusterBalloonMaxWidth: 340,
            clusterBalloonContentLayout,
        });
        clusterer.add(placemarks);
        map.geoObjects.add(clusterer);
    }

    if (coords.length > 1) {
        map.setBounds(ymaps.util.bounds.fromPoints(coords), { checkZoomRange: true, duration: 0 });
    } else if (bounds) {
        const [[minLng, minLat], [maxLng, maxLat]] = bounds;
        map.setBounds(
            ymaps.util.bounds.fromPoints([
                [minLat, minLng],
                [maxLat, maxLng],
            ]),
            { checkZoomRange: true, duration: 0 },
        );
    }

    return { map, clusterer, placemarks };
}

function ExpandMapIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
        </svg>
    );
}

export const ObjectsMap = React.memo(function ObjectsMap({
    /** Строки для маркеров (уже после фильтров дашборда). */
    markerData,
    summary,
    theme,
}: {
    markerData: DataRow[];
    summary: DataSummary;
    theme: Theme;
}) {
    const { token } = useAuth();
    const mapHostRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Ymaps21Map | null>(null);
    const clustererRef = useRef<{ removeAll: () => void } | null>(null);
    const placemarksRef = useRef<Ymaps21Placemark[]>([]);
    const apiKey = getYandexMapsApiKey();
    const [expanded, setExpanded] = useState(false);
    const [mapError, setMapError] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [mapPointLimit, setMapPointLimit] = useState<number>(() => loadMapPointLimit());
    const coordsCacheRef = useRef(new WeakMap<DataRow, { lat: number; lng: number } | null>());

    const mapStats = useMemo(() => {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const stats = pointsFromRows(markerData, summary, coordsCacheRef.current);
        if (IS_DEV) {
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
            if (elapsed > 3) {
                // eslint-disable-next-line no-console
                console.info('[perf] map:points-build', {
                    rowsIn: markerData.length,
                    points: stats.points.length,
                    elapsedMs: Number(elapsed.toFixed(1)),
                });
            }
        }
        return stats;
    }, [markerData, summary]);
    const points = mapStats.points;
    const reverseGeocodeCoordsByKey = useMemo(() => {
        const out = new Map<string, { lat: number; lng: number }>();
        for (const point of points) {
            if (point.address?.trim()) continue;
            const key = buildCanonicalReverseGeocodeKey(point.lat, point.lng)?.cacheKey;
            if (!key || out.has(key)) continue;
            out.set(key, { lat: point.lat, lng: point.lng });
        }
        return out;
    }, [points]);
    const { resolveAddress, version: reverseAddressVersion } = useReverseGeocodeAddresses(token, reverseGeocodeCoordsByKey, {
        autoStart: true,
    });
    const rowsWithLink = mapStats.rowsWithLink;
    const renderedPointCount = Math.min(points.length, mapPointLimit);
    const hiddenByLimit = Math.max(points.length - mapPointLimit, 0);
    const sampledCoords = useMemo(
        () => samplePointsWithinLimit(points, renderedPointCount),
        [points, renderedPointCount],
    );
    const geocodedSampled = useMemo(() => {
        return sampledCoords.map(point => {
            const key = buildCanonicalReverseGeocodeKey(point.lat, point.lng)?.cacheKey;
            const fallback = point.address?.trim() || 'Адрес не определен';
            if (!key || point.address?.trim()) return { ...point, address: fallback };
            return { ...point, address: resolveAddress(key, fallback) };
        });
    }, [sampledCoords, resolveAddress, reverseAddressVersion]);
    const sampledGeometryKey = useMemo(
        () => sampledCoords.map(point => `${point.lat},${point.lng},${point.listingUrl ?? ''}`).join('|'),
        [sampledCoords],
    );
    const pointCountLabelParts = [`На карте: ${sampledCoords.length}`];
    if (hiddenByLimit > 0) pointCountLabelParts.push(`${hiddenByLimit} скрыто лимитом`);
    if (mapStats.tooFarFiltered > 0) pointCountLabelParts.push(`${mapStats.tooFarFiltered} вне радиуса`);
    const pointCountLabel = pointCountLabelParts.join(' · ');

    const bounds = useMemo(() => boundsFromLatLng(sampledCoords), [sampledCoords]);
    const mapCenter = useMemo((): [number, number] => {
        const c = resolveCityCenter(summary);
        if (c) return [c.lat, c.lng];
        return [55.7558, 37.6176];
    }, [summary]);

    useEffect(() => {
        if (!expanded) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setExpanded(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [expanded]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(MAP_POINT_LIMIT_KEY, String(mapPointLimit));
        } catch {
            /* localStorage может быть недоступен */
        }
    }, [mapPointLimit]);

    useEffect(() => {
        if (!expanded) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [expanded]);

    useEffect(() => {
        if (!apiKey || !mapHostRef.current || sampledCoords.length === 0) return;

        let cancelled = false;
        let stopTileWatch: (() => void) | undefined;

        setMapError(null);
        setMapReady(false);

        loadYandexMaps(apiKey)
            .then(ymaps => {
                if (cancelled || !mapHostRef.current) return;

                const host = mapHostRef.current;
                clustererRef.current?.removeAll();
                mapRef.current?.destroy();
                mapRef.current = null;
                clustererRef.current = null;
                placemarksRef.current = [];
                host.replaceChildren();

                const { map, clusterer, placemarks } = initMap(
                    host,
                    ymaps,
                    geocodedSampled,
                    bounds,
                    theme,
                    mapCenter,
                );
                mapRef.current = map;
                clustererRef.current = clusterer;
                placemarksRef.current = placemarks;

                stopTileWatch = watchMapTileErrors(host, msg => {
                    if (!cancelled) setMapError(msg);
                });

                if (!cancelled) setMapReady(true);
            })
            .catch(err => {
                if (!cancelled) {
                    setMapError(err instanceof Error ? err.message : formatYmapsRuntimeError(err));
                }
            });

        return () => {
            cancelled = true;
            stopTileWatch?.();
            clustererRef.current?.removeAll();
            clustererRef.current = null;
            placemarksRef.current = [];
            mapRef.current?.destroy();
            mapRef.current = null;
        };
    }, [apiKey, sampledGeometryKey, bounds, theme, mapCenter, loadAttempt]);

    useEffect(() => {
        if (!mapReady || placemarksRef.current.length === 0) return;
        for (let index = 0; index < geocodedSampled.length; index += 1) {
            placemarksRef.current[index]?.properties.set(placemarkProperties(geocodedSampled[index], theme));
        }
    }, [mapReady, geocodedSampled, theme, reverseAddressVersion]);

    const fitMapToHost = () => {
        try {
            mapRef.current?.container?.fitToViewport();
        } catch {
            /* fitToViewport недоступен в части сборок API */
        }
    };

    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        fitMapToHost();
        const delays = expanded ? [0, 80, 200, 400] : [80];
        const timers = delays.map(ms => window.setTimeout(fitMapToHost, ms));
        return () => timers.forEach(t => window.clearTimeout(t));
    }, [expanded, mapReady]);

    useEffect(() => {
        if (!expanded || !mapReady || !mapHostRef.current) return;
        const host = mapHostRef.current;
        const ro = new ResizeObserver(() => fitMapToHost());
        ro.observe(host);
        return () => ro.disconnect();
    }, [expanded, mapReady]);

    const originHint =
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    const canShowMap = Boolean(apiKey && !mapError && points.length > 0);

    const mapPanelClass = expanded
        ? themeClass(theme, {
              dark: 'fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6',
              light: 'fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/25 p-3 backdrop-blur-sm sm:p-6',
          })
        : '';

    const mapFrameClass = expanded
        ? themeClass(theme, {
              dark: 'relative flex h-[min(92vh,900px)] max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-zinc-950 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.55)]',
              light: 'relative flex h-[min(92vh,900px)] max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/95 bg-white shadow-[0_24px_64px_-16px_rgba(0,0,0,0.12)]',
          })
        : themeClass(theme, {
              dark: 'relative h-[24rem] overflow-hidden rounded-2xl border border-zinc-700/60 bg-zinc-900/40',
              light: 'relative h-[24rem] overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50',
          });

    const mapBodyClass = expanded
        ? 'relative flex min-h-0 flex-1 flex-col p-4 sm:p-6'
        : 'relative h-full';

    const mapHostClass = expanded
        ? 'relative h-full min-h-0 w-full flex-1 min-h-[60vh]'
        : 'relative h-full w-full';

    const handleMapPointLimitChange = (nextValue: number) => {
        setMapPointLimit(snapMapPointLimit(nextValue));
    };

    return (
        <section
            className={themeClass(theme, {
                dark: 'rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5',
                light: 'rounded-3xl border border-zinc-200 bg-white p-5',
            })}
        >
            <div className="mb-4 space-y-2.5">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-3">
                    <h3 className="min-w-0 text-lg font-semibold">Карта объектов</h3>
                    <span
                        className={themeClass(theme, {
                            dark: 'min-w-0 text-xs leading-relaxed text-zinc-400 sm:text-sm md:text-right',
                            light: 'min-w-0 text-xs leading-relaxed text-zinc-600 sm:text-sm md:text-right',
                        })}
                    >
                        {pointCountLabel}
                    </span>
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        disabled={!canShowMap}
                        className={themeClass(theme, {
                            dark: 'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-zinc-700/90 bg-zinc-900/80 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-zinc-800 disabled:opacity-40 md:justify-self-end',
                            light: 'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-indigo-300 hover:bg-zinc-50 disabled:opacity-40 md:justify-self-end',
                        })}
                        aria-label="Открыть карту на весь экран"
                    >
                        <ExpandMapIcon />
                        <span>На весь экран</span>
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                    <span
                        className={themeClass(theme, {
                            dark: 'text-xs font-medium uppercase tracking-wide text-zinc-500',
                            light: 'text-xs font-medium uppercase tracking-wide text-zinc-500',
                        })}
                    >
                        Лимит точек
                    </span>
                    <input
                        type="range"
                        min={MIN_MAP_POINT_LIMIT}
                        max={MAX_MAP_POINT_LIMIT}
                        step={100}
                        value={mapPointLimit}
                        onChange={e => handleMapPointLimitChange(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer accent-indigo-500"
                        aria-label="Лимит точек на карте"
                    />
                    <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_MAP_POINT_LIMIT}
                        max={MAX_MAP_POINT_LIMIT}
                        step={100}
                        value={mapPointLimit}
                        onChange={e => handleMapPointLimitChange(Number(e.target.value))}
                        className={themeClass(theme, {
                            dark: 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-right text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none sm:w-24',
                            light: 'w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-right text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none sm:w-24',
                        })}
                        aria-label="Лимит точек числом"
                    />
                </div>
            </div>

            {!canShowMap && (
                <>
                    {!apiKey ? (
                        <div
                            className={themeClass(theme, {
                                dark: 'flex h-[24rem] flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 px-6 text-center text-sm text-zinc-400',
                                light: 'flex h-[24rem] flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-6 text-center text-sm text-zinc-600',
                            })}
                        >
                            <p>Для карты нужен API-ключ Yandex Maps.</p>
                            <p className="text-xs opacity-80">
                                Создайте файл <code className="font-mono">.env</code> с{' '}
                                <code className="font-mono">VITE_YANDEX_MAPS_API_KEY=ваш_ключ</code> (ключ JavaScript API
                                2.1), в кабинете Яндекса укажите Referer <code className="font-mono">{originHint}</code>{' '}
                                и перезапустите <code className="font-mono">npm run dev</code>.
                            </p>
                        </div>
                    ) : mapError ? (
                        <div
                            className={themeClass(theme, {
                                dark: 'flex h-[24rem] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 px-6 text-center text-sm text-red-300',
                                light: 'flex h-[24rem] flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-6 text-center text-sm text-red-600',
                            })}
                        >
                            <p className="font-medium">Карта недоступна</p>
                            <p className="max-w-md">{mapError}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    resetYandexMapsLoader(apiKey);
                                    setMapError(null);
                                    setMapReady(false);
                                    setLoadAttempt(n => n + 1);
                                }}
                                className={themeClass(theme, {
                                    dark: 'rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700',
                                    light: 'rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50',
                                })}
                            >
                                Повторить загрузку
                            </button>
                        </div>
                    ) : (
                        <div
                            className={themeClass(theme, {
                                dark: 'flex h-[24rem] flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/40 px-6 text-center text-sm text-zinc-400',
                                light: 'flex h-[24rem] flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-6 text-center text-sm text-zinc-600',
                            })}
                        >
                            <p>
                                На карте нечего показать: среди отфильтрованных объявлений нет ни одного с координатами
                                и ссылкой на карточку.
                                {rowsWithLink > 0 && (
                                    <>
                                        {' '}
                                        Со ссылкой — {rowsWithLink}, без координат — {mapStats.missingCoords}, слишком
                                        далеко от центра города (&gt;{MAX_DISTANCE_FROM_CITY_CENTER_KM} км) —{' '}
                                        {mapStats.tooFarFiltered}.
                                    </>
                                )}
                            </p>
                            {rowsWithLink > 0 && points.length === 0 && (
                                <p className="text-xs opacity-80">
                                    Часто координаты и ссылка лежат в разных строках CSV или «Геолокация» записана
                                    неполной. Обновите датасет с сервера или переимпортируйте файл после ETL — при
                                    загрузке строки склеиваются по ID объявления.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            {canShowMap && (
                <div
                    className={expanded ? mapPanelClass : undefined}
                    role={expanded ? 'presentation' : undefined}
                    onClick={expanded ? () => setExpanded(false) : undefined}
                >
                    <div
                        role={expanded ? 'dialog' : undefined}
                        aria-modal={expanded || undefined}
                        aria-labelledby={expanded ? 'objects-map-expand-title' : undefined}
                        className={mapFrameClass}
                        onClick={expanded ? e => e.stopPropagation() : undefined}
                    >
                        {expanded && (
                            <div
                                className={themeClass(theme, {
                                    dark: 'flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6 sm:py-4',
                                    light: 'flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4',
                                })}
                            >
                                <div className="min-w-0">
                                    <h2
                                        id="objects-map-expand-title"
                                        className={themeClass(theme, {
                                            dark: 'font-display text-base font-semibold text-zinc-50 sm:text-lg',
                                            light: 'font-display text-base font-semibold text-zinc-900 sm:text-lg',
                                        })}
                                    >
                                        Карта объектов
                                    </h2>
                                    <p
                                        className={themeClass(theme, {
                                            dark: 'mt-1 text-xs text-zinc-400',
                                            light: 'mt-1 text-xs text-zinc-600',
                                        })}
                                    >
                                        {pointCountLabel}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setExpanded(false)}
                                    className={themeClass(theme, {
                                        dark: 'shrink-0 rounded-xl p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100',
                                        light: 'shrink-0 rounded-xl p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900',
                                    })}
                                    aria-label="Закрыть"
                                >
                                    <CloseIcon />
                                </button>
                            </div>
                        )}
                        <div className={mapBodyClass}>
                            <div ref={mapHostRef} className={mapHostClass} />
                            {!mapReady && (
                                <div
                                    className={themeClass(theme, {
                                        dark: 'absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-sm text-zinc-400',
                                        light: 'absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-zinc-600',
                                    })}
                                >
                                    Загружаем карту…
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
});
