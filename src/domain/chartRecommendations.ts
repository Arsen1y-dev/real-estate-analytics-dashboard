import type { DataSummary } from '@/types';

export type PriceRecommendation = {
    id: 'histogram-price' | 'scatter-price-area';
    title: string;
    description: string;
};

/**
 * Рекомендации при работе со столбцом цены (простая эвристика по coreColumnMap).
 */
export function getPriceColumnRecommendations(
    summary: DataSummary,
    opts: { areaAvailable: boolean; scatterAvailable: boolean }
): PriceRecommendation[] {
    const price = summary.coreColumnMap.price;
    if (!price) return [];

    const out: PriceRecommendation[] = [
        {
            id: 'histogram-price',
            title: 'Гистограмма цены',
            description: 'Покажет распределение и типичный диапазон стоимости.',
        },
    ];

    if (opts.areaAvailable && opts.scatterAvailable) {
        out.push({
            id: 'scatter-price-area',
            title: 'Точечный график: цена × площадь',
            description: 'Связь цены и площади по объектам выборки.',
        });
    }

    return out;
}

/** Текущий выбранный числовой столбец в режиме гистограммы. */
export function effectiveHistogramColumn(column: string, numericCols: string[]): string {
    return column || numericCols[0] || '';
}
