import { loadAccessibleReport } from './report-service.js';

const MAX_COMMENT_LENGTH = 2000;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }

// Verified claims win; otherwise fall back to the client-supplied display fields
// (same trust model as report creation — see getAuthorName in report-service.js).
function getAuthorName(body, auth) {
	const verifiedName = [auth.claims?.first_name, auth.claims?.last_name]
		.filter((part) => typeof part === 'string' && part.trim())
		.join(' ')
		.trim();
	const fallbackName = typeof auth.claims?.name === 'string' ? auth.claims.name.trim() : '';
	const suppliedName = typeof body?.authorName === 'string' ? body.authorName.trim() : '';
	return (verifiedName || fallbackName || suppliedName).slice(0, 160) || null;
}
function getAuthorImageUrl(body, auth) {
	const imageUrl = typeof auth.claims?.picture === 'string' ? auth.claims.picture : body?.authorImageUrl;
	if (typeof imageUrl !== 'string' || !imageUrl.trim() || imageUrl.length > 2048) return null;
	try {
		const url = new URL(imageUrl);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}
function toComment(row) {
	return {
		id: row.id,
		reportId: row.report_id,
		authorId: row.author_id,
		authorName: row.author_name,
		authorImageUrl: row.author_image_url,
		body: row.body,
		isSystem: row.is_system === 1,
		createdAt: row.created_at,
	};
}
const COMMENT_COLUMNS = 'id, report_id, author_id, author_name, author_image_url, body, is_system, created_at';

// Inserts a status-change auto comment (never deletable) and bumps the denormalized count.
export async function insertSystemComment(env, reportId, body) {
	const result = await env.road_map_db.prepare(
		'INSERT INTO comments (report_id, author_id, author_name, body, is_system) VALUES (?, ?, ?, ?, 1)',
	).bind(reportId, 'system', 'RoadMap System', body).run();
	if (result.meta.changes) {
		await env.road_map_db.prepare('UPDATE reports SET comment_count = comment_count + 1 WHERE id = ?').bind(reportId).run();
	}
}

export async function getComments(env, reportId, auth = null) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	const report = await loadAccessibleReport(env, reportId, auth);
	if (!report) return errorResponse('Report not found', 404);
	const { results } = await env.road_map_db.prepare(
		`SELECT ${COMMENT_COLUMNS} FROM comments WHERE report_id = ? ORDER BY created_at DESC, id DESC`,
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

	const authorName = getAuthorName(body, auth);
	const authorImageUrl = getAuthorImageUrl(body, auth);
	const result = await env.road_map_db.prepare(
		'INSERT INTO comments (report_id, author_id, author_name, author_image_url, body) VALUES (?, ?, ?, ?, ?)',
	).bind(reportId, auth.userId, authorName, authorImageUrl, text).run();
	if (!result.meta.changes) return errorResponse('Unable to save comment', 500);

	await env.road_map_db.prepare('UPDATE reports SET comment_count = comment_count + 1 WHERE id = ?').bind(reportId).run();
	const saved = await env.road_map_db.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ?`).bind(result.meta.last_row_id).first();
	return json({ comment: saved ? toComment(saved) : null, commentCount: (report.commentCount ?? 0) + 1 }, 201);
}

export async function deleteComment(env, reportId, commentId, auth) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	if (!Number.isSafeInteger(commentId) || commentId < 1) return errorResponse('Comment not found', 404);
	const report = await loadAccessibleReport(env, reportId, auth);
	if (!report) return errorResponse('Report not found', 404);

	const comment = await env.road_map_db.prepare(
		`SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ? AND report_id = ? LIMIT 1`,
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
