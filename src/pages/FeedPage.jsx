import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import ReportPostCard from '../components/ReportPostCard';
import styles from './FeedPage.module.css';

const DEFAULT_FILTERS = { categoryId: '', status: '', municipality: '', q: '', sort: 'recent' };
const VIEW_MODES = { default: 'default', list: 'list' };
const VIEW_MODE_STORAGE_KEY = 'road-map:feed-view-mode';
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

function locationDisplayName(location) {
	if (!location) return '—';
	const parts = [location.barangay, location.city, location.province]
		.filter((part) => typeof part === 'string' && part.trim());
	return parts.length > 0 ? parts.join(', ') : '—';
}

function readStoredViewMode() {
	try {
		const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
		return stored === VIEW_MODES.list ? VIEW_MODES.list : VIEW_MODES.default;
	} catch {
		return VIEW_MODES.default;
	}
}

function ListAuthorAvatar({ src, name }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	const initials = name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
	return (
		<span className={styles.avatar}>
			{src && !failed
				? <img src={src} alt="" onError={() => setFailed(true)} />
				: initials}
		</span>
	);
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
	const [viewMode, setViewMode] = useState(readStoredViewMode);

	// Persist the selected view mode across visits.
	useEffect(() => {
		try {
			window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
		} catch {
			/* storage unavailable (private mode); toggle still works for this visit */
		}
	}, [viewMode]);

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
				<div className={styles.viewToggle} role="group" aria-label="Feed view mode">
					<button
						type="button"
						className={`${styles.viewToggleBtn} ${viewMode === VIEW_MODES.default ? styles.viewToggleBtnActive : ''}`}
						aria-pressed={viewMode === VIEW_MODES.default}
						onClick={() => setViewMode(VIEW_MODES.default)}
					>
						Default
					</button>
					<button
						type="button"
						className={`${styles.viewToggleBtn} ${viewMode === VIEW_MODES.list ? styles.viewToggleBtnActive : ''}`}
						aria-pressed={viewMode === VIEW_MODES.list}
						onClick={() => setViewMode(VIEW_MODES.list)}
					>
						List
					</button>
				</div>
			</div>

			{isLoading && reports.length === 0 && <p className={styles.state}>Loading reports...</p>}
			{error && <p className={styles.error} role="alert">{error}</p>}
			{!isLoading && !error && reports.length === 0 && <p className={styles.state}>No reports match these filters.</p>}
			{reports.length > 0 && viewMode === VIEW_MODES.default && (
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
			{reports.length > 0 && viewMode === VIEW_MODES.list && (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								<th>Poster</th>
								<th>Title</th>
								<th className={styles.descCol}>Description</th>
								<th>Location</th>
								<th>Category</th>
								<th>Status</th>
								<th className={styles.actionsCol}>Actions</th>
							</tr>
						</thead>
						<tbody>
							{reports.map((report) => {
								const poster = report.authorName || (report.authorId === user?.id ? authorName : report.authorId) || '—';
								const status = report.status || '—';
								return (
									<tr key={report.id}>
										<td className={styles.posterCell}>
											<div className={styles.posterRow}>
												<ListAuthorAvatar
													src={report.authorImageUrl || (report.authorId === user?.id ? user?.imageUrl : null)}
													name={poster}
												/>
												<span>{poster}</span>
											</div>
										</td>
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
										<td>
											<span className={`${styles.statusPill} ${styles[`status-${status.toLowerCase()}`] || ''}`}>
												{status}
											</span>
										</td>
										<td className={styles.actionsCol}>
											<div className={styles.actions}>
												<Link
													to={`/feed/${report.id}`}
													className={styles.viewBtn}
													aria-label={`View report: ${report.title}`}
												>
													View
												</Link>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
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
