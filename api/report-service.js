import { LocationResolutionError, resolveRoadLocation } from './location-service.js';
import { computeHotspots } from './clustering.js';
import { calculateRoute } from './routing-service.js';
import { createNotification } from './notification-service.js';
import { insertSystemComment } from './comment-service.js';
import { buildDisplayName } from './user-service.js';
import { moderateReport } from './ai-service.js';

const MAX_PAGE_SIZE = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_IMAGE_SIZE + 256 * 1024;
const GEOAPIFY_TIMEOUT = 10000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAP_REPORT_STATUSES = new Set(['Open', 'Resolved']);
const REPORT_SELECT = `
	SELECT r.id, r.title, r.description, r.author_id, r.status,
		r.image_url, r.static_map_url, r.barangay, r.city, r.province, r.resolved_address,
		r.longitude, r.latitude, r.start_longitude, r.start_latitude, r.dest_longitude, r.dest_latitude,
		r.route_polyline, r.vote_count, r.comment_count, r.created_at, r.updated_at,
		r.static_map_r2_key, c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
		u.first_name AS author_first_name, u.last_name AS author_last_name, u.image_url AS author_image_url
	FROM reports r
	JOIN categories c ON c.id = r.category_id
	LEFT JOIN users u ON u.id = r.author_id AND u.deleted_at IS NULL
`;

function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function errorResponse(message, status = 400) { return json({ error: message }, status); }
function mediaUrl(key) { return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`; }
function canManageReports(auth) { return auth?.role === 'authority' || auth?.role === 'admin'; }
function canReadPending(report, auth) { return canManageReports(auth) || auth?.userId === report.author_id; }
function isArchived(report) { return report?.status === 'Rejected' || report?.deleted_at != null; }
function toReport(row, images = []) {
	const authorName = buildDisplayName(row.author_first_name, row.author_last_name);
	return {
		id: row.id, title: row.title, description: row.description, authorId: row.author_id, authorName, authorImageUrl: row.author_image_url,
		category: { id: row.category_id, name: row.category_name, slug: row.category_slug }, status: row.status,
		imageUrl: row.image_url ? mediaUrl(row.image_url) : null,
		images: images.filter((image) => image.r2_key).map((image) => ({ id: image.id, url: mediaUrl(image.r2_key), fileName: image.file_name, contentType: image.content_type })),
		staticMapUrl: row.static_map_r2_key ? mediaUrl(row.static_map_r2_key) : row.static_map_url,
		location: { barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address, longitude: row.longitude, latitude: row.latitude },
		startLocation: row.start_longitude != null && row.start_latitude != null ? { longitude: row.start_longitude, latitude: row.start_latitude } : null,
		destLocation: row.dest_longitude != null && row.dest_latitude != null ? { longitude: row.dest_longitude, latitude: row.dest_latitude } : null,
		routePolyline: row.route_polyline || null,
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
async function findReportAny(env, id) {
	const { results } = await env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.id = ? LIMIT 1`).bind(id).all();
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
const FEED_STATUSES = new Set(['Open', 'Pending', 'Resolved', 'Rejected']);
const FEED_SORTS = new Set(['recent', 'oldest', 'votes']);
function feedOrderBy(sort) {
	if (sort === 'oldest') return 'ORDER BY r.created_at ASC, r.id ASC';
	if (sort === 'votes') return 'ORDER BY r.vote_count DESC, r.created_at DESC, r.id DESC';
	return 'ORDER BY r.created_at DESC, r.id DESC';
}
export async function listReports(env, url, auth = null) {
	const pagination = parsePagination(url); if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;

	const rawCategoryId = url.searchParams.get('categoryId');
	const categoryId = rawCategoryId === null || rawCategoryId === '' ? null : Number(rawCategoryId);
	if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return errorResponse('categoryId must be a positive integer');
	const status = url.searchParams.get('status');
	if (status !== null && status !== '' && !FEED_STATUSES.has(status)) return errorResponse('status must be one of Open, Pending, Resolved, Rejected');
	const municipality = url.searchParams.get('municipality');
	const city = municipality && municipality !== 'all' ? municipality.trim() : null;
	const qRaw = url.searchParams.get('q');
	const q = qRaw && qRaw.trim() ? qRaw.trim().slice(0, 200) : null;
	const sortParam = url.searchParams.get('sort') || 'recent';
	if (!FEED_SORTS.has(sortParam)) return errorResponse('sort must be one of recent, oldest, votes');

	let filters = '';
	const filterValues = [];
	if (categoryId !== null) { filters += ' AND r.category_id = ?'; filterValues.push(categoryId); }
	if (status !== null && status !== '') { filters += ' AND r.status = ?'; filterValues.push(status); }
	if (city !== null) { filters += ' AND r.city = ?'; filterValues.push(city); }
	if (q !== null) { filters += ' AND (r.title LIKE ? OR r.description LIKE ?)'; const like = `%${q}%`; filterValues.push(like, like); }

	// Pending visibility: non-managers only see their own pending (or none if signed out).
	let visibility = '';
	const visibilityValues = [];
	if (!canManageReports(auth)) {
		if (auth?.userId) {
			visibility = " AND (r.status <> 'Pending' OR r.author_id = ?)";
			visibilityValues.push(auth.userId);
		} else {
			visibility = " AND r.status <> 'Pending'";
		}
	}

	const whereBase = `WHERE r.deleted_at IS NULL AND r.status <> 'Rejected'${filters}${visibility}`;
	// Count query uses the same predicates but without the r. alias on the base reports table.
	const countFilters = filters.replaceAll('r.', '');
	const countVisibility = visibility.replaceAll('r.', '');
	const countWhere = `WHERE deleted_at IS NULL AND status <> 'Rejected'${countFilters}${countVisibility}`;

	const orderBy = feedOrderBy(sortParam);
	const [{ results }, countResult] = await Promise.all([
		env.road_map_db.prepare(`${REPORT_SELECT} ${whereBase} ${orderBy} LIMIT ? OFFSET ?`).bind(...filterValues, ...visibilityValues, limit, offset).all(),
		env.road_map_db.prepare(`SELECT COUNT(*) AS total FROM reports ${countWhere}`).bind(...filterValues, ...visibilityValues).all(),
	]);
	const reports = await Promise.all(results.map(async (row) => { const { results: images } = await env.road_map_db.prepare('SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id').bind(row.id).all(); return toReport(row, images); }));
	const total = countResult.results[0]?.total ?? 0;
	return json({ reports, pagination: { limit, offset, total, hasMore: offset + reports.length < total } });
}
export async function getReportFacets(env) {
	const [{ results: categories }, { results: cities }] = await Promise.all([
		env.road_map_db.prepare('SELECT id, name, slug FROM categories ORDER BY id').all(),
		env.road_map_db.prepare("SELECT DISTINCT city FROM reports WHERE deleted_at IS NULL AND city IS NOT NULL AND city <> '' ORDER BY city").all(),
	]);
	return json({
		categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
		municipalities: cities.map((row) => row.city).filter(Boolean),
	});
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
		SELECT r.id, r.title, r.description, r.author_id,
			r.status, r.barangay, r.city, r.province, r.resolved_address,
			r.longitude, r.latitude, r.start_longitude, r.start_latitude, r.dest_longitude, r.dest_latitude,
			r.route_polyline, r.created_at,
			c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
			u.first_name AS author_first_name, u.last_name AS author_last_name, u.image_url AS author_image_url
		FROM reports r
		JOIN categories c ON c.id = r.category_id
		LEFT JOIN users u ON u.id = r.author_id AND u.deleted_at IS NULL
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
		authorName: buildDisplayName(row.author_first_name, row.author_last_name),
		authorImageUrl: row.author_image_url,
		status: row.status,
		category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
		location: { barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address, longitude: row.longitude, latitude: row.latitude },
		startLocation: row.start_longitude != null && row.start_latitude != null ? { longitude: row.start_longitude, latitude: row.start_latitude } : null,
		destLocation: row.dest_longitude != null && row.dest_latitude != null ? { longitude: row.dest_longitude, latitude: row.dest_latitude } : null,
		routePolyline: row.route_polyline || null,
		longitude: row.longitude,
		latitude: row.latitude,
		createdAt: row.created_at,
	}));
	const total = countResult?.total ?? 0;
	return json({ reports, pagination: { limit, offset, total, hasMore: offset + reports.length < total } });
}
const MAX_HOTSPOT_POINTS = 2000;

export async function getHotspots(env, url) {
	const rawDays = Number(url.searchParams.get('days') ?? 90);
	const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 365) : 90;
	const rawEps = Number(url.searchParams.get('eps') ?? 300);
	const eps = Number.isFinite(rawEps) && rawEps > 0 ? Math.min(rawEps, 5000) : 300;
	const rawMinPts = Number(url.searchParams.get('minPts') ?? 3);
	const minPts = Number.isInteger(rawMinPts) && rawMinPts > 0 ? Math.min(rawMinPts, 50) : 3;

	const sinceDate = new Date(Date.now() - days * 86400000);
	const since = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}`;

	let bboxClause = '';
	const bboxValues = [];
	const rawSwLng = url.searchParams.get('sw_lng');
	const rawSwLat = url.searchParams.get('sw_lat');
	const rawNeLng = url.searchParams.get('ne_lng');
	const rawNeLat = url.searchParams.get('ne_lat');
	const swLng = rawSwLng !== null ? Number(rawSwLng) : NaN;
	const swLat = rawSwLat !== null ? Number(rawSwLat) : NaN;
	const neLng = rawNeLng !== null ? Number(rawNeLng) : NaN;
	const neLat = rawNeLat !== null ? Number(rawNeLat) : NaN;
	if ([swLng, swLat, neLng, neLat].every(Number.isFinite)) {
		bboxClause = ' AND r.longitude >= ? AND r.longitude <= ? AND r.latitude >= ? AND r.latitude <= ?';
		bboxValues.push(swLng, neLng, swLat, neLat);
	}

	const query = `
		SELECT r.id, r.latitude, r.longitude, r.status, r.category_id, r.route_polyline
		FROM reports r
		WHERE r.deleted_at IS NULL
			AND r.status IN ('Open', 'Resolved')
			AND r.latitude IS NOT NULL
			AND r.longitude IS NOT NULL
			AND r.route_polyline IS NOT NULL
			AND r.created_at >= ?${bboxClause}
		ORDER BY r.created_at DESC
		LIMIT ?`;
	const values = [since, ...bboxValues, MAX_HOTSPOT_POINTS];
	const { results } = await env.road_map_db.prepare(query).bind(...values).all();

	const geojson = computeHotspots(results, eps, minPts);
	return json(geojson);
}

// Shared visibility rules for a single report: managers see everything;
// everyone else gets null for archived (rejected/deleted) or others' pending reports.
export async function loadAccessibleReport(env, id, auth = null) {
	const report = canManageReports(auth) ? await findReportAny(env, id) : await findReport(env, id);
	if (!report) return null;
	if (isArchived(report) && !canManageReports(auth)) return null;
	if (report.status === 'Pending' && !canReadPending({ status: report.status, author_id: report.authorId }, auth)) return null;
	return report;
}
export async function getReport(env, id, status = 200, auth = null) {
	const report = await loadAccessibleReport(env, id, auth);
	if (!report) return errorResponse('Report not found', 404);
	return json(report, status);
}
export async function approveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse('Insufficient permissions', 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (report.status !== 'Pending') return errorResponse('Only pending reports can be approved', 409);
	const result = await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL").bind(new Date().toISOString(), id).run();
	if (!result.meta.changes) return errorResponse('Report status changed; reload and try again', 409);
	await createNotification(env, { userId: report.author_id, type: 'report_approved', reportId: id, actorId: auth.userId, message: 'Your report was approved and is now visible to the community.' });
	const actor = buildDisplayName(auth.claims?.first_name, auth.claims?.last_name);
	await insertSystemComment(env, id, `Report approved${actor ? ` by ${actor}` : ''} and is now visible to the community.`);
	return getReport(env, id, 200, auth);
}
export async function rejectReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse('Insufficient permissions', 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (report.status !== 'Pending') return errorResponse('Only pending reports can be rejected', 409);
	const now = new Date().toISOString();
	const result = await env.road_map_db.prepare("UPDATE reports SET status = 'Rejected', updated_at = ?, archived_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL").bind(now, now, id).run();
	if (!result.meta.changes) return errorResponse('Report status changed; reload and try again', 409);
	await createNotification(env, { userId: report.author_id, type: 'report_rejected', reportId: id, actorId: auth.userId, message: 'Your report was rejected by an enforcer.' });
	return getReport(env, id, 200, auth);
}
export async function deletePendingReport(env, id, auth) {
	if (!auth?.userId) return errorResponse('Authentication required', 401);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (!canManageReports(auth) && auth.userId !== report.author_id) return errorResponse('Report not found', 404);
	if (report.status !== 'Pending' && report.status !== 'Open') return errorResponse('Only pending or open reports can be deleted', 409);
	const deletedAt = new Date().toISOString();
	const ownershipClause = canManageReports(auth) ? '' : ' AND author_id = ?';
	const bindings = canManageReports(auth) ? [deletedAt, deletedAt, deletedAt, id] : [deletedAt, deletedAt, deletedAt, id, auth.userId];
	const result = await env.road_map_db.prepare(`UPDATE reports SET deleted_at = ?, updated_at = ?, archived_at = ? WHERE id = ? AND status IN ('Pending', 'Open') AND deleted_at IS NULL${ownershipClause}`).bind(...bindings).run();
	if (!result.meta.changes) return errorResponse('Report changed; reload and try again', 409);
	return json({ id, deleted: true });
}
export async function resolveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse('Insufficient permissions', 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse('Report not found', 404);
	const report = await env.road_map_db.prepare('SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL').bind(id).first();
	if (!report) return errorResponse('Report not found', 404);
	if (report.status === 'Pending') return errorResponse('Pending reports must be approved before resolution', 409);
	if (report.status !== 'Resolved') {
		const resolvedAt = new Date().toISOString();
		const result = await env.road_map_db.prepare("UPDATE reports SET status = 'Resolved', updated_at = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status NOT IN ('Pending', 'Resolved') AND deleted_at IS NULL").bind(resolvedAt, resolvedAt, auth.userId, id).run();
		if (!result.meta.changes) return errorResponse('Report status changed; reload and try again', 409);
		await createNotification(env, { userId: report.author_id, type: 'report_resolved', reportId: id, actorId: auth.userId, message: 'Your report was marked as resolved.' });
		const actor = buildDisplayName(auth.claims?.first_name, auth.claims?.last_name);
		await insertSystemComment(env, id, `This report was marked as resolved${actor ? ` by ${actor}` : ''}.`);
	}
	return getReport(env, id, 200, auth);
}

// Vote functions
const VOTABLE_STATUSES = new Set(['Open', 'Resolved']);

async function getUserVoteStatus(env, reportId, userId) {
	const vote = await env.road_map_db.prepare('SELECT 1 FROM report_votes WHERE report_id = ? AND user_id = ?').bind(reportId, userId).first();
	return !!vote;
}

export async function voteReport(env, reportId, userId) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	
	const report = await env.road_map_db.prepare('SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL').bind(reportId).first();
	if (!report) return errorResponse('Report not found', 404);
	if (!VOTABLE_STATUSES.has(report.status)) return errorResponse('Voting is only allowed on Open or Resolved reports', 409);

	const existingVote = await env.road_map_db.prepare('SELECT 1 FROM report_votes WHERE report_id = ? AND user_id = ?').bind(reportId, userId).first();
	if (existingVote) {
		// User already voted - remove vote (toggle off)
		const deleteResult = await env.road_map_db.prepare('DELETE FROM report_votes WHERE report_id = ? AND user_id = ?').bind(reportId, userId).run();
		if (deleteResult.meta.changes) {
			await env.road_map_db.prepare('UPDATE reports SET vote_count = vote_count - 1 WHERE id = ?').bind(reportId).run();
		}
		const newVoteCount = await env.road_map_db.prepare('SELECT vote_count FROM reports WHERE id = ?').bind(reportId).first();
		return json({ voteCount: newVoteCount?.vote_count ?? 0, hasVoted: false });
	}

	// Add vote (toggle on)
	const insertResult = await env.road_map_db.prepare('INSERT INTO report_votes (report_id, user_id) VALUES (?, ?)').bind(reportId, userId).run();
	if (insertResult.meta.changes) {
		await env.road_map_db.prepare('UPDATE reports SET vote_count = vote_count + 1 WHERE id = ?').bind(reportId).run();
	}
	const newVoteCount = await env.road_map_db.prepare('SELECT vote_count FROM reports WHERE id = ?').bind(reportId).first();
	return json({ voteCount: newVoteCount?.vote_count ?? 0, hasVoted: true });
}

export async function getVoteStatus(env, reportId, userId) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse('Report not found', 404);
	
	const report = await env.road_map_db.prepare('SELECT vote_count FROM reports WHERE id = ? AND deleted_at IS NULL').bind(reportId).first();
	if (!report) return errorResponse('Report not found', 404);
	
	const hasVoted = userId ? await getUserVoteStatus(env, reportId, userId) : false;
	return json({ voteCount: report.vote_count, hasVoted });
}

function formValue(form, key, fallback = null) { const value = form.get(key); return typeof value === 'string' ? value : fallback; }
async function parseBody(request) {
	if (request.headers.get('content-type')?.includes('multipart/form-data')) {
		const form = await request.formData();
		return {
			title: formValue(form, 'title', ''),
			description: formValue(form, 'description', ''),
			authorId: formValue(form, 'authorId', ''),
			categoryId: formValue(form, 'categoryId'),
			status: formValue(form, 'status'),
			imageUrl: null,
			barangay: formValue(form, 'barangay'),
			city: formValue(form, 'city'),
			province: formValue(form, 'province', ''),
			resolvedAddress: formValue(form, 'resolvedAddress'),
			longitude: formValue(form, 'longitude'),
			latitude: formValue(form, 'latitude'),
			startLongitude: formValue(form, 'startLongitude'),
			startLatitude: formValue(form, 'startLatitude'),
			destLongitude: formValue(form, 'destLongitude'),
			destLatitude: formValue(form, 'destLatitude'),
			image: form.get('image'),
		};
	}
	return { ...(await request.json()), image: null };
}



function extension(contentType) { return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[contentType] || 'bin'; }
async function createStaticMap(env, reportId, longitude, latitude, routeGeometry, startLng, startLat, destLng, destLat) {
	if (!env.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), GEOAPIFY_TIMEOUT);
	let url;
	if (routeGeometry && Array.isArray(routeGeometry.coordinates) && routeGeometry.coordinates.length > 0) {
		// Simplify to ~40 points to keep the URL short.
		const coords = routeGeometry.coordinates;
		const step = Math.max(1, Math.floor(coords.length / 40));
		const simplified = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
		// Geoapify geometry format (from working sample URL):
		//   geometry=polyline:lng1,lat1,lng2,lat2,...;fillcolor:%23hex
		// All coordinates are comma-separated in a flat list (NOT pipe-separated).
		// The parameter name is 'geometry' (NOT 'polyline').
		// Geoapify auto-fits to the geometry when center/area/marker are omitted.
		const flatCoords = simplified.flatMap((c) => [Number(c[0]).toFixed(6), Number(c[1]).toFixed(6)]).join(',');
		const geometryParam = `polyline:${flatCoords};linecolor:%230066ff;linewidth:10`;
		url = `https://maps.geoapify.com/v1/staticmap?style=osm-bright-smooth&width=1000&height=600`
			+ `&geometry=${geometryParam}`
			+ `&apiKey=${encodeURIComponent(env.GEOAPIFY_API_KEY)}`;
		console.log(url);
		console.log('[static-map] geometry url length=', url.length, 'points=', simplified.length);
	} else {
		const params = new URLSearchParams({ style: 'osm-bright-smooth', width: '1000', height: '600', center: `lonlat:${longitude},${latitude}`, zoom: '16', marker: `lonlat:${longitude},${latitude}`, apiKey: env.GEOAPIFY_API_KEY });
		url = `https://maps.geoapify.com/v1/staticmap?${params}`;
	}
	let response;
	try { response = await fetch(url, { signal: controller.signal }); } finally { clearTimeout(timeout); }
	if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
		let detail = '';
		try { detail = (await response.clone().text()).slice(0, 200); } catch {}
		console.error('[static-map] failed status=', response.status, 'detail=', detail);
		throw new Error('Geoapify static map generation failed');
	}
	const key = `reports/${reportId}/static-map.png`; await env.ROAD_MAP_MEDIA.put(key, await response.arrayBuffer(), { httpMetadata: { contentType: response.headers.get('content-type') } }); return key;
}



export async function createReport(request, env, auth, ctx) {
	const contentLength = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) return errorResponse('Request is too large');
	let body; try { body = await parseBody(request); } catch { return errorResponse('Request body must be valid JSON or multipart form data'); }
	const title = typeof body.title === 'string' ? body.title.trim() : ''; const description = typeof body.description === 'string' ? body.description.trim() : ''; const longitude = Number(body.longitude); const latitude = Number(body.latitude); const categoryId = Number(body.categoryId);
	const startLongitude = body.startLongitude != null ? Number(body.startLongitude) : null;
	const startLatitude = body.startLatitude != null ? Number(body.startLatitude) : null;
	const destLongitude = body.destLongitude != null ? Number(body.destLongitude) : null;
	const destLatitude = body.destLatitude != null ? Number(body.destLatitude) : null;
	if (!title) return errorResponse('title is required'); if (!description) return errorResponse('description is required'); if (title.length > 160) return errorResponse('title must be 160 characters or fewer'); if (description.length > 5000) return errorResponse('description must be 5000 characters or fewer'); if (!Number.isInteger(categoryId) || categoryId < 1) return errorResponse('categoryId must be a positive integer');
	let resolvedLocation;
	try { resolvedLocation = await resolveRoadLocation(latitude, longitude, env, request.signal); } catch (error) {
		if (error instanceof LocationResolutionError) return errorResponse(error.message, error.status);
		throw error;
	}
	let resolvedStart = null;
	let resolvedDest = null;
	let routePolyline = null;
	if (Number.isFinite(startLongitude) && Number.isFinite(startLatitude) && Number.isFinite(destLongitude) && Number.isFinite(destLatitude)) {
		try {
			resolvedStart = await resolveRoadLocation(startLatitude, startLongitude, env, request.signal);
			resolvedDest = await resolveRoadLocation(destLatitude, destLongitude, env, request.signal);
		} catch (error) {
			if (error instanceof LocationResolutionError) return errorResponse(`Route point: ${error.message}`, error.status);
			throw error;
		}
		try {
			routePolyline = JSON.stringify(await calculateRoute(resolvedStart.latitude, resolvedStart.longitude, resolvedDest.latitude, resolvedDest.longitude, request.signal, env));
		} catch (error) {
			return errorResponse(error.message || 'Unable to calculate route between points', 502);
		}
	}
	const category = await env.road_map_db.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first(); if (!category) return errorResponse('categoryId does not reference an existing category');
	const image = body.image;
	if (image && (typeof image.type !== 'string' || !IMAGE_TYPES.has(image.type))) return errorResponse('image must be a JPEG, PNG, GIF, or WebP file');
	if (image && image.size > MAX_IMAGE_SIZE) return errorResponse('image must be 5 MB or smaller');
	let reportId; let imageKey; let staticMapKey;
	try {
		const result = await env.road_map_db.prepare('INSERT INTO reports (title, description, author_id, category_id, status, image_url, barangay, city, province, resolved_address, longitude, latitude, start_longitude, start_latitude, dest_longitude, dest_latitude, route_polyline) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(title, description, auth.userId, categoryId, 'Pending', resolvedLocation.barangay || null, resolvedLocation.city || null, resolvedLocation.province, resolvedLocation.address, resolvedLocation.longitude, resolvedLocation.latitude, resolvedStart?.longitude ?? null, resolvedStart?.latitude ?? null, resolvedDest?.longitude ?? null, resolvedDest?.latitude ?? null, routePolyline).run();
		reportId = result.meta.last_row_id;
		if (image) { 
			console.log('[report] Processing uploaded image:', { name: image.name, type: image.type, size: image.size });
			imageKey = `reports/${reportId}/images/${crypto.randomUUID()}.${extension(image.type)}`; 
			await env.ROAD_MAP_MEDIA.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { fileName: image.name || 'upload' } }); 
			await env.road_map_db.prepare('INSERT INTO report_images (report_id, image_url, r2_key, content_type, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)').bind(reportId, imageKey, imageKey, image.type, image.name || null, image.size).run(); 
			console.log('[report] Image stored with R2 key:', imageKey);
		} else {
			console.log('[report] No image uploaded for report:', reportId);
		}
		const parsedRoute = routePolyline ? JSON.parse(routePolyline) : null;
		staticMapKey = await createStaticMap(env, reportId, longitude, latitude, parsedRoute, resolvedStart?.longitude ?? longitude, resolvedStart?.latitude ?? latitude, resolvedDest?.longitude ?? longitude, resolvedDest?.latitude ?? latitude); await env.road_map_db.prepare('UPDATE reports SET static_map_r2_key = ?, static_map_url = ? WHERE id = ?').bind(staticMapKey, mediaUrl(staticMapKey), reportId).run();

		// AI moderation: dispatch to Render service (production) or run in-worker (local dev).
		// Failures leave the report as Pending for manual review.
		const renderUrl = env.RENDER_AI_SERVICE_URL;
		if (renderUrl) {
			// Production: fire-and-forget webhook to Render AI service with retry.
			// Uses ctx.waitUntil() so the Worker stays alive after responding to the client.
				const moderationTask = (async () => {
				const maxRetries = 2;
				for (let attempt = 0; attempt <= maxRetries; attempt++) {
					try {
						const categoryRow = await env.road_map_db.prepare('SELECT name FROM categories WHERE id = ?').bind(categoryId).first();
						const webhookPayload = {
							reportId,
							title,
							description,
							category: categoryRow?.name || 'Unknown',
							imageKey: imageKey || null,
							authorId: auth.userId,
							timestamp: new Date().toISOString(),
						};
						const secret = env.AI_WEBHOOK_SECRET;
						if (!secret) {
							console.error('[report] AI_WEBHOOK_SECRET not configured, skipping Render webhook');
							return;
						}
						const bodyStr = JSON.stringify(webhookPayload);
						const encoder = new TextEncoder();
						const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
						const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyStr));
						const signature = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

						// Use longer timeout for first attempt to accommodate Render cold start (free tier sleeps after inactivity)
						const timeoutMs = attempt === 0 ? 60000 : 15000;
						console.log('[report] Sending moderation webhook to Render for report:', reportId, 'attempt:', attempt, 'timeout:', timeoutMs + 'ms');
						console.log('[report] Render URL:', renderUrl);
						console.log('[report] Payload size:', bodyStr.length, 'bytes');
						console.log('[report] Signature (first 32 chars):', signature.slice(0, 32));
						const controller = new AbortController();
						const timeout = setTimeout(() => {
							console.error('[report] Render webhook TIMEOUT after', timeoutMs, 'ms for report:', reportId, 'attempt:', attempt);
							controller.abort();
						}, timeoutMs);
						let response;
						try {
							response = await fetch(renderUrl, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature },
								body: bodyStr,
								signal: controller.signal,
							});
						} catch (fetchErr) {
							clearTimeout(timeout);
							console.error('[report] Fetch THREW for report:', reportId, 'attempt:', attempt, 'error:', fetchErr?.message || String(fetchErr));
							throw fetchErr;
						}
						clearTimeout(timeout);
						console.log('[report] Render responded with status:', response.status, 'for report:', reportId, 'attempt:', attempt);
						if (!response.ok) {
							const errText = await response.text();
							console.error('[report] Render webhook FAILED:', response.status, errText.slice(0, 500), 'attempt:', attempt);
						} else {
							const okText = await response.text();
							console.log('[report] Render webhook SUCCESS for report:', reportId, 'attempt:', attempt, 'response:', okText.slice(0, 200));
							return; // Success — exit retry loop
						}
					} catch (err) {
						console.error('[report] Error sending Render webhook:', err, 'attempt:', attempt);
					}
					// Exponential backoff before retry
					if (attempt < maxRetries) {
						const delay = Math.pow(2, attempt) * 1000;
						await new Promise((resolve) => setTimeout(resolve, delay));
					}
				}
				console.error('[report] Render webhook exhausted all retries for report:', reportId);
			})();
			if (ctx?.waitUntil) {
				ctx.waitUntil(moderationTask);
			} else {
				console.warn('[report] ctx.waitUntil not available; moderation may be terminated early');
			}
		} else {
			// Local dev: run moderation synchronously in-worker.
			// Uses ctx.waitUntil() so wrangler dev also keeps the Worker alive.
			const localModerationTask = (async () => {
				try {
					const categoryRow = await env.road_map_db.prepare('SELECT name FROM categories WHERE id = ?').bind(categoryId).first();
					const moderation = await moderateReport(env, {
						title,
						description,
						category: categoryRow?.name || 'Unknown',
						imageR2Key: imageKey || null,
					});
					if (!moderation) return;

					const now = new Date().toISOString();
					await env.road_map_db.prepare(
						'UPDATE reports SET ai_verdict = ?, ai_confidence = ?, ai_reason = ?, ai_reviewed_at = ? WHERE id = ?',
					).bind(moderation.verdict, moderation.confidence, moderation.reason, now, reportId).run();

					if (moderation.verdict === 'approve' && !moderation.needsManualReview) {
						await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending'").bind(now, reportId).run();
						await createNotification(env, { userId: auth.userId, type: 'report_auto_approved', reportId, actorId: 'ai-system', message: 'Your report was auto-approved by AI and is now visible to the community.' });
						await insertSystemComment(env, reportId, `AI auto-approved this report (confidence: ${Math.round(moderation.confidence * 100)}%).`);
					} else if (moderation.verdict === 'reject' && !moderation.needsManualReview) {
						await env.road_map_db.prepare("UPDATE reports SET status = 'Rejected', updated_at = ?, archived_at = ? WHERE id = ? AND status = 'Pending'").bind(now, now, reportId).run();
						await createNotification(env, { userId: auth.userId, type: 'report_auto_rejected', reportId, actorId: 'ai-system', message: `Your report was auto-rejected by AI. Reason: ${moderation.reason}` });
						await insertSystemComment(env, reportId, `AI auto-rejected this report (confidence: ${Math.round(moderation.confidence * 100)}%). Reason: ${moderation.reason}`);
					} else {
						await createNotification(env, { userId: auth.userId, type: 'report_needs_review', reportId, actorId: 'ai-system', message: `Your report requires manual review. AI confidence: ${Math.round(moderation.confidence * 100)}%.` });
					}
				} catch (err) {
					console.error('[report] Local AI moderation failed for report', reportId, ':', err);
				}
			})();
			if (ctx?.waitUntil) {
				ctx.waitUntil(localModerationTask);
			}
		}

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
