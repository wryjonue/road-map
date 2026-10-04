import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import Header from './Header';
import { canManageReports, useAppRole } from '../auth/roles';
import { ROUTE_ENABLED } from '../route-flags';
import styles from './RootLayout.module.css';

export default function RootLayout() {
	const { isLoaded, role } = useAppRole();
	const canViewTickets = isLoaded && canManageReports(role);

	useEffect(() => {
		console.info('[clerk-diag] root layout mounted');
	}, []);

	return (
		<div className={styles.appShell}>
			<Header />
			<nav className={styles.topNav} aria-label="Main navigation">
				{ROUTE_ENABLED.home && <NavLink className="navlink" to="/">Home</NavLink>}
				<NavLink className="navlink" to="/dashboard">Dashboard</NavLink>
				<NavLink className="navlink" to="/feed">Feed</NavLink>
				{ROUTE_ENABLED.tickets && canViewTickets && <NavLink className="navlink" to="/tickets">Tickets</NavLink>}
				<NavLink className="navlink" to="/map">Map</NavLink>
				{ROUTE_ENABLED.about && <NavLink className="navlink" to="/about">About</NavLink>}
			</nav>
			<main className={styles.mainContent}><Outlet /></main>
		</div>
	);
}
