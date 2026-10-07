import { useEffect, useState } from 'react';
import { Link } from 'react-router';
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

export default function ReportPostCard({ id, title, avatar, poster, authorImageUrl, date, status, description, votes, comments, imageUrl, images, staticMapUrl, canChangeStatus, canDelete, isStatusUpdating, isBusy, onStatusChange, onDelete, onVote }) {
	const statusClass = `status-badge status-${status.toLowerCase()}`;
	const statusOptions = canChangeStatus && status === 'Pending'
		? [{ label: 'Approve Report', value: 'Open' }, { label: 'Deny Report', value: 'Rejected' }]
		: canChangeStatus && status === 'Open' ? [{ label: 'Resolve report', value: 'Resolved' }] : [];
	if (canDelete && (status === 'Pending' || status === 'Open')) statusOptions.push({ label: 'Delete', value: 'Delete' });
	const reportImageUrl = images?.[0]?.url || imageUrl;
	const hasImage = Boolean(reportImageUrl);

	const [voteCount, setVoteCount] = useState(votes);
	const [hasVoted, setHasVoted] = useState(false);
	const [isVoting, setIsVoting] = useState(false);

	const handleVote = async () => {
		if (isVoting || !onVote) return;
		setIsVoting(true);
		try {
			const result = await onVote(id);
			if (result) {
				setVoteCount(result.voteCount);
				setHasVoted(result.hasVoted);
			}
		} finally {
			setIsVoting(false);
		}
	};

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
				{(canChangeStatus || canDelete) && statusOptions.length > 0 ? <select className={statusClass} value={status} onChange={(event) => event.target.value === 'Delete' ? onDelete() : onStatusChange(event.target.value)} disabled={isBusy} aria-label={`Change report status from ${status}`}>
					<option value={status}>{isStatusUpdating ? 'Updating...' : status}</option>
					{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
				</select> : <span className={statusClass}>{status}</span>}
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
					<Link to={`/feed/${id}`} className="primary-btn action-link">View Details</Link>
					<button
						type="button"
						className={`secondary-btn vote-button ${hasVoted ? 'voted' : ''}`}
						onClick={handleVote}
						disabled={isVoting}
						aria-pressed={hasVoted}
						aria-label={hasVoted ? 'Remove upvote' : 'Upvote report'}
					>
						{isVoting ? 'Voting...' : 'Upvote'}
					</button>
				</div>
				<div className={styles.actions}>
					<button type="button" className="secondary-btn unclickable-btn">Votes ({voteCount})</button>
					<button type="button" className="ghost-btn unclickable-btn">Comments ({comments})</button>
				</div>
			</div>
		</article>
	);
}
