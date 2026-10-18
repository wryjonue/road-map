import liminAvatar from '../assets/avatars/limin-avatar.jpg';
import manuelAvatar from '../assets/avatars/manuel-avatar.jpg';
import mallariAvatar from '../assets/avatars/mallari-avatar.png';
import bagtasAvatar from '../assets/avatars/bagtas-avatar.jpg';
import logoImg from '../assets/logo.png';
import roadmapIcon from '../assets/roadmap-icon.png';
import styles from './About.module.css';

const TEAM = [
	{ name: 'Angelo Glenn C. Limin', role: 'Project Leader', avatar: liminAvatar },
	{ name: 'James Timothy A. Manuel', role: 'Document Controller', avatar: manuelAvatar },
	{ name: 'Nella Gabriel B. Mallari', role: 'UI/UX Designer', avatar: mallariAvatar },
	{ name: 'Harley Jet P. Bagtas', role: 'Technical Assistant', avatar: bagtasAvatar },
];

const FEATURES = [
	{
		title: 'Incident Reporting',
		description: 'Residents can report blocked routes, flooding, debris, outages, and dangerous road conditions for quick review and response.',
		icon: (
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
				<line x1="12" y1="9" x2="12" y2="13" />
				<line x1="12" y1="17" x2="12.01" y2="17" />
			</svg>
		),
	},
	{
		title: 'AI-Powered Moderation',
		description: 'Context-aware chatbot with function calling assists users in real time, while AI-based auto-moderation evaluates new reports for quality and relevance before they reach the public feed.',
		icon: (
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
				<path d="M9 13v2" />
				<path d="M15 13v2" />
			</svg>
		),
	},
	{
		title: 'Dashboard Panel',
		description: 'Authority and admin users access a comprehensive dashboard with category breakdowns, daily incident trends, pending report queues, archived records, and CSV export capabilities.',
		icon: (
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<rect x="3" y="3" width="7" height="7" />
				<rect x="14" y="3" width="7" height="7" />
				<rect x="14" y="14" width="7" height="7" />
				<rect x="3" y="14" width="7" height="7" />
			</svg>
		),
	},
	{
		title: 'Map Display',
		description: 'Interactive map visualization of incident locations with hotspot clustering, route calculation, and real-time geospatial data rendering.',
		icon: (
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
				<line x1="8" y1="2" x2="8" y2="18" />
				<line x1="16" y1="6" x2="16" y2="22" />
			</svg>
		),
	},
];

export default function About() {
	return (
		<div className={`${styles.aboutPage}`}>
			{/* Hero */}
			<section className={styles.hero}>
				<div className={styles.heroBranding}>
					<img className={styles.heroLogo} src={logoImg} alt="RoadMap" />
					<p className={styles.description}>
						RoadMap empowers Bataeños to build safer roads via community-driven incident reporting,
						AI-powered moderation and assistant, and interactive map visualization. The platform connects citizens with local
						their community members to identify, report, and resolve road hazards efficiently.
					</p>
				</div>
				<img className={styles.heroIcon} src={roadmapIcon} alt="RoadMap icon" />
			</section>

			{/* Features */}
			<section>
				<h2 className={styles.sectionTitle}>Features</h2>
				<div className={styles.featuresGrid}>
					{FEATURES.map((feature) => (
						<div key={feature.title} className={styles.featureCard}>
							<div class={styles.featureWrapper}>
								<div className={styles.featureIcon}>{feature.icon}</div>
								<h3 className={styles.featureTitle}>{feature.title}</h3>
							</div>
							<p className={styles.featureDescription}>{feature.description}</p>
						</div>
					))}
				</div>
			</section>

			{/* Team */}
			<section>
				<h2 className={styles.sectionTitle}>Group Members</h2>
				<div className={styles.teamGrid}>
					{TEAM.map((member) => (
						<div key={member.name} className={styles.teamCard}>
							<img
								className={styles.avatar}
								src={member.avatar}
								alt={`${member.name} avatar`}
							/>
							<h3 className={styles.memberName}>{member.name}</h3>
							<span className={styles.memberRole}>{member.role}</span>
						</div>
					))}
				</div>
			</section>

			{/* Contact */}
			<section>
				<h2 className={styles.sectionTitle}>Contact</h2>
				<div className={styles.contactCard}>
					<div className={styles.contactItems}>
						<a href="mailto:contactus@roadmap.vieryn.party" className={styles.contactLink}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
							<span>contactus@roadmap.vieryn.party</span>
						</a>
						<a href="tel:+639771307845" className={styles.contactLink}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
							<span>+63 977 130 7845</span>
						</a>
					</div>
					<div className={styles.socialLinks}>
						<a href="#" className={styles.socialLink} aria-label="Facebook">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
						</a>
						<a href="#" className={styles.socialLink} aria-label="Twitter">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" /></svg>
						</a>
						<a href="#" className={styles.socialLink} aria-label="GitHub">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
						</a>
						<a href="#" className={styles.socialLink} aria-label="LinkedIn">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
						</a>
					</div>
				</div>
			</section>

			{/* Disclaimer */}
			<section className={styles.disclaimerSection}>
				<blockquote className={styles.disclaimer}>
					This website is submitted to <strong>Mr. Lester John De Lemos</strong>,{' '}
					<strong>Ms. Christina Veneath Somo</strong>, <strong>Mr. Ezekiel Ortiguerra</strong>, and{' '}
					<strong>Mr. Manuel Lyttelton Nuevo</strong> as part of the College of Computer Studies curriculum at the{' '}
					<strong>Bataan Peninsula State University</strong>. The website and source project are{' '}
					<strong>not intended for public use and consumption</strong> and is provided for{' '}
					<strong>demonstration and development purposes</strong> only. Verify incident information and follow
					applicable local laws and safety guidance before taking action.
				</blockquote>
			</section>
		</div>
	);
}
