 import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import PendingReportsTable from '../components/PendingReportsTable';
import ArchivedReportsTable from '../components/ArchivedReportsTable';
import { useAppRole, canManageReports } from '../auth/roles';
import { buildDashboardCsv, downloadCsv, exportFilename } from '../utils/exportCsv';
import { generateDashboardPdf } from '../utils/exportPdf';
import AdminUserManagement from '../components/AdminUserManagement';
import styles from './Dashboard.module.css';

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip);

const CATEGORY_COLORS = ['#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#6366f1', '#14b8a6', '#64748b'];
const STATUS_COLORS = {
	Open: '#3b82f6',
	Resolved: '#10b981',
	Pending: '#eab308',
	Rejected: '#ef4444',
};

function getMonthOptions() {
	const options = [];
	const now = new Date();
	for (let i = 0; i < 12; i++) {
		const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
		const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
		const label = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
		options.push({ value, label });
	}
	return options;
}

function formatTrend(value) {
	if (value === null || value === undefined) return { text: '—', className: '' };
	const sign = value > 0 ? '+' : '';
	return { text: `${sign}${value}%`, className: value >= 0 ? styles.trendUp : styles.trendDown };
}

export default function Dashboard() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { isLoaded: roleLoaded, role } = useAppRole();
	const canManage = roleLoaded && canManageReports(role);
	const canAdmin = roleLoaded && role === 'admin';

	const [selectedMonth, setSelectedMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
	const [selectedMunicipality, setSelectedMunicipality] = useState('all');
	const [data, setData] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [isExportingPdf, setIsExportingPdf] = useState(false);

	const categoryChartRef = useRef(null);
	const statusChartRef = useRef(null);
	const municipalityChartRef = useRef(null);
	const dailyChartRef = useRef(null);
	const dashboardRef = useRef(null);

	const monthOptions = getMonthOptions();
	const municipalities = data?.municipalities ?? [];

	// Fetch monthly report data
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

	// Category Chart (Horizontal Bar)
	useEffect(() => {
		if (!categoryChartRef.current || !data?.byCategory?.length) return undefined;
		const chart = new Chart(categoryChartRef.current, {
			type: 'bar',
			data: {
				labels: data.byCategory.map((c) => c.name),
				datasets: [{
					label: 'Reports',
					data: data.byCategory.map((c) => c.total),
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
					tooltip: { displayColors: false, callbacks: { label: (ctx) => ` ${ctx.parsed.x} reports` } },
				},
				scales: {
					x: { beginAtZero: true, ticks: { display: false }, grid: { display: false }, border: { display: false } },
					y: { grid: { display: false }, ticks: { autoSkip: false, color: '#64748b', font: { size: 11 } }, border: { display: false } },
				},
			},
			plugins: [{
				id: 'valueLabels',
				afterDatasetsDraw(chartInstance) {
					const { ctx } = chartInstance;
					chartInstance.data.datasets.forEach((dataset, i) => {
						const meta = chartInstance.getDatasetMeta(i);
						meta.data.forEach((bar, index) => {
							ctx.fillStyle = '#0f172a';
							ctx.font = 'bold 11px Inter, sans-serif';
							ctx.textAlign = 'left';
							ctx.textBaseline = 'middle';
							ctx.fillText(dataset.data[index], bar.x + 8, bar.y);
						});
					});
				},
			}],
		});
		return () => chart.destroy();
	}, [data]);

	// Status Chart (Doughnut)
	useEffect(() => {
		if (!statusChartRef.current || !data?.byStatus?.length) return undefined;
		const chart = new Chart(statusChartRef.current, {
			type: 'doughnut',
			data: {
				labels: data.byStatus.map((s) => s.status),
				datasets: [{
					data: data.byStatus.map((s) => s.count),
					backgroundColor: data.byStatus.map((s) => STATUS_COLORS[s.status] || '#64748b'),
					borderWidth: 0,
					hoverOffset: 4,
				}],
			},
			options: {
				maintainAspectRatio: false,
				responsive: true,
				cutout: '65%',
				plugins: {
					legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 11 } } },
					tooltip: { displayColors: true, callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} (${Math.round((ctx.parsed / ctx.dataset.data.reduce((a, b) => a + b, 0)) * 100)}%)` } },
				},
			},
		});
		return () => chart.destroy();
	}, [data]);

	// Municipality Chart (Vertical Bar)
	useEffect(() => {
		if (!municipalityChartRef.current || !data?.byMunicipality?.length) return undefined;
		const topMunicipalities = data.byMunicipality.slice(0, 10);
		const chart = new Chart(municipalityChartRef.current, {
			type: 'bar',
			data: {
				labels: topMunicipalities.map((m) => m.municipality),
				datasets: [{
					label: 'Reports',
					data: topMunicipalities.map((m) => m.count),
					backgroundColor: '#6366f1',
					borderRadius: 4,
					borderSkipped: false,
				}],
			},
			options: {
				maintainAspectRatio: false,
				responsive: true,
				plugins: {
					legend: { display: false },
					tooltip: { displayColors: false, callbacks: { label: (ctx) => ` ${ctx.parsed.y} reports` } },
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8', font: { size: 10 } }, grid: { color: '#f1f5f9' }, border: { display: false } },
					x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 }, border: { display: false } },
				},
			},
		});
		return () => chart.destroy();
	}, [data]);

	// Daily Trend Chart (Line)
	useEffect(() => {
		if (!dailyChartRef.current || !data?.dailyReports?.length) return undefined;
		const chart = new Chart(dailyChartRef.current, {
			type: 'line',
			data: {
				labels: data.dailyReports.map((r) => new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: 'UTC' }).format(new Date(`${r.day}T00:00:00Z`))),
				datasets: [{
					label: 'Reports',
					data: data.dailyReports.map((r) => r.count),
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
					tooltip: { displayColors: false, callbacks: { label: (ctx) => ` ${ctx.parsed.y} reports` } },
				},
				scales: {
					y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8', font: { size: 10 } }, grid: { color: '#f1f5f9' }, border: { display: false } },
					x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } }, border: { display: false } },
				},
			},
		});
		return () => chart.destroy();
	}, [data]);

	const activeReports = data ? Math.max(data.total - data.resolved, 0) : 0;
	const monthLabel = monthOptions.find((o) => o.value === selectedMonth)?.label || selectedMonth;
	const totalTrend = formatTrend(data?.trends?.totalChange);
	const resolvedTrend = formatTrend(data?.trends?.resolvedChange);
	const rateTrend = formatTrend(data?.trends?.rateChange);
	const resolutionRate = data && data.total ? Math.round((data.resolved / data.total) * 1000) / 10 : 0;

	const handleExportCsv = () => {
		const csv = buildDashboardCsv({
			metrics: data ? { total: data.total, resolved: data.resolved, resolvedPercentage: resolutionRate, categories: data.byCategory.map((c) => ({ name: c.name, count: c.total })), dailyReports: data.dailyReports } : null,
			monthly: { month: selectedMonth, municipality: selectedMunicipality, data },
			monthLabel,
			year: Number(selectedMonth.split('-')[0]),
			exportedAt: new Date().toLocaleString(),
		});
		downloadCsv(exportFilename(new Date()), csv);
	};

	const handleExportPdf = async () => {
		if (!dashboardRef.current || !data) return;
		setIsExportingPdf(true);
		try {
			await generateDashboardPdf(dashboardRef.current, {
				monthLabel,
				municipality: selectedMunicipality === 'all' ? 'All Municipalities' : selectedMunicipality,
				generatedAt: new Date().toLocaleString(),
			});
		} catch (err) {
			console.error('PDF export failed:', err);
			setError('Failed to generate PDF. Please try again.');
		} finally {
			setIsExportingPdf(false);
		}
	};

	return (
		<div className={styles.dashboardContainer} ref={dashboardRef}>
			{/* Overview Header */}
			<div className={`${styles.overviewHeader} ${styles.noPrint}`}>
				<h2 className={styles.overviewTitle}>Month: {monthLabel}</h2>
				<div className={styles.overviewActions}>
					<select
						className={styles.filterSelect}
						value={selectedMonth}
						onChange={(e) => setSelectedMonth(e.target.value)}
						aria-label="Select month"
					>
						{monthOptions.map((option) => (
							<option key={option.value} value={option.value}>{option.label}</option>
						))}
					</select>
					<select
						className={styles.filterSelect}
						value={selectedMunicipality}
						onChange={(e) => setSelectedMunicipality(e.target.value)}
						aria-label="Filter by municipality"
					>
						<option value="all">All municipalities</option>
						{municipalities.map((m) => (
							<option key={m} value={m}>{m}</option>
						))}
					</select>
					<button
						type="button"
						className={`primary-btn ${styles.exportBtn}`}
						onClick={handleExportCsv}
						disabled={!data || isLoading}
						aria-label="Export dashboard data as CSV"
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
						Export as Spreadsheet
					</button>
					<button
						type="button"
						className={`primary-btn ${styles.exportBtn}`}
						onClick={handleExportPdf}
						disabled={!data || isLoading || isExportingPdf}
						aria-label="Generate PDF report"
					>
						{isExportingPdf ? (
							<>Generating...</>
						) : (
							<>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
								Export as PDF
							</>
						)}
					</button>
				</div>
			</div>

			{error && <p className={styles.error} role="alert">{error}</p>}

			{/* Top Metrics Grid */}
			<div className={styles.metricsGrid}>
				<div className={`${styles.metricCard} ${styles.whiteCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabel}>All Reports</span>
						{/*<div className={styles.cardIcon}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
						</div>*/}
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValue}>{data ? data.total.toLocaleString() : '—'}</strong>
						{data && <span className={`${styles.trendBadge} ${totalTrend.className}`}>{totalTrend.text}</span>}
					</div>
					
				</div>

				<div className={`${styles.metricCard} ${styles.whiteCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabel}>Resolved Reports</span>
						{/*<div className={styles.cardIcon}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
						</div>*/}
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValue}>{data ? data.resolved.toLocaleString() : '—'}</strong>
						{data && <span className={`${styles.trendBadge} ${resolvedTrend.className}`}>{resolvedTrend.text}</span>}
					</div>
					
				</div>

				<div className={`${styles.metricCard} ${styles.darkCard}`}>
					<div className={styles.cardHeader}>
						<span className={styles.cardLabelLight}>Ratio</span>
						{/*<div className={styles.cardIconLight}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
						</div>*/}
					</div>
					<div className={styles.cardValueRow}>
						<strong className={styles.cardValueLight}>{data ? `${resolutionRate}%` : '—'}</strong>
						
					</div>
				</div>
			</div>

			{isLoading && <p className={styles.state} role="status">Loading report metrics...</p>}

			{/* Charts Grid */}
			<div className={styles.chartsGrid}>
				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="daily-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="daily-chart-heading" className={styles.chartTitle}>Report Counts</h3>
						</div>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={dailyChartRef} role="img" aria-label="Line chart of daily report counts" />
					</div>
					{!isLoading && !error && (data?.dailyReports?.length ?? 0) === 0 && <p className={styles.emptyState}>No reports to display yet.</p>}
				</section>

				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="category-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="category-chart-heading" className={styles.chartTitle}>Categories</h3>
							
						</div>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={categoryChartRef} role="img" aria-label="Bar chart of report counts by category" />
					</div>
					{!isLoading && !error && (data?.byCategory?.length ?? 0) === 0 && <p className={styles.emptyState}>No categories to display.</p>}
				</section>

				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="status-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="status-chart-heading" className={styles.chartTitle}>By status</h3>
						</div>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={statusChartRef} role="img" aria-label="Doughnut chart of report status distribution" />
					</div>
					{!isLoading && !error && (data?.byStatus?.length ?? 0) === 0 && <p className={styles.emptyState}>No status data available.</p>}
				</section>

				<section className={`${styles.chartCard} ${styles.whiteCard}`} aria-labelledby="municipality-chart-heading">
					<div className={styles.chartHeader}>
						<div>
							<h3 id="municipality-chart-heading" className={styles.chartTitle}>Top municipalities</h3>
						</div>
					</div>
					<div className={styles.chartFrame}>
						<canvas ref={municipalityChartRef} role="img" aria-label="Bar chart of top municipalities by report count" />
					</div>
					{!isLoading && !error && (data?.byMunicipality?.length ?? 0) === 0 && <p className={styles.emptyState}>No municipality data available.</p>}
				</section>
			</div>
				
			{/* Accessible Data Table (hidden visually, visible to screen readers and PDF) */}
			{data && (
				<div className={styles.srOnly}>
					<table>
						<caption>Monthly Report Data for {monthLabel}</caption>
						<thead><tr><th>Category</th><th>Total</th><th>Resolved</th><th>Active</th></tr></thead>
						<tbody>
							{data.byCategory.map((c) => (
								<tr key={c.name}><td>{c.name}</td><td>{c.total}</td><td>{c.resolved}</td><td>{c.active}</td></tr>
							))}
						</tbody>
					</table>
					<table>
						<caption>Status Breakdown</caption>
						<thead><tr><th>Status</th><th>Count</th></tr></thead>
						<tbody>
							{data.byStatus.map((s) => (
								<tr key={s.status}><td>{s.status}</td><td>{s.count}</td></tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{/* Pending review (managers only) */}
			{canManage && (<>
				<h2>Enforcer-only Panel</h2>
				<div className={`${styles.reportSection} ${styles.noPrint}`}>
					<PendingReportsTable />
				</div>
				<div className={`${styles.reportSection} ${styles.noPrint}`}>
					<ArchivedReportsTable />
				</div>
				</>
			)}

			
			

			{/* Admin User Management (admin only) */}
			{canAdmin && (
				<>
				<h2 className={`${styles.subHeading}`}>Admin-Only Panel</h2>
				<div className={`${styles.reportSection} ${styles.noPrint}`}>
					<AdminUserManagement />
				</div>
				</>
			)}
		</div>
	);
}
