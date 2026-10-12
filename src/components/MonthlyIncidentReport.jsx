import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import styles from './MonthlyIncidentReport.module.css';

const CATEGORY_COLORS = {
	'Road Accident (Self)': '#f97316',
	'Road Accident (Vehicular)': '#f97316',
	'Damaged Road': '#eab308',
	'Flooded Road': '#eab308',
	'Road Construction': '#3b82f6',
	'Roadworks': '#3b82f6',
	'Road Closure': '#8b5cf6',
	'Fallen Debris': '#8b5cf6',
	'Heavy Traffic': '#64748b',
	'Others': '#64748b',
};

function getMonthOptions() {
	const options = [];
	const now = new Date();
	for (let i = 0; i < 12; i++) {
		// Build the date in UTC so the formatted label and the YYYY-MM value
		// never drift apart across timezones (a local midnight can be the
		// previous month in UTC, which previously shifted labels back by one).
		const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
		const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
		const label = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
		options.push({ value, label });
	}
	return options;
}

export default function MonthlyIncidentReport({ onSnapshotChange } = {}) {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const [selectedMonth, setSelectedMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
	const [selectedMunicipality, setSelectedMunicipality] = useState('all');
	const [data, setData] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const monthOptions = getMonthOptions();

	useEffect(() => {
		if (!isLoaded) return undefined;
		const controller = new AbortController();
		const loadReport = async () => {
			setIsLoading(true);
			setError('');
			setData(null);
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch(`/api/dashboard/monthly-report?month=${encodeURIComponent(selectedMonth)}&municipality=${encodeURIComponent(selectedMunicipality)}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || 'Unable to load monthly report');
				if (!controller.signal.aborted) setData(result);
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load monthly report');
			} finally {
				if (!controller.signal.aborted) setIsLoading(false);
			}
		};
		void loadReport();
		return () => controller.abort();
	}, [getToken, isLoaded, isSignedIn, selectedMonth, selectedMunicipality]);

	const municipalities = data?.byMunicipality ?? [];

	useEffect(() => {
		if (!onSnapshotChange) return;
		onSnapshotChange({ month: selectedMonth, municipality: selectedMunicipality, data });
	}, [onSnapshotChange, selectedMonth, selectedMunicipality, data]);

	return (
		<section className={styles.section} aria-labelledby="monthly-report-heading">
			<div className={styles.card}>
				<div className={styles.sectionHeader}>
					<div>
						<h2 id="monthly-report-heading" className={styles.title}>Monthly incident report</h2>
						<p className={styles.subtitle}>Reported, resolved, and still on our radar.</p>
					</div>
					<div className={styles.filters}>
						<select 
							className={styles.filterSelect}
							value={selectedMonth} 
							onChange={(event) => setSelectedMonth(event.target.value)}
						>
							{monthOptions.map((option) => (
								<option key={option.value} value={option.value}>{option.label}</option>
							))}
						</select>
						<select 
							className={styles.filterSelect}
							value={selectedMunicipality}
							onChange={(event) => setSelectedMunicipality(event.target.value)}
						>
							<option value="all">All municipalities</option>
							{municipalities.map((m) => (
								<option key={m.municipality} value={m.municipality}>{m.municipality}</option>
							))}
						</select>
					</div>
				</div>

				{error && <p className={styles.error} role="alert">{error}</p>}
				{isLoading && <p className={styles.state} role="status">Loading monthly report...</p>}

				{!isLoading && !error && data && (
					<div className={styles.tableContainer}>
						<table className={styles.reportTable}>
							<thead>
								<tr>
									<th>CATEGORY</th>
									<th className={styles.numCol}>TOTAL</th>
									<th className={styles.numCol}>RESOLVED</th>
									<th className={styles.numCol}>ACTIVE</th>
								</tr>
							</thead>
							<tbody>
								{(data.byCategory ?? []).length > 0 ? (
									data.byCategory.map((cat) => (
										<tr key={cat.name}>
											<td>
												<div className={styles.categoryCell}>
													<span className={styles.dot} style={{ backgroundColor: CATEGORY_COLORS[cat.name] || '#64748b' }} />
													{cat.name}
												</div>
											</td>
											<td className={styles.numCol}>{cat.total}</td>
											<td className={styles.numCol}>{cat.resolved}</td>
											<td className={styles.numCol}>{cat.active}</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={4} className={styles.emptyState}>No incidents recorded for this period.</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	);
}
