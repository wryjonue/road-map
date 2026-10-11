import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@clerk/react';
import styles from './NotificationPanel.module.css';

const NOTIF_ICONS = {
	report_approved: '✓',
	report_rejected: '✕',
	report_resolved: '★',
};

const NOTIF_COLORS = {
	report_approved: '#2d7a5d',
	report_rejected: '#bd3e50',
	report_resolved: '#376fa3',
};

function timeAgo(dateStr) {
	const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export default function NotificationPanel() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const navigate = useNavigate();
	const [isOpen, setIsOpen] = useState(false);
	const [notifications, setNotifications] = useState([]);
	const [unreadCount, setUnreadCount] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [toast, setToast] = useState(null);
	const wsRef = useRef(null);
	const reconnectTimer = useRef(null);
	const panelRef = useRef(null);

	const fetchUnreadCount = useCallback(async () => {
		try {
			const token = await getToken();
			const res = await fetch('/api/notifications/unread-count', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (res.ok) {
				const data = await res.json();
				setUnreadCount(data.count ?? 0);
			}
		} catch {
			// Silently fail — badge will update on next poll or WS push.
		}
	}, [getToken]);

	const fetchNotifications = useCallback(async () => {
		setIsLoading(true);
		try {
			const token = await getToken();
			const res = await fetch('/api/notifications?limit=20', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (res.ok) {
				const data = await res.json();
				setNotifications(data.notifications ?? []);
			}
		} catch {
			// Silently fail.
		} finally {
			setIsLoading(false);
		}
	}, [getToken]);

	const markRead = useCallback(async (notifId) => {
		try {
			const token = await getToken();
			await fetch(`/api/notifications/${notifId}/read`, {
				method: 'PATCH',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, isRead: true } : n));
			setUnreadCount((prev) => Math.max(0, prev - 1));
		} catch {
			// Silently fail.
		}
	}, [getToken]);

	const markAllRead = useCallback(async () => {
		try {
			const token = await getToken();
			await fetch('/api/notifications/read-all', {
				method: 'PATCH',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
			setUnreadCount(0);
		} catch {
			// Silently fail.
		}
	}, [getToken]);

	const handleNotifClick = useCallback((notif) => {
		if (!notif.isRead) markRead(notif.id);
		setIsOpen(false);
		navigate(`/feed/${notif.reportId}`);
	}, [markRead, navigate]);

	// WebSocket connection for real-time updates
	useEffect(() => {
		if (!isLoaded || !isSignedIn) return undefined;

		let cancelled = false;
		let retryDelay = 1000;

		const connect = async () => {
			if (cancelled) return;
			try {
				const token = await getToken();
				if (!token || cancelled) return;
				const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
					// Browser WebSocket API does not support custom headers; pass token as query param.
					const ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications?token=${encodeURIComponent(token)}`);
				wsRef.current = ws;

				ws.onopen = () => { retryDelay = 1000; };
				ws.onmessage = (event) => {
					try {
						const payload = JSON.parse(event.data);
						if (payload.event === 'notification') {
							setNotifications((prev) => [payload.data, ...prev]);
							setUnreadCount((prev) => prev + 1);
							// Show a temporary toast if the panel is closed.
							setToast(payload.data);
							setTimeout(() => setToast(null), 5000);
						} else if (payload.event === 'unread_count') {
							setUnreadCount(payload.data.count ?? 0);
						}
					} catch {
						// Ignore malformed messages.
					}
				};
				ws.onclose = () => {
					wsRef.current = null;
					if (!cancelled) {
						reconnectTimer.current = setTimeout(connect, retryDelay);
						retryDelay = Math.min(retryDelay * 2, 30000);
					}
				};
				ws.onerror = () => { ws.close(); };
			} catch {
				if (!cancelled) {
					reconnectTimer.current = setTimeout(connect, retryDelay);
					retryDelay = Math.min(retryDelay * 2, 30000);
				}
			}
		};

		void connect();
		void fetchUnreadCount();

		return () => {
			cancelled = true;
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
			if (wsRef.current) wsRef.current.close();
		};
	}, [isLoaded, isSignedIn, getToken, fetchUnreadCount]);

	// Close panel when clicking outside
	useEffect(() => {
		if (!isOpen) return undefined;
		const handleClickOutside = (event) => {
			if (panelRef.current && !panelRef.current.contains(event.target)) {
				setIsOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	// Fetch notifications when panel opens
	useEffect(() => {
		if (isOpen && isSignedIn) void fetchNotifications();
	}, [isOpen, isSignedIn, fetchNotifications]);

	if (!isLoaded || !isSignedIn) return null;

	return (
		<div className={styles.wrapper} ref={panelRef}>
			{toast && (
				<div className={styles.toast} onClick={() => { setToast(null); handleNotifClick(toast); }}>
					<span className={styles.notifIcon} style={{ background: NOTIF_COLORS[toast.type] || '#5f6972' }}>
						{NOTIF_ICONS[toast.type] || '•'}
					</span>
					<div className={styles.toastContent}>
						<p className={styles.notifMessage}>{toast.message}</p>
						<span className={styles.notifTime}>just now</span>
					</div>
				</div>
			)}
			<button
				type="button"
				className={styles.bellButton}
				onClick={() => setIsOpen((prev) => !prev)}
				aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
			>
				<svg className={styles.bellIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
					<path d="M13.73 21a2 2 0 0 1-3.46 0" />
				</svg>
				{unreadCount > 0 && <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
			</button>

			{isOpen && (
				<div className={styles.panel}>
					<div className={styles.panelHeader}>
						<h3>Notifications</h3>
						{unreadCount > 0 && (
							<button type="button" className={styles.markAllBtn} onClick={markAllRead}>Mark all read</button>
						)}
					</div>
					<div className={styles.panelBody}>
						{isLoading && notifications.length === 0 && <p className={styles.empty}>Loading...</p>}
						{!isLoading && notifications.length === 0 && <p className={styles.empty}>No notifications yet.</p>}
						{notifications.map((notif) => (
							<button
								key={notif.id}
								type="button"
								className={`${styles.notifItem} ${notif.isRead ? styles.notifRead : styles.notifUnread}`}
								onClick={() => handleNotifClick(notif)}
							>
								<span className={styles.notifIcon} style={{ background: NOTIF_COLORS[notif.type] || '#5f6972' }}>
									{NOTIF_ICONS[notif.type] || '•'}
								</span>
								<div className={styles.notifContent}>
									<p className={styles.notifMessage}>{notif.message}</p>
									<span className={styles.notifTime}>{timeAgo(notif.createdAt)}</span>
								</div>
								{!notif.isRead && <span className={styles.unreadDot} />}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
