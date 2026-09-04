import { NavLink, Outlet } from 'react-router';
import Header from './Header';
import styles from './RootLayout.module.css';

export default function RootLayout() {
	return (
		<div className={styles.appShell}>
			<Header />
			<nav className={styles.topNav} aria-label="Main navigation">
				<NavLink className="navlink" to="/">Home</NavLink>
				<NavLink className="navlink" to="/dashboard">Dashboard</NavLink>
				<NavLink className="navlink" to="/feed">Feed</NavLink>
				<NavLink className="navlink" to="/tickets">Tickets</NavLink>
				<NavLink className="navlink" to="/map">Map</NavLink>
				<NavLink className="navlink" to="/about">About</NavLink>
			</nav>
			<main className={styles.mainContent}><Outlet /></main>
		</div>
	);
}
