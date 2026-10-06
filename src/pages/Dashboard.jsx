import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { BarController, BarElement, CategoryScale, Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import MonthlyIncidentReport from '../components/MonthlyIncidentReport';
import styles from './Dashboard.module.css';

Chart.register(BarController, BarElement, CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip);

const CATEGORY_COLORS = ['#3b7587', '#bb594a', '#718a3e', '#b48228', '#725e8c', '#397158', '#bc7040', '#496894', '#707980'];

export default function Dashboard() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const chartCanvas = useRef(null);
	const monthlyChartCanvas = useRef(null);
	const [metrics, setMetrics] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!isLoaded) return undefined;
		const controller = new AbortController();
		const loadMetrics = async () => {
			setIsLoading(true);
			setError('');
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch('/api/dashboard/metrics', {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Unable to load dashboard metrics');
				if (!controller.signal.aborted) setMetrics(data);
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load dashboard metrics');
			} finally {
				if (!controller.signal.aborted) setIsLoading(false);
			}
		};
		void loadMetrics();
		return () => controller.abort();
	}, [getToken, isLoaded, isSignedIn]);

	useEffect(() => {
		if (!chartCanvas.current || !metrics) return undefined;
		const chart = new Chart(chartCanvas.current, {
			type: 'bar',
			data: {
				labels: metrics.categories.map((category) => category.name),
				datasets: [{
					label: 'Reports',
					data: metrics.categories.map((category) => category.count),
					backgroundColor: CATEGORY_COLORS,
					borderWidth: 0,
					barThickness: 18,
				}],
			},
			options: {
				indexAxis: 'y',
				maintainAspectRatio: false,
				responsive: true,
				plugins: {
					legend: { display: false },
					tooltip: { displayColors: false, callbacks: { label: (context) => ` ${context.parsed.x} reports` } },
				},
				scales: {
					x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e4e4e4' } },
					y: { grid: { display: false }, ticks: { autoSkip: false, color: '#343434' } },
				},
			},
		});
		return () => chart.destroy();
	}, [metrics]);

	useEffect(() => {
		if (!monthlyChartCanvas.current || !metrics) return undefined;
		const chart = new Chart(monthlyChartCanvas.current, {
			type: 'line',
			data: {
				labels: metrics.monthlyReports.map((report) => new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${report.month}-01T00:00:00Z`))),
				datasets: [{
					label: 'Open and resolved reports',
					data: metrics.monthlyReports.map((report) => report.count),
					borderColor: '#3b7587',
					backgroundColor: 'rgba(59, 117, 135, .14)',
					pointBackgroundColor: '#3b7587',
					pointBorderColor: '#ffffff',
					pointBorderWidth: 2,
					pointRadius: 4,
					fill: true,
					tension: .25,
				}],
			},
			options: {
				maintainAspectRatio: false,
				responsive: true,
				plugins: {
					legend: { display: false },
					tooltip: { displayColors: false, callbacks: { label: (context) => ` ${context.parsed.y} reports` } },
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e4e4e4' } },
					x: { grid: { display: false } },
				},
			},
		});
		return () => chart.destroy();
	}, [metrics]);

	const stats = metrics ? [
		{ label: 'Total', value: metrics.total.toLocaleString() },
		{ label: 'Resolved', value: metrics.resolved.toLocaleString() },
		{ label: 'Resolved %', value: `${metrics.resolvedPercentage.toFixed(1)}%` },
	] : [];

	return (
		<section className={`page-card ${styles.dashboardPage}`}>
			<header className={styles.header}>
				<div><h1>Dashboard</h1></div>
			</header>
			{error && <p className={styles.error} role="alert">{error}</p>}
			<div className={styles.analyticsGrid}>
				{stats.map((stat) => <div key={stat.label} className={styles.statCard}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}
				{isLoading && <p className={styles.state} role="status">Loading report metrics...</p>}
			</div>
			<section className={styles.chartSection} aria-labelledby="monthly-chart-heading">
				<div className={styles.chartHeading}>
					<div><h2 id="monthly-chart-heading">Reports per month</h2></div>
				</div>
				{metrics && <div className={styles.chartFrame}><canvas ref={monthlyChartCanvas} role="img" aria-label="Line chart of open and resolved reports per month" /></div>}
				{!isLoading && !error && metrics?.monthlyReports.length === 0 && <p className={styles.emptyState}>No open or resolved reports to display yet.</p>}
			</section>
			<section className={styles.chartSection} aria-labelledby="category-chart-heading">
				<div className={styles.chartHeading}>
					<div><h2 id="category-chart-heading">Incidents by category</h2></div>
				</div>
				{metrics && <div className={styles.chartFrame}><canvas ref={chartCanvas} role="img" aria-label="Bar chart of report counts by category" /></div>}
				{!isLoading && !error && metrics?.total === 0 && <p className={styles.emptyState}>No reports to display yet.</p>}
			</section>
				<MonthlyIncidentReport />
		</section>
	);
}
