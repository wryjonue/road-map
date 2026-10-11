const MAX_PAGE_SIZE = 20;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }

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
 * Get paginated notifications for a user.
 */
export async function getNotifications(env, userId, url) {
	const rawLimit = Number(url.searchParams.get('limit') ?? 20);
	const limit = Math.min(Math.max(1, Math.floor(rawLimit)), MAX_PAGE_SIZE);
	const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') ?? 0)));

	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(
			'SELECT id, user_id, type, report_id, actor_id, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
		).bind(userId, limit, offset).all(),
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
		message: row.message,
		isRead: row.is_read === 1,
		createdAt: row.created_at,
	}));

	const total = countResult?.total ?? 0;
	return json({ notifications, pagination: { limit, offset, total, hasMore: offset + notifications.length < total } });
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadCount(env, userId) {
	const result = await env.road_map_db.prepare(
		'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0'
	).bind(userId).first();
	return json({ count: result?.count ?? 0 });
}

/**
 * Mark a single notification as read (only if owned by the user).
 */
export async function markAsRead(env, notificationId, userId) {
	if (!Number.isSafeInteger(notificationId) || notificationId < 1) return errorResponse('Invalid notification id', 400);
	const result = await env.road_map_db.prepare(
		'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND is_read = 0'
	).bind(notificationId, userId).run();
	if (!result.meta.changes) return errorResponse('Notification not found or already read', 404);

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

	return json({ id: notificationId, isRead: true });
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(env, userId) {
	await env.road_map_db.prepare(
		'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
	).bind(userId).run();

	// Push updated unread count via WebSocket
	try {
		const stub = env.NOTIFICATION_HUB.getByName(`user:${userId}`);
		await stub.broadcast(JSON.stringify({ event: 'unread_count', data: { count: 0 } }));
	} catch (error) {
		console.error('[notification] failed to push unread count:', String(error));
	}

	return json({ markedAllRead: true });
}
