export function newChartId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `chart-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
