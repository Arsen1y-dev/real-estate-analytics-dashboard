import Papa from 'papaparse';
import type { DataRow, DataSummary } from '@/types';
import { tryGetDatasetForFile, saveCachedDataset } from '@/cache';
import { buildDataSummary, collectHouseType, normalizeCell, rowHasAnyValue } from '@/domain/dataset';

export function importCsvFile(
    file: File,
    onDataLoaded: (data: DataRow[], summary: DataSummary) => void,
    setLoading: (loading: boolean) => void
): void {
    const fromCache = tryGetDatasetForFile(file);
    if (fromCache) {
        onDataLoaded(fromCache.data, fromCache.summary);
        return;
    }
    setLoading(true);
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        worker: true,
        fastMode: true,
        complete: (results: { data: Record<string, unknown>[] }) => {
            const rawData = results.data;
            const first = rawData[0] || {};
            const columnOrder = Object.keys(first);
            const houseTypeCols = columnOrder.filter(k => k.startsWith('тип_дома_'));

            const processedData: DataRow[] = rawData
                .map((row): DataRow => {
                    const out: DataRow = {};
                    for (const k of columnOrder) {
                        out[k] = normalizeCell(row[k]);
                    }
                    out.houseType = collectHouseType(row, houseTypeCols);
                    return out;
                })
                .filter(rowHasAnyValue);

            if (processedData.length > 0) {
                const order = Object.keys(processedData[0] ?? {});
                const summary = buildDataSummary(processedData, order);
                saveCachedDataset(file, processedData, summary);
                onDataLoaded(processedData, summary);
            } else {
                alert('Не удалось обработать данные. Проверьте формат CSV файла.');
            }
            setLoading(false);
        },
        error: (error: { message: string }) => {
            setLoading(false);
            alert(`Ошибка при парсинге файла: ${error.message}`);
        },
    });
}
