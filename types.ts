
export interface ApartmentData {
  'Цена': number;
  'Количество комнат': number;
  'Общая площадь': number;
  'Расстояние до центра (км)': number;
  'houseType': string;
  [key: string]: any;
}

export interface Range {
  min: number;
  max: number;
}

export interface FilterSettings {
  price: Range;
  area: Range;
  rooms: number[];
}

export interface DataSummary {
  price: Range;
  area: Range;
  rooms: number[];
  houseTypes: string[];
}
