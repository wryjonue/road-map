import { LocationResolutionError, resolveRoadLocation } from './location-service.js';

const MAX_PAGE_SIZE = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_IMAGE_SIZE + 256 * 1024;
const GEOAPIFY_TIMEOUT = 10000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAP_REPORT_STATUSES = new Set(['Open', 'Resolved']);
const REPORT_SELECT = `
	SELECT r.id, r.title, r.description, r.author_id, r.author_name, r.author_image_url, r.status,
		r.image_url, r.static_map_url, r.barangay, r.city, r.province, r.resolved_address,
		r.longitude, r.latitude, r.vote_count, r.comment_count, r.created_at, r.updated_at,
		r.static_map_r2_key, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
	FROM reports r JOIN categories c ON c.id = r.category_id
`;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }
function mediaUrl(key) { return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`; }
function canManageReports(auth) { return auth?.role === 'authority' || auth?.role === 'admin'; }
function canReadPending(report, auth) { return canManageReports(auth) || auth?.userId === report.author_id; }
function getAuthorName(body, auth) {
	const verifiedName = [auth.claims?.first_name, auth.claims?.last_name]
		.filter((part) => typeof part === 'string' && part.trim())
		.join(' ')
		.trim();
	const suppliedName = typeof body.authorName === 'string' ? body.authorName.trim() : '';
	return (verifiedName || suppliedName).slice(0, 160) || null;
}
function getAuthorImageUrl(body, auth) {
	const imageUrl = typeof auth.claims?.picture === 'string' ? auth.claims.picture : body.authorImageUrl;
	if (typeof imageUrl !== 'string' || !imageUrl.trim() || imageUrl.length > 2048) return null;
	try {
		const url = new URL(imageUrl);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}
function toReport(row, images = []) {
	return {
		id: row.id, title: row.title, description: row.description, authorId: row.author_id, authorName: row.author_name, authorImageUrl: row.author_image_url,
		category: { id: row.category_id, name: row.category_name, slug: row.category_slug }, status: row.status,
		imageUrl: row.image_url ? mediaUrl(row.image_url) : null,
		images: images.filter((image) => image.r2_key).map((image) => ({ id: image.id, url: mediaUrl(image.r2_key), fileName: image.file_name, contentType: image.content_type })),
		staticMapUrl: row.static_map_r2_key ? mediaUrl(row.static_map_r2_key) : row.static_map_url,
		location: { barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address, longitude: row.longitude, latitude: row.latitude },
		barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address,
		longitude: row.longitude, latitude: row.latitude, voteCount: row.vote_count, commentCount: row.comment_count,
		createdAt: row.created_at, updatedAt: row.updated_at,
	};
}
async function findReport(env, id) {
	const { results } = await env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`).bind(id).all();
	if (!results.length) return null;
	const { results: images } = await env.road_map_db.prepare('SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id').bind(id).all();
	return toReport(results[0], images);
}
function parsePagination(url) {
	const rawLimit = Number(url.searchParams.get('limit') ?? 10); const rawOffset = Number(url.searchParams.get('offset') ?? 0);
	if (!Number.isInteger(rawLimit) || rawLimit < 1) return { error: 'limit must be a positive integer' };
	if (!Number.isInteger(rawOffset) || rawOffset < 0) return { error: 'offset must be a non-negative integer' };
	return { limit: Math.min(rawLimit, MAX_PAGE_SIZE), offset: rawOffset };
}
export async function listReports(env, url, auth = null) {
	const pagination = parsePagination(url); if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;
	let reportVisibility = '';
	let countVisibility = '';
	let reportBindings = [limit, offset];
	let countBindings = [];
	if (!canManageReports(auth)) {
		if (auth?.userId) {
			reportVisibility = " AND (r.status <> 'Pending' OR r.author_id = ?)";
			countVisibility = " AND (status <> 'Pending' OR author_id = ?)";
			reportBindings = [auth.userId, limit, offset];
			countBindings = [auth.userId];
		} else {
			reportVisibility = " AND r.status <> 'Pending'";
			countVisibility = " AND status <> 'Pending'";
		}
	}
	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.deleted_at IS NULL${reportVisibility} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).bind(...reportBindings).all(),
		env.road_map_db.prepare(`SELECT COUNT(*) AS total FROM reports WHERE deleted_at IS NULL${countVisibility}`).bind(...countBindings).all(),
	]);
	const reports = await Promise.all(results.map(async (row) => { const { results: images } = await env.road_map_db.prepare('SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id').bind(row.id).all(); return toReport(row, images); }));
	const total = countResult.results[0]?.total ?? 0;
	return json({ reports, pagination: { limit, offset, total, hasMore: offset + reports.length < total } });
}
export async function getMapReports(env, url) {
	const pagination = parsePagination(url);
	if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;
	const rawCategoryId = url.searchParams.get('categoryId');
	const categoryId = rawCategoryId === null ? null : Number(rawCategoryId);
	if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return errorResponse('categoryId must be a positive integer');
	const status = url.searchParams.get('status');
	if (status !== null && !MAP_REPORT_STATUSES.has(status)) return errorResponse('status must be Open or Resolved');

	let filters = '';
	const filterValues = [];
	if (categoryId !== null) {
		filters += ' AND r.category_id = ?';
		filterValues.push(categoryId);
	}
	if (status !== null) {
		filters += ' AND r.status = ?';
		filterValues.push(status);
	}
	const mapQuery = `
		SELECT r.id, r.title, r.description, r.author_id, r.author_name, r.author_image_url,
			r.status, r.barangay, r.city, r.province, r.resolved_address,
			r.longitude, r.latitude, r.created_at,
			c.id AS category_id, c.name AS category_name, c.slug AS category_slug
		FROM reports r JOIN categories c ON c.id = r.category_id
		WHERE r.deleted_at IS NULL AND r.status IN ('Open', 'Resolved')${filters}
		ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`;
	const countQuery = `SELECT COUNT(*) AS total FROM reports r WHERE r.deleted_at IS NULL AND r.status IN ('Open', 'Resolved')${filters}`;
	const values = [...filterValues, limit, offset];
	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(mapQuery).bind(...values).all(),
		env.road_map_db.prepare(countQuery).bind(...filterValues).first(),
	]);
	const reports = results.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		authorId: row.author_id,
		authorName: row.author_name,
		authorImageUrl: row.author_image_url,
		status: row.status,
		category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
		location: { barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address, longitude: row.longitude, latitude: row.latitude },
		longitude: row.longitude,
		latitude: row.latitude,
		createdAt: row.created_at,
	}));
	const total = countResult?.total ?? 0;
	return json({ reports, pagination: { limit, offset, total, hasMore: offset + reports.length < total } });
}
export async function getReport(env, id, status = 200, auth = null) {
	const report = await findReport(env, id);
	if (!report || (report.status === 'Pending' && !canReadPending({ status: report.status, author_id: report.authorId }, auth))) return errorResponse('Report not found', 404);
	return json(report, status);
}
export async function approveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse('Insufficient permissions', 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (report.status !== 'Pending') return errorResponse('Only pending reports can be approved', 409);
	const result = await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL").bind(new Date().toISOString(), id).run();
	if (!result.meta.changes) return errorResponse('Report status changed; reload and try again', 409);
	return getReport(env, id, 200, auth);
}
export async function deletePendingReport(env, id, auth) {
	if (!auth?.userId) return errorResponse('Authentication required', 401);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (!canManageReports(auth) && auth.userId !== report.author_id) return errorResponse('Report not found', 404);
	if (report.status !== 'Pending') return errorResponse('Only pending reports can be deleted', 409);
	const deletedAt = new Date().toISOString();
	const ownershipClause = canManageReports(auth) ? '' : ' AND author_id = ?';
	const bindings = canManageReports(auth) ? [deletedAt, deletedAt, id] : [deletedAt, deletedAt, id, auth.userId];
	const result = await env.road_map_db.prepare(`UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL${ownershipClause}`).bind(...bindings).run();
	if (!result.meta.changes) return errorResponse('Report changed; reload and try again', 409);
	return json({ id, deleted: true });
}
export async function resolveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse('Insufficient permissions', 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (report.status === 'Pending') return errorResponse('Pending reports must be approved before resolution', 409);
	if (report.status !== 'Resolved') {
		const resolvedAt = new Date().toISOString();
		const result = await env.road_map_db.prepare("UPDATE reports SET status = 'Resolved', updated_at = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status NOT IN ('Pending', 'Resolved') AND deleted_at IS NULL").bind(resolvedAt, resolvedAt, auth.userId, id).run();
		if (!result.meta.changes) return errorResponse('Report status changed; reload and try again', 409);
	}
	return getReport(env, id, 200, auth);
}
function formValue(form, key, fallback = null) { const value = form.get(key); return typeof value === 'string' ? value : fallback; }
async function parseBody(request) {
	if (request.headers.get('content-type')?.includes('multipart/form-data')) {
		const form = await request.formData();
		return {
			title: formValue(form, 'title', ''),
			description: formValue(form, 'description', ''),
			authorId: formValue(form, 'authorId', ''),
			authorName: formValue(form, 'authorName'),
			authorImageUrl: formValue(form, 'authorImageUrl'),
			categoryId: formValue(form, 'categoryId'),
			status: formValue(form, 'status'),
			imageUrl: null,
			barangay: formValue(form, 'barangay'),
			city: formValue(form, 'city'),
			province: formValue(form, 'province', ''),
			resolvedAddress: formValue(form, 'resolvedAddress'),
			longitude: formValue(form, 'longitude'),
			latitude: formValue(form, 'latitude'),
			image: form.get('image'),
		};
	}
	return { ...(await request.json()), image: null };
}
function extension(contentType) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[contentType] || 'bin'; }
async function createStaticMap(env, reportId, longitude, latitude) {
	if (!env.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');
	const params = new URLSearchParams({ style: 'osm-bright-smooth', width: '1000', height: '600', center: `lonlat:${longitude},${latitude}`, zoom: '12', marker: `lonlat:${longitude},${latitude}`, apiKey: env.GEOAPIFY_API_KEY });
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), GEOAPIFY_TIMEOUT);
	let response;
	try { response = await fetch(`https://maps.geoapify.com/v1/staticmap?${params}`, { signal: controller.signal }); } finally { clearTimeout(timeout); }
	if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Geoapify static map generation failed');
	const key = `reports/${reportId}/static-map.png`; await env.ROAD_MAP_MEDIA.put(key, await response.arrayBuffer(), { httpMetadata: { contentType: response.headers.get('content-type') } }); return key;
}
export async function createReport(request, env, auth) {
	const contentLength = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) return errorResponse('Request is too large');
	let body; try { body = await parseBody(request); } catch { return errorResponse('Request body must be valid JSON or multipart form data'); }
	const title = typeof body.title === 'string' ? body.title.trim() : ''; const description = typeof body.description === 'string' ? body.description.trim() : ''; const longitude = Number(body.longitude); const latitude = Number(body.latitude); const categoryId = Number(body.categoryId);
	if (!title) return errorResponse('title is required'); if (!description) return errorResponse('description is required'); if (title.length > 160) return errorResponse('title must be 160 characters or fewer'); if (description.length > 5000) return errorResponse('description must be 5000 characters or fewer'); if (!Number.isInteger(categoryId) || categoryId < 1) return errorResponse('categoryId must be a positive integer');
	let resolvedLocation;
	try { resolvedLocation = await resolveRoadLocation(latitude, longitude, env, request.signal); } catch (error) {
		if (error instanceof LocationResolutionError) return errorResponse(error.message, error.status);
		throw error;
	}
	const category = await env.road_map_db.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first(); if (!category) return errorResponse('categoryId does not reference an existing category');
	const image = body.image;
	if (image && (typeof image.type !== 'string' || !IMAGE_TYPES.has(image.type))) return errorResponse('image must be a JPEG, PNG, GIF, or WebP file');
	if (image && image.size > MAX_IMAGE_SIZE) return errorResponse('image must be 5 MB or smaller');
	let reportId; let imageKey; let staticMapKey;
	try {
		const authorName = getAuthorName(body, auth);
		const authorImageUrl = getAuthorImageUrl(body, auth);
		const result = await env.road_map_db.prepare('INSERT INTO reports (title, description, author_id, author_name, author_image_url, category_id, status, image_url, barangay, city, province, resolved_address, longitude, latitude) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)').bind(title, description, auth.userId, authorName, authorImageUrl, categoryId, 'Pending', resolvedLocation.barangay || null, resolvedLocation.city || null, resolvedLocation.province, resolvedLocation.address, resolvedLocation.longitude, resolvedLocation.latitude).run();
		reportId = result.meta.last_row_id;
		if (image) { imageKey = `reports/${reportId}/images/${crypto.randomUUID()}.${extension(image.type)}`; await env.ROAD_MAP_MEDIA.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { fileName: image.name || 'upload' } }); await env.road_map_db.prepare('INSERT INTO report_images (report_id, image_url, r2_key, content_type, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)').bind(reportId, imageKey, imageKey, image.type, image.name || null, image.size).run(); }
		staticMapKey = await createStaticMap(env, reportId, longitude, latitude); await env.road_map_db.prepare('UPDATE reports SET static_map_r2_key = ?, static_map_url = ? WHERE id = ?').bind(staticMapKey, mediaUrl(staticMapKey), reportId).run();
		return getReport(env, reportId, 201, auth);
	} catch (error) {
		if (imageKey) await env.ROAD_MAP_MEDIA.delete(imageKey).catch(() => {}); if (staticMapKey) await env.ROAD_MAP_MEDIA.delete(staticMapKey).catch(() => {}); if (reportId) await env.road_map_db.prepare('DELETE FROM reports WHERE id = ?').bind(reportId).run().catch(() => {}); throw error;
	}
}
export async function getMedia(request, env, key, auth = null) {
	if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return errorResponse('Invalid media key', 400);
	const report = await env.road_map_db.prepare('SELECT r.status, r.author_id FROM reports r WHERE r.deleted_at IS NULL AND (r.static_map_r2_key = ? OR r.image_url = ? OR EXISTS (SELECT 1 FROM report_images ri WHERE ri.report_id = r.id AND ri.r2_key = ?)) LIMIT 1').bind(key, key, key).first();
	if (!report || (report.status === 'Pending' && !canReadPending(report, auth))) return errorResponse('Media not found', 404);
	const object = await env.ROAD_MAP_MEDIA.get(key); if (!object) return errorResponse('Media not found', 404);
	const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('Cache-Control', 'private, no-store'); return new Response(object.body, { headers });
}
