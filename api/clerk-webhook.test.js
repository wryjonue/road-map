import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Webhook } from 'standardwebhooks';
import { handleClerkWebhook } from './clerk-webhook.js';

const TEST_SECRET = 'whsec_dGVzdF9zZWNyZXRfZm9yX3VuaXRfdGVzdHNfb25seQ==';

class FakeDatabase {
	constructor() {
		this.rows = new Map();
		this.queries = [];
	}

	prepare(sql) {
		const db = this;
		let values = [];
		return {
			bind(...boundValues) {
				values = boundValues;
				return this;
			},
			async first() {
				db.queries.push({ sql, values });
				if (sql.includes('SELECT') && sql.includes('FROM users WHERE id = ?')) {
					const row = db.rows.get(values[0]) || null;
					return row;
				}
				return null;
			},
			async run() {
				db.queries.push({ sql, values });
				if (sql.startsWith('INSERT INTO users')) {
					const id = values[0];
					db.rows.set(id, {
						id,
						first_name: values[1],
						last_name: values[2],
						image_url: values[3],
						created_at: '2026-10-17T00:00:00Z',
						updated_at: '2026-10-17T00:00:00Z',
						deleted_at: null,
					});
					return { meta: { changes: 1 } };
				}
				if (sql.startsWith('UPDATE users SET first_name')) {
					const id = values[3];
					const existing = db.rows.get(id);
					if (existing) {
						existing.first_name = values[0];
						existing.last_name = values[1];
						existing.image_url = values[2];
					}
					return { meta: { changes: existing ? 1 : 0 } };
				}
				if (sql.startsWith('UPDATE users SET deleted_at')) {
					const id = values[0];
					const existing = db.rows.get(id);
					if (existing && existing.deleted_at === null) {
						existing.deleted_at = '2026-10-17T12:00:00Z';
					}
					return { meta: { changes: existing ? 1 : 0 } };
				}
				return { meta: { changes: 0 } };
			},
		};
	}
}

function createEnv(overrides = {}) {
	return {
		road_map_db: new FakeDatabase(),
		CLERK_WEBHOOK_SECRET: TEST_SECRET,
		...overrides,
	};
}

function signPayload(secret, payload, msgId = 'msg_test_1', timestamp = Math.floor(Date.now() / 1000)) {
	const wh = new Webhook(secret);
	const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
	const signature = wh.sign(msgId, new Date(timestamp * 1000), body);
	return { body, headers: { 'svix-id': msgId, 'svix-timestamp': String(timestamp), 'svix-signature': signature } };
}

describe('handleClerkWebhook', () => {
	it('returns 405 for non-POST requests', async () => {
		const env = createEnv();
		const request = new Request('https://roadmap.test/api/webhooks/clerk', { method: 'GET' });
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 405);
	});

	it('returns 503 when CLERK_WEBHOOK_SECRET is missing', async () => {
		const env = createEnv({ CLERK_WEBHOOK_SECRET: undefined });
		const request = new Request('https://roadmap.test/api/webhooks/clerk', { method: 'POST' });
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 503);
	});

	it('returns 400 for invalid signature', async () => {
		const env = createEnv();
		const request = new Request('https://roadmap.test/api/webhooks/clerk', {
			method: 'POST',
			headers: {
				'svix-id': 'msg_bad',
				'svix-timestamp': String(Math.floor(Date.now() / 1000)),
				'svix-signature': 'v1,aW52YWxpZA==',
			},
			body: JSON.stringify({ type: 'user.updated', data: { id: 'user_1' } }),
		});
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 400);
	});

	it('returns 400 when svix headers are missing', async () => {
		const env = createEnv();
		const request = new Request('https://roadmap.test/api/webhooks/clerk', {
			method: 'POST',
			body: JSON.stringify({ type: 'user.updated', data: { id: 'user_1' } }),
		});
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 400);
	});

	it('upserts user on user.updated event', async () => {
		const env = createEnv();
		const payload = {
			type: 'user.updated',
			data: { id: 'user_abc', first_name: 'Jane', last_name: 'Doe', image_url: 'https://img.clerk.com/avatar.jpg' },
		};
		const { body, headers } = signPayload(TEST_SECRET, payload);
		const request = new Request('https://roadmap.test/api/webhooks/clerk', { method: 'POST', headers, body });
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 200);
		const data = await response.json();
		assert.equal(data.received, true);
		assert.ok(env.road_map_db.rows.has('user_abc'));
		assert.equal(env.road_map_db.rows.get('user_abc').first_name, 'Jane');
		assert.equal(env.road_map_db.rows.get('user_abc').last_name, 'Doe');
		assert.equal(env.road_map_db.rows.get('user_abc').image_url, 'https://img.clerk.com/avatar.jpg');
	});

	it('soft-deletes user on user.deleted event', async () => {
		const env = createEnv();
		env.road_map_db.rows.set('user_del', {
			id: 'user_del', first_name: 'Old', last_name: 'User', image_url: null,
			created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
		});
		const payload = { type: 'user.deleted', data: { object: 'user', id: 'user_del', deleted: true } };
		const { body, headers } = signPayload(TEST_SECRET, payload);
		const request = new Request('https://roadmap.test/api/webhooks/clerk', { method: 'POST', headers, body });
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 200);
		assert.ok(env.road_map_db.rows.get('user_del').deleted_at != null);
	});

	it('acknowledges unhandled event types with 200', async () => {
		const env = createEnv();
		const payload = { type: 'session.created', data: { id: 'sess_1' } };
		const { body, headers } = signPayload(TEST_SECRET, payload);
		const request = new Request('https://roadmap.test/api/webhooks/clerk', { method: 'POST', headers, body });
		const response = await handleClerkWebhook(request, env);
		assert.equal(response.status, 200);
		const data = await response.json();
		assert.equal(data.received, true);
		assert.equal(env.road_map_db.rows.size, 0);
	});
});
