const ONE_HOT_PREFIXES = [
    'санузел_',
    'окна_',
    'ремонт_',
    'тип_дома_',
    'парковка_',
    'вид_сделки_',
    'способ_продажи_',
] as const;

/** One-hot и бинарные признаки (0/1) — в UI выбор «Да/Нет», не ручной ввод. */
export function isBinaryFeatureColumn(name: string): boolean {
    if (ONE_HOT_PREFIXES.some(prefix => name.startsWith(prefix))) return true;
    if (name.startsWith('Двор_')) return true;
    if (name.endsWith('_есть')) return true;
    if (name === 'Первый_этаж' || name === 'Последний_этаж') return true;
    return false;
}

export function inferDatasetColumnKind(
    name: string,
    numericRatio: number
): 'numeric' | 'categorical' {
    if (name.startsWith('тип_дома_')) return 'categorical';
    if (isBinaryFeatureColumn(name)) return 'categorical';
    if (numericRatio >= 0.85) return 'numeric';
    return 'categorical';
}

export type AdditionalFilterInputKind = 'number' | 'binary' | 'categorical';

export function additionalFilterInputKind(
    column: string,
    summaryKind: 'numeric' | 'categorical' | undefined
): AdditionalFilterInputKind {
    if (isBinaryFeatureColumn(column)) return 'binary';
    if (summaryKind === 'numeric') return 'number';
    return 'categorical';
}
