const MAX_PAGE_SIZE = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const VALID_STATUSES = new Set(['Open', 'Pending', 'Resolved', 'Closed', 'Rejected']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const REPORT_SELECT = `
	SELECT r.id, r.title, r.description, r.author_id, r.author_name, r.status,
		r.image_url, r.static_map_url, r.barangay, r.city, r.province, r.resolved_address,
		r.longitude, r.latitude, r.vote_count, r.comment_count, r.created_at, r.updated_at,
		r.static_map_r2_key, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
	FROM reports r JOIN categories c ON c.id = r.category_id
`;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }
function mediaUrl(key) { return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`; }
function toReport(row, images = []) {
	return {
		id: row.id, title: row.title, description: row.description, authorId: row.author_id, authorName: row.author_name,
		category: { id: row.category_id, name: row.category_name, slug: row.category_slug }, status: row.status,
		imageUrl: row.image_url ? mediaUrl(row.image_url) : null,
		images: images.map((image) => ({ id: image.id, url: mediaUrl(image.r2_key), fileName: image.file_name, contentType: image.content_type })),
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
export async function listReports(env, url) {
	const pagination = parsePagination(url); if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;
	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
		env.road_map_db.prepare('SELECT COUNT(*) AS total FROM reports WHERE deleted_at IS NULL').all(),
	]);
	const reports = await Promise.all(results.map(async (row) => { const { results: images } = await env.road_map_db.prepare('SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id').bind(row.id).all(); return toReport(row, images); }));
	const total = countResult.results[0]?.total ?? 0;
	return json({ reports, pagination: { limit, offset, total, hasMore: offset + reports.length < total } });
}
export async function getReport(env, id, status = 200) { const report = await findReport(env, id); return report ? json(report, status) : errorResponse('Report not found', 404); }
function formValue(form, key, fallback = null) { const value = form.get(key); return typeof value === 'string' ? value : fallback; }
async function parseBody(request) {
	if (request.headers.get('content-type')?.includes('multipart/form-data')) {
		const form = await request.formData(); return { title: formValue(form, 'title', ''), description: formValue(form, 'description', ''), authorId: formValue(form, 'authorId', ''), authorName: formValue(form, 'authorName'), categoryId: formValue(form, 'categoryId'), status: formValue(form, 'status'), imageUrl: null, barangay: formValue(form, 'barangay'), city: formValue(form, 'city'), province: formValue(form, 'province', ''), resolvedAddress: formValue(form, 'resolvedAddress'), longitude: formValue(form, 'longitude'), latitude: formValue(form, 'latitude'), image: form.get('image') };
	}
	return { ...(await request.json()), image: null };
}
function extension(contentType) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[contentType] || 'bin'; }
async function createStaticMap(env, reportId, longitude, latitude) {
	if (!env.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');
	const params = new URLSearchParams({ style: 'osm-bright-smooth', width: '1000', height: '600', center: `lonlat:${longitude},${latitude}`, zoom: '12', marker: `lonlat:${longitude},${latitude}`, apiKey: env.GEOAPIFY_API_KEY });
	const response = await fetch(`https://maps.geoapify.com/v1/staticmap?${params}`);
	if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Geoapify static map generation failed');
	const key = `reports/${reportId}/static-map.png`; await env.ROAD_MAP_MEDIA.put(key, await response.arrayBuffer(), { httpMetadata: { contentType: response.headers.get('content-type') } }); return key;
}
export async function createReport(request, env) {
	let body; try { body = await parseBody(request); } catch { return errorResponse('Request body must be valid JSON or multipart form data'); }
	const title = typeof body.title === 'string' ? body.title.trim() : ''; const description = typeof body.description === 'string' ? body.description.trim() : ''; const authorId = typeof body.authorId === 'string' ? body.authorId.trim() : ''; const province = typeof body.province === 'string' ? body.province.trim() : ''; const longitude = Number(body.longitude); const latitude = Number(body.latitude); const categoryId = Number(body.categoryId);
	if (!title) return errorResponse('title is required'); if (!description) return errorResponse('description is required'); if (!authorId) return errorResponse('authorId is required'); if (!Number.isInteger(categoryId) || categoryId < 1) return errorResponse('categoryId must be a positive integer'); if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return errorResponse('longitude must be between -180 and 180'); if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return errorResponse('latitude must be between -90 and 90'); if (province.toLowerCase() !== 'bataan') return errorResponse('Reports are limited to the Province of Bataan'); if (body.status && !VALID_STATUSES.has(body.status)) return errorResponse('status is invalid');
	const category = await env.road_map_db.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first(); if (!category) return errorResponse('categoryId does not reference an existing category');
	const image = body.image;
	if (image && (typeof image.type !== 'string' || !IMAGE_TYPES.has(image.type))) return errorResponse('image must be a JPEG, PNG, GIF, or WebP file');
	if (image && image.size > MAX_IMAGE_SIZE) return errorResponse('image must be 5 MB or smaller');
	let reportId; let imageKey; let staticMapKey;
	try {
		const result = await env.road_map_db.prepare('INSERT INTO reports (title, description, author_id, author_name, category_id, status, image_url, barangay, city, province, resolved_address, longitude, latitude) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)').bind(title, description, authorId, body.authorName ?? null, categoryId, body.status || 'Open', body.barangay ?? null, body.city ?? null, province, body.resolvedAddress ?? null, longitude, latitude).run();
		reportId = result.meta.last_row_id;
		if (image) { imageKey = `reports/${reportId}/images/${crypto.randomUUID()}.${extension(image.type)}`; await env.ROAD_MAP_MEDIA.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { fileName: image.name || 'upload' } }); await env.road_map_db.prepare('INSERT INTO report_images (report_id, image_url, r2_key, content_type, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)').bind(reportId, imageKey, imageKey, image.type, image.name || null, image.size).run(); }
		staticMapKey = await createStaticMap(env, reportId, longitude, latitude); await env.road_map_db.prepare('UPDATE reports SET static_map_r2_key = ?, static_map_url = ? WHERE id = ?').bind(staticMapKey, mediaUrl(staticMapKey), reportId).run();
		return getReport(env, reportId, 201);
	} catch (error) {
		if (imageKey) await env.ROAD_MAP_MEDIA.delete(imageKey).catch(() => {}); if (staticMapKey) await env.ROAD_MAP_MEDIA.delete(staticMapKey).catch(() => {}); if (reportId) await env.road_map_db.prepare('DELETE FROM reports WHERE id = ?').bind(reportId).run().catch(() => {}); throw error;
	}
}
export async function getMedia(request, env, key) {
	if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return errorResponse('Invalid media key', 400);
	const object = await env.ROAD_MAP_MEDIA.get(key); if (!object) return errorResponse('Media not found', 404);
	const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('Cache-Control', 'public, max-age=31536000, immutable'); return new Response(object.body, { headers });
}
