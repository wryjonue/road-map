import styles from './ReportPostCard.module.css';

export default function ReportPostCard({ title, avatar, poster, date, status, description, votes, comments, imageUrl, images, staticMapUrl }) {
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
					{imageUrl || images?.length ? <img className={styles.uploadedImage} src={images?.[0]?.url || imageUrl} alt="Incident report" /> : <div className={styles.imagePlaceholder}><span>Optional image container</span></div>}
				</div>
				<div className={styles.mapPreviewWrapper}>
					{staticMapUrl ? <img className={styles.mapImage} src={staticMapUrl} alt="Static map of incident location" /> : <div className={styles.mapPreview} aria-label="Map preview" />}
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
