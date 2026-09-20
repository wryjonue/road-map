import styles from './Dashboard.module.css';

const analyticsCards = [
	{ label: 'Total', value: '0', delta: '+0 this week' },
	{ label: 'Resolved ', value: '0', delta: '+0 this week' },
	{ label: 'iolations ', value: '0', delta: '+0 this week' },
	{ label: 'Fines Collected', value: '0PHP', delta: '0% collected' },
];
const breakdown = [
	{ label: 'Incidents', value: 42, color: 'var(--primary)' },
	{ label: 'Roadworks', value: 31, color: 'var(--warning)' },
	{ label: 'Traffic Violations', value: 27, color: 'var(--success)' },
];
const resolutionRates = [{ label: 'Hazard', value: 82 }, { label: 'Traffic', value: 74 }, { label: 'Case', value: 68 }];
const recentActivity = [
	{ type: 'Violation', summary: 'Lorem-Ipsum · Lorem-Ipsum', status: 'Lorem', time: '2m ago' },
	{ type: 'Incident', summary: 'The quick brown fox', status: 'Open', time: '18m ago' },
	{ type: 'Violation', summary: '0-8897 · Yes', status: 'Issued', time: '43m ago' },
	{ type: 'Incident', summary: '0 · Mama Mo Blue', status: 'Resolved', time: '1h ago' },
];

export default function Dashboard() {
	return (
		<section className={`page-card ${styles.dashboardPage}`}>
			<div className={`section-heading ${styles.header}`}>
				<div><p className="eyebrow">Road-map Overview</p><h1>Dashboard</h1></div>
				<button type="button" className="primary-btn">Export Report</button>
			</div>
			<div className={styles.analyticsGrid}>{analyticsCards.map((card) => <div key={card.label} className={styles.statCard}><span>{card.label}</span><strong>{card.value}</strong><em>{card.delta}</em></div>)}</div>
			<div className={styles.panels}>
				<div className={styles.panel}><h3>Incident</h3><div className={styles.metricList}>{breakdown.map((item) => <div key={item.label} className={styles.metricRow}><div className={styles.metricLabel}><span>{item.label}</span><strong>{item.value}%</strong></div><div className={styles.metricBar}><div className={styles.metricFill} style={{ width: `${item.value}%`, background: item.color }} /></div></div>)}</div></div>
				<div className={styles.panel}><h3>Rate</h3><div className={styles.metricList}>{resolutionRates.map((item) => <div key={item.label} className={styles.metricRow}><div className={styles.metricLabel}><span>{item.label}</span><strong>{item.value}%</strong></div><div className={styles.metricBar}><div className={`${styles.metricFill} ${styles.secondaryFill}`} style={{ width: `${item.value}%` }} /></div></div>)}</div></div>
			</div>
			<div className={`${styles.panel} ${styles.tablePanel}`}><h3>Recent activity</h3><table className="audit-table"><thead><tr><th>Type</th><th>Summary</th><th>Status</th><th>Time</th></tr></thead><tbody>{recentActivity.map((item) => <tr key={`${item.type}-${item.summary}`}><td>{item.type}</td><td>{item.summary}</td><td><span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status}</span></td><td>{item.time}</td></tr>)}</tbody></table></div>
		</section>
	);
}
