import { buildDisplayName } from './user-service.js';

/**
 * Create a notification record in D1 and push it to the user via WebSocket.
 * Skips self-notification (actor === recipient).
 */
export async function createNotification(env, { userId, type, reportId, actorId, message }) {
	if (!userId || !type || !reportId || !actorId || !message) return;
	// Skip self-notification
	if (userId === actorId) return;

	const result = await env.road_map_db.prepare(
		'INSERT INTO notifications (user_id, type, report_id, actor_id, message) VALUES (?, ?, ?, ?, ?)'
	).bind(userId, type, reportId, actorId, message).run();

	const notification = {
		id: result.meta.last_row_id,
		userId,
		type,
		reportId,
		actorId,
		message,
		isRead: false,
		createdAt: new Date().toISOString(),
	};

	// Push to the user's NotificationHub DO (fire-and-forget)
	try {
		const stub = env.NOTIFICATION_HUB.getByName(`user:${userId}`);
		await stub.broadcast(JSON.stringify({ event: 'notification', data: notification }));
	} catch (error) {
		console.error('[notification] failed to push to WebSocket:', String(error));
	}

	return notification;
}

/**
 * Create a management notification
 * @param {Object} env - Worker environment
 * @param {string} userId - Recipient user ID
 * @param {string} type - Notification type (e.g., 'user_role_changed')
 * @param {string} actorId - Actor who performed the action
 * @param {string} targetUserId - Target user ID (for user management notifications)
 * @param {string} message - Notification message
 * @returns {Promise<void>}
 */
export async function createManagementNotification(env, userId, type, actorId, targetUserId, message) {
	await env.road_map_db.prepare(
		'INSERT INTO notifications (user_id, type, actor_id, target_user_id, message, notification_type) VALUES (?, ?, ?, ?, ?, ?)'
	).bind(userId, type, actorId, targetUserId, message, 'management').run();
}

/**
 * Get paginated notifications for a user.
 */
export async function getNotifications(env, userId, url) {
	const rawLimit = Number(url.searchParams.get('limit') ?? 20);
	const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 20);
	const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') ?? 0)));
	const isRead = url.searchParams.get('is_read');
	const notificationType = url.searchParams.get('notification_type');

	let whereClause = 'WHERE user_id = ?';
	const params = [userId];

	if (isRead === 'true') {
		whereClause += ' AND is_read = 1';
	} else if (isRead === 'false') {
		whereClause += ' AND is_read = 0';
	}

	if (notificationType) {
		whereClause += ' AND notification_type = ?';
		params.push(notificationType);
	}

	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(
			'SELECT id, user_id, type, report_id, actor_id, target_user_id, message, is_read, created_at, notification_type FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
		).bind(...params, limit, offset).all(),
		env.road_map_db.prepare(
			'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?'
		).bind(userId).first(),
	]);

	const notifications = results.map((row) => ({
		id: row.id,
		userId: row.user_id,
		type: row.type,
		reportId: row.report_id,
		actorId: row.actor_id,
		targetUserId: row.target_user_id,
		message: row.message,
		isRead: row.is_read === 1,
		createdAt: row.created_at,
		notificationType: row.notification_type,
	}));

	const total = countResult?.total ?? 0;
	return { notifications, pagination: { limit, offset, total, hasMore: offset + notifications.length < total } };
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadCount(env, userId) {
	const result = await env.road_map_db.prepare(
		'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0'
	).bind(userId).first();
	return { count: result?.count ?? 0 };
}

/**
 * Mark a single notification as read (only if owned by the user).
 */
export async function markAsRead(env, notificationId, userId) {
	if (!Number.isSafeInteger(notificationId) || notificationId < 1) return { error: 'Invalid notification id', status: 400 };
	const result = await env.road_map_db.prepare(
		'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND is_read = 0'
	).bind(notificationId, userId).run();
	if (!result.meta.changes) return { error: 'Notification not found or already read', status: 404 };

	// Push updated unread count via WebSocket
	try {
		const countResult = await env.road_map_db.prepare(
			'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0'
		).bind(userId).first();
		const stub = env.NOTIFICATION_HUB.getByName(`user:${userId}`);
		await stub.broadcast(JSON.stringify({ event: 'unread_count', data: { count: countResult?.count ?? 0 } }));
	} catch (error) {
		console.error('[notification] failed to push unread count:', String(error));
	}

	return { success: true };
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(env, userId) {
	await env.road_map_db.prepare(
		'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
	).bind(userId).run();
	return { success: true };
}
