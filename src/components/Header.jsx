import { Link } from 'react-router';
import { Show, UserButton } from '@clerk/react';
import styles from './Header.module.css';

export default function Header() {
	return (
		<header className={styles.header}>
			<div className={styles.logo}>
				<div className={styles.logoMark}>R</div>
				<span>RoadMap</span>
			</div>
			<div className={styles.authContainer}>
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
