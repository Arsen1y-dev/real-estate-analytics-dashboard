import type { Theme } from '@/theme';

/** Градиенты карточек статистики — inline, чтобы работало с Tailwind CDN без safelist. */
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

const DARK: Record<StatGradientKey, string> = {
    count: 'linear-gradient(135deg, rgba(34,211,238,0.38) 0%, rgba(34,211,238,0.14) 42%, rgba(8,47,73,0.55) 100%)',
    priceMean: 'linear-gradient(135deg, rgba(139,92,246,0.38) 0%, rgba(139,92,246,0.15) 42%, rgba(59,7,100,0.5) 100%)',
    priceMedian: 'linear-gradient(135deg, rgba(59,130,246,0.38) 0%, rgba(59,130,246,0.14) 42%, rgba(23,37,84,0.52) 100%)',
    area: 'linear-gradient(135deg, rgba(16,185,129,0.38) 0%, rgba(16,185,129,0.14) 42%, rgba(6,78,59,0.52) 100%)',
    rpm2Mean: 'linear-gradient(135deg, rgba(217,70,239,0.4) 0%, rgba(192,38,211,0.22) 42%, rgba(88,28,135,0.52) 100%)',
    rpm2Median: 'linear-gradient(135deg, rgba(244,63,94,0.4) 0%, rgba(225,29,72,0.2) 42%, rgba(136,19,55,0.52) 100%)',
    extra0: 'linear-gradient(135deg, rgba(245,158,11,0.38) 0%, rgba(245,158,11,0.16) 42%, rgba(120,53,15,0.48) 100%)',
    extra1: 'linear-gradient(135deg, rgba(163,230,53,0.34) 0%, rgba(163,230,53,0.14) 42%, rgba(63,98,18,0.48) 100%)',
    extra2: 'linear-gradient(135deg, rgba(249,115,22,0.38) 0%, rgba(249,115,22,0.16) 42%, rgba(124,45,18,0.48) 100%)',
};

const LIGHT: Record<StatGradientKey, string> = {
    count: 'linear-gradient(135deg, rgba(34,211,238,0.32) 0%, rgba(165,243,252,0.55) 45%, rgba(236,254,255,0.95) 100%)',
    priceMean: 'linear-gradient(135deg, rgba(139,92,246,0.28) 0%, rgba(196,181,253,0.45) 45%, rgba(245,243,255,0.95) 100%)',
    priceMedian: 'linear-gradient(135deg, rgba(59,130,246,0.28) 0%, rgba(147,197,253,0.5) 45%, rgba(239,246,255,0.95) 100%)',
    area: 'linear-gradient(135deg, rgba(16,185,129,0.28) 0%, rgba(167,243,208,0.5) 45%, rgba(236,253,245,0.95) 100%)',
    rpm2Mean: 'linear-gradient(135deg, rgba(217,70,239,0.26) 0%, rgba(245,208,254,0.55) 45%, rgba(253,244,255,0.95) 100%)',
    rpm2Median: 'linear-gradient(135deg, rgba(244,63,94,0.26) 0%, rgba(254,205,211,0.55) 45%, rgba(255,241,242,0.95) 100%)',
    extra0: 'linear-gradient(135deg, rgba(245,158,11,0.26) 0%, rgba(253,230,138,0.55) 45%, rgba(255,251,235,0.95) 100%)',
    extra1: 'linear-gradient(135deg, rgba(163,230,53,0.24) 0%, rgba(217,249,157,0.5) 45%, rgba(247,254,231,0.95) 100%)',
    extra2: 'linear-gradient(135deg, rgba(249,115,22,0.26) 0%, rgba(254,215,170,0.55) 45%, rgba(255,247,237,0.95) 100%)',
};

export function statCardGradient(theme: Theme, key: StatGradientKey): string {
    return theme === 'dark' ? DARK[key] : LIGHT[key];
}
