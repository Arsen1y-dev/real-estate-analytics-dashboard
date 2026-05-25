import React, { useCallback, useState } from 'react';
import type { Role } from '@/auth';
import { useAuth } from '@/auth';
import type { ManagerUser } from '@/api/manager';
import {
    createManagerUser,
    deleteManagerUser,
    fetchManagerUsers,
    resetManagerUserPassword,
    updateManagerUserRole,
} from '@/api/manager';
import { MANAGER_ASSIGNABLE_ROLES, roleLabel } from '@/roles';

function formatAt(at: string): string {
    try {
        return new Date(at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return at;
    }
}

export function UserManagementPanel({ onToast }: { onToast: (message: string) => void }) {
    const { token, user: self } = useAuth();
    const [users, setUsers] = useState<ManagerUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);

    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState<Role>('observer');

    const reload = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        const list = await fetchManagerUsers(token);
        setUsers(list);
        setLoading(false);
    }, [token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        const result = await createManagerUser(token, {
            username: newUsername.trim(),
            password: newPassword,
            role: newRole,
        });
        if (!result.ok) {
            onToast(result.error);
            return;
        }
        onToast(`Создан пользователь ${result.user.username}`);
        setNewUsername('');
        setNewPassword('');
        setNewRole('observer');
        await reload();
    };

    const handleRoleChange = async (u: ManagerUser, role: Role) => {
        if (!token || u.role === role) return;
        setBusyId(u.id);
        const result = await updateManagerUserRole(token, u.id, role);
        setBusyId(null);
        if (!result.ok) {
            onToast(result.error);
            return;
        }
        onToast(`Роль ${u.username}: ${roleLabel(role)}`);
        await reload();
    };

    const handlePasswordReset = async (u: ManagerUser) => {
        if (!token) return;
        const password = window.prompt(`Новый пароль для ${u.username} (мин. 6 символов):`);
        if (!password) return;
        setBusyId(u.id);
        const result = await resetManagerUserPassword(token, u.id, password);
        setBusyId(null);
        if (!result.ok) {
            onToast(result.error);
            return;
        }
        onToast(`Пароль обновлён: ${u.username}`);
    };

    const handleDelete = async (u: ManagerUser) => {
        if (!token) return;
        if (!window.confirm(`Удалить пользователя ${u.username}?`)) return;
        setBusyId(u.id);
        const result = await deleteManagerUser(token, u.id);
        setBusyId(null);
        if (!result.ok) {
            onToast(result.error);
            return;
        }
        onToast(`Удалён: ${u.username}`);
        await reload();
    };

    return (
        <div className="space-y-8">
            <form onSubmit={handleCreate} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <h3 className="text-sm font-semibold text-zinc-200">Новый пользователь</h3>
                <div className="mt-3 flex flex-wrap gap-3">
                    <input
                        value={newUsername}
                        onChange={e => setNewUsername(e.target.value)}
                        placeholder="Логин"
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                        required
                    />
                    <input
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="Пароль"
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                        required
                        minLength={6}
                    />
                    <select
                        value={newRole}
                        onChange={e => setNewRole(e.target.value as Role)}
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    >
                        {MANAGER_ASSIGNABLE_ROLES.map(r => (
                            <option key={r} value={r}>
                                {roleLabel(r)}
                            </option>
                        ))}
                    </select>
                    <button
                        type="submit"
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
                    >
                        Создать
                    </button>
                </div>
            </form>

            {loading ? (
                <p className="text-sm text-zinc-400">Загрузка пользователей…</p>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-zinc-900/80 text-zinc-400">
                            <tr>
                                <th className="px-4 py-3 font-medium">Логин</th>
                                <th className="px-4 py-3 font-medium">Роль</th>
                                <th className="px-4 py-3 font-medium">Создан</th>
                                <th className="px-4 py-3 font-medium">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            {users.map(u => {
                                const isSelf = self?.id === u.id;
                                const canEditRole = !isSelf && u.role !== 'manager';
                                const busy = busyId === u.id;
                                return (
                                    <tr key={u.id}>
                                        <td className="px-4 py-3 font-medium">
                                            {u.username}
                                            {isSelf && (
                                                <span className="ml-2 text-xs text-zinc-500">(вы)</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {canEditRole ? (
                                                <select
                                                    value={u.role}
                                                    disabled={busy}
                                                    onChange={e =>
                                                        void handleRoleChange(u, e.target.value as Role)
                                                    }
                                                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                                                >
                                                    {MANAGER_ASSIGNABLE_ROLES.map(r => (
                                                        <option key={r} value={r}>
                                                            {roleLabel(r)}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span>{roleLabel(u.role)}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-zinc-400">{formatAt(u.createdAt)}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => void handlePasswordReset(u)}
                                                    className="rounded border border-zinc-600 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                                                >
                                                    Сброс пароля
                                                </button>
                                                {!isSelf && (
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => void handleDelete(u)}
                                                        className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                                                    >
                                                        Удалить
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
