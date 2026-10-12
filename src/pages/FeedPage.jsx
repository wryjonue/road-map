import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import ReportPostCard from '../components/ReportPostCard';
import styles from './FeedPage.module.css';

const DEFAULT_FILTERS = { categoryId: '', status: '', municipality: '', q: '', sort: 'recent' };
const STATUS_OPTIONS = [
	{ value: '', label: 'All statuses' },
	{ value: 'Open', label: 'Open' },
	{ value: 'Pending', label: 'Pending' },
	{ value: 'Resolved', label: 'Resolved' },
	{ value: 'Rejected', label: 'Rejected' },
];
const SORT_OPTIONS = [
	{ value: 'recent', label: 'Most recent' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'votes', label: 'Most voted' },
];

function filtersEqual(a, b) {
	return Object.keys(DEFAULT_FILTERS).every((key) => a[key] === b[key]);
}

function buildQuery(filters, offset) {
	const params = new URLSearchParams({ limit: '10', offset: String(offset) });
	if (filters.categoryId) params.set('categoryId', filters.categoryId);
	if (filters.status) params.set('status', filters.status);
	if (filters.municipality) params.set('municipality', filters.municipality);
	if (filters.q.trim()) params.set('q', filters.q.trim());
	if (filters.sort && filters.sort !== 'recent') params.set('sort', filters.sort);
	return params.toString();
}

export default function FeedPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { user } = useUser();
	const authorName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
	const [reports, setReports] = useState([]);
	const [pagination, setPagination] = useState({ limit: 10, offset: 0, total: 0, hasMore: false });
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');

	// Facets for the dropdowns
	const [categories, setCategories] = useState([]);
	const [municipalities, setMunicipalities] = useState([]);

	// Pending = what the controls show; applied = what was last fetched.
	const [pendingFilters, setPendingFilters] = useState(DEFAULT_FILTERS);
	const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
	const isDirty = useMemo(() => !filtersEqual(pendingFilters, appliedFilters), [pendingFilters, appliedFilters]);
	const hasActiveFilters = useMemo(
		() => !filtersEqual(appliedFilters, DEFAULT_FILTERS),
		[appliedFilters]
	);

	const loadReports = useCallback(async (filters, offset = 0, append = false) => {
		setIsLoading(true);
		setError('');
		try {
			const token = isSignedIn ? await getToken() : null;
			const response = await fetch(`/api/reports?${buildQuery(filters, offset)}`, {
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

	// Load facets once on mount.
	useEffect(() => {
		if (!isLoaded) return undefined;
		const controller = new AbortController();
		const loadFacets = async () => {
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch('/api/reports/facets', {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok || controller.signal.aborted) return;
				setCategories(Array.isArray(data.categories) ? data.categories : []);
				setMunicipalities(Array.isArray(data.municipalities) ? data.municipalities : []);
			} catch {
				/* facets are non-critical; dropdowns just stay empty */
			}
		};
		void loadFacets();
		return () => controller.abort();
	}, [getToken, isLoaded, isSignedIn]);

	// Initial load with default filters.
	useEffect(() => {
		if (isLoaded) void loadReports(DEFAULT_FILTERS);
	}, [isLoaded, loadReports]);

	const updateFilter = (key, value) => setPendingFilters((prev) => ({ ...prev, [key]: value }));

	const applyFilters = () => {
		setAppliedFilters(pendingFilters);
		void loadReports(pendingFilters, 0, false);
	};

	const clearFilters = () => {
		setPendingFilters(DEFAULT_FILTERS);
		setAppliedFilters(DEFAULT_FILTERS);
		void loadReports(DEFAULT_FILTERS, 0, false);
	};

	const handleSearchKeyDown = (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			applyFilters();
		}
	};

	return (
		<div className={styles.feedPage}>
			<div className={styles.feedHeader}>
				<p className={styles.feedSubtitle}>Local voices. Safer journeys. Share what you see.</p>
			</div>

			<div className={styles.topbar}>
				<div className={styles.searchWrap}>
					<input
						type="search"
						className={styles.searchInput}
						placeholder="Search reports, routes, or locations"
						aria-label="Search reports"
						value={pendingFilters.q}
						onChange={(e) => updateFilter('q', e.target.value)}
						onKeyDown={handleSearchKeyDown}
					/>
				</div>
				<Link to="/feed/create" className="primary-btn action-link">+ Create report</Link>
			</div>

			<div className={styles.filterBar}>
				<select
					className={styles.filterSelect}
					value={pendingFilters.categoryId}
					onChange={(e) => updateFilter('categoryId', e.target.value)}
					aria-label="Filter by category"
				>
					<option value="">All categories</option>
					{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
				</select>
				<select
					className={styles.filterSelect}
					value={pendingFilters.municipality}
					onChange={(e) => updateFilter('municipality', e.target.value)}
					aria-label="Filter by municipality"
				>
					<option value="">All municipalities</option>
					{municipalities.map((m) => <option key={m} value={m}>{m}</option>)}
				</select>
				<select
					className={styles.filterSelect}
					value={pendingFilters.status}
					onChange={(e) => updateFilter('status', e.target.value)}
					aria-label="Filter by status"
				>
					{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
				</select>
				<select
					className={styles.filterSelect}
					value={pendingFilters.sort}
					onChange={(e) => updateFilter('sort', e.target.value)}
					aria-label="Sort reports"
				>
					{SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
				</select>

				{isDirty && (
					<button type="button" className={`primary-btn ${styles.applyBtn}`} onClick={applyFilters}>Apply filters</button>
				)}
				{hasActiveFilters && !isDirty && (
				<button className="ghost-btn" type="button" onClick={clearFilters}>Clear filters</button>
				)}
			</div>

			{isLoading && reports.length === 0 && <p className={styles.state}>Loading reports...</p>}
			{error && <p className={styles.error} role="alert">{error}</p>}
			{!isLoading && !error && reports.length === 0 && <p className={styles.state}>No reports match these filters.</p>}
			{reports.length > 0 && (
				<div className={styles.list}>
					{reports.map((report) => (
						<ReportPostCard
							key={report.id}
							{...report}
							authorImageUrl={report.authorImageUrl || (report.authorId === user?.id ? user?.imageUrl : null)}
							poster={report.authorName || (report.authorId === user?.id ? authorName : report.authorId)}
							date={report.createdAt}
						/>
					))}
				</div>
			)}
			{pagination.hasMore && (
				<button
					type="button"
					className={`secondary-btn ${styles.loadMore}`}
					onClick={() => loadReports(appliedFilters, reports.length, true)}
					disabled={isLoading}
				>
					{isLoading ? 'Loading...' : 'Load more'}
				</button>
			)}
		</div>
	);
}
