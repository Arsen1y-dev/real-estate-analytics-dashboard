type LruTtlCacheOptions = {
    max: number;
    ttlMs: number;
};

export type LruTtlCache<K, V> = {
    get: (key: K) => V | undefined;
    set: (key: K, value: V) => void;
    getOrCompute: (key: K, compute: () => V) => V;
    clear: () => void;
    size: () => number;
};

export function createLruTtlCache<K, V>(options: LruTtlCacheOptions): LruTtlCache<K, V> {
    const max = Math.max(1, Math.trunc(options.max));
    const ttlMs = Math.max(1, Math.trunc(options.ttlMs));
    const store = new Map<K, { value: V; expiresAt: number }>();

    const touch = (key: K, entry: { value: V; expiresAt: number }) => {
        store.delete(key);
        store.set(key, entry);
    };

    const sweepExpired = (now: number) => {
        for (const [key, entry] of store) {
            if (entry.expiresAt <= now) store.delete(key);
        }
    };

    const ensureLimit = () => {
        while (store.size > max) {
            const oldestKey = store.keys().next().value;
            if (oldestKey === undefined) return;
            store.delete(oldestKey);
        }
    };

    return {
        get(key) {
            const now = Date.now();
            const entry = store.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt <= now) {
                store.delete(key);
                return undefined;
            }
            touch(key, entry);
            return entry.value;
        },
        set(key, value) {
            const now = Date.now();
            sweepExpired(now);
            const entry = { value, expiresAt: now + ttlMs };
            touch(key, entry);
            ensureLimit();
        },
        getOrCompute(key, compute) {
            const cached = this.get(key);
            if (cached !== undefined) return cached;
            const computed = compute();
            this.set(key, computed);
            return computed;
        },
        clear() {
            store.clear();
        },
        size() {
            return store.size;
        },
    };
}
