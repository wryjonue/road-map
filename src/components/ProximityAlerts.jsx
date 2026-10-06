import styles from './ProximityAlerts.module.css';

const THRESHOLD_OPTIONS = [
	{ value: 100, label: '100 m' },
	{ value: 200, label: '200 m' },
	{ value: 300, label: '300 m' },
	{ value: 500, label: '500 m' },
	{ value: 1000, label: '1 km' },
];

function formatDistance(meters) {
	return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export default function ProximityAlerts({ nearbyReports, threshold, onThresholdChange, referenceLabel }) {
	return (
		<section className={styles.panel} aria-label="Proximity alerts">
			<div className={styles.panelHeader}>
				<h2>Nearby incidents</h2>
				<label className={styles.thresholdControl}>
					<span>Within</span>
					<select value={threshold} onChange={(event) => onThresholdChange(Number(event.target.value))}>
						{THRESHOLD_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>{option.label}</option>
						))}
					</select>
				</label>
			</div>

			{nearbyReports.length > 0 ? (
				<ul className={styles.alertList} role="list">
					{nearbyReports.map((report) => (
						<li key={report.id} className={styles.alertItem}>
							<span className={styles.alertIcon} aria-hidden="true">⚠</span>
							<div className={styles.alertBody}>
								<span className={styles.alertTitle}>{report.title}</span>
								<div className={styles.alertMeta}>
									<span className={styles.alertDistance}>{formatDistance(report.distanceMeters)}</span>
									<span>{report.category.name}</span>
								</div>
							</div>
						</li>
					))}
				</ul>
			) : (
				<p className={styles.empty}>No open incidents within {formatDistance(threshold)}.</p>
			)}

			<p className={styles.referenceNote}>
				{referenceLabel}
			</p>
		</section>
	);
}
