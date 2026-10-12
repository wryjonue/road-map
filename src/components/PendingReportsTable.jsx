import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useAppRole, canManageReports } from '../auth/roles';
import styles from './PendingReportsTable.module.css';

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

export default function PendingReportsTable() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { isLoaded: roleLoaded, role } = useAppRole();
	const [reports, setReports] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const [actingId, setActingId] = useState(null);

	const isManager = roleLoaded && canManageReports(role);

	const loadPending = useCallback(async () => {
		setIsLoading(true);
		setError('');
		try {
			const token = isSignedIn ? await getToken() : null;
			const response = await fetch('/api/dashboard/pending?limit=10', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			const data = await response.json();
			if (response.status === 403) { setReports([]); return; }
			if (!response.ok) throw new Error(data.error || 'Unable to load pending reports');
			setReports(Array.isArray(data.reports) ? data.reports : []);
		} catch (loadError) {
			setError(loadError.message || 'Unable to load pending reports');
		} finally {
			setIsLoading(false);
		}
	}, [getToken, isSignedIn]);

	useEffect(() => {
		if (isLoaded && isManager) void loadPending();
	}, [isLoaded, isManager, loadPending]);

	const handleAction = async (reportId, action) => {
		setActingId(reportId);
		setError('');
		try {
			const token = isSignedIn ? await getToken() : null;
			const response = await fetch(`/api/reports/${reportId}/status`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ status: action === 'approve' ? 'Open' : 'Rejected' }),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || `Unable to ${action} report`);
			// Optimistic removal — refresh only this component's list.
			setReports((current) => current.filter((r) => r.id !== reportId));
		} catch (actionError) {
			setError(actionError.message || `Unable to ${action} report`);
			// Restore correct state by refetching the pending list.
			void loadPending();
		} finally {
			setActingId(null);
		}
	};

	if (!roleLoaded || !isManager) return null;

	return (
		<section className={styles.card} aria-labelledby="pending-heading">
			<div className={styles.header}>
				<h2 id="pending-heading" className={styles.title}>Pending review</h2>
				{!isLoading && <span className={styles.countBadge}>{reports.length} pending</span>}
			</div>

			{error && <p className={styles.error} role="alert">{error}</p>}

			{isLoading && <p className={styles.state} role="status">Loading pending reports…</p>}

			{!isLoading && !error && reports.length === 0 && (
				<p className={styles.state}>No pending reports to review.</p>
			)}

			{!isLoading && reports.length > 0 && (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								<th>Poster</th>
								<th>Title</th>
								<th className={styles.descCol}>Description</th>
								<th>Location</th>
								<th>Category</th>
								<th className={styles.actionsCol}>Actions</th>
							</tr>
						</thead>
						<tbody>
							{reports.map((report) => {
								const acting = actingId === report.id;
								return (
									<tr key={report.id}>
										<td className={styles.posterCell}>{report.poster}</td>
										<td className={styles.titleCell}>{report.title}</td>
										<td className={`${styles.descCell} ${styles.descCol}`}>{report.description}</td>
										<td className={styles.locationCell}>{locationDisplayName(report.location)}</td>
										<td>
											<span
												className={styles.categoryPill}
												style={{ '--category-color': CATEGORY_COLORS[report.category?.id] || '#5f6972' }}
											>
												{report.category?.name || 'Uncategorized'}
											</span>
										</td>
										<td className={styles.actionsCol}>
											<div className={styles.actions}>
												<button
													type="button"
													className={`${styles.actionBtn} ${styles.acceptBtn}`}
													aria-label={`Approve report: ${report.title}`}
													title="Approve"
													disabled={actingId !== null}
													onClick={() => handleAction(report.id, 'approve')}
												>
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
												</button>
												<button
													type="button"
													className={`${styles.actionBtn} ${styles.rejectBtn}`}
													aria-label={`Reject report: ${report.title}`}
													title="Reject"
													disabled={actingId !== null}
													onClick={() => handleAction(report.id, 'reject')}
												>
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
												</button>
												{acting && <span className={styles.actingDot} aria-hidden="true" />}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
