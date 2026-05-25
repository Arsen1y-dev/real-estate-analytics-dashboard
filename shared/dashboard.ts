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
    yearBuilt: string | null;
    distanceKm: string | null;
    floor: string | null;
    firstFloor: string | null;
    lastFloor: string | null;
}

export interface ColumnInfo {
    name: string;
    kind: 'numeric' | 'categorical';
}

export type AdditionalNumberOperator = 'gte' | 'lte' | 'between';
export type AdditionalTextOperator = 'equals' | 'contains';
export type AdditionalFilterOperator = AdditionalNumberOperator | AdditionalTextOperator;

export interface AdditionalFilterCondition {
    id: string;
    column: string;
    operator: AdditionalFilterOperator;
    value: string;
    valueTo?: string;
}

export interface FilterSettings {
    price: Range;
    area: Range;
    rooms: number[];
    yearBuilt: Range;
    distanceKm: Range;
    floor: Range;
    houseTypes: string[];
    excludeFirstFloor: boolean;
    excludeLastFloor: boolean;
    radiusKm: number | null;
    additionalFilters: AdditionalFilterCondition[];
}

export interface CityCenter {
    lat: number;
    lng: number;
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
    yearBuilt: Range;
    distanceKm: Range;
    floor: Range;
    /** Центр города для карты и fallback расстояния */
    cityCenter?: CityCenter;
    /** id города датасета (server/data/cities/{id}) */
    cityId?: string;
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
    groupByColumn?: string;
}
