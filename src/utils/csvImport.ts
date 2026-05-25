import Papa from 'papaparse';
import type { DataRow, DataSummary } from '@/types';
import { tryGetDatasetForFile, saveCachedDataset } from '@/cache';
import { buildDataSummary, collectHouseType, normalizeCell, refreshSummaryFromData, rowHasAnyValue } from '@/domain/dataset';
import { yieldToMain } from '@/utils/yieldToMain';

/** ~5× больше штатного processed_apartment_data.csv в репозитории */
export const MAX_CSV_BYTES = 20 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;
const ROW_PROCESS_CHUNK = 400;

function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

async function processRawRows(
    rawData: Record<string, unknown>[],
    columnOrder: string[],
    houseTypeCols: string[]
): Promise<DataRow[]> {
    const processed: DataRow[] = [];
    for (let i = 0; i < rawData.length; i += ROW_PROCESS_CHUNK) {
        const end = Math.min(i + ROW_PROCESS_CHUNK, rawData.length);
        for (let j = i; j < end; j += 1) {
            const row = rawData[j];
            const out: DataRow = {};
            for (const k of columnOrder) {
                out[k] = normalizeCell(row[k]);
            }
            out.houseType = collectHouseType(row, houseTypeCols);
            if (rowHasAnyValue(out)) processed.push(out);
        }
        if (end < rawData.length) await yieldToMain();
    }
    return processed;
}

async function parseAndProcessFile(file: File): Promise<{ data: DataRow[]; summary: DataSummary } | { error: string }> {
    if (file.size > MAX_CSV_BYTES) {
        return {
            error: `Файл слишком большой (${formatSize(file.size)}). Максимум ${formatSize(MAX_CSV_BYTES)}.`,
        };
    }

    const parsed = await new Promise<Papa.ParseResult<Record<string, unknown>> | { error: string }>(resolve => {
        Papa.parse<Record<string, unknown>>(file, {
            header: true,
            skipEmptyLines: true,
            // worker: true ломается в Vite (воркер не стартует → вечный «загрузка»)
            worker: false,
            complete: results => resolve(results),
            error: err => resolve({ error: err.message }),
        });
    });

    if ('error' in parsed) {
        return { error: parsed.error };
    }

    const rawData = parsed.data;
    if (rawData.length > MAX_CSV_ROWS) {
        return {
            error: `Слишком много строк (${rawData.length.toLocaleString('ru-RU')}). Максимум ${MAX_CSV_ROWS.toLocaleString('ru-RU')}.`,
        };
    }

    await yieldToMain();

    const first = rawData[0] || {};
    const columnOrder = Object.keys(first);
    const houseTypeCols = columnOrder.filter(k => k.startsWith('тип_дома_'));
    const processedData = await processRawRows(rawData, columnOrder, houseTypeCols);

    if (processedData.length === 0) {
        return { error: 'Не удалось обработать данные. Проверьте формат CSV файла.' };
    }

    await yieldToMain();
    const order = Object.keys(processedData[0] ?? {});
    const summary = buildDataSummary(processedData, order);
    return { data: processedData, summary };
}

export function importCsvFile(
    file: File,
    onDataLoaded: (data: DataRow[], summary: DataSummary) => void,
    setLoading: (loading: boolean) => void
): void {
    const fromCache = tryGetDatasetForFile(file);
    setLoading(true);

    void (async () => {
        await yieldToMain();

        if (fromCache) {
            onDataLoaded(fromCache.data, refreshSummaryFromData(fromCache.data, fromCache.summary));
            setLoading(false);
            return;
        }

        try {
            const result = await parseAndProcessFile(file);
            if ('error' in result) {
                alert(result.error);
                setLoading(false);
                return;
            }

            onDataLoaded(result.data, result.summary);
            window.setTimeout(() => saveCachedDataset(file, result.data, result.summary), 0);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Неизвестная ошибка';
            alert(`Ошибка при загрузке файла: ${message}`);
        } finally {
            setLoading(false);
        }
    })();
}
