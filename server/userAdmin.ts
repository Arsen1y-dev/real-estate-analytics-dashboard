import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { canManagerAssign, isRole, type Role } from './roles';

export type UserRecord = {
    id: number;
    username: string;
    role: Role;
    createdAt: string;
};

const MIN_PASSWORD_LEN = 6;

export function migrateUsersTableForManager(db: Database.Database): void {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as
        | { sql?: string }
        | undefined;
    if (row?.sql?.includes("'manager'")) return;

    db.exec(`
CREATE TABLE IF NOT EXISTS users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('observer','analyst','admin','manager')),
  created_at TEXT NOT NULL
);
INSERT INTO users_new (id, username, password_hash, role, created_at)
  SELECT id, username, password_hash, role, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`);
}

export class UserAdminService {
    constructor(private db: Database.Database) {}

    listUsers(): UserRecord[] {
        const rows = this.db
            .prepare('SELECT id, username, role, created_at FROM users ORDER BY username')
            .all() as { id: number; username: string; role: Role; created_at: string }[];
        return rows.map(r => ({
            id: r.id,
            username: r.username,
            role: r.role,
            createdAt: r.created_at,
        }));
    }

    countManagers(): number {
        const row = this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'manager'").get() as { c: number };
        return row.c;
    }

    createUser(username: string, password: string, role: Role): UserRecord {
        const name = username.trim();
        if (!name) throw new Error('Логин не может быть пустым');
        if (password.length < MIN_PASSWORD_LEN) {
            throw new Error(`Пароль не короче ${MIN_PASSWORD_LEN} символов`);
        }
        if (!canManagerAssign(role)) {
            throw new Error('Нельзя назначить эту роль');
        }
        const hash = bcrypt.hashSync(password, 10);
        const at = new Date().toISOString();
        try {
            const info = this.db
                .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
                .run(name, hash, role, at);
            return { id: Number(info.lastInsertRowid), username: name, role, createdAt: at };
        } catch (e) {
            if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error('Пользователь с таким логином уже есть');
            }
            throw e;
        }
    }

    updateRole(targetId: number, role: Role, actorId: number): UserRecord {
        if (!isRole(role) || !canManagerAssign(role)) {
            throw new Error('Нельзя назначить эту роль');
        }
        if (targetId === actorId) {
            throw new Error('Нельзя изменить свою роль');
        }
        const existing = this.getUserById(targetId);
        if (!existing) throw new Error('Пользователь не найден');
        this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
        return { ...existing, role };
    }

    updatePassword(targetId: number, password: string): void {
        if (password.length < MIN_PASSWORD_LEN) {
            throw new Error(`Пароль не короче ${MIN_PASSWORD_LEN} символов`);
        }
        const existing = this.getUserById(targetId);
        if (!existing) throw new Error('Пользователь не найден');
        const hash = bcrypt.hashSync(password, 10);
        this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, targetId);
    }

    deleteUser(targetId: number, actorId: number): void {
        if (targetId === actorId) {
            throw new Error('Нельзя удалить свою учётку');
        }
        const existing = this.getUserById(targetId);
        if (!existing) throw new Error('Пользователь не найден');
        if (existing.role === 'manager' && this.countManagers() <= 1) {
            throw new Error('Нельзя удалить последнего руководителя');
        }
        this.db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    }

    getUserById(id: number): UserRecord | null {
        const row = this.db
            .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
            .get(id) as { id: number; username: string; role: Role; created_at: string } | undefined;
        if (!row) return null;
        return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
    }
}
