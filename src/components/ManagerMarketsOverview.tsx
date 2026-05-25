import React from 'react';
import type { CityMarketOverview } from '@/api/manager';

function formatAt(at: string): string {
    try {
        return new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return at;
    }
}

function formatMoney(n: number | null): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

export function ManagerMarketsOverview({ cities }: { cities: CityMarketOverview[] }) {
    if (cities.length === 0) {
        return <p className="text-sm text-zinc-400">Нет городов в конфигурации.</p>;
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-zinc-900/80 text-zinc-400">
                    <tr>
                        <th className="px-4 py-3 font-medium">Город</th>
                        <th className="px-4 py-3 font-medium">Строк</th>
                        <th className="px-4 py-3 font-medium">Обновлено</th>
                        <th className="px-4 py-3 font-medium">Последний файл</th>
                        <th className="px-4 py-3 font-medium">Загрузок</th>
                        <th className="px-4 py-3 font-medium">Цена (мин–макс)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                    {cities.map(city => (
                        <tr key={city.id} className={city.hasData ? '' : 'opacity-60'}>
                            <td className="px-4 py-3 font-medium text-zinc-100">{city.label}</td>
                            <td className="px-4 py-3">{city.rowCount.toLocaleString('ru-RU')}</td>
                            <td className="px-4 py-3 text-zinc-300">{formatAt(city.updatedAt)}</td>
                            <td className="px-4 py-3 text-zinc-400">{city.lastFileName ?? '—'}</td>
                            <td className="px-4 py-3">{city.uploadCount}</td>
                            <td className="px-4 py-3 text-zinc-300">
                                {city.kpi
                                    ? `${formatMoney(city.kpi.priceMin)} – ${formatMoney(city.kpi.priceMax)}`
                                    : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
