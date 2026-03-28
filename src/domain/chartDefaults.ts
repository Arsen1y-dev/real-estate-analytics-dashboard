import type { DataSummary, UserChartDefinition } from '@/types';
import { newChartId } from '@/utils/id';

/** Стартовый график: первая числовая колонка как гистограмма (если есть). */
export function defaultChartsForSummary(summary: DataSummary): UserChartDefinition[] {
    const col = summary.columns.find(c => c.kind === 'numeric');
    if (!col) return [];
    return [{ id: newChartId(), type: 'histogram', title: col.name, column: col.name }];
}
