import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { canManageReports, useAppRole } from '../auth/roles';
import styles from './ViewReportPage.module.css';

function AuthenticatedMediaImage({ src, alt, className }) {
	const { getToken, isLoaded } = useAuth();
	const [objectUrl, setObjectUrl] = useState('');
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!isLoaded || !src) return undefined;
		let nextObjectUrl;
		let cancelled = false;
		setObjectUrl('');
		setFailed(false);

		const loadMedia = async () => {
			try {
				const token = await getToken();
				const response = await fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
				if (!response.ok) throw new Error('Media request failed');
				const loadedObjectUrl = URL.createObjectURL(await response.blob());
				if (cancelled) {
					URL.revokeObjectURL(loadedObjectUrl);
					return;
				}
				nextObjectUrl = loadedObjectUrl;
				setObjectUrl(nextObjectUrl);
			} catch {
				if (!cancelled) setFailed(true);
			}
		};

		void loadMedia();
		return () => {
			cancelled = true;
			if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
		};
	}, [getToken, isLoaded, src]);

	if (failed) return <span className={styles.imagePlaceholder} role="img" aria-label={`${alt} unavailable`}>Media unavailable</span>;
	return objectUrl ? <img className={className} src={objectUrl} alt={alt} /> : <span className={styles.imagePlaceholder} role="status">Loading media...</span>;
}

function ReportMediaImage({ src, alt, className }) {
	if (src?.startsWith('/api/media/')) return <AuthenticatedMediaImage src={src} alt={alt} className={className} />;
	return <img className={className} src={src} alt={alt} />;
}

export default function ViewReportPage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { user } = useUser();
	const { role } = useAppRole();
	const mapContainer = useRef(null);
	const mapRef = useRef(null);
	const [report, setReport] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const [isMutating, setIsMutating] = useState(false);
	const userLocationRef = useRef(null);

	const canManage = canManageReports(role);
	const canDelete = canManage || (report && report.authorId === user?.id);

	useEffect(() => {
		if (!isLoaded) return undefined;
		const controller = new AbortController();
		const loadReport = async () => {
			setIsLoading(true);
			setError('');
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch(`/api/reports/${id}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Unable to load report');
				if (!controller.signal.aborted) setReport(data);
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load report');
			} finally {
				if (!controller.signal.aborted) setIsLoading(false);
			}
		};
		void loadReport();
		return () => controller.abort();
	}, [id, getToken, isLoaded, isSignedIn]);

	useEffect(() => {
		if (!mapContainer.current || !report) return undefined;
		maplibregl.setWorkerUrl(maplibreWorkerUrl);
		const center = [report.location.longitude, report.location.latitude];
		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
			center,
			zoom: 15,
		});
		mapRef.current = map;

		new maplibregl.Marker({ color: '#c65d2e' }).setLngLat(center).addTo(map);

		map.once('load', () => {
			if (userLocationRef.current) {
				new maplibregl.Marker({ color: '#3b82f6' }).setLngLat(userLocationRef.current).addTo(map);
			}
		});

		return () => {
			mapRef.current = null;
			map.remove();
		};
	}, [report]);

	useEffect(() => {
		if (!navigator.geolocation) return undefined;
		let cancelled = false;
		navigator.geolocation.getCurrentPosition(
			(position) => {
				if (cancelled) return;
				const coords = [position.coords.longitude, position.coords.latitude];
				userLocationRef.current = coords;
				if (mapRef.current && mapRef.current.loaded()) {
					new maplibregl.Marker({ color: '#3b82f6' }).setLngLat(coords).addTo(mapRef.current);
				}
			},
			() => {},
			{ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
		);
		return () => { cancelled = true; };
	}, []);

	const updateStatus = async (nextStatus) => {
		if (!canManage || isMutating) return;
		setIsMutating(true);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to update this report.');
			const response = await fetch(`/api/reports/${id}/status`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to update report status');
			setReport((current) => current ? { ...current, ...data } : current);
		} catch (statusError) {
			setError(statusError.message);
		} finally {
			setIsMutating(false);
		}
	};

	const deleteReport = async () => {
		if (isMutating || !window.confirm('Delete this report? This action cannot be undone.')) return;
		setIsMutating(true);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to delete this report.');
			const response = await fetch(`/api/reports/${id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to delete report');
			navigate('/feed');
		} catch (deleteError) {
			setError(deleteError.message);
		} finally {
			setIsMutating(false);
		}
	};

	if (isLoading) return <section className={`page-card ${styles.page}`}><p className={styles.state}>Loading report...</p></section>;
	if (error && !report) return <section className={`page-card ${styles.page}`}><p className={styles.error} role="alert">{error}</p><button type="button" className="primary-btn" onClick={() => navigate('/feed')}>Back to Feed</button></section>;
	if (!report) return null;

	const statusClass = `status-badge status-${report.status.toLowerCase()}`;
	const reportImageUrl = report.images?.[0]?.url || report.imageUrl;

	const statusOptions = canManage && report.status === 'Pending'
		? [{ label: 'Approve Report', value: 'Open' }, { label: 'Deny Report', value: 'Rejected' }]
		: canManage && report.status === 'Open'
			? [{ label: 'Resolve report', value: 'Resolved' }]
			: [];
	if (canDelete && (report.status === 'Pending' || report.status === 'Open')) {
		statusOptions.push({ label: 'Delete', value: 'Delete' });
	}

	return (
		<section className={`page-card ${styles.page}`}>
			{error && report && <p className={styles.error} role="alert">{error}</p>}
			<div className={styles.header}>
				<button type="button" className="ghost-btn" onClick={() => navigate('/feed')}>← Back to Feed</button>
				<div className={styles.headerActions}>
					{(canManage || canDelete) && statusOptions.length > 0
						? <select
							className={statusClass}
							value={report.status}
							onChange={(event) => event.target.value === 'Delete' ? deleteReport() : updateStatus(event.target.value)}
							disabled={isMutating}
							aria-label={`Change report status from ${report.status}`}
						>
							<option value={report.status}>{isMutating ? 'Updating...' : report.status}</option>
							{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
						</select>
						: <span className={statusClass}>{report.status}</span>}
				</div>
			</div>

			<div className={styles.content}>
				<div className={styles.details}>
					<h1>{report.title}</h1>
					<div className={styles.meta}>
						<span>{report.authorName || 'Community reporter'}</span>
						<span>·</span>
						<span>{new Date(report.createdAt).toLocaleString()}</span>
						<span>·</span>
						<span>{report.category.name}</span>
					</div>
					<p className={styles.description}>{report.description}</p>
					{reportImageUrl && <div className={styles.imageWrap}><ReportMediaImage className={styles.reportImage} src={reportImageUrl} alt="Incident report" /></div>}
					<div className={styles.locationInfo}>
						<strong>Location</strong>
						<span>{report.location.resolvedAddress || [report.location.barangay, report.location.city, report.location.province].filter(Boolean).join(', ')}</span>
					</div>
				</div>

				<div className={styles.mapSection}>
					<div ref={mapContainer} className={styles.mapCanvas} aria-label="Map of incident location" />
				</div>
			</div>

			<section className={styles.commentsSection} aria-labelledby="comments-heading">
				<h2 id="comments-heading">Comments ({report.commentCount})</h2>
				<div className={styles.commentsPlaceholder}>
					<p>Comments feature coming soon.</p>
				</div>
			</section>
		</section>
	);
}
