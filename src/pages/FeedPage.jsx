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

	const resolveReport = async (reportId) => {
		if (!canManageReports(role) || mutatingReport) return;
		setMutatingReport({ id: reportId, action: 'resolve' });
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
			setMutatingReport(null);
		}
	};

	const approveReport = async (reportId) => {
		if (!canManageReports(role) || mutatingReport) return;
		setMutatingReport({ id: reportId, action: 'approve' });
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to update this report.');
			const response = await fetch(`/api/reports/${reportId}/status`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'Open' }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to approve report');
			setReports((current) => current.map((report) => report.id === reportId ? { ...report, ...data } : report));
		} catch (approveError) {
			setError(approveError.message);
		} finally {
			setMutatingReport(null);
		}
	};

	const deleteReport = async (report) => {
		const canDelete = canManageReports(role) || report.authorId === user?.id;
		if (!canDelete || mutatingReport || !window.confirm('Delete this pending report?')) return;
		setMutatingReport({ id: report.id, action: 'delete' });
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to update this report.');
			const response = await fetch(`/api/reports/${report.id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to delete report');
			setReports((current) => current.filter((currentReport) => currentReport.id !== report.id));
			setPagination((current) => {
				const total = Math.max(0, current.total - 1);
				return { ...current, total, hasMore: reports.length - 1 < total };
			});
		} catch (deleteError) {
			setError(deleteError.message);
		} finally {
			setMutatingReport(null);
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
			{reports.length > 0 && <div className={styles.list}>{reports.map((report) => <ReportPostCard key={report.id} {...report} authorImageUrl={report.authorImageUrl || (report.authorId === user?.id ? user?.imageUrl : null)} poster={report.authorName || (report.authorId === user?.id ? authorName : report.authorId)} date={report.createdAt} votes={report.voteCount} comments={report.commentCount} canResolve={canManageReports(role)} isResolving={mutatingReport?.id === report.id && mutatingReport.action === 'resolve'} canModeratePending={canManageReports(role)} canDeletePending={canManageReports(role) || report.authorId === user?.id} isApproving={mutatingReport?.id === report.id && mutatingReport.action === 'approve'} isDeleting={mutatingReport?.id === report.id && mutatingReport.action === 'delete'} isBusy={Boolean(mutatingReport)} onResolve={() => resolveReport(report.id)} onApprove={() => approveReport(report.id)} onDelete={() => deleteReport(report)} />)}</div>}
			{pagination.hasMore && <button type="button" className={`primary-btn ${styles.loadMore}`} onClick={() => loadReports(reports.length, true)} disabled={isLoading}>{isLoading ? 'Loading...' : 'Load More'}</button>}
		</section>
	);
}
