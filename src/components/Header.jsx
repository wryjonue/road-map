import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@clerk/react';
import { useAppRole } from '../auth/roles';
import NotificationPanel from './NotificationPanel';
import styles from './Header.module.css';

export default function Header({ onMenuClick }) {
	const { isLoaded, isSignedIn } = useAuth();
	useAppRole();
	const authContainerRef = useRef(null);
	const location = useLocation();

	// Get page title from path
	const getPageTitle = () => {
		const path = location.pathname;
		if (path === '/dashboard') return 'Dashboard';
		if (path === '/feed') return 'Report Feed';
		if (path === '/map') return '2D Map View';
		if (path === '/assistant') return 'AI Assistant';
		if (path === '/tickets') return 'Tickets';
		if (path === `/about`) return 'About';
		if (path.startsWith('/feed/')) return 'Report Details';
		return 'RoadMap';
	};

	useEffect(() => {
		const expectedBranch = !isLoaded ? 'pending' : isSignedIn ? 'signed-in' : 'signed-out';
		console.info('[clerk-diag] header auth state', {
			isLoaded,
			isSignedIn: isLoaded ? Boolean(isSignedIn) : null,
			expectedBranch,
		});

		const frameId = window.requestAnimationFrame(() => {
			const container = authContainerRef.current;
			const control = container?.querySelector('a, button');
			const containerStyle = container ? window.getComputedStyle(container) : null;
			const controlStyle = control ? window.getComputedStyle(control) : null;

			console.info('[clerk-diag] header control snapshot', {
				containerMounted: Boolean(container),
				childCount: container?.childElementCount ?? 0,
				containerDisplay: containerStyle?.display ?? null,
				containerVisibility: containerStyle?.visibility ?? null,
				containerRectCount: container?.getClientRects().length ?? 0,
				controlPresent: Boolean(control),
				controlDisplay: controlStyle?.display ?? null,
				controlVisibility: controlStyle?.visibility ?? null,
				controlRectCount: control?.getClientRects().length ?? 0,
			});
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [isLoaded, isSignedIn]);

	const currentDate = new Date().toLocaleDateString('en-US', { 
		day: 'numeric', 
		month: 'long', 
		year: 'numeric' 
	});

	return (
		<header className={styles.header}>
			<div className={styles.leftSection}>
				<button className={styles.menuButton} onClick={onMenuClick} aria-label="Open menu">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<line x1="3" y1="12" x2="21" y2="12" />
						<line x1="3" y1="6" x2="21" y2="6" />
						<line x1="3" y1="18" x2="21" y2="18" />
					</svg>
				</button>
				
				<h1 className={styles.pageTitle}><span className={styles.desktopTitle}>{getPageTitle()}</span><span className={styles.mobileTitle}>RoadMap</span></h1>
			</div>
			<div className={styles.rightSection} ref={authContainerRef}>
				<div className={styles.dateDisplay}>
					Current Date:
					<span>{currentDate}</span>
				</div>
				{/* Auth controls moved to Sidebar, only Notifications remain here for desktop */}
				{/* On mobile, we might want notifications here too */}
				<NotificationPanel />
			</div>
		</header>
	);
}
