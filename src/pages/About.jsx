import styles from './About.module.css';

export default function About() {
	return (
		<div className={`page-card ${styles.aboutPage}`}>
			<h1>Monitoring roads.</h1>
			<p>RoadMap empowers Bataan and Bataenos to build safer roads through real-time hazard tracking and streamlined traffic violation enforcement.</p>
			<div className={styles.teamGrid}>
				<div>Incident Reporting</div>
				<div>Traffic Enforcement</div>
				<div>Digital Ticketing</div>
				<div>Map Display</div></div>
			<div className={styles.aboutGrid}>
				<div className={styles.aboutCard}><h3>Citizen hazard reporting</h3><p>Residents can report blocked routes, flooding, debris, outages, and dangerous road conditions for quick review and response.</p></div>
				<div className={styles.aboutCard}><h3>Official violation ticketing</h3><p>MBDAs and any relevant authorities can log violations, assign fines, monitor ticket status, and resolve cases in a single control panel.</p></div>
			</div>
		</div>
	);
}
