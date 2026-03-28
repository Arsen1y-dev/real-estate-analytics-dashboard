import React, { useCallback, useState } from 'react';
import type { DataRow, DataSummary } from '@/types';
import { importCsvFile } from '@/utils/csvImport';

export const FileUpload: React.FC<{
    onDataLoaded: (data: DataRow[], summary: DataSummary) => void;
    setLoading: (loading: boolean) => void;
}> = ({ onDataLoaded, setLoading }) => {
    const [dragActive, setDragActive] = useState(false);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            importCsvFile(file, onDataLoaded, setLoading);
        }
        event.target.value = '';
    };

    const onDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
    }, []);

    const onDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    }, []);

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (!file) return;
            const name = file.name.toLowerCase();
            if (!name.endsWith('.csv')) {
                window.alert('Нужен файл с расширением .csv');
                return;
            }
            importCsvFile(file, onDataLoaded, setLoading);
        },
        [onDataLoaded, setLoading]
    );

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16">
            <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`w-full max-w-md rounded-3xl border border-dashed px-8 py-12 text-center shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)] transition-colors sm:px-12 ${
                    dragActive
                        ? 'border-indigo-400/80 bg-indigo-500/[0.08]'
                        : 'border-zinc-700/80 bg-zinc-900/40'
                }`}
            >
                <svg className="mx-auto h-12 w-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <h2 className="font-display mt-6 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">Загрузите CSV</h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                    Перетащите файл сюда или выберите с диска — дашборд построится по столбцам автоматически.
                </p>
                <div className="mt-10">
                    <label
                        htmlFor="file-upload"
                        className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                        <span>Выбрать файл</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".csv" onChange={handleFileChange} />
                    </label>
                </div>
            </div>
        </div>
    );
};
