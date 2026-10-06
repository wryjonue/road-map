import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import styles from './MonthlyIncidentReport.module.css';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const AREA_COLORS = ['#3b7587', '#bb594a', '#718a3e', '#b48228', '#725e8c', '#397158', '#bc7040', '#496894', '#707980'];

function getMonthOptions() {
	const options = [];
	const now = new Date();
	for (let i = 0; i < 12; i++) {
		const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
		const label = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
		options.push({ value, label });
	}
	return options;
}

function formatMonthLabel(month) {
	const [year, mon] = month.split('-').map(Number);
	const date = new Date(Date.UTC(year, mon - 1, 1));
	return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export default function MonthlyIncidentReport() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const chartCanvas = useRef(null);
	const chartInstance = useRef(null);
	const [selectedMonth, setSelectedMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
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
				const response = await fetch(`/api/dashboard/monthly-report?month=${encodeURIComponent(selectedMonth)}`, {
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
	}, [getToken, isLoaded, isSignedIn, selectedMonth]);

	useEffect(() => {
		if (!chartCanvas.current || !data) return undefined;
		chartInstance.current?.destroy();
		chartInstance.current = new Chart(chartCanvas.current, {
			type: 'bar',
			data: {
				labels: data.byArea.map((item) => item.area),
				datasets: [{
					label: 'Incidents',
					data: data.byArea.map((item) => item.count),
					backgroundColor: AREA_COLORS.slice(0, data.byArea.length),
					borderWidth: 0,
					barThickness: 22,
				}],
			},
			options: {
				indexAxis: 'y',
				maintainAspectRatio: false,
				responsive: true,
				plugins: {
					legend: { display: false },
					tooltip: { displayColors: false, callbacks: { label: (context) => ` ${context.parsed.x} incidents` } },
				},
				scales: {
					x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e4e4e4' } },
					y: { grid: { display: false }, ticks: { autoSkip: false, color: '#343434' } },
				},
			},
		});
		return () => {
			chartInstance.current?.destroy();
			chartInstance.current = null;
		};
	}, [data]);

	return (
		<section className={styles.section} aria-labelledby="monthly-report-heading">
			<div className={styles.sectionHeader}>
				<h2 id="monthly-report-heading">Monthly Incident Report</h2>
				<label className={styles.monthControl}>
					<span>Month</span>
					<select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
						{monthOptions.map((option) => (
							<option key={option.value} value={option.value}>{option.label}</option>
						))}
					</select>
				</label>
			</div>

			{error && <p className={styles.error} role="alert">{error}</p>}
			{isLoading && <p className={styles.state} role="status">Loading monthly report...</p>}

			{!isLoading && !error && data && (
				<>
					<div className={styles.metricsGrid}>
						<div className={styles.metricCard}>
							<span>Total Incidents</span>
							<strong>{data.total.toLocaleString()}</strong>
						</div>
						<div className={styles.metricCard}>
							<span>Resolved</span>
							<strong>{data.resolved.toLocaleString()}</strong>
						</div>
						<div className={`${styles.metricCard} ${styles.unresolved}`}>
							<span>Unresolved</span>
							<strong>{data.unresolved.toLocaleString()}</strong>
						</div>
					</div>

					{data.byArea.length > 0 ? (
						<div className={styles.chartFrame}>
							<canvas ref={chartCanvas} role="img" aria-label={`Horizontal bar chart of incidents by area for ${formatMonthLabel(selectedMonth)}`} />
						</div>
					) : (
						<p className={styles.emptyState}>No incidents recorded for {formatMonthLabel(selectedMonth)}.</p>
					)}
				</>
			)}
		</section>
	);
}
