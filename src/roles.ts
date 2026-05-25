import type { Role } from '@/auth';

export const ROLE_LABELS: Record<Role, string> = {
    observer: 'Наблюдатель',
    analyst: 'Аналитик',
    admin: 'Администратор',
    manager: 'Руководитель',
};

/** Роли, которые руководитель может назначать */
export const MANAGER_ASSIGNABLE_ROLES: Role[] = ['observer', 'analyst', 'admin'];

export function roleLabel(role: Role): string {
    return ROLE_LABELS[role];
}
