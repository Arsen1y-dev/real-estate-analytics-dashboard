import type { Theme } from '@/theme';

/** Ключи сохранены для логики KPI; визуально — одна нейтральная поверхность + лёгкий акцент. */
export type StatGradientKey =
    | 'count'
    | 'priceMean'
    | 'priceMedian'
    | 'area'
    | 'rpm2Mean'
    | 'rpm2Median'
    | 'extra0'
    | 'extra1'
    | 'extra2';

/** Минималистичная заливка карточки: нейтраль + лёгкий indigo (единый акцент). */
export function statCardSurface(theme: Theme, variant: 'hero' | 'secondary'): string {
    if (theme === 'dark') {
        return variant === 'hero'
            ? 'linear-gradient(165deg, rgba(99,102,241,0.09) 0%, rgba(24,24,27,0.92) 42%, rgba(9,9,11,0.98) 100%)'
            : 'linear-gradient(165deg, rgba(63,63,70,0.35) 0%, rgba(9,9,11,0.94) 100%)';
    }
    return variant === 'hero'
        ? 'linear-gradient(165deg, rgba(99,102,241,0.05) 0%, rgba(255,255,255,0.98) 55%, #ffffff 100%)'
        : 'linear-gradient(165deg, rgba(244,244,245,0.95) 0%, #ffffff 100%)';
}

/** @deprecated Используйте statCardSurface; ключ не влияет на цвет. */
export function statCardGradient(theme: Theme, _key: StatGradientKey): string {
    return statCardSurface(theme, 'secondary');
}
