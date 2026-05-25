import type { DataRow } from './dashboard';

/** Служебное поле строки — не экспортировать и не показывать в columnOrder. */
export const UPLOAD_BATCH_ID_FIELD = '__uploadBatchId';

export const INTERNAL_ROW_FIELDS = [UPLOAD_BATCH_ID_FIELD, 'houseType'] as const;

export type UploadMode = 'append' | 'replace';

export type DatasetUploadRecord = {
    batchId: string;
    at: string;
    fileName: string;
    added: number;
    skippedDuplicates: number;
    tooFarFiltered?: number;
    droppedInvalid?: number;
    mode: UploadMode;
};

export type DatasetMeta = {
    rowCount: number;
    updatedAt: string;
    lastFileName: string | null;
    uploads: DatasetUploadRecord[];
};

export function isInternalColumn(name: string): boolean {
    return (INTERNAL_ROW_FIELDS as readonly string[]).includes(name);
}

export function publicColumnOrderFromRows(rows: DataRow[], fallback: string[] = []): string[] {
    const keys = new Set<string>(fallback);
    for (const row of rows) {
        for (const k of Object.keys(row)) {
            if (!isInternalColumn(k)) keys.add(k);
        }
    }
    return [...keys];
}
