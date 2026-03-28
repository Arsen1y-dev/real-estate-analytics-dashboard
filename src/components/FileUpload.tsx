import React from 'react';
import type { DataRow, DataSummary } from '@/types';
import { importCsvFile } from '@/utils/csvImport';

export const FileUpload: React.FC<{
    onDataLoaded: (data: DataRow[], summary: DataSummary) => void;
    setLoading: (loading: boolean) => void;
}> = ({ onDataLoaded, setLoading }) => {
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            importCsvFile(file, onDataLoaded, setLoading);
        }
        event.target.value = '';
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
            <div className="w-full max-w-md rounded-2xl border border-dashed border-slate-600 bg-slate-900/50 px-6 py-10 text-center shadow-xl sm:px-10">
                <svg className="mx-auto h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <h2 className="font-display mt-5 text-xl font-semibold tracking-tight text-white sm:text-2xl">Загрузите CSV</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">Выберите файл с данными — дашборд построится по столбцам автоматически.</p>
                <div className="mt-8">
                    <label
                        htmlFor="file-upload"
                        className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:bg-cyan-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                        <span>Выбрать файл</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".csv" onChange={handleFileChange} />
                    </label>
                </div>
            </div>
        </div>
    );
};
