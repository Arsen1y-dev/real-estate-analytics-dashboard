import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReverseGeocodeProgress, reverseGeocodeByCoords } from '@/api/geocode';
import { normalizeReverseGeocodeKey } from '../../shared/reverseGeocodeKey';

const REVERSE_GEOCODE_CONCURRENCY = 3;
const REVERSE_GEOCODE_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const REVERSE_GEOCODE_FLUSH_MS = 140;

export type ReverseGeocodeHookProgress = {
    total: number;
    resolved: number;
    queued: number;
    inFlight: number;
};

export function useReverseGeocodeAddresses(
    token: string | null,
    coordsByKey: ReadonlyMap<string, { lat: number; lng: number }>,
    options?: { autoStart?: boolean }
): {
    resolveAddress: (key: string | null | undefined, fallback: string) => string;
    version: number;
    running: boolean;
    setRunning: (next: boolean) => void;
    progress: ReverseGeocodeHookProgress;
} {
    const autoStart = options?.autoStart ?? false;
    const [version, setVersion] = useState(0);
    const [running, setRunning] = useState(autoStart);
    const [queueStats, setQueueStats] = useState({ queued: 0, inFlight: 0 });
    const addressCacheRef = useRef<Record<string, string>>({});
    const queueRef = useRef<string[]>([]);
    const queuedRef = useRef<Set<string>>(new Set());
    const inFlightRef = useRef<Set<string>>(new Set());
    const activeCountRef = useRef(0);
    const failedUntilRef = useRef<Map<string, number>>(new Map());
    const flushTimerRef = useRef<number | null>(null);
    const [snapshotReady, setSnapshotReady] = useState(false);

    const keys = useMemo(() => Array.from(coordsByKey.keys()).sort(), [coordsByKey]);

    const aliasKeysByCanonical = useMemo(() => {
        const out = new Map<string, string[]>();
        for (const key of keys) {
            const canonical = normalizeReverseGeocodeKey(key)?.cacheKey ?? key;
            const existing = out.get(canonical);
            if (existing) {
                existing.push(key);
            } else {
                out.set(canonical, [key]);
            }
        }
        return out;
    }, [keys]);

    const syncQueueStats = useCallback(() => {
        setQueueStats({
            queued: queueRef.current.length + queuedRef.current.size,
            inFlight: inFlightRef.current.size,
        });
    }, []);

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current != null) return;
        flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            setVersion(v => v + 1);
            syncQueueStats();
        }, REVERSE_GEOCODE_FLUSH_MS);
    }, [syncQueueStats]);

    useEffect(
        () => () => {
            if (flushTimerRef.current != null) {
                window.clearTimeout(flushTimerRef.current);
            }
        },
        []
    );

    useEffect(() => {
        if (autoStart) setRunning(true);
    }, [autoStart]);

    const purgeQueuedKey = useCallback((key: string) => {
        queuedRef.current.delete(key);
        if (queueRef.current.length === 0) return;
        queueRef.current = queueRef.current.filter(queuedKey => queuedKey !== key);
    }, []);

    const pumpQueue = useCallback(() => {
        if (!token || !running) {
            syncQueueStats();
            return;
        }
        while (activeCountRef.current < REVERSE_GEOCODE_CONCURRENCY && queueRef.current.length > 0) {
            const key = queueRef.current.shift();
            if (!key) continue;
            if (addressCacheRef.current[key]) {
                purgeQueuedKey(key);
                scheduleFlush();
                continue;
            }
            const coords = coordsByKey.get(key);
            if (!coords) {
                purgeQueuedKey(key);
                continue;
            }
            activeCountRef.current += 1;
            inFlightRef.current.add(key);
            syncQueueStats();
            void reverseGeocodeByCoords(token, coords.lat, coords.lng)
                .then(result => {
                    if (result.ok) {
                        const responseKey = result.data.cacheKey || key;
                        const resolvedAddress = result.data.address?.trim() ?? '';
                        if (resolvedAddress) {
                            const canonical = normalizeReverseGeocodeKey(responseKey)?.cacheKey ?? responseKey;
                            const aliases = aliasKeysByCanonical.get(canonical) ?? [];
                            for (const alias of new Set([key, responseKey, ...aliases])) {
                                if (addressCacheRef.current[alias] !== resolvedAddress) {
                                    addressCacheRef.current[alias] = resolvedAddress;
                                    scheduleFlush();
                                }
                                purgeQueuedKey(alias);
                            }
                            failedUntilRef.current.delete(key);
                            return;
                        }
                        failedUntilRef.current.set(key, Date.now() + REVERSE_GEOCODE_FAILURE_COOLDOWN_MS);
                        return;
                    }
                    failedUntilRef.current.set(key, Date.now() + REVERSE_GEOCODE_FAILURE_COOLDOWN_MS);
                })
                .finally(() => {
                    activeCountRef.current = Math.max(0, activeCountRef.current - 1);
                    purgeQueuedKey(key);
                    inFlightRef.current.delete(key);
                    syncQueueStats();
                    if (running && queueRef.current.length > 0) {
                        queueMicrotask(() => {
                            pumpQueue();
                        });
                    }
                });
        }
        syncQueueStats();
    }, [token, coordsByKey, aliasKeysByCanonical, purgeQueuedKey, scheduleFlush, running, syncQueueStats]);

    useEffect(() => {
        if (!token) {
            setSnapshotReady(false);
            return;
        }
        if (keys.length === 0) {
            setSnapshotReady(true);
            return;
        }
        let cancelled = false;
        setSnapshotReady(false);
        void fetchReverseGeocodeProgress(token, keys)
            .then(result => {
                if (cancelled) return;
                if (result.ok) {
                    let changed = false;
                    for (const [key, value] of Object.entries(result.data.byKey)) {
                        const canonical = normalizeReverseGeocodeKey(key)?.cacheKey ?? key;
                        const aliases = aliasKeysByCanonical.get(canonical) ?? [key];
                        if (!aliases.includes(key)) aliases.push(key);
                        if (value.source === 'cache' && value.address.trim()) {
                            for (const aliasKey of aliases) {
                                if (addressCacheRef.current[aliasKey] !== value.address) {
                                    addressCacheRef.current[aliasKey] = value.address;
                                    changed = true;
                                }
                                failedUntilRef.current.delete(aliasKey);
                                purgeQueuedKey(aliasKey);
                            }
                        }
                    }
                    if (changed) scheduleFlush();
                }
                setSnapshotReady(true);
            })
            .catch(() => {
                if (!cancelled) setSnapshotReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [token, keys, aliasKeysByCanonical, purgeQueuedKey, scheduleFlush]);

    const enqueueMissingKeys = useCallback(() => {
        if (!token) return;
        const now = Date.now();
        for (const key of keys) {
            if (addressCacheRef.current[key]) continue;
            if (queuedRef.current.has(key) || inFlightRef.current.has(key)) continue;
            const failedUntil = failedUntilRef.current.get(key) ?? 0;
            if (failedUntil > now) continue;
            queuedRef.current.add(key);
            queueRef.current.push(key);
        }
        syncQueueStats();
        pumpQueue();
    }, [token, keys, pumpQueue, syncQueueStats]);

    useEffect(() => {
        if (!token || !snapshotReady || !running) return;
        enqueueMissingKeys();
    }, [token, keys, snapshotReady, running, enqueueMissingKeys]);

    const handleSetRunning = useCallback(
        (next: boolean) => {
            setRunning(next);
            if (!next) {
                queueRef.current = [];
                queuedRef.current.clear();
                syncQueueStats();
                return;
            }
            if (snapshotReady) {
                enqueueMissingKeys();
            }
        },
        [enqueueMissingKeys, snapshotReady, syncQueueStats]
    );

    useEffect(() => {
        if (running) pumpQueue();
    }, [running, pumpQueue]);

    const resolveAddress = useCallback((key: string | null | undefined, fallback: string): string => {
        if (!key) return fallback;
        return addressCacheRef.current[key] ?? fallback;
    }, []);

    const progress = useMemo((): ReverseGeocodeHookProgress => {
        let resolved = 0;
        for (const key of keys) {
            if (addressCacheRef.current[key]?.trim()) resolved += 1;
        }
        return {
            total: keys.length,
            resolved,
            queued: queueStats.queued,
            inFlight: queueStats.inFlight,
        };
    }, [keys, queueStats.inFlight, queueStats.queued, version]);

    return { resolveAddress, version, running, setRunning: handleSetRunning, progress };
}
