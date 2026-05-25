import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Role = 'observer' | 'analyst' | 'admin' | 'manager';
export type AuthUser = { id: number; username: string; role: Role };

type AuthContextValue = {
    user: AuthUser | null;
    token: string | null;
    login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
    logout: () => void;
};

const envApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const normalizedEnvApiBase = envApiBase ? envApiBase.replace(/\/+$/, '') : '';

const API_BASE = normalizedEnvApiBase || (import.meta.env.DEV ? '' : typeof window !== 'undefined' ? window.location.origin : '');
const AUTH_KEY = 'realty-dashboard-auth-v1';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [user, setUser] = useState<AuthUser | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const raw = localStorage.getItem(AUTH_KEY);
                if (!raw) return;
                const parsed = JSON.parse(raw) as { token?: string; user?: AuthUser };
                if (!parsed.token || !parsed.user) return;

                if (!cancelled) {
                    setToken(parsed.token);
                    setUser(parsed.user);
                }

                const resp = await fetch(`${API_BASE}/api/me`, {
                    headers: { Authorization: `Bearer ${parsed.token}` },
                });
                if (cancelled) return;
                if (!resp.ok) {
                    localStorage.removeItem(AUTH_KEY);
                    setToken(null);
                    setUser(null);
                    return;
                }
                const json = (await resp.json()) as { user?: AuthUser };
                if (!json.user) return;
                setUser(json.user);
                localStorage.setItem(AUTH_KEY, JSON.stringify({ token: parsed.token, user: json.user }));
            } catch {
                // API недоступен — оставляем локальную сессию для офлайн-работы с CSV
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const login = async (username: string, password: string) => {
        try {
            const resp = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const json = (await resp.json()) as { token?: string; user?: AuthUser; error?: string };
            if (!resp.ok || !json.token || !json.user) {
                return { ok: false, error: json.error || 'Ошибка входа' };
            }
            setToken(json.token);
            setUser(json.user);
            localStorage.setItem(AUTH_KEY, JSON.stringify({ token: json.token, user: json.user }));
            return { ok: true };
        } catch {
            return { ok: false, error: 'Сервер недоступен' };
        }
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem(AUTH_KEY);
    };

    const value = useMemo<AuthContextValue>(() => ({ user, token, login, logout }), [user, token]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used in AuthProvider');
    return ctx;
}

export function apiBaseUrl(): string {
    return API_BASE;
}

export function apiAbsoluteBaseUrl(): string {
    if (API_BASE) {
        return API_BASE;
    }
    return typeof window !== 'undefined' ? window.location.origin : '';
}
