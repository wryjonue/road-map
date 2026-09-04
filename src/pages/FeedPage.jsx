import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import ReportPostCard from '../components/ReportPostCard';
import styles from './FeedPage.module.css';

export default function FeedPage() {
	const [reports, setReports] = useState([]);
	const [pagination, setPagination] = useState({ limit: 10, offset: 0, total: 0, hasMore: false });
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	const loadReports = async (offset = 0, append = false) => {
		setIsLoading(true);
		setError('');
		try {
			const response = await fetch(`/api/reports?limit=10&offset=${offset}`);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to load reports');
			setReports((current) => append ? [...current, ...data.reports] : data.reports);
			setPagination(data.pagination);
		} catch (loadError) {
			setError(loadError.message);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => { loadReports(); }, []);

	return (
		<section className={`page-card ${styles.feedPage}`}>
			<div className={styles.topbar}>
				<div className={styles.searchWrap}><input type="search" placeholder="Search reports, routes, or locations" aria-label="Search reports" /></div>
				<Link to="/feed/create" className="primary-btn action-link">Create Report</Link>
			</div>
			{isLoading && reports.length === 0 && <p className={styles.state}>Loading reports...</p>}
			{error && <p className={styles.error} role="alert">{error}</p>}
			{!isLoading && !error && reports.length === 0 && <p className={styles.state}>No reports found.</p>}
			{reports.length > 0 && <div className={styles.list}>{reports.map((report) => <ReportPostCard key={report.id} {...report} poster={report.authorName || report.authorId} date={report.createdAt} votes={report.voteCount} comments={report.commentCount} />)}</div>}
			{pagination.hasMore && <button type="button" className={`primary-btn ${styles.loadMore}`} onClick={() => loadReports(pagination.offset + pagination.limit, true)} disabled={isLoading}>{isLoading ? 'Loading...' : 'Load More'}</button>}
		</section>
	);
}
