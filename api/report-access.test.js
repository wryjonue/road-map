import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { normalizeRole } from './auth.js';
import worker from './index.js';
import { createReport, getMedia, getReport, listReports, resolveReport } from './report-service.js';

function reportRow({ id, status, authorId = 'reporter-1', mapKey = null, imageKey = null, deletedAt = null }) {
	return {
		id,
		title: `Report ${id}`,
		description: 'Road hazard',
		author_id: authorId,
		author_name: null,
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
		category_name: 'Road Hazard',
		category_slug: 'road-hazard',
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
					const rows = database.rows.filter((row) => row.deleted_at === null && (!sql.includes("status <> 'Pending'") || row.status !== 'Pending'));
					return { results: [{ total: rows.length }] };
				}
				if (sql.includes('FROM report_images')) return { results: [] };
				if (sql.includes('FROM reports r JOIN categories c')) {
					let rows = database.rows.filter((row) => row.deleted_at === null);
					if (sql.includes('r.id = ?')) rows = rows.filter((row) => row.id === values[0]);
					if (sql.includes("r.status <> 'Pending'")) rows = rows.filter((row) => row.status !== 'Pending');
					rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
					if (sql.includes('LIMIT ? OFFSET ?')) rows = rows.slice(values[1], values[1] + values[0]);
					return { results: rows };
				}
				throw new Error(`Unexpected query: ${sql}`);
			},
			async first() {
				database.queries.push({ sql, values });
				if (sql.includes('SELECT id FROM categories')) return { id: values[0] };
				if (sql.includes('SELECT status FROM reports WHERE id')) {
					const row = database.rows.find((item) => item.id === values[0] && item.deleted_at === null);
					return row ? { status: row.status } : null;
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
					const row = reportRow({ id: 1, status: values[5], authorId: values[2] });
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

test('regular feed rows and totals both exclude pending reports', async () => {
	const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' }), reportRow({ id: 2, status: 'Open' })]);
	const response = await listReports(env, new URL('https://roadmap.test/api/reports'), { userId: 'reporter-1', role: 'user' });
	const data = await response.json();

	assert.deepEqual(data.reports.map((report) => report.status), ['Open']);
	assert.equal(data.pagination.total, 1);
	assert.equal(data.pagination.hasMore, false);
	assert.ok(database.queries.filter((query) => query.sql.includes("status <> 'Pending'")).length >= 2);
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

test('only authority and admin can resolve, and resolution records the verified actor', async () => {
	for (const role of ['authority', 'admin']) {
		const { env, database } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
		const response = await resolveReport(env, 1, { userId: `${role}-1`, role });
		const data = await response.json();
		assert.equal(data.status, 'Resolved');
		assert.equal(database.rows[0].resolved_by, `${role}-1`);
		assert.ok(database.rows[0].resolved_at);
		assert.equal(database.rows[0].updated_at, database.rows[0].resolved_at);
	}
	const { env } = createEnvironment([reportRow({ id: 1, status: 'Pending' })]);
	assert.equal((await resolveReport(env, 1, { userId: 'reporter-1', role: 'user' })).status, 403);
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

test('report creation forces Pending and uses the verified author ID', async () => {
	const { env, database } = createEnvironment();
	const originalGlobalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
	const form = new FormData();
	form.set('title', 'Blocked road');
	form.set('description', 'A lane is blocked');
	form.set('authorId', 'forged-author');
	form.set('categoryId', '1');
	form.set('status', 'Resolved');
	form.set('province', 'Bataan');
	form.set('longitude', '120.5');
	form.set('latitude', '14.5');

	try {
		const request = new Request('https://roadmap.test/api/reports', { method: 'POST', body: form });
		const response = await createReport(request, env, { userId: 'verified-author', role: 'user' });
		const data = await response.json();
		assert.equal(response.status, 201);
		assert.equal(data.status, 'Pending');
		assert.equal(data.authorId, 'verified-author');
		assert.equal(database.rows[0].status, 'Pending');
	} finally {
		globalThis.fetch = originalGlobalFetch;
	}
});