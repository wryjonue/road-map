import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import ReportPostCard from '../components/ReportPostCard';
import { canManageReports, useAppRole } from '../auth/roles';
import styles from './FeedPage.module.css';

export default function FeedPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { user } = useUser();
	const { role } = useAppRole();
	const authorName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
	const [reports, setReports] = useState([]);
	const [pagination, setPagination] = useState({ limit: 10, offset: 0, total: 0, hasMore: false });
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const [mutatingReport, setMutatingReport] = useState(null);

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

	const updateReportStatus = async (reportId, nextStatus) => {
		if (!canManageReports(role) || mutatingReport) return;
		setMutatingReport({ id: reportId, status: nextStatus });
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to update this report.');
			const response = await fetch(`/api/reports/${reportId}/status`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to update report status');
			setReports((current) => current.map((report) => report.id === reportId ? { ...report, ...data } : report));
		} catch (statusError) {
			setError(statusError.message);
		} finally {
			setMutatingReport(null);
		}
	};

	const deleteReport = async (reportId) => {
		if (mutatingReport || !window.confirm('Delete this report?')) return;
		setMutatingReport({ id: reportId, action: 'delete' });
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to delete this report.');
			const response = await fetch(`/api/reports/${reportId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to delete report');
			setReports((current) => current.filter((report) => report.id !== reportId));
		} catch (deleteError) {
			setError(deleteError.message);
		} finally {
			setMutatingReport(null);
		}
	};

	const handleVote = useCallback(async (reportId) => {
		const token = await getToken();
		if (!token) {
			setError('Sign in to vote on reports.');
			return null;
		}
		try {
			const response = await fetch(`/api/reports/${reportId}/vote`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to vote');
			// Optimistic update - the component will update its local state
			setReports((current) =>
				current.map((report) =>
					report.id === reportId ? { ...report, voteCount: data.voteCount } : report
				)
			);
			return data;
		} catch (voteError) {
			setError(voteError.message);
			return null;
		}
	}, [getToken]);

	return (
		<section className={`page-card ${styles.feedPage}`}>
			<div className={styles.topbar}>
				<div className={styles.searchWrap}><input type="search" placeholder="Search reports, routes, or locations" aria-label="Search reports" /></div>
				<Link to="/feed/create" className="primary-btn action-link">Create Report</Link>
			</div>
			{isLoading && reports.length === 0 && <p className={styles.state}>Loading reports...</p>}
			{error && <p className={styles.error} role="alert">{error}</p>}
			{!isLoading && !error && reports.length === 0 && <p className={styles.state}>No reports found.</p>}
			{reports.length > 0 && <div className={styles.list}>{reports.map((report) => <ReportPostCard key={report.id} {...report} authorImageUrl={report.authorImageUrl || (report.authorId === user?.id ? user?.imageUrl : null)} poster={report.authorName || (report.authorId === user?.id ? authorName : report.authorId)} date={report.createdAt} votes={report.voteCount} comments={report.commentCount} canChangeStatus={canManageReports(role)} canDelete={canManageReports(role) || report.authorId === user?.id} isStatusUpdating={mutatingReport?.id === report.id && mutatingReport?.action !== 'delete'} isBusy={Boolean(mutatingReport)} onStatusChange={(nextStatus) => updateReportStatus(report.id, nextStatus)} onDelete={() => deleteReport(report.id)} onVote={handleVote} />)}</div>}
			{pagination.hasMore && <button type="button" className={`primary-btn ${styles.loadMore}`} onClick={() => loadReports(reports.length, true)} disabled={isLoading}>{isLoading ? 'Loading...' : 'Load More'}</button>}
		</section>
	);
}
