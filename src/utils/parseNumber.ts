export function parseNumber(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value === 'string') {
        const cleaned = value
            .replace(/\u00A0/g, ' ')
            .replace(/[a-zA-Zа-яА-Я%₽$]/g, '')
            .replace(/\s+/g, '')
            .replace(',', '.');

        if (cleaned === '') {
            return NaN;
        }

        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    return NaN;
}
