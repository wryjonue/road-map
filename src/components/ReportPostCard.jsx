import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@clerk/react';
import styles from './ReportPostCard.module.css';

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

export default function ReportPostCard({ id, title, poster, authorImageUrl, date, status, description, imageUrl, images, staticMapUrl, category, city, barangay, province }) {
	const navigate = useNavigate();
	const reportImageUrl = images?.[0]?.url || imageUrl;

	// Build a short display location from the most specific available field.
	const displayLocation = [barangay, city, province].filter((part) => typeof part === 'string' && part.trim()).join(', ') || null;

	const openReport = () => navigate(`/feed/${id}`);
	const handleKeyDown = (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openReport();
		}
	};

	// Build the carousel slide list from whatever media actually exists.
	const slides = useMemo(() => {
		const list = [];
		if (reportImageUrl) list.push({ key: 'image', src: reportImageUrl, alt: 'Incident report' });
		if (staticMapUrl) list.push({ key: 'map', src: staticMapUrl, alt: 'Static map of incident location' });
		return list;
	}, [reportImageUrl, staticMapUrl]);
	const hasCarousel = slides.length > 1;
	const [activeSlide, setActiveSlide] = useState(0);

	const goTo = (event, index) => {
		event.preventDefault();
		event.stopPropagation();
		setActiveSlide((index + slides.length) % slides.length);
	};

	return (
		<article className={styles.card} onClick={openReport} onKeyDown={handleKeyDown} role="link" tabIndex={0} aria-label={`View report: ${title}`}>
			<Link to={`/feed/${id}`} className={styles.stretchedLink} aria-hidden="true" tabIndex={-1} />

			<div className={styles.mediaCarousel}>
				<div className={styles.mediaFrame}>
					{slides.length > 0
						? slides.map((slide, i) => (
							<ReportMediaImage
								key={slide.key}
								className={`${styles.slide} ${i === activeSlide ? styles.slideActive : styles.slideHidden}`}
								src={slide.src}
								alt={slide.alt}
							/>
						))
						: <div className={styles.mapPreview} aria-label="Map preview" />}
					{displayLocation && (
						<span className={styles.locationOverlay} title={displayLocation}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.locationIcon}>
								<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
								<circle cx="12" cy="10" r="3" />
							</svg>
							{displayLocation}
						</span>
					)}
				</div>
				{hasCarousel && (
					<>
						<button type="button" className={`${styles.chevron} ${styles.chevronPrev}`} onClick={(e) => goTo(e, activeSlide - 1)} aria-label="Previous image">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
						</button>
						<button type="button" className={`${styles.chevron} ${styles.chevronNext}`} onClick={(e) => goTo(e, activeSlide + 1)} aria-label="Next image">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
						</button>
						<div className={styles.carouselDots}>
							{slides.map((slide, i) => (
								<button key={slide.key} type="button" className={`${styles.dot} ${i === activeSlide ? styles.dotActive : ''}`} onClick={(e) => goTo(e, i)} aria-label={`Go to image ${i + 1}`} />
							))}
						</div>
					</>
				)}
			</div>

			<div className={styles.cardBody}>
				<div className={styles.badgeRow}>
					{category && <span className={styles.categoryBadge} style={{ '--category-color': CATEGORY_COLORS[category.id] || '#5f6972' }}>{category.name}</span>}
					<span className={`${styles.statusPill} ${styles[`status-${status.toLowerCase()}`]}`}>{status}</span>
				</div>
				<h3 className={styles.title}>{title}</h3>
				<p className={styles.description}>{description}</p>
				<div className={styles.posterRow}>
					<AuthorAvatar src={authorImageUrl} name={poster} />
					<p className={styles.meta}>{poster} · {date}</p>
				</div>
			</div>
		</article>
	);
}
