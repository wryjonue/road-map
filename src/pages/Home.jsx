import { Link } from 'react-router';
import styles from './Home.module.css';

export default function Home() {
	return (
		<div className={`page-card ${styles.heroCard}`}>
			<div className={styles.heroCopy}>
				<p className="eyebrow">Citywide road intelligence</p>
				<h1>Monitor hazards. Enforce safer roads.</h1>
				<p>Be a responsible Bataeno. Track live road incidents, coordinate rapid response, and manage traffic violations with a single operational view built for cities, agencies, and community reporting.</p>
				<div className={styles.quickActions}>
					<Link to="/feed/create" className="primary-btn action-link">Report an Incident</Link>
					<Link to="/tickets" className="secondary-btn action-link secondary-link">Issue Violation Ticket</Link>
				</div>
			</div>
			<div className={styles.heroStats}>
				<div><strong>0</strong><span>Active Traffic Incidents</span></div>
				<div><strong>100</strong><span>Resolved Road Hazards</span></div>
				<div><strong>222</strong><span>Issued Violation Tickets</span></div>
				<div><strong>341</strong><span>Community Reporters Active</span></div>
			</div>
		</div>
	);
}
