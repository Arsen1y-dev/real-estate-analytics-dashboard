export type Role = 'observer' | 'analyst' | 'admin' | 'manager';

export const ALL_ROLES: Role[] = ['observer', 'analyst', 'admin', 'manager'];

/** Роли, которые manager может назначать другим */
export const MANAGER_ASSIGNABLE_ROLES: Role[] = ['observer', 'analyst', 'admin'];

export function isRole(value: string): value is Role {
    return ALL_ROLES.includes(value as Role);
}

export function canManagerAssign(role: Role): boolean {
    return MANAGER_ASSIGNABLE_ROLES.includes(role);
}
