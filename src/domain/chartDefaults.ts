import type { DataSummary, UserChartDefinition } from '@/types';
import { newChartId } from '@/utils/id';
import { chartFromPreset } from '@/domain/chartPresets';

/** Стартовый график: пресет «распределение цены» или первая числовая колонка. */
export function defaultChartsForSummary(summary: DataSummary): UserChartDefinition[] {
    const priceHist = chartFromPreset('priceDistribution', summary);
    if (priceHist) return [priceHist];
    const col = summary.columns.find(c => c.kind === 'numeric');
    if (!col) return [];
    return [{ id: newChartId(), type: 'histogram', title: col.name, column: col.name }];
}
