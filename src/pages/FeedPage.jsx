import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@clerk/react';
import ReportPostCard from '../components/ReportPostCard';
import { canManageReports, useAppRole } from '../auth/roles';
import styles from './FeedPage.module.css';

export default function FeedPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { role } = useAppRole();
	const [reports, setReports] = useState([]);
	const [pagination, setPagination] = useState({ limit: 10, offset: 0, total: 0, hasMore: false });
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const [resolvingReportId, setResolvingReportId] = useState(null);

	const loadReports = useCallback(async (offset = 0, append = false) => {
		setIsLoading(true);
		setError('');
		try {
			const token = isSignedIn ? await getToken() : null;
			const response = await fetch(`/api/reports?limit=10&offset=${offset}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to load reports');
			setReports((current) => append ? [...current, ...data.reports] : data.reports);
			setPagination(data.pagination);
		} catch (loadError) {
			setError(loadError.message);
		} finally {
			setIsLoading(false);
		}
	}, [getToken, isSignedIn]);

	useEffect(() => {
		if (isLoaded) void loadReports();
	}, [isLoaded, loadReports]);

	const resolveReport = async (reportId) => {
		if (!canManageReports(role)) return;
		setResolvingReportId(reportId);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to update this report.');
			const response = await fetch(`/api/reports/${reportId}/status`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'Resolved' }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to resolve report');
			setReports((current) => current.map((report) => report.id === reportId ? { ...report, ...data } : report));
		} catch (resolveError) {
			setError(resolveError.message);
		} finally {
			setResolvingReportId(null);
		}
	};

	return (
		<section className={`page-card ${styles.feedPage}`}>
			<div className={styles.topbar}>
				<div className={styles.searchWrap}><input type="search" placeholder="Search reports, routes, or locations" aria-label="Search reports" /></div>
				<Link to="/feed/create" className="primary-btn action-link">Create Report</Link>
			</div>
			{isLoading && reports.length === 0 && <p className={styles.state}>Loading reports...</p>}
			{error && <p className={styles.error} role="alert">{error}</p>}
			{!isLoading && !error && reports.length === 0 && <p className={styles.state}>No reports found.</p>}
			{reports.length > 0 && <div className={styles.list}>{reports.map((report) => <ReportPostCard key={report.id} {...report} poster={report.authorName || report.authorId} date={report.createdAt} votes={report.voteCount} comments={report.commentCount} canResolve={canManageReports(role)} isResolving={resolvingReportId === report.id} onResolve={() => resolveReport(report.id)} />)}</div>}
			{pagination.hasMore && <button type="button" className={`primary-btn ${styles.loadMore}`} onClick={() => loadReports(pagination.offset + pagination.limit, true)} disabled={isLoading}>{isLoading ? 'Loading...' : 'Load More'}</button>}
		</section>
	);
}
