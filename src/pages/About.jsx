import styles from './About.module.css';

export default function About() {
	return (
		<div className={`page-card ${styles.aboutPage}`}>
			<h1>Safer roads through shared visibility</h1>
			<p>RoadMap empowers cities and citizens to build safer roads through real-time hazard tracking and streamlined traffic violation enforcement.</p>
			<div className={styles.teamGrid}><div>Incident Monitoring</div><div>Traffic Enforcement</div><div>Violation Ticketing</div><div>Geospatial Mapping</div></div>
			<div className={styles.aboutGrid}>
				<div className={styles.aboutCard}><h3>Citizen hazard reporting</h3><p>Residents and field teams can report blocked routes, flooding, debris, outages, and dangerous road conditions for quick review and response.</p></div>
				<div className={styles.aboutCard}><h3>Official violation ticketing</h3><p>Traffic enforcement officers can log violations, assign fines, monitor ticket status, and resolve cases in a single control panel designed for accountability.</p></div>
			</div>
		</div>
	);
}
