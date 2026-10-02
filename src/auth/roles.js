import { useAuth } from '@clerk/react';

export const APP_ROLES = Object.freeze(['user', 'authority', 'admin']);

export function normalizeRole(role) {
	return APP_ROLES.includes(role) ? role : 'user';
}

export function canManageReports(role) {
	return role === 'authority' || role === 'admin';
}

export function useAppRole() {
	const { isLoaded, sessionClaims } = useAuth();
	return { isLoaded, role: isLoaded ? normalizeRole(sessionClaims?.role) : 'user' };
}