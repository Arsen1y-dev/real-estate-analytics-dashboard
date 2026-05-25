const MOSCOW_LAT = 55.7558;
const MOSCOW_LNG = 37.6176;

export { MOSCOW_LAT, MOSCOW_LNG };

export interface Ymaps21Global {
    ready: (callback: () => void) => void;
    Map: new (
        element: HTMLElement,
        state: { center: number[]; zoom: number; controls?: string[] },
        options?: { suppressMapOpenBlock?: boolean },
    ) => Ymaps21Map;
    Placemark: new (
        coords: number[],
        properties?: {
            balloonContentBody?: string;
            balloonContentHeader?: string;
            balloonContentFooter?: string;
            clusterCaption?: string;
            hintContent?: string;
        },
        options?: { preset?: string },
    ) => Ymaps21Placemark;
    templateLayoutFactory: {
        createClass: (
            template: string,
            overrides?: Record<string, unknown>,
        ) => unknown;
    };
    Clusterer: new (options?: {
        preset?: string;
        groupByCoordinates?: boolean;
        clusterDisableClickZoom?: boolean;
        clusterDisableBalloon?: boolean;
        clusterOpenBalloonOnClick?: boolean;
        clusterBalloonPanelMaxMapArea?: number;
        clusterBalloonMaxHeight?: number;
        clusterBalloonMaxWidth?: number;
        clusterBalloonContentLayout?: unknown;
    }) => {
        add: (objects: unknown[]) => void;
        removeAll: () => void;
    };
    util: {
        bounds: {
            fromPoints: (points: number[][]) => number[][];
        };
    };
}

export interface Ymaps21Placemark {
    properties: {
        set: (props: {
            balloonContentBody?: string;
            balloonContentHeader?: string;
            balloonContentFooter?: string;
            clusterCaption?: string;
            hintContent?: string;
        }) => void;
    };
}

export interface Ymaps21Map {
    geoObjects: { add: (obj: unknown) => void; remove: (obj: unknown) => void };
    setBounds: (bounds: number[][], options?: { checkZoomRange?: boolean; duration?: number }) => void;
    destroy: () => void;
    options: { set: (key: string, value: string) => void };
    container?: { fitToViewport: () => void };
}

const DEFAULT_LOAD_TIMEOUT_MS = 18_000;

let loadPromise: Promise<Ymaps21Global> | null = null;
let loadGeneration = 0;

export function getYandexMapsApiKey(): string {
    return (import.meta.env.VITE_YANDEX_MAPS_API_KEY ?? '').trim();
}

export function ymaps21ScriptUrl(apiKey: string): string {
    return `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
}

/** Сброс кэша загрузки (кнопка «Повторить» на карте). */
export function resetYandexMapsLoader(apiKey?: string): void {
    loadPromise = null;
    loadGeneration += 1;
    if (apiKey?.trim()) {
        document.querySelector(`script[src="${ymaps21ScriptUrl(apiKey.trim())}"]`)?.remove();
        delete (window as Window & { ymaps?: Ymaps21Global }).ymaps;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(new Error(`${label}: превышено время ожидания (${Math.round(ms / 1000)} с)`));
        }, ms);

        promise.then(
            value => {
                window.clearTimeout(timer);
                resolve(value);
            },
            err => {
                window.clearTimeout(timer);
                reject(err);
            },
        );
    });
}

export function isInvalidApiKeyMessage(message: string): boolean {
    return /invalid\s*api\s*key/i.test(message) || message.toLowerCase().includes('api key');
}

/** Перевод типичных ошибок рантайма ymaps (в т.ч. «Load failed» на тайлах). */
export function formatYmapsRuntimeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    if (/превышено время ожидания/i.test(raw)) {
        return (
            'Карта не ответила вовремя (JavaScript API 2.1). ' +
            `Проверьте ключ и Referer ${origin} в кабинете Яндекса, перезапустите npm run dev и обновите страницу (Ctrl+Shift+R).`
        );
    }

    if (/load failed/i.test(raw)) {
        return (
            'Не удалось загрузить тайлы карты (Load failed). ' +
            `В кабинете Яндекса для ключа JavaScript API 2.1 укажите «Ограничение по HTTP Referer» и добавьте origin: ${origin}. ` +
            'localhost, 127.0.0.1 и IP-адрес Vite — разные Referer; откройте дашборд с того же URL, что в списке.'
        );
    }

    if (/invalid\s*api\s*key/i.test(raw)) {
        return (
            'Неверный или неактивированный API-ключ Yandex Maps. ' +
            'Создайте ключ JavaScript API 2.1, укажите VITE_YANDEX_MAPS_API_KEY в .env и перезапустите npm run dev.'
        );
    }

    if (/403|forbidden/i.test(raw)) {
        return (
            `Доступ к Yandex Maps запрещён${raw ? `: ${raw}` : ''}. ` +
            `Проверьте Referer для ${origin} в кабинете разработчика.`
        );
    }

    return raw || 'Не удалось инициализировать карту Yandex Maps';
}

function scriptAlreadyLoaded(src: string): boolean {
    const el = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (!el) return false;
    return el.readyState === 'complete' || el.readyState === 'loaded' || Boolean(el.getAttribute('data-loaded'));
}

function injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (scriptAlreadyLoaded(src)) {
            resolve();
            return;
        }

        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (existing) {
            const onLoad = () => {
                existing.setAttribute('data-loaded', '1');
                resolve();
            };
            const onError = () => reject(new Error('script error'));
            existing.addEventListener('load', onLoad, { once: true });
            existing.addEventListener('error', onError, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.setAttribute('data-loaded', '1');
            resolve();
        };
        script.onerror = () => reject(new Error('script error'));
        document.head.appendChild(script);
    });
}

async function waitYmaps21Ready(ymaps: Ymaps21Global, timeoutMs: number): Promise<Ymaps21Global> {
    await withTimeout(
        new Promise<void>((resolve, reject) => {
            try {
                ymaps.ready(resolve);
            } catch (err) {
                reject(err);
            }
        }),
        timeoutMs,
        'Yandex Maps 2.1',
    );
    return ymaps;
}

async function loadYmaps21Script(apiKey: string, timeoutMs: number): Promise<Ymaps21Global> {
    const w = window as Window & { ymaps?: Ymaps21Global };
    if (!w.ymaps) {
        await withTimeout(injectScript(ymaps21ScriptUrl(apiKey)), timeoutMs, 'Загрузка скрипта API 2.1');
    }

    if (!w.ymaps) {
        throw new Error('Yandex Maps API 2.1 не инициализировался (window.ymaps отсутствует)');
    }

    return waitYmaps21Ready(w.ymaps, timeoutMs);
}

/** Загрузка Yandex Maps JavaScript API 2.1. */
export function loadYandexMaps(apiKey: string, options?: { timeoutMs?: number }): Promise<Ymaps21Global> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Yandex Maps доступны только в браузере'));
    }

    const key = apiKey.trim();
    if (!key) {
        return Promise.reject(
            new Error('API-ключ не задан (VITE_YANDEX_MAPS_API_KEY). Перезапустите dev-сервер после правки .env.'),
        );
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    const generation = loadGeneration;

    if (!loadPromise) {
        loadPromise = withTimeout(loadYmaps21Script(key, timeoutMs), timeoutMs, 'Yandex Maps').catch(err => {
            if (generation === loadGeneration) {
                loadPromise = null;
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(formatYmapsRuntimeError(new Error(msg)));
        });
    }

    return loadPromise;
}

export type LngLat = [number, number];

/** Границы [[minLng, minLat], [maxLng, maxLat]] с отступом. */
export function boundsFromLatLng(points: { lat: number; lng: number }[]): [LngLat, LngLat] | null {
    if (!points.length) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of points) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
    }
    const padLat = Math.max((maxLat - minLat) * 0.08, 0.002);
    const padLng = Math.max((maxLng - minLng) * 0.08, 0.002);
    return [
        [minLng - padLng, minLat - padLat],
        [maxLng + padLng, maxLat + padLat],
    ];
}

/** Точки [lat, lng] для API 2.1. */
export function latLngPointsForV21(points: { lat: number; lng: number }[]): number[][] {
    return points.map(p => [p.lat, p.lng]);
}

/** Наблюдатель «Load failed» внутри контейнера карты (ошибка тайлов ymaps, не из нашего кода). */
export function watchMapTileErrors(container: HTMLElement, onError: (message: string) => void): () => void {
    const check = () => {
        const text = container.innerText ?? '';
        if (/load failed/i.test(text)) {
            onError(formatYmapsRuntimeError(new Error('Load failed')));
        }
    };

    const observer = new MutationObserver(check);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    check();

    return () => observer.disconnect();
}
