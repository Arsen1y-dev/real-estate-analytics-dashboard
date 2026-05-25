import React, { useEffect, useState } from 'react';
import { useAuth } from '@/auth';
import { fetchMarketsOverview, type CityMarketOverview } from '@/api/manager';
import { roleLabel } from '@/roles';
import { ManagerMarketsOverview } from '@/components/ManagerMarketsOverview';
import { UserManagementPanel } from '@/components/UserManagementPanel';
import { useThemePreferences } from '@/hooks/useThemePreferences';
import { ThemeControls } from '@/components/ThemeControls';
import { themeClass } from '@/theme';

type Tab = 'markets' | 'users';

export function ManagerConsole() {
    const { user, token, logout } = useAuth();
    const { theme, themeMode, colorScheme, cycleThemeMode, cycleColorScheme } = useThemePreferences();
    const [tab, setTab] = useState<Tab>('markets');
    const [cities, setCities] = useState<CityMarketOverview[]>([]);
    const [loadingMarkets, setLoadingMarkets] = useState(true);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            setLoadingMarkets(true);
            const list = await fetchMarketsOverview(token);
            if (!cancelled) {
                setCities(list);
                setLoadingMarkets(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 4000);
        return () => window.clearTimeout(t);
    }, [toast]);

    return (
        <div className={themeClass(theme, {
            dark: 'min-h-screen bg-zinc-950 text-zinc-100',
            light: 'min-h-screen bg-zinc-50 text-zinc-900',
        })}>
            <header className={themeClass(theme, {
                dark: 'border-b border-zinc-800 bg-zinc-900/60 px-4 py-4 sm:px-6',
                light: 'border-b border-zinc-200 bg-white/90 px-4 py-4 sm:px-6',
            })}>
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-semibold">Консоль руководителя</h1>
                        <p className={themeClass(theme, {
                            dark: 'text-sm text-zinc-400',
                            light: 'text-sm text-zinc-600',
                        })}>
                            {user?.username} · {user ? roleLabel(user.role) : ''}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <ThemeControls
                            theme={theme}
                            themeMode={themeMode}
                            colorScheme={colorScheme}
                            onCycleScheme={cycleColorScheme}
                            onCycleThemeMode={cycleThemeMode}
                        />
                        <button
                            type="button"
                            onClick={logout}
                            className={themeClass(theme, {
                                dark: 'rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800',
                                light: 'rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm shadow-sm hover:bg-zinc-50',
                            })}
                        >
                            Выйти
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
                <nav className="mb-6 flex gap-2">
                    <button
                        type="button"
                        onClick={() => setTab('markets')}
                        className={tab === 'markets'
                            ? 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white'
                            : themeClass(theme, {
                                dark: 'rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800',
                                light: 'rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50',
                            })}
                    >
                        Рынки
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('users')}
                        className={tab === 'users'
                            ? 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white'
                            : themeClass(theme, {
                                dark: 'rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800',
                                light: 'rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50',
                            })}
                    >
                        Пользователи
                    </button>
                </nav>

                {tab === 'markets' && (
                    <section>
                        <h2 className="mb-1 text-base font-semibold">Сводка по городам</h2>
                        {loadingMarkets ? (
                            <p className={themeClass(theme, {
                                dark: 'text-sm text-zinc-400',
                                light: 'text-sm text-zinc-600',
                            })}>Загрузка…</p>
                        ) : (
                            <ManagerMarketsOverview cities={cities} />
                        )}
                    </section>
                )}

                {tab === 'users' && (
                    <section>
                        <h2 className="mb-1 text-base font-semibold">Управление пользователями</h2>
                        <p className={themeClass(theme, {
                            dark: 'mb-4 text-sm text-zinc-400',
                            light: 'mb-4 text-sm text-zinc-600',
                        })}>
                            Создание учёток и роли: наблюдатель, аналитик, администратор.
                        </p>
                        <UserManagementPanel onToast={setToast} />
                    </section>
                )}
            </main>

            {toast && (
                <div
                    role="status"
                    className={themeClass(theme, {
                        dark: 'fixed bottom-8 left-1/2 z-[100] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-center text-sm shadow-xl',
                        light: 'fixed bottom-8 left-1/2 z-[100] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-center text-sm shadow-xl',
                    })}
                >
                    {toast}
                </div>
            )}
        </div>
    );
}
