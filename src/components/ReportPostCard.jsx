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

export default function ReportPostCard({ title, avatar, poster, date, status, description, votes, comments, imageUrl, images, staticMapUrl, canResolve, isResolving, onResolve }) {
	const statusClass = `status-badge status-${status.toLowerCase()}`;

	return (
		<article className={styles.card}>
			<div className={styles.header}>
				<div className={styles.posterMeta}>
					<div className={styles.avatar}>{avatar}</div>
					<div>
						<h3>{title}</h3>
						<p>{poster} · {date}</p>
					</div>
				</div>
				<span className={statusClass}>{status}</span>
			</div>

			<div className={styles.body}>
				<div className={styles.copy}>
					<p className={styles.description}>{description}</p>
					{imageUrl || images?.length ? <ReportMediaImage className={styles.uploadedImage} src={images?.[0]?.url || imageUrl} alt="Incident report" /> : <div className={styles.imagePlaceholder}><span>Optional image container</span></div>}
				</div>
				<div className={styles.mapPreviewWrapper}>
					{staticMapUrl ? <ReportMediaImage className={styles.mapImage} src={staticMapUrl} alt="Static map of incident location" /> : <div className={styles.mapPreview} aria-label="Map preview" />}
				</div>
			</div>

			<div className={styles.footer}>
				<div className={styles.actions}>
					<button type="button" className="primary-btn">View Details</button>
					<button type="button" className="secondary-btn">Upvote</button>
					{canResolve && status !== 'Resolved' && <button type="button" className="secondary-btn" onClick={onResolve} disabled={isResolving}>{isResolving ? 'Resolving...' : 'Resolve'}</button>}
				</div>
				<div className={styles.actions}>
					<button type="button" className="secondary-btn unclickable-btn">Votes ({votes})</button>
					<button type="button" className="ghost-btn unclickable-btn">Comments ({comments})</button>
				</div>
			</div>
		</article>
	);
}
