export const MAX_SCATTER_POINTS = 1200;

export function sampleArray<T>(array: readonly T[], limit: number): T[] {
    if (array.length <= limit) {
        return array.slice() as T[];
    }

    const step = array.length / limit;
    const sampled: T[] = [];
    for (let i = 0; i < limit; i += 1) {
        sampled.push(array[Math.floor(i * step)]);
    }

    return sampled;
}
