import type { Role } from '@/auth';
import type { DataSourceMode } from '@/domain/dataSource';

export type RoleCapabilities = {
    forceServerSource: boolean;
    canPickDataSource: boolean;
    canUploadPersonalCsv: boolean;
    canUseChartConstructor: boolean;
    canUseFilteredTable: boolean;
    canExport: boolean;
    canRefreshFromServer: boolean;
    canViewAdminServerPanel: boolean;
    showMarketOverview: boolean;
    showObserverListings: boolean;
};

export function getRoleCapabilities(role: Role): RoleCapabilities {
    if (role === 'manager') {
        return {
            forceServerSource: false,
            canPickDataSource: false,
            canUploadPersonalCsv: false,
            canUseChartConstructor: false,
            canUseFilteredTable: false,
            canExport: false,
            canRefreshFromServer: false,
            canViewAdminServerPanel: false,
            showMarketOverview: false,
            showObserverListings: false,
        };
    }
    const isObserver = role === 'observer';
    const isAdmin = role === 'admin';
    const isPro = role === 'analyst' || isAdmin;
    return {
        forceServerSource: isObserver || isAdmin,
        canPickDataSource: role === 'analyst',
        canUploadPersonalCsv: isPro,
        canUseChartConstructor: isPro,
        canUseFilteredTable: isPro,
        canExport: isPro,
        canRefreshFromServer: isPro,
        canViewAdminServerPanel: isAdmin,
        showMarketOverview: isObserver || role === 'analyst',
        showObserverListings: isObserver,
    };
}

export function shouldUsePersonalCache(role: Role, mode: DataSourceMode | null): boolean {
    if (role === 'observer') return false;
    return mode === 'personal';
}
