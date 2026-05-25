import type { ColumnInfo, DataSummary } from '@/types';

const TECHNICAL_COLUMN_RE =
    /(^|[\s_])(id|uuid|guid|url|uri|link|href|slug|hash|token|key|код|ид|ссылка|latitude|longitude|lat|lng|широт[аы]?|долгот[аы]?)([\s_]|$)/i;
const ADDRESS_LIKE_RE = /(^|[\s_])(address|адрес|улиц|street|дом|квартир|подъезд)([\s_]|$)/i;
const DISCRETE_NUMERIC_RE = /(^|[\s_])(комнат|rooms?|этаж|floor|year|год|первый|последний)([\s_]|$)/i;

function normalizeColumnName(name: string): string {
    return name
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isTechnicalChartColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return TECHNICAL_COLUMN_RE.test(normalized);
}

function isAddressLikeColumn(name: string): boolean {
    return ADDRESS_LIKE_RE.test(normalizeColumnName(name));
}

function looksLikeDiscreteNumeric(column: ColumnInfo, summary: DataSummary): boolean {
    if (column.kind !== 'numeric') return false;
    if (DISCRETE_NUMERIC_RE.test(normalizeColumnName(column.name))) return true;
    const { rooms, floor, yearBuilt, firstFloor, lastFloor } = summary.coreColumnMap;
    return [rooms, floor, yearBuilt, firstFloor, lastFloor].includes(column.name);
}

export function isHistogramColumnAllowed(column: ColumnInfo): boolean {
    return column.kind === 'numeric' && !isTechnicalChartColumn(column.name);
}

export function isScatterAxisColumnAllowed(column: ColumnInfo): boolean {
    return column.kind === 'numeric' && !isTechnicalChartColumn(column.name);
}

export function isCategoryBarsColumnAllowed(column: ColumnInfo, summary: DataSummary): boolean {
    if (column.name === 'houseType') return false;
    if (isTechnicalChartColumn(column.name) || isAddressLikeColumn(column.name)) return false;
    if (column.kind === 'categorical') return true;
    return looksLikeDiscreteNumeric(column, summary);
}

export function getHistogramColumns(summary: DataSummary): string[] {
    return summary.columns.filter(isHistogramColumnAllowed).map(c => c.name);
}

export function getScatterColumns(summary: DataSummary): string[] {
    return summary.columns.filter(isScatterAxisColumnAllowed).map(c => c.name);
}

export function getCategoryBarsColumns(summary: DataSummary): string[] {
    return summary.columns.filter(c => isCategoryBarsColumnAllowed(c, summary)).map(c => c.name);
}
