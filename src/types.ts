export type DataRow = Record<string, unknown>;

export interface Range {
    min: number;
    max: number;
}

export interface NumericRange {
    min: number;
    max: number;
}

/** Карта «стандартных» колонок для фильтров и сводки (если есть в CSV). */
export interface CoreColumnMap {
    price: string | null;
    area: string | null;
    rooms: string | null;
}

export interface ColumnInfo {
    name: string;
    kind: 'numeric' | 'categorical';
}

export interface FilterSettings {
    price: Range;
    area: Range;
    rooms: number[];
}

export interface DataSummary {
    /** Порядок столбцов как в первой строке CSV */
    columnOrder: string[];
    columns: ColumnInfo[];
    coreColumnMap: CoreColumnMap;
    price: Range;
    area: Range;
    rooms: number[];
    houseTypes: string[];
}

export type UserChartType = 'histogram' | 'scatter' | 'categoryBars';

export interface UserChartDefinition {
    id: string;
    type: UserChartType;
    title: string;
    /** Гистограмма или распределение по категориям */
    column: string;
    xColumn?: string;
    yColumn?: string;
}
