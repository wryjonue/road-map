import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import Header from './Header';
import Sidebar from './Sidebar';
import styles from './RootLayout.module.css';

export default function RootLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	useEffect(() => {
		console.info('[clerk-diag] root layout mounted');
	}, []);

	return (
		<div className={styles.appShell}>
			<Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
			<div className={styles.mainWrapper}>
				<Header onMenuClick={() => setSidebarOpen(true)} />
				<main className={styles.mainContent}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
