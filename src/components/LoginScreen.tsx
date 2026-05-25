import React, { useState } from 'react';
import { useAuth } from '@/auth';

export function LoginScreen() {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await login(username.trim(), password);
        setBusy(false);
        if (!result.ok) setError(result.error ?? 'Ошибка авторизации');
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
            <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
                <h1 className="text-xl font-semibold">Вход в дашборд</h1>
                <p className="mt-2 text-sm text-zinc-400">Роли: observer / analyst / admin / manager</p>
                <label className="mt-5 block text-sm">
                    <span className="mb-1 block text-zinc-400">Логин</span>
                    <input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
                        placeholder="admin"
                    />
                </label>
                <label className="mt-3 block text-sm">
                    <span className="mb-1 block text-zinc-400">Пароль</span>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
                        placeholder="admin123"
                    />
                </label>
                {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
                <button
                    type="submit"
                    disabled={busy}
                    className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-60"
                >
                    {busy ? 'Входим...' : 'Войти'}
                </button>
            </form>
        </div>
    );
}
