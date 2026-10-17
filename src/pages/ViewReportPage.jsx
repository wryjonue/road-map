import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { canManageReports, useAppRole } from '../auth/roles';
import styles from './ViewReportPage.module.css';

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

function CommentAvatar({ src, name }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	const initials = name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
	return (
		<div className={styles.commentAvatar}>
			{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <span>{initials}</span>}
		</div>
	);
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
	const [voteCount, setVoteCount] = useState(0);
	const [hasVoted, setHasVoted] = useState(false);
	const [isVoting, setIsVoting] = useState(false);
	const voteSyncedRef = useRef(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [comments, setComments] = useState([]);
	const [areCommentsLoading, setAreCommentsLoading] = useState(false);
	const [commentText, setCommentText] = useState('');
	const [isSubmittingComment, setIsSubmittingComment] = useState(false);
	const [isDeletingCommentId, setIsDeletingCommentId] = useState(null);
	const userLocationRef = useRef(null);
	const dropdownRef = useRef(null);
	const menuItemsRef = useRef([]);

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
				if (!controller.signal.aborted) {
					setReport(data);
					setVoteCount(data.voteCount ?? 0);
				}
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load report');
			} finally {
				if (!controller.signal.aborted) setIsLoading(false);
			}
		};
		void loadReport();
		return () => controller.abort();
	}, [id, getToken, isLoaded, isSignedIn]);

	// Load the signed-in user's vote status once per report id.
	useEffect(() => {
		if (!isLoaded) return undefined;
		voteSyncedRef.current = false;
		const controller = new AbortController();
		const loadVoteStatus = async () => {
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch(`/api/reports/${id}/vote`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok || controller.signal.aborted) return;
				voteSyncedRef.current = true;
				setVoteCount(data.voteCount ?? 0);
				setHasVoted(Boolean(data.hasVoted));
			} catch {
				/* vote status is non-critical; count still shows from the report payload */
			}
		};
		void loadVoteStatus();
		return () => controller.abort();
	}, [id, getToken, isLoaded, isSignedIn]);

	// Load comments once per report id (public list; auth header only when signed in).
	useEffect(() => {
		if (!isLoaded || !report) return undefined;
		const controller = new AbortController();
		const loadComments = async () => {
			setAreCommentsLoading(true);
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch(`/api/reports/${id}/comments`, {
					headers: token ? { Authorization:  `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok || controller.signal.aborted) return;
				setComments(data.comments ?? []);
				setReport((current) => (current ? { ...current, commentCount: data.commentCount ?? current.commentCount } : current));
			} catch {
				/* comments are non-critical; keep the section visible with the empty state */
			} finally {
				if (!controller.signal.aborted) setAreCommentsLoading(false);
			}
		};
		void loadComments();
		return () => controller.abort();
	}, [id, isLoaded, isSignedIn, getToken, report?.id]);

	useEffect(() => {
		if (!mapContainer.current || !report) return undefined;
		maplibregl.setWorkerUrl(maplibreWorkerUrl);
		const hasRoute = Boolean(report.routePolyline);
		const center = hasRoute && report.startLocation
			? [report.startLocation.longitude, report.startLocation.latitude]
			: [report.location.longitude, report.location.latitude];
		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
			center,
			zoom: hasRoute ? 12 : 15,
		});
		mapRef.current = map;

		// Safety: ensure the canvas is sized correctly after the card layout settles.
		const resizeFrame = window.requestAnimationFrame(() => map.resize());
		const handleResize = () => map.resize();
		window.addEventListener('resize', handleResize);

		map.once('load', () => {
			if (hasRoute && report.routePolyline) {
				try {
					const geometry = JSON.parse(report.routePolyline);
					map.addSource('route-line', { type: 'geojson', data: geometry });
					map.addLayer({
						id: 'route-path',
						type: 'line',
						source: 'route-line',
						paint: { 'line-color': '#0066ff', 'line-width': 4, 'line-opacity': 0.85 },
					});
					if (Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
						const bounds = new maplibregl.LngLatBounds();
						geometry.coordinates.forEach((coord) => bounds.extend(coord));
						map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
					}
				} catch {
					// Invalid polyline JSON; fall back to point marker below
				}
			}
			if (!hasRoute) {
				new maplibregl.Marker({ color: '#c65d2e' }).setLngLat(center).addTo(map);
			}
			if (userLocationRef.current) {
				new maplibregl.Marker({ color: '#3b82f6' })
				.setLngLat(userLocationRef.current)
				.setPopup(new maplibregl.Popup({ offset: 25 }).setText('Your Current Location')).addTo(map);
			}
		});

		return () => {
			window.cancelAnimationFrame(resizeFrame);
			window.removeEventListener('resize', handleResize);
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

	// Close the status menu on outside click.
	useEffect(() => {
		if (!menuOpen) return undefined;
		const handlePointerDown = (event) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setMenuOpen(false);
		};
		document.addEventListener('mousedown', handlePointerDown);
		return () => document.removeEventListener('mousedown', handlePointerDown);
	}, [menuOpen]);

	// Close the menu when the report/status changes or an action starts.
	useEffect(() => { setMenuOpen(false); }, [report?.status, isMutating]);

	const handleMenuKeyDown = (event, index, itemCount) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			setMenuOpen(false);
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			const next = (index + 1) % itemCount;
			menuItemsRef.current[next]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			const prev = (index - 1 + itemCount) % itemCount;
			menuItemsRef.current[prev]?.focus();
		} else if (event.key === 'Home') {
			event.preventDefault();
			menuItemsRef.current[0]?.focus();
		} else if (event.key === 'End') {
			event.preventDefault();
			menuItemsRef.current[itemCount - 1]?.focus();
		}
	};

	const runAction = (option) => {
		setMenuOpen(false);
		if (option.value === 'Delete') void deleteReport();
		else void updateStatus(option.value);
	};

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

	const handleVote = async () => {
		if (isVoting) return;
		if (!isSignedIn) {
			setError('Sign in to vote on reports.');
			return;
		}
		const prevCount = voteCount;
		const prevHasVoted = hasVoted;
		setVoteCount((count) => (prevHasVoted ? Math.max(0, count - 1) : count + 1));
		setHasVoted(!prevHasVoted);
		setIsVoting(true);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in to vote on reports.');
			const response = await fetch(`/api/reports/${id}/vote`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || 'Unable to update vote');
			setVoteCount(data.voteCount ?? 0);
			setHasVoted(Boolean(data.hasVoted));
		} catch (voteError) {
			setVoteCount(prevCount);
			setHasVoted(prevHasVoted);
			setError(voteError.message || 'Unable to update vote');
		} finally {
			setIsVoting(false);
		}
	};

	const submitComment = async (event) => {
		event.preventDefault();
		if (isSubmittingComment) return;
		const text = commentText.trim();
		if (!text) return;
		setIsSubmittingComment(true);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in to comment on reports.');
			const response = await fetch(`/api/reports/${id}/comments`, {
				method: 'POST',
				headers: { Authorization:  `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					body: text,
				}),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to post comment');
			if (data.comment) setComments((current) => [data.comment, ...current]);
			setCommentText('');
			if (typeof data.commentCount === 'number') {
				setReport((current) => (current ? { ...current, commentCount: data.commentCount } : current));
			}
		} catch (commentError) {
			setError(commentError.message || 'Unable to post comment');
		} finally {
			setIsSubmittingComment(false);
		}
	};

	const canDeleteComment = (comment) => {
		if (!isSignedIn || comment.isSystem) return false;
		return role === 'admin' || comment.authorId === user?.id || report.authorId === user?.id;
	};

	const removeComment = async (commentId) => {
		if (isDeletingCommentId || !window.confirm('Delete this comment?')) return;
		setIsDeletingCommentId(commentId);
		setError('');
		try {
			const token = await getToken();
			if (!token) throw new Error('Sign in again to delete this comment.');
			const response = await fetch(`/api/reports/${id}/comments/${commentId}`, {
				method: 'DELETE',
				headers: { Authorization:  `Bearer ${token}` },
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to delete comment');
			setComments((current) => current.filter((comment) => comment.id !== commentId));
			if (typeof data.commentCount === 'number') {
				setReport((current) => (current ? { ...current, commentCount: data.commentCount } : current));
			}
		} catch (deleteError) {
			setError(deleteError.message || 'Unable to delete comment');
		} finally {
			setIsDeletingCommentId(null);
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

	if (isLoading) return <div className={styles.page}><p className={styles.state}>Loading report...</p></div>;
	if (error && !report) {
		return (
			<div className={styles.page}>
				<div className={styles.stateActions}>
					<p className={styles.error} role="alert">{error}</p>
					<button type="button" className="primary-btn" onClick={() => navigate('/feed')}>Back to reports</button>
				</div>
			</div>
		);
	}
	if (!report) return null;

	const reportImageUrl = report.images?.[0]?.url || report.imageUrl;
	const statusKey = report.status.toLowerCase();
	const locationText = report.location.resolvedAddress || [report.location.barangay, report.location.city, report.location.province].filter(Boolean).join(', ') || 'Location unavailable';

	const statusActions = [];
	if (canManage && report.status === 'Pending') {
		statusActions.push({ label: 'Approve report', value: 'Open', kind: 'approve', icon: 'check' });
		statusActions.push({ label: 'Deny report', value: 'Rejected', kind: 'deny', icon: 'x' });
	}
	if (canManage && report.status === 'Open') {
		statusActions.push({ label: 'Resolve report', value: 'Resolved', kind: 'resolve', icon: 'check' });
	}
	if (canDelete && (report.status === 'Pending' || report.status === 'Open')) {
		statusActions.push({ label: 'Delete report', value: 'Delete', kind: 'delete', icon: 'trash' });
	}
	const hasActions = statusActions.length > 0;

	const ActionIcon = ({ name }) => {
		if (name === 'check') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
		if (name === 'x') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
		if (name === 'trash') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
		return null;
	};

	return (
		<div className={styles.page}>
			{error && report && <p className={styles.error} role="alert">{error}</p>}

			{/* Top bar */}
			<div className={styles.topBar}>
				<button type="button" className={`ghost-btn ${styles.backButton}`} onClick={() => navigate('/feed')} aria-label="Back to community reports">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
					Back to reports
				</button>
				<div className={styles.statusArea}>
					{hasActions ? (
						<div className={`${styles.dropdown} ${menuOpen ? styles.dropdownOpen : ''}`} ref={dropdownRef}>
							<button
								type="button"
								className={styles.dropdownTrigger}
								aria-haspopup="menu"
								aria-expanded={menuOpen}
								aria-controls="status-menu"
								disabled={isMutating}
								onClick={() => setMenuOpen((open) => !open)}
								onKeyDown={(event) => {
									if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										setMenuOpen(true);
										window.requestAnimationFrame(() => menuItemsRef.current[0]?.focus());
									}
								}}
							>
								{isMutating ? <span className={styles.spinner} aria-hidden="true" /> : <span className={`${styles.triggerDot} ${styles[statusKey]}`} aria-hidden="true" />}
								{isMutating ? 'Updating…' : report.status}
								<svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
							</button>
							{menuOpen && (
								<div id="status-menu" className={styles.dropdownMenu} role="menu" aria-label="Report actions">
									{statusActions.map((option, index) => (
										<button
											key={option.value}
											type="button"
											role="menuitem"
											className={`${styles.menuItem} ${styles[option.kind]}`}
											ref={(el) => { menuItemsRef.current[index] = el; }}
											disabled={isMutating}
											onClick={() => runAction(option)}
											onKeyDown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); runAction(option); }
												else handleMenuKeyDown(event, index, statusActions.length);
											}}
										>
											<ActionIcon name={option.icon} />
											{option.label}
										</button>
									))}
								</div>
							)}
						</div>
					) : (
						<span className={`${styles.statusPill} ${styles[statusKey]}`}>{report.status}</span>
					)}
				</div>
			</div>

			{/* Two-column content */}
			<div className={styles.content}>
				<div className={styles.leftColumn}>
					<div className={`${styles.card} ${styles.detailsCard}`}>
						<div className={styles.badgeRow}>
							<span className={styles.categoryPill} style={{ '--category-color': CATEGORY_COLORS[report.category?.id] || '#5f6972' }}>{report.category?.name || 'Uncategorized'}</span>
							<span className={`${styles.statusPill} ${styles[statusKey]}`}>{report.status}</span>
							<button
								type="button"
								className={`${styles.voteBtn} ${hasVoted ? styles.voteBtnActive : ''}`}
								aria-pressed={hasVoted}
								aria-label={hasVoted ? 'Remove upvote' : 'Upvote report'}
								disabled={isVoting}
								onClick={() => void handleVote()}
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
								<span>{voteCount}</span>
							</button>
						</div>
						<h1 className={styles.title}>{report.title}</h1>
						<div className={styles.meta}>
							<span>{report.authorName || 'Community reporter'}</span>
							<span className={styles.metaSep}>·</span>
							<span>{new Date(report.createdAt).toLocaleString()}</span>
						</div>
						<p className={styles.description}>{report.description}</p>
					</div>

					{reportImageUrl && (
						<div className={`${styles.card} ${styles.mediaCard}`}>
							<div className={styles.imageWrap}>
								<ReportMediaImage className={styles.reportImage} src={reportImageUrl} alt="Incident report" />
							</div>
						</div>
					)}

					<div className={`${styles.card} ${styles.locationCard}`}>
						<svg className={styles.locationIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
						<div className={styles.locationText}>
							<span className={styles.locationLabel}>Location</span>
							<span className={styles.locationValue}>{locationText}</span>
						</div>
					</div>
				</div>

				<div className={styles.mapSection}>
					<div className={`${styles.card} ${styles.mapCard}`}>
						<div ref={mapContainer} className={styles.mapCanvas} aria-label="Map of incident location" />
					</div>
				</div>
			</div>

			{/* Comments */}
			<div className={`${styles.card} ${styles.commentsCard}`} aria-labelledby="comments-heading">
				<h2 id="comments-heading">Comments ({report.commentCount ?? 0})</h2>

				{isSignedIn && (
					<form className={styles.commentForm} onSubmit={submitComment}>
						<textarea
							className={styles.commentTextarea}
							value={commentText}
							onChange={(event) => setCommentText(event.target.value)}
							placeholder="Add a comment about this report..."
							aria-label="Comment text"
							rows={3}
							maxLength={2000}
							disabled={isSubmittingComment}
							required
						/>
						<div className={styles.commentFormActions}>
							<button
								type="submit"
								className="primary-btn"
								disabled={isSubmittingComment || !commentText.trim()}
							>
								{isSubmittingComment ? 'Posting…' : 'Post comment'}
							</button>
						</div>
					</form>
				)}

				{areCommentsLoading ? (
					<p className={styles.commentsEmpty}>Loading comments...</p>
				) : comments.length === 0 ? (
					<div className={styles.commentsEmpty}>
						<p>No comments yet.</p>
					</div>
				) : (
					<ul className={styles.commentList}>
						{comments.map((comment) => (
							<li
								key={comment.id}
								className={`${styles.commentItem} ${comment.isSystem ? styles.commentSystem : ''}`}
							>
								{comment.isSystem ? (
									<span className={styles.systemAvatar} aria-hidden="true">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="20 6 9 17 4 12" />
										</svg>
									</span>
								) : (
									<CommentAvatar src={comment.authorImageUrl} name={comment.authorName} />
								)}
								<div className={styles.commentContent}>
									<div className={styles.commentHeader}>
										<span className={styles.commentAuthor}>
											{comment.isSystem ? 'RoadMap System' : (comment.authorName || 'Community member')}
										</span>
										{comment.isSystem && <span className={styles.systemTag}>Status update</span>}
										<span className={styles.commentTime}>
											{new Date(comment.createdAt).toLocaleString()}
										</span>
										{canDeleteComment(comment) && (
											<button
												type="button"
												className={styles.commentDeleteBtn}
												onClick={() => void removeComment(comment.id)}
												disabled={isDeletingCommentId === comment.id}
												aria-label="Delete comment"
											>
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
													<polyline points="3 6 5 6 21 6" />
													<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
												</svg>
											</button>
										)}
									</div>
									<p className={styles.commentBody}>{comment.body}</p>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
