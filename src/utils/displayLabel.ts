const MULTISPACE_RE = /\s+/g;
const PREFIXES = [
    'тип дома',
    'вид сделки',
    'способ продажи',
    'санузел',
    'ремонт',
    'парковка',
    'окна',
    'двор',
];

function stripOuterQuotes(input: string): string {
    let s = input.trim();
    while (
        s.length >= 2 &&
        ((s.startsWith('"') && s.endsWith('"')) ||
            (s.startsWith("'") && s.endsWith("'")) ||
            (s.startsWith('`') && s.endsWith('`')))
    ) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function normalizeDisplayBase(input: string): string {
    return stripOuterQuotes(
        input
            .replace(/\r?\n+/g, ' · ')
            .replace(/["“”„‟`]+/g, '')
            .replace(/_/g, ' ')
            .replace(/\s*·\s*/g, ' · ')
            .replace(MULTISPACE_RE, ' ')
            .trim()
    );
}

function mapBooleanToken(s: string): string | null {
    const token = stripOuterQuotes(s).trim().toLowerCase();
    if (token === 'true') return 'Да';
    if (token === 'false') return 'Нет';
    return null;
}

function sentenceCase(input: string): string {
    const s = input.trim();
    if (!s) return s;
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

function withDomainPrefixColon(input: string): string {
    if (!input || input.includes(':')) return input;
    const lower = input.toLowerCase();
    for (const prefix of PREFIXES) {
        if (lower === prefix) {
            return sentenceCase(prefix);
        }
        if (lower.startsWith(`${prefix} `)) {
            const value = input.slice(prefix.length).trim();
            if (!value) return sentenceCase(prefix);
            return `${sentenceCase(prefix)}: ${value}`;
        }
    }
    return sentenceCase(input);
}

export function formatColumnLabel(raw: string): string {
    const normalized = normalizeDisplayBase(raw);
    if (!normalized) return raw;
    return withDomainPrefixColon(normalized);
}

export function formatCategoryValue(raw: unknown): string {
    if (raw == null) return '(пусто)';
    if (typeof raw === 'boolean') return raw ? 'Да' : 'Нет';
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return '(пусто)';
        return String(raw);
    }

    const text = String(raw).trim();
    if (!text) return '(пусто)';

    const bool = mapBooleanToken(text);
    if (bool) return bool;

    const normalized = normalizeDisplayBase(text);
    if (!normalized) return '(пусто)';
    return withDomainPrefixColon(normalized);
}

export function canonicalCategoryKey(raw: unknown): string {
    const display = formatCategoryValue(raw)
        .toLowerCase()
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*·\s*/g, '·')
        .replace(MULTISPACE_RE, ' ')
        .trim();
    return display || '(пусто)';
}

export function truncateDisplayLabel(label: string, maxLength: number): string {
    if (label.length <= maxLength) return label;
    if (maxLength <= 1) return '…';
    return `${label.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
