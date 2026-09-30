import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Show, useAuth, UserButton } from '@clerk/react';
import styles from './Header.module.css';

export default function Header() {
	const { isLoaded, isSignedIn } = useAuth();
	const authContainerRef = useRef(null);

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

	return (
		<header className={styles.header}>
			<div className={styles.logo}>
				<div className={styles.logoMark}>R</div>
				<span>RoadMap</span>
			</div>
			<div className={styles.authContainer} ref={authContainerRef}>
				<Show when="signed-out">
					<Link to="/sign-in" className="auth-link">Sign in</Link>
				</Show>
				<Show when="signed-in">
					<UserButton />
				</Show>
			</div>
		</header>
	);
}
