import type { ColorScheme, Theme } from '@/theme';
import { getRuntimeColorScheme } from '@/theme';

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

/** Минималистичная заливка карточки: нейтраль + акцент схемы. */
export function statCardSurface(theme: Theme, variant: 'hero' | 'secondary', scheme: ColorScheme = getRuntimeColorScheme()): string {
    if (scheme === 'helloKitty') {
        if (theme === 'dark') {
            return variant === 'hero'
                ? 'linear-gradient(165deg, rgba(244,114,182,0.12) 0%, rgba(76,5,25,0.92) 42%, rgba(62,8,27,0.98) 100%)'
                : 'linear-gradient(165deg, rgba(157,23,77,0.35) 0%, rgba(62,8,27,0.94) 100%)';
        }
        return variant === 'hero'
            ? 'linear-gradient(165deg, rgba(244,114,182,0.08) 0%, rgba(255,255,255,0.98) 55%, #ffffff 100%)'
            : 'linear-gradient(165deg, rgba(255,228,230,0.95) 0%, #ffffff 100%)';
    }
    if (scheme === 'green') {
        if (theme === 'dark') {
            return variant === 'hero'
                ? 'linear-gradient(165deg, rgba(52,211,153,0.1) 0%, rgba(6,78,59,0.92) 42%, rgba(2,44,34,0.98) 100%)'
                : 'linear-gradient(165deg, rgba(6,78,59,0.45) 0%, rgba(2,44,34,0.94) 100%)';
        }
        return variant === 'hero'
            ? 'linear-gradient(165deg, rgba(16,185,129,0.06) 0%, rgba(255,255,255,0.98) 55%, #ffffff 100%)'
            : 'linear-gradient(165deg, rgba(209,250,229,0.95) 0%, #ffffff 100%)';
    }
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
