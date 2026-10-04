import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import styles from './ReportPostCard.module.css';

function AuthenticatedMediaImage({ src, alt, className }) {
	const { getToken, isLoaded } = useAuth();
	const [objectUrl, setObjectUrl] = useState('');
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!isLoaded) return undefined;
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

function AuthorAvatar({ src, name }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [src]);
	const initials = name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
	return <div className={styles.avatar}>{src && !failed ? <img src={src} alt={`${name || 'Report author'} avatar`} onError={() => setFailed(true)} /> : initials}</div>;
}

export default function ReportPostCard({ title, avatar, poster, authorImageUrl, date, status, description, votes, comments, imageUrl, images, staticMapUrl, canChangeStatus, isStatusUpdating, isBusy, onStatusChange }) {
	const statusClass = `status-badge status-${status.toLowerCase()}`;
	const nextStatus = status === 'Pending' ? 'Open' : status === 'Open' ? 'Resolved' : null;
	const reportImageUrl = images?.[0]?.url || imageUrl;
	const hasImage = Boolean(reportImageUrl);

	return (
		<article className={styles.card}>
			<div className={styles.header}>
				<div className={styles.posterMeta}>
					<AuthorAvatar src={authorImageUrl} name={poster || avatar} />
					<div>
						<h3>{title}</h3>
						<p>{poster} · {date}</p>
					</div>
				</div>
				{canChangeStatus && nextStatus ? <button type="button" className={statusClass} onClick={() => onStatusChange(nextStatus)} disabled={isBusy} aria-label={`Change report status from ${status} to ${nextStatus}`} title={`Change status to ${nextStatus}`}>{isStatusUpdating ? 'Updating...' : status}</button> : <span className={statusClass}>{status}</span>}
			</div>

			<div className={`${styles.body} ${!hasImage ? styles.bodyNoImage : ''}`}>
				<div className={styles.copy}>
					<p className={styles.description}>{description}</p>
					{hasImage && <ReportMediaImage className={styles.uploadedImage} src={reportImageUrl} alt="Incident report" />}
				</div>
				<div className={styles.mapPreviewWrapper}>
					{staticMapUrl ? <ReportMediaImage className={styles.mapImage} src={staticMapUrl} alt="Static map of incident location" /> : <div className={styles.mapPreview} aria-label="Map preview" />}
				</div>
			</div>

			<div className={styles.footer}>
				<div className={styles.actions}>
					<button type="button" className="primary-btn">View Details</button>
					<button type="button" className="secondary-btn">Upvote</button>
				</div>
				<div className={styles.actions}>
					<button type="button" className="secondary-btn unclickable-btn">Votes ({votes})</button>
					<button type="button" className="ghost-btn unclickable-btn">Comments ({comments})</button>
				</div>
			</div>
		</article>
	);
}
