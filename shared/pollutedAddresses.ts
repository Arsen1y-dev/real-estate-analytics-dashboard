/**
 * Адреса, которые парсер ошибочно подхватывает с realty.yandex.ru (офис Яндекса и т.п.).
 * Такие значения отбрасываются — адрес берётся из reverse geocoding по координатам.
 */
export function isPollutedParserAddress(value: unknown): boolean {
    if (value == null) return false;
    const normalized = String(value).trim();
    if (!normalized) return false;
    const low = normalized.toLowerCase();
    return low.includes('садовническ') && /\b82\b/.test(low);
}
