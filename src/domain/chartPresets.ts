import type { DataSummary, UserChartDefinition } from '@/types';
import { newChartId } from '@/utils/id';

export type ChartPresetId = 'priceDistribution' | 'priceVsArea' | 'roomsVsPrice';

export const CHART_PRESET_LABELS: Record<ChartPresetId, { title: string; hint: string }> = {
    priceDistribution: {
        title: 'Распределение цены',
        hint: 'Гистограмма по колонке цены',
    },
    priceVsArea: {
        title: 'Цена vs площадь',
        hint: 'Точечная диаграмма: площадь по оси X, цена по Y',
    },
    roomsVsPrice: {
        title: 'Комнаты vs цена',
        hint: 'Точечная диаграмма: комнаты по X, цена по Y (нужны числовые столбцы)',
    },
};

function columnKind(summary: DataSummary, name: string | null): 'numeric' | 'categorical' | null {
    if (!name) return null;
    return summary.columns.find(c => c.name === name)?.kind ?? null;
}

/** Одна визуализация по пресету или null, если в данных нет нужных столбцов. */
export function chartFromPreset(id: ChartPresetId, summary: DataSummary): UserChartDefinition | null {
    const { price, area, rooms } = summary.coreColumnMap;

    switch (id) {
        case 'priceDistribution': {
            if (!price || columnKind(summary, price) !== 'numeric') return null;
            return {
                id: newChartId(),
                type: 'histogram',
                column: price,
                title: CHART_PRESET_LABELS.priceDistribution.title,
            };
        }
        case 'priceVsArea': {
            if (!price || !area) return null;
            if (columnKind(summary, price) !== 'numeric' || columnKind(summary, area) !== 'numeric') return null;
            return {
                id: newChartId(),
                type: 'scatter',
                column: area,
                xColumn: area,
                yColumn: price,
                title: CHART_PRESET_LABELS.priceVsArea.title,
            };
        }
        case 'roomsVsPrice': {
            if (!price || !rooms) return null;
            if (columnKind(summary, price) !== 'numeric' || columnKind(summary, rooms) !== 'numeric') return null;
            return {
                id: newChartId(),
                type: 'scatter',
                column: rooms,
                xColumn: rooms,
                yColumn: price,
                title: CHART_PRESET_LABELS.roomsVsPrice.title,
            };
        }
        default:
            return null;
    }
}

export function isPresetAvailable(id: ChartPresetId, summary: DataSummary): boolean {
    return chartFromPreset(id, summary) !== null;
}

export const ALL_PRESET_IDS: ChartPresetId[] = ['priceDistribution', 'priceVsArea', 'roomsVsPrice'];
