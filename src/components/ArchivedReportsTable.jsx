import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useAppRole, canManageReports } from '../auth/roles';
import styles from './ArchivedReportsTable.module.css';

const CATEGORY_COLORS = {
	1: '#c65d2e',
	2: '#bd3e50',
	3: '#8b6aad',
	4: '#27829a',
	5: '#607d35',
	6: '#c28a22',
	7: '#376fa3',
	8: '#aa4776',
	9: '#5f6972',
};

function locationDisplayName(location) {
	if (!location) return '—';
	const parts = [location.barangay, location.city, location.province]
		.filter((part) => typeof part === 'string' && part.trim());
	return parts.length > 0 ? parts.join(', ') : '—';
}

function formatArchivedDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ArchivedReportsTable() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { isLoaded: roleLoaded, role } = useAppRole();
	const [reports, setReports] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	const isManager = roleLoaded && canManageReports(role);

	const loadArchived = useCallback(async () => {
		setIsLoading(true);
		setError('');
		try {
			const token = isSignedIn ? await getToken() : null;
			const response = await fetch('/api/dashboard/archived?limit=10', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			const data = await response.json();
			if (response.status === 403) { setReports([]); return; }
			if (!response.ok) throw new Error(data.error || 'Unable to load archived reports');
			setReports(Array.isArray(data.reports) ? data.reports : []);
		} catch (loadError) {
			setError(loadError.message || 'Unable to load archived reports');
		} finally {
			setIsLoading(false);
		}
	}, [getToken, isSignedIn]);

	useEffect(() => {
		if (isLoaded && isManager) void loadArchived();
	}, [isLoaded, isManager, loadArchived]);

	if (!roleLoaded || !isManager) return null;

	return (
		<section className={styles.card} aria-labelledby="archived-heading">
			<div className={styles.header}>
				<h2 id="archived-heading" className={styles.title}>Recently archived</h2>
				{!isLoading && <span className={styles.countBadge}>{reports.length} archived</span>}
			</div>

			<p className={styles.subtitle}>Rejected and deleted reports are kept here for the record — they are hidden from everyone else.</p>

			{error && <p className={styles.error} role="alert">{error}</p>}

			{isLoading && <p className={styles.state} role="status">Loading archived reports…</p>}

			{!isLoading && !error && reports.length === 0 && (
				<p className={styles.state}>No archived reports yet.</p>
			)}

			{!isLoading && reports.length > 0 && (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								<th>Poster</th>
								<th>Title</th>
								<th>Category</th>
								<th>Location</th>
								<th>Reason</th>
								<th>Archived</th>
							</tr>
						</thead>
						<tbody>
							{reports.map((report) => (
								<tr key={report.id}>
									<td className={styles.posterCell}>{report.poster}</td>
									<td className={styles.titleCell}>{report.title}</td>
									<td>
										<span
											className={styles.categoryPill}
											style={{ '--category-color': CATEGORY_COLORS[report.category?.id] || '#5f6972' }}
										>
											{report.category?.name || 'Uncategorized'}
										</span>
									</td>
									<td className={styles.locationCell}>{locationDisplayName(report.location)}</td>
									<td>
										<span className={`${styles.reasonPill} ${report.reason === 'Deleted' ? styles.reasonDeleted : styles.reasonRejected}`}>
											{report.reason}
										</span>
									</td>
									<td className={styles.dateCell}>{formatArchivedDate(report.archivedAt)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
