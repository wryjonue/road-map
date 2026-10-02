import { Navigate } from 'react-router';
import { useAppRole } from '../auth/roles';

export default function RequireRole({ roles, children }) {
	const { isLoaded, role } = useAppRole();

	if (!isLoaded) return <p role="status">Checking access...</p>;
	if (!roles.includes(role)) return <Navigate to="/" replace />;
	return children;
}