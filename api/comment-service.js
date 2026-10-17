import { loadAccessibleReport } from './report-service.js';
import { buildDisplayName } from './user-service.js';
import { createNotification } from './notification-service.js';

const MAX_COMMENT_LENGTH = 2000;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }

function toComment(row) {
	return {
		id: row.id,
		reportId: row.report_id,
		authorId: row.author_id,
		authorName: row.is_system === 1 ? 'RoadMap System' : buildDisplayName(row.author_first_name, row.author_last_name),
		authorImageUrl: row.author_image_url,
		body: row.body,
		isSystem: row.is_system === 1,
		createdAt: row.created_at,
	};
}

const COMMENT_SELECT = `
	SELECT cm.id, cm.report_id, cm.author_id, cm.body, cm.is_system, cm.created_at,
		u.first_name AS author_first_name, u.last_name AS author_last_name, u.image_url AS author_image_url
	FROM comments cm
	LEFT JOIN users u ON u.id = cm.author_id AND u.deleted_at IS NULL
`;

// Inserts a status-change auto comment (never deletable) and bumps the denormalized count.
export async function insertSystemComment(env, reportId, body) {
	const result = await env.road_map_db.prepare(
		'INSERT INTO comments (report_id, author_id, body, is_system) VALUES (?, ?, ?, 1)',
	).bind(reportId, 'system', body).run();
	if (result.meta.changes) {
		await env.road_map_db.prepare('UPDATE reports SET comment_count = comment_count + 1 WHERE id = ?').bind(reportId).run();
	}
}

export async function getComments(env, reportId, auth = null) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	const report = await loadAccessibleReport(env, reportId, auth);
	if (!report) return errorResponse('Report not found', 404);
	const { results } = await env.road_map_db.prepare(
		`${COMMENT_SELECT} WHERE cm.report_id = ? ORDER BY cm.created_at DESC, cm.id DESC`,
	).bind(reportId).all();
	return json({ comments: results.map(toComment), commentCount: report.commentCount ?? results.length });
}

export async function createComment(request, env, reportId, auth) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	const report = await loadAccessibleReport(env, reportId, auth);
	if (!report) return errorResponse('Report not found', 404);

	let body;
	try { body = await request.json(); } catch { return errorResponse('Request body must be valid JSON'); }
	const text = typeof body?.body === 'string' ? body.body.trim() : '';
	if (!text) return errorResponse('body is required');
	if (text.length > MAX_COMMENT_LENGTH) return errorResponse(`body must be ${MAX_COMMENT_LENGTH} characters or fewer`);

	const result = await env.road_map_db.prepare(
		'INSERT INTO comments (report_id, author_id, body) VALUES (?, ?, ?)',
	).bind(reportId, auth.userId, text).run();
	if (!result.meta.changes) return errorResponse('Unable to save comment', 500);

	await env.road_map_db.prepare('UPDATE reports SET comment_count = comment_count + 1 WHERE id = ?').bind(reportId).run();
	const saved = await env.road_map_db.prepare(`${COMMENT_SELECT} WHERE cm.id = ?`).bind(result.meta.last_row_id).first();

	// Notify report author and prior non-system commenters (excluding self).
	// Fire-and-forget; failures are logged but do not block the response.
	try {
		const actorName = buildDisplayName(auth.claims?.first_name, auth.claims?.last_name) || 'Someone';
		const recipients = await env.road_map_db.prepare(
			'SELECT DISTINCT author_id FROM comments WHERE report_id = ? AND is_system = 0 AND author_id != ? UNION SELECT author_id FROM reports WHERE id = ? AND author_id != ?',
		).bind(reportId, auth.userId, reportId, auth.userId).all();
		for (const row of recipients.results) {
			await createNotification(env, {
				userId: row.author_id,
				type: 'comment_created',
				reportId,
				actorId: auth.userId,
				message: `${actorName} commented on a report you're involved in.`,
			});
		}
	} catch (err) {
		console.error('[comment] failed to dispatch comment notifications:', String(err));
	}

	return json({ comment: saved ? toComment(saved) : null, commentCount: (report.commentCount ?? 0) + 1 }, 201);
}

export async function deleteComment(env, reportId, commentId, auth) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	if (!Number.isSafeInteger(commentId) || commentId < 1) return errorResponse('Comment not found', 404);
	const report = await loadAccessibleReport(env, reportId, auth);
	if (!report) return errorResponse('Report not found', 404);

	const comment = await env.road_map_db.prepare(
		`${COMMENT_SELECT} WHERE cm.id = ? AND cm.report_id = ? LIMIT 1`,
	).bind(commentId, reportId).first();
	if (!comment) return errorResponse('Comment not found', 404);
	if (comment.is_system === 1) return errorResponse('System comments cannot be deleted', 403);

	const isAdmin = auth?.role === 'admin';
	const isCommenter = auth?.userId === comment.author_id;
	const isReportAuthor = auth?.userId === report.authorId;
	if (!isAdmin && !isCommenter && !isReportAuthor) return errorResponse('Insufficient permissions', 403);

	const result = await env.road_map_db.prepare('DELETE FROM comments WHERE id = ? AND report_id = ?').bind(commentId, reportId).run();
	if (result.meta.changes) {
		await env.road_map_db.prepare('UPDATE reports SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?').bind(reportId).run();
	}
	const countRow = await env.road_map_db.prepare('SELECT comment_count FROM reports WHERE id = ?').bind(reportId).first();
	return json({ id: commentId, deleted: true, commentCount: countRow?.comment_count ?? 0 });
}
