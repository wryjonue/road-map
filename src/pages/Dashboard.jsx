import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { BarController, BarElement, CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import MonthlyIncidentReport from '../components/MonthlyIncidentReport';
import styles from './Dashboard.module.css';

Chart.register(BarController, BarElement, CategoryScale, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip);

// Mockup colors for categories: Accident (Orange), Road damage (Yellow), Construction (Blue), Closure (Purple)
// Mapping to existing categories roughly or using a palette
const CATEGORY_COLORS = ['#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#14b8a6', '#64748b'];

export default function Dashboard() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const chartCanvas = useRef(null);
	const dailyChartCanvas = useRef(null);
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

	// Incidents by Category Chart (Horizontal Bar)
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
					borderRadius: 4,
					borderSkipped: false,
					barThickness: 12,
				}],
			},
			options: {
				indexAxis: 'y',
				maintainAspectRatio: false,
				responsive: true,
				layout: { padding: { right: 20 } },
				plugins: {
					legend: { display: false },
					tooltip: { displayColors: false, callbacks: { label: (context) => ` ${context.parsed.x} reports` } },
				},
				scales: {
					x: { 
						beginAtZero: true, 
						ticks: { precision: 0, display: false }, 
						grid: { display: false },
						border: { display: false }
					},
					y: { 
						grid: { display: false }, 
						ticks: { autoSkip: false, color: '#64748b', font: { size: 11 } },
						border: { display: false }
					},
				},
			},
			plugins: [{
				id: 'valueLabels',
				afterDatasetsDraw(chart) {
					const { ctx } = chart;
					chart.data.datasets.forEach((dataset, i) => {
						const meta = chart.getDatasetMeta(i);
						meta.data.forEach((bar, index) => {
							const value = dataset.data[index];
							ctx.fillStyle = '#0f172a';
							ctx.font = 'bold 11px Inter, sans-serif';
							ctx.textAlign = 'left';
							ctx.textBaseline = 'middle';
							ctx.fillText(value, bar.x + 8, bar.y);
						});
					});
				}
			}]
		});
		return () => chart.destroy();
	}, [metrics]);

	// Reports per Day Chart (Line)
	useEffect(() => {
		if (!dailyChartCanvas.current || !metrics) return undefined;
		const dailyReports = metrics.dailyReports ?? [];
		// Limit to last 7 days for the mockup look if data allows, or just show all
		const displayData = dailyReports.slice(-7);
		
		const chart = new Chart(dailyChartCanvas.current, {
			type: 'line',
			data: {
				labels: displayData.map((report) => new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: 'UTC' }).format(new Date(`${report.day}T00:00:00Z`))),
				datasets: [{
					label: 'Reports',
					data: displayData.map((report) => report.count),
					borderColor: '#f97316',
					backgroundColor: (context) => {
						const ctx = context.chart.ctx;
						const gradient = ctx.createLinearGradient(0, 0, 0, 200);
						gradient.addColorStop(0, 'rgba(249, 115, 22, 0.2)');
						gradient.addColorStop(1, 'rgba(249, 115, 22, 0)');
						return gradient;
					},
					pointBackgroundColor: '#f97316',
					pointBorderColor: '#ffffff',
					pointBorderWidth: 2,
					pointRadius: 3,
					fill: true,
					tension: 0.4,
					borderWidth: 2,
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
					y: { 
						beginAtZero: true, 
						ticks: { precision: 0, color: '#94a3b8', font: { size: 10 } }, 
						grid: { color: '#f1f5f9' },
						border: { display: false }
					},
					x: { 
						grid: { display: false },
						ticks: { color: '#94a3b8', font: { size: 10 } },
						border: { display: false }
					},
				},
			},
		});
		return () => chart.destroy();
	}, [metrics]);

	// Calculate active reports (Total - Resolved)
	const activeReports = metrics ? (metrics.total - metrics.resolved) : 0;

	// Compute current and previous month labels from the actual date
	const now = new Date();
	const currentMonthLabel = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
		new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
	);
	const prevMonthDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
	const prevMonthLabel = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(prevMonthDate);
	
	// Mock trend data since API doesn't provide it yet
	const totalTrend = '+12.3%';
	const resolvedTrend = '+20.0%';
	const rateTrend = '+5.0 pts';

	return (
		<div className={styles.dashboardContainer}>
			{/* Overview Header */}
			<div className={styles.overviewHeader}>
				<h2 className={styles.overviewTitle}>{currentMonthLabel} overview</h2>
				<span className={styles.activeBadge}>{activeReports} active reports</span>
			</div>

			{error && <p className={styles.error} role="alert">{error}</p>}

			{/* Top Metrics Grid */}
			<div className={styles.metricsGrid}>
				<div className={`${styles.metricCard} ${styles.whiteCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabel}>Total reports</span>
						<div className={styles.cardIcon}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
						</div>
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValue}>{metrics ? metrics.total.toLocaleString() : '—'}</strong>
						<span className={styles.trendBadge}>{totalTrend}</span>
					</div>
					<p className={styles.cardSubtitle}>This month · 114 in {prevMonthLabel}</p>
				</div>

				<div className={`${styles.metricCard} ${styles.whiteCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabel}>Resolved reports</span>
						<div className={styles.cardIcon}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
						</div>
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValue}>{metrics ? metrics.resolved.toLocaleString() : '—'}</strong>
						<span className={styles.trendBadge}>{resolvedTrend}</span>
					</div>
					<p className={styles.cardSubtitle}>This month · 80 in {prevMonthLabel}</p>
				</div>

				<div className={`${styles.metricCard} ${styles.darkCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabelLight}>Resolution rate</span>
						<div className={styles.cardIconLight}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
						</div>
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValueLight}>{metrics ? `${metrics.resolvedPercentage.toFixed(0)}%` : '—'}</strong>
						<span className={styles.trendBadgeDark}>{rateTrend}</span>
					</div>
					<p className={styles.cardSubtitleLight}>Up from 70% in {prevMonthLabel}</p>
				</div>
			</div>

			{isLoading && <p className={styles.state} role="status">Loading report metrics...</p>}

			{/* Charts Row */}
			<div className={styles.chartsGrid}>
				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="daily-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="daily-chart-heading" className={styles.chartTitle}>Reports per day</h3>
							<p className={styles.chartSubtitle}>{metrics?.dailyReports?.reduce((s, r) => s + r.count, 0) ?? 0} reports · {currentMonthLabel}</p>
						</div>
						<span className={styles.filterBadge}>Last 7 days</span>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={dailyChartCanvas} role="img" aria-label="Line chart of reports per day" />
					</div>
					{!isLoading && !error && (metrics?.dailyReports?.length ?? 0) === 0 && <p className={styles.emptyState}>No reports to display yet.</p>}
				</section>

				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="category-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="category-chart-heading" className={styles.chartTitle}>Incidents by category</h3>
							<p className={styles.chartSubtitle}>{currentMonthLabel} {now.getFullYear()} · {metrics?.total ?? 0} total reports</p>
						</div>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={chartCanvas} role="img" aria-label="Bar chart of report counts by category" />
					</div>
					{!isLoading && !error && metrics?.total === 0 && <p className={styles.emptyState}>No reports to display yet.</p>}
				</section>
			</div>

			{/* Monthly Incident Report */}
			<div className={styles.reportSection}>
				<MonthlyIncidentReport />
			</div>
		</div>
	);
}
