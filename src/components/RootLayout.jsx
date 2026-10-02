import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import Header from './Header';
import { canManageReports, useAppRole } from '../auth/roles';
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
				<NavLink className="navlink" to="/">Home</NavLink>
				<NavLink className="navlink" to="/dashboard">Dashboard</NavLink>
				<NavLink className="navlink" to="/feed">Feed</NavLink>
				{canViewTickets && <NavLink className="navlink" to="/tickets">Tickets</NavLink>}
				<NavLink className="navlink" to="/map">Map</NavLink>
				<NavLink className="navlink" to="/about">About</NavLink>
			</nav>
			<main className={styles.mainContent}><Outlet /></main>
		</div>
	);
}
