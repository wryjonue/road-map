import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { normalizeRole } from './auth.js';
import worker from './index.js';
import categories from '../src/data/categories.js';
import { resolveRoadLocation } from './location-service.js';
import { approveReport, createReport, deletePendingReport, getMapReports, getMedia, getReport, listReports, rejectReport, resolveReport } from './report-service.js';

function reportRow({ id, status, authorId = 'reporter-1', authorName = null, authorImageUrl = null, mapKey = null, imageKey = null, deletedAt = null }) {
	return {
		id,
		title: `Report ${id}`,
		description: 'Road hazard',
		author_id: authorId,
		author_name: authorName,
		author_image_url: authorImageUrl,
		status,
		image_url: null,
		static_map_url: null,
		barangay: 'Central',
		city: 'Balanga',
		province: 'Bataan',
		resolved_address: null,
		longitude: 120.5,
		latitude: 14.5,
		vote_count: 0,
		comment_count: 0,
		created_at: `2026-10-0${id} 00:00:00`,
		updated_at: '2026-10-01 00:00:00',
		resolved_at: null,
		resolved_by: null,
		deleted_at: deletedAt,
		static_map_r2_key: mapKey,
		image_key: imageKey,
		category_id: 1,
		category_name: 'Road Construction',
		category_slug: 'road-construction',
	};
}

class FakeDatabase {
	constructor(rows = []) {
		this.rows = rows;
		this.queries = [];
	}

	prepare(sql) {
		const database = this;
		let values = [];
		const statement = {
			bind(...boundValues) {
				values = boundValues;
				return statement;
			},
			async all() {
				database.queries.push({ sql, values });
				if (sql.includes('SELECT COUNT(*) AS total FROM reports')) {
					let rows = database.rows.filter((row) => row.deleted_at === null);
					if (sql.includes("status IN ('Open', 'Resolved')")) rows = rows.filter((row) => row.status === 'Open' || row.status === 'Resolved');
					let filterIndex = 0;
					if (sql.includes('category_id = ?')) {
						const categoryId = values[filterIndex++];
						rows = rows.filter((row) => row.category_id === categoryId);
					}
					if (sql.includes('status = ?')) rows = rows.filter((row) => row.status === values[filterIndex]);
					if (sql.includes("status <> 'Pending' OR author_id = ?")) rows = rows.filter((row) => row.status !== 'Pending' || row.author_id === values[0]);
					else if (sql.includes("status <> 'Pending'")) rows = rows.filter((row) => row.status !== 'Pending');
					return { results: [{ total: rows.length }] };
				}
				if (sql.includes('FROM report_images')) return { results: [] };
				if (sql.includes('FROM reports r JOIN categories c')) {
					let rows = database.rows.filter((row) => row.deleted_at === null);
					if (sql.includes("r.status IN ('Open', 'Resolved')")) rows = rows.filter((row) => row.status === 'Open' || row.status === 'Resolved');
					let filterIndex = 0;
					if (sql.includes('r.category_id = ?')) {
						const categoryId = values[filterIndex++];
						rows = rows.filter((row) => row.category_id === categoryId);
					}
					if (sql.includes('r.status = ?')) rows = rows.filter((row) => row.status === values[filterIndex]);
					if (sql.includes('r.id = ?')) rows = rows.filter((row) => row.id === values[0]);
					if (sql.includes("r.status <> 'Pending' OR r.author_id = ?")) rows = rows.filter((row) => row.status !== 'Pending' || row.author_id === values[0]);
					else if (sql.includes("r.status <> 'Pending'")) rows = rows.filter((row) => row.status !== 'Pending');
					rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
					if (sql.includes('LIMIT ? OFFSET ?')) {
						const [limit, offset] = values.slice(-2);
						rows = rows.slice(offset, offset + limit);
					}
					return { results: rows };
				}
				throw new Error(`Unexpected query: ${sql}`);
			},
			async first() {
				database.queries.push({ sql, values });
				if (sql.includes('SELECT id FROM categories')) return { id: values[0] };
				if (sql.includes("SELECT COUNT(*) AS total FROM reports r WHERE r.deleted_at IS NULL AND r.status IN ('Open', 'Resolved')")) {
					let rows = database.rows.filter((row) => row.deleted_at === null && (row.status === 'Open' || row.status === 'Resolved'));
					let filterIndex = 0;
					if (sql.includes('r.category_id = ?')) {
						const categoryId = values[filterIndex++];
						rows = rows.filter((row) => row.category_id === categoryId);
					}
					if (sql.includes('r.status = ?')) rows = rows.filter((row) => row.status === values[filterIndex]);
					return { total: rows.length };
				}
				if (sql.includes('SELECT status FROM reports WHERE id') || sql.includes('SELECT status, author_id FROM reports WHERE id')) {
					const row = database.rows.find((item) => item.id === values[0] && item.deleted_at === null);
					return row ? { status: row.status, author_id: row.author_id } : null;
				}
				if (sql.includes('SELECT r.status, r.author_id FROM reports r')) {
					const row = database.rows.find((item) => item.deleted_at === null && (item.static_map_r2_key === values[0] || item.image_url === values[1] || item.image_key === values[2]));
					return row ? { status: row.status, author_id: row.author_id } : null;
				}
				throw new Error(`Unexpected query: ${sql}`);
			},
			async run() {
				database.queries.push({ sql, values });
				if (sql.startsWith('INSERT INTO reports')) {
					const row = reportRow({ id: 1, status: values[6], authorId: values[2], authorName: values[3], authorImageUrl: values[4] });
					row.barangay = values[7];
					row.city = values[8];
					row.province = values[9];
					row.resolved_address = values[10];
					row.longitude = values[11];
					row.latitude = values[12];
					database.rows.push(row);
					return { meta: { last_row_id: row.id, changes: 1 } };
				}
				if (sql.startsWith('UPDATE reports SET static_map_r2_key')) {
					const row = database.rows.find((item) => item.id === values[2]);
					row.static_map_r2_key = values[0];
					row.static_map_url = values[1];
					return { meta: { changes: 1 } };
				}
				if (sql.startsWith("UPDATE reports SET status = 'Resolved'")) {
					const row = database.rows.find((item) => item.id === values[3] && item.deleted_at === null && item.status !== 'Resolved');
					if (!row) return { meta: { changes: 0 } };
					row.status = 'Resolved';
					row.updated_at = values[0];
					row.resolved_at = values[1];
					row.resolved_by = values[2];
					return { meta: { changes: 1 } };
				}
				if (sql.startsWith("UPDATE reports SET status = 'Open'")) {
					const row = database.rows.find((item) => item.id === values[1] && item.deleted_at === null && item.status === 'Pending');
					if (!row) return { meta: { changes: 0 } };
					row.status = 'Open';
					row.updated_at = values[0];
					return { meta: { changes: 1 } };
				}
				if (sql.startsWith("UPDATE reports SET status = 'Rejected'")) {
					const row = database.rows.find((item) => item.id === values[1] && item.deleted_at === null && item.status === 'Pending');
					if (!row) return { meta: { changes: 0 } };
					row.status = 'Rejected';
					row.updated_at = values[0];
					return { meta: { changes: 1 } };
				}
				if (sql.startsWith('UPDATE reports SET deleted_at')) {
					const row = database.rows.find((item) => item.id === values[2] && item.deleted_at === null && (item.status === 'Pending' || item.status === 'Open') && (values.length < 4 || item.author_id === values[3]));
					if (!row) return { meta: { changes: 0 } };
					row.deleted_at = values[0];
					row.updated_at = values[1];
					return { meta: { changes: 1 } };
				}
				throw new Error(`Unexpected query: ${sql}`);
			},
		};
		return statement;
	}
}

function createEnvironment(rows = []) {
	const database = new FakeDatabase(rows);
	const mediaObjects = new Map();
	return {
		database,
		mediaObjects,
		env: {
			road_map_db: database,
			ROAD_MAP_MEDIA: {
				async put(key, value) { mediaObjects.set(key, value); },
				async get(key) {
					const value = mediaObjects.get(key);
					return value ? { body: new Blob([value]).stream(), writeHttpMetadata: (headers) => headers.set('Content-Type', 'image/png') } : null;
				},
				async delete(key) { mediaObjects.delete(key); },
			},
			GEOAPIFY_API_KEY: 'test-key',
		},
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

test('only the three configured roles are accepted', () => {
	assert.equal(normalizeRole('user'), 'user');
	assert.equal(normalizeRole('authority'), 'authority');
	assert.equal(normalizeRole('admin'), 'admin');
	assert.equal(normalizeRole(undefined), 'user');
	assert.equal(normalizeRole('owner'), 'user');
});

test('regular feed shows own pending reports but hides others and counts visible rows', async () => {
	const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' }), reportRow({ id: 2, status: 'Open' })]);
	const response = await listReports(env, new URL('https://roadmap.test/api/reports'), { userId: 'reporter-1', role: 'user' });
	const data = await response.json();

	assert.deepEqual(data.reports.map((report) => report.status), ['Open', 'Pending']);
	assert.equal(data.pagination.total, 2);
	assert.equal(data.pagination.hasMore, false);
	assert.ok(database.queries.filter((query) => query.sql.includes('author_id = ?')).length >= 2);
	const otherUserResponse = await listReports(env, new URL('https://roadmap.test/api/reports'), { userId: 'other-user', role: 'user' });
	const otherUserData = await otherUserResponse.json();
	assert.deepEqual(otherUserData.reports.map((report) => report.status), ['Open']);
	assert.equal(otherUserData.pagination.total, 1);
});

test('authority and admin can list pending reports', async () => {
	const rows = [reportRow({ id: 1, status: 'Pending' }), reportRow({ id: 2, status: 'Open' })];
	for (const role of ['authority', 'admin']) {
		const { env } = createEnvironment(rows.map((row) => ({ ...row })));
		const response = await listReports(env, new URL('https://roadmap.test/api/reports'), { userId: 'staff-1', role });
		const data = await response.json();
		assert.equal(data.reports.length, 2);
		assert.equal(data.pagination.total, 2);
	}
});

test('only the report owner or staff can retrieve pending details', async () => {
	const { env } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
	assert.equal((await getReport(env, 1, 200, { userId: 'reporter-1', role: 'user' })).status, 200);
	assert.equal((await getReport(env, 1, 200, { userId: 'other-user', role: 'user' })).status, 404);
	assert.equal((await getReport(env, 1)).status, 404);
	assert.equal((await getReport(env, 1, 200, { userId: 'staff-1', role: 'authority' })).status, 200);
});

test('pending media is private to its owner and is not publicly cached', async () => {
	const { env, mediaObjects } = createEnvironment([reportRow({ id: 1, status: 'Pending', mapKey: 'reports/1/static-map.png' })]);
	mediaObjects.set('reports/1/static-map.png', new Uint8Array([1, 2, 3]));
	const request = new Request('https://roadmap.test/api/media/reports/1/static-map.png');

	assert.equal((await getMedia(request, env, 'reports/1/static-map.png')).status, 404);
	const response = await getMedia(request, env, 'reports/1/static-map.png', { userId: 'reporter-1', role: 'user' });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('authority and admin can approve pending reports, while regular users cannot', async () => {
	for (const role of ['authority', 'admin']) {
		const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
		const response = await approveReport(env, 1, { userId: `${role}-1`, role });
		const data = await response.json();
		assert.equal(data.status, 'Open');
		assert.equal(database.rows[0].status, 'Open');
	}
	const { env } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
	assert.equal((await approveReport(env, 1, { userId: 'reporter-1', role: 'user' })).status, 403);
});

test('approval only accepts active pending reports', async () => {
	const { env } = createEnvironment([reportRow({ id: 1, status: 'Open' })]);
	assert.equal((await approveReport(env, 1, { userId: 'authority-1', role: 'authority' })).status, 409);
	assert.equal((await approveReport(env, 99, { userId: 'authority-1', role: 'authority' })).status, 404);
});

test('authority and admin can reject pending reports, while regular users and non-pending reports cannot', async () => {
	for (const role of ['authority', 'admin']) {
		const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
		const response = await rejectReport(env, 1, { userId: `${role}-1`, role });
		const data = await response.json();
		assert.equal(data.status, 'Rejected');
		assert.equal(database.rows[0].status, 'Rejected');
	}
	const { env: userEnv } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
	assert.equal((await rejectReport(userEnv, 1, { userId: 'reporter-1', role: 'user' })).status, 403);
	const { env: openEnv } = createEnvironment([reportRow({ id: 1, status: 'Open' })]);
	assert.equal((await rejectReport(openEnv, 1, { userId: 'authority-1', role: 'authority' })).status, 409);
});

test('authority and admin can soft-delete pending reports only', async () => {
	for (const role of ['authority', 'admin']) {
		const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
		const response = await deletePendingReport(env, 1, { userId: `${role}-1`, role });
		assert.equal(response.status, 200);
		assert.equal(database.rows[0].deleted_at, database.rows[0].updated_at);
		assert.equal((await getReport(env, 1, 200, { userId: `${role}-1`, role })).status, 404);
	}
});

test('report owners can delete their own pending reports, but not another user\'s reports', async () => {
	const { env, database } = createEnvironment([
		reportRow({ id: 1, status: 'Pending', authorId: 'reporter-1' }),
		reportRow({ id: 2, status: 'Pending', authorId: 'reporter-2' }),
	]);
	const owner = { userId: 'reporter-1', role: 'user' };
	assert.equal((await deletePendingReport(env, 1, owner)).status, 200);
	assert.ok(database.rows[0].deleted_at);
	assert.equal((await deletePendingReport(env, 2, owner)).status, 404);
	assert.equal(database.rows[1].deleted_at, null);
});

test('staff can delete open reports, while resolved, missing, and previously deleted reports are rejected', async () => {
	const { env } = createEnvironment([
		reportRow({ id: 1, status: 'Open' }),
		reportRow({ id: 2, status: 'Pending', deletedAt: '2026-10-02T00:00:00.000Z' }),
		reportRow({ id: 3, status: 'Resolved' }),
	]);
	const staff = { userId: 'authority-1', role: 'authority' };
	assert.equal((await deletePendingReport(env, 1, staff)).status, 200);
	assert.equal((await deletePendingReport(env, 2, staff)).status, 404);
	assert.equal((await deletePendingReport(env, 3, staff)).status, 409);
	assert.equal((await deletePendingReport(env, 99, staff)).status, 404);
});

test('report owners can delete their own open reports but not another user\'s open reports', async () => {
	const { env, database } = createEnvironment([
		reportRow({ id: 1, status: 'Open', authorId: 'reporter-1' }),
		reportRow({ id: 2, status: 'Open', authorId: 'reporter-2' }),
	]);
	const owner = { userId: 'reporter-1', role: 'user' };
	assert.equal((await deletePendingReport(env, 1, owner)).status, 200);
	assert.equal((await deletePendingReport(env, 2, owner)).status, 404);
	assert.equal(database.rows[1].deleted_at, null);
});

test('only authority and admin can resolve, and pending reports must be approved first', async () => {
	for (const role of ['authority', 'admin']) {
		const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Open' })]);
		const response = await resolveReport(env, 1, { userId: `${role}-1`, role });
		const data = await response.json();
		assert.equal(data.status, 'Resolved');
		assert.equal(database.rows[0].resolved_by, `${role}-1`);
		assert.ok(database.rows[0].resolved_at);
		assert.equal(database.rows[0].updated_at, database.rows[0].resolved_at);
	}
	const { env: pendingEnv } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
	assert.equal((await resolveReport(pendingEnv, 1, { userId: 'authority-1', role: 'authority' })).status, 409);
	assert.equal((await resolveReport(pendingEnv, 1, { userId: 'reporter-1', role: 'user' })).status, 403);
});

test('soft-deleted reports are absent from list, detail, and media reads', async () => {
	const { env, mediaObjects } = createEnvironment([reportRow({ id: 1, status: 'Open', mapKey: 'reports/1/static-map.png', deletedAt: '2026-10-02T00:00:00.000Z' })]);
	mediaObjects.set('reports/1/static-map.png', new Uint8Array([1, 2, 3]));
	const listed = await listReports(env, new URL('https://roadmap.test/api/reports'), { userId: 'authority-1', role: 'authority' });
	assert.equal((await listed.json()).reports.length, 0);
	assert.equal((await getReport(env, 1, 200, { userId: 'authority-1', role: 'authority' })).status, 404);
	assert.equal((await getMedia(new Request('https://roadmap.test/api/media/reports/1/static-map.png'), env, 'reports/1/static-map.png', { userId: 'authority-1', role: 'authority' })).status, 404);
});

test('mock-auth owners can delete their own pending reports but cannot approve', async () => {
	const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending', authorId: 'mock-user-local' })]);
	const headers = { 'X-Local-Mock-Auth': 'true' };
	const deleteResponse = await worker.fetch(new Request('https://roadmap.test/api/reports/1', { method: 'DELETE', headers }), { ...env, ENVIRONMENT: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' });
	assert.equal(deleteResponse.status, 200);
	assert.ok(database.rows[0].deleted_at);
	const approveResponse = await worker.fetch(new Request('https://roadmap.test/api/reports/1/status', {
		method: 'PATCH',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: 'Open', role: 'admin' }),
	}), { ENVIRONMENT: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' });
	assert.equal(approveResponse.status, 403);
});

test('mock-auth users cannot use the status endpoint', async () => {
	const request = new Request('https://roadmap.test/api/reports/1/status', {
		method: 'PATCH',
		headers: { 'X-Local-Mock-Auth': 'true', 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: 'Resolved', role: 'admin' }),
	});
	const response = await worker.fetch(request, { ENVIRONMENT: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' });
	assert.equal(response.status, 403);
});

test('malformed supplied credentials are rejected on public reads', async () => {
	const request = new Request('https://roadmap.test/api/reports', { headers: { Authorization: 'Basic invalid' } });
	const response = await worker.fetch(request, {});
	assert.equal(response.status, 401);
});

test('location preview requires auth and returns the snapped road location', async () => {
	const { env } = createEnvironment();
	const unauthenticated = await worker.fetch(new Request('https://roadmap.test/api/location/resolve?latitude=14.5&longitude=120.5'), env);
	assert.equal(unauthenticated.status, 401);
	const originalGlobalFetch = globalThis.fetch;
	globalThis.fetch = async (url, options) => {
		if (url.includes('/mapmatching')) {
			const body = JSON.parse(options.body);
			assert.deepEqual(body.waypoints[0].location, [120.5, 14.5]);
			return Response.json({ features: [{ properties: { waypoints: [{ location: [120.501, 14.501], match_type: 'matched', match_distance: 25 }], legs: [{ steps: [{ name: 'Road 1' }] }] } }] });
		}
		return Response.json({ display_name: 'Road 1, Balanga, Bataan', address: { road: 'Road 1', city: 'Balanga', state: 'Bataan' } });
	};
	try {
		const request = new Request('https://roadmap.test/api/location/resolve?latitude=14.5&longitude=120.5', { headers: { 'X-Local-Mock-Auth': 'true' } });
		const response = await worker.fetch(request, { ...env, ENVIRONMENT: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { longitude: 120.501, latitude: 14.501, snapDistance: 25, roadName: 'Road 1', barangay: '', city: 'Balanga', province: 'Bataan', address: 'Road 1, Balanga, Bataan' });
	} finally {
		globalThis.fetch = originalGlobalFetch;
	}
});

test('location resolver rejects road matches beyond the snap limit', async () => {
	const originalGlobalFetch = globalThis.fetch;
	globalThis.fetch = async () => Response.json({ features: [{ properties: { waypoints: [{ location: [120.6, 14.6], match_type: 'matched', match_distance: 101 }] } }] });
	try {
		await assert.rejects(() => resolveRoadLocation(14.5, 120.5, { GEOAPIFY_API_KEY: 'test-key' }), /more than 100 meters/);
	} finally {
		globalThis.fetch = originalGlobalFetch;
	}
});

test('report creation forces Pending and uses the verified author ID', async () => {
	const { env, database } = createEnvironment();
	const originalGlobalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		if (url.includes('/mapmatching')) return Response.json({ features: [{ properties: { waypoints: [{ location: [120.5001, 14.5001], match_type: 'matched', match_distance: 12 }] } }] });
		if (url.includes('nominatim.openstreetmap.org')) return Response.json({ display_name: 'Matched Road, Balanga, Bataan', address: { road: 'Matched Road', suburb: 'Central', city: 'Balanga', state: 'Bataan' } });
		return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
	};
	const form = new FormData();
	form.set('title', 'Blocked road');
	form.set('description', 'A lane is blocked');
	form.set('authorId', 'forged-author');
	form.set('authorName', 'Forged Name');
	form.set('authorImageUrl', 'https://img.clerk.com/forged-avatar.jpg');
	form.set('categoryId', '1');
	form.set('status', 'Resolved');
	form.set('province', 'Bataan');
	form.set('longitude', '120.5');
	form.set('latitude', '14.5');

	try {
		const request = new Request('https://roadmap.test/api/reports', { method: 'POST', body: form });
		const response = await createReport(request, env, { userId: 'verified-author', role: 'user', claims: { first_name: 'Jane', last_name: 'Reporter', picture: 'https://img.clerk.com/verified-avatar.jpg' } });
		const data = await response.json();
		assert.equal(response.status, 201);
		assert.equal(data.status, 'Pending');
		assert.equal(data.authorId, 'verified-author');
		assert.equal(data.authorName, 'Jane Reporter');
		assert.equal(data.authorImageUrl, 'https://img.clerk.com/verified-avatar.jpg');
		assert.equal(database.rows[0].status, 'Pending');
		assert.equal(database.rows[0].author_name, 'Jane Reporter');
		assert.equal(database.rows[0].author_image_url, 'https://img.clerk.com/verified-avatar.jpg');
		assert.equal(database.rows[0].longitude, 120.5001);
		assert.equal(database.rows[0].latitude, 14.5001);
	} finally {
		globalThis.fetch = originalGlobalFetch;
	}
});

test('map reports expose only open and resolved non-deleted reports', async () => {
	const rows = [
		reportRow({ id: 1, status: 'Open' }),
		reportRow({ id: 2, status: 'Resolved' }),
		reportRow({ id: 3, status: 'Pending' }),
		reportRow({ id: 4, status: 'Closed' }),
		reportRow({ id: 5, status: 'Rejected' }),
		reportRow({ id: 6, status: 'Blocked' }),
		reportRow({ id: 7, status: 'Open', deletedAt: '2026-10-02T00:00:00.000Z' }),
	];
	const { env } = createEnvironment(rows);
	const response = await getMapReports(env, new URL('https://roadmap.test/api/map/reports'));
	const data = await response.json();

	assert.deepEqual(data.reports.map((report) => report.id).sort(), [1, 2]);
	assert.deepEqual(data.reports.map((report) => report.status).sort(), ['Open', 'Resolved']);
	assert.equal(data.pagination.total, 2);
	assert.ok(data.reports.every((report) => !('images' in report) && !('imageUrl' in report) && !('staticMapUrl' in report)));
});

test('map category and status filters combine independently and paginate', async () => {
	const rows = [
		reportRow({ id: 1, status: 'Open' }),
		reportRow({ id: 2, status: 'Resolved' }),
		reportRow({ id: 3, status: 'Open' }),
	];
	rows[2].category_id = 2;
	const { env, database } = createEnvironment(rows);
	const combinedResponse = await getMapReports(env, new URL('https://roadmap.test/api/map/reports?categoryId=1&status=Resolved'));
	const combinedData = await combinedResponse.json();
	assert.equal(combinedData.reports.length, 1, JSON.stringify({ combinedData, queries: database.queries }));
	assert.equal(combinedData.reports[0].id, 2);

	const pageOne = await getMapReports(env, new URL('https://roadmap.test/api/map/reports?limit=1&offset=0'));
	const pageOneData = await pageOne.json();
	assert.equal(pageOneData.reports.length, 1);
	assert.equal(pageOneData.pagination.total, 3);
	assert.equal(pageOneData.pagination.hasMore, true);
	const pageTwo = await getMapReports(env, new URL('https://roadmap.test/api/map/reports?limit=1&offset=1'));
	assert.equal((await pageTwo.json()).pagination.hasMore, true);
});

test('map report filters reject statuses outside Open and Resolved and invalid categories', async () => {
	const { env } = createEnvironment([reportRow({ id: 1, status: 'Open' })]);
	assert.equal((await getMapReports(env, new URL('https://roadmap.test/api/map/reports?status=Pending'))).status, 400);
	assert.equal((await getMapReports(env, new URL('https://roadmap.test/api/map/reports?status=Blocked'))).status, 400);
	assert.equal((await getMapReports(env, new URL('https://roadmap.test/api/map/reports?categoryId=0'))).status, 400);
});

test('map route visibility is unchanged by anonymous or mock-user access', async () => {
	const { env } = createEnvironment([
		reportRow({ id: 1, status: 'Open' }),
		reportRow({ id: 2, status: 'Pending' }),
		reportRow({ id: 3, status: 'Resolved' }),
	]);
	const anonymous = await worker.fetch(new Request('https://roadmap.test/api/map/reports'), env);
	const mockUser = await worker.fetch(new Request('https://roadmap.test/api/map/reports', { headers: { 'X-Local-Mock-Auth': 'true' } }), {
		...env,
		ENVIRONMENT: 'development',
		ALLOW_LOCAL_MOCK_AUTH: 'true',
	});
	assert.deepEqual((await anonymous.json()).reports.map((report) => report.id), (await mockUser.json()).reports.map((report) => report.id));
});

test('dashboard metrics aggregate active reports and include zero-count categories', async () => {
	const rows = categories.map((category, index) => ({
		category_id: category.id,
		category_name: category.name,
		report_count: index === 0 ? 2 : 0,
		resolved_count: index === 0 ? 1 : 0,
	}));
	const env = {
		road_map_db: {
			prepare(sql) {
				return { all: async () => {
					if (sql.includes('GROUP BY c.id, c.name')) {
						assert.ok(sql.includes('r.deleted_at IS NULL'));
						return { results: rows };
					}
					assert.ok(sql.includes("strftime('%Y-%m', created_at)"));
					return { results: [{ report_month: '2026-09', report_count: 1 }, { report_month: '2026-10', report_count: 1 }] };
				} };
			},
		},
	};
	const response = await worker.fetch(new Request('https://roadmap.test/api/dashboard/metrics'), env);
	const data = await response.json();

	assert.equal(response.status, 200);
	assert.equal(data.total, 2);
	assert.equal(data.resolved, 1);
	assert.equal(data.resolvedPercentage, 50);
	assert.equal(data.categories.length, categories.length);
		assert.deepEqual(data.monthlyReports, [{ month: '2026-09', count: 1 }, { month: '2026-10', count: 1 }]);
	assert.deepEqual(data.categories[0], { id: categories[0].id, name: categories[0].name, count: 2 });
	assert.ok(data.categories.slice(1).every((category) => category.count === 0));
});