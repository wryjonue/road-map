// Canonical user profile management synced from Clerk.
// All writes are idempotent. Soft-deleted users (deleted_at IS NOT NULL) are never
// resurrected by upserts — only an explicit admin action could restore them.

/**
 * Build a display name from first_name and last_name columns.
 * Used by API services after LEFT JOIN users resolves author profiles.
 */
export function buildDisplayName(firstName, lastName) {
	const parts = [firstName, lastName]
		.filter((part) => typeof part === 'string' && part.trim());
	return parts.join(' ').trim().slice(0, 160) || null;
}

/**
 * Extract first and last name from Clerk claims or user object.
 * Clerk JWTs may only provide `name` (full display name) without separate
 * first_name/last_name fields. This helper splits `name` as a fallback.
 */
function extractNames(source) {
	let firstName = typeof source.first_name === 'string' ? source.first_name.trim() : null;
	let lastName = typeof source.last_name === 'string' ? source.last_name.trim() : null;

	if (!firstName && !lastName && typeof source.name === 'string') {
		const parts = source.name.trim().split(/\s+/);
		if (parts.length >= 2) {
			firstName = parts[0];
			lastName = parts.slice(1).join(' ');
		} else if (parts.length === 1 && parts[0]) {
			firstName = parts[0];
		}
	}

	return {
		firstName: firstName || null,
		lastName: lastName || null,
		imageUrl: (typeof source.picture === 'string' ? source.picture : source.image_url)?.trim() || null,
	};
}

export async function getUserById(env, userId) {
	if (!userId) return null;
	return env.road_map_db.prepare(
		'SELECT id, first_name, last_name, image_url, created_at, updated_at, deleted_at FROM users WHERE id = ? LIMIT 1'
	).bind(userId).first();
}

/**
 * Upsert a user row from verified JWT claims (lazy creation on first auth).
 * Only writes if the row is missing or if any field has changed, to avoid
 * per-request D1 writes (hazard H4).
 */
export async function upsertUserFromClaims(env, claims) {
	if (!claims?.sub) return;
	const id = claims.sub;
	const { firstName, lastName, imageUrl } = extractNames(claims);

	const existing = await getUserById(env, id);
	if (existing) {
		// Never resurrect a soft-deleted user via lazy upsert.
		if (existing.deleted_at != null) return;
		// Skip write if nothing changed.
		if (existing.first_name === firstName && existing.last_name === lastName && existing.image_url === imageUrl) return;
		await env.road_map_db.prepare(
			'UPDATE users SET first_name = ?, last_name = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
		).bind(firstName, lastName, imageUrl, id).run();
	} else {
		await env.road_map_db.prepare(
			'INSERT INTO users (id, first_name, last_name, image_url) VALUES (?, ?, ?, ?)'
		).bind(id, firstName, lastName, imageUrl).run();
	}
}

/**
 * Upsert a user row from a Clerk webhook payload (user.updated event).
 * The payload carries the full UserJSON object.
 */
export async function upsertUserFromPayload(env, userData) {
	if (!userData?.id) return;
	const id = userData.id;
	const { firstName, lastName, imageUrl } = extractNames(userData);

	const existing = await getUserById(env, id);
	if (existing) {
		// Never resurrect a soft-deleted user via webhook.
		if (existing.deleted_at != null) return;
		if (existing.first_name === firstName && existing.last_name === lastName && existing.image_url === imageUrl) return;
		await env.road_map_db.prepare(
			'UPDATE users SET first_name = ?, last_name = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
		).bind(firstName, lastName, imageUrl, id).run();
	} else {
		await env.road_map_db.prepare(
			'INSERT INTO users (id, first_name, last_name, image_url) VALUES (?, ?, ?, ?)'
		).bind(id, firstName, lastName, imageUrl).run();
	}
}

/**
 * Soft-delete a user row (user.deleted webhook event).
 * Payload carries only { object: 'user', id, deleted: true } — no name/image.
 */
export async function softDeleteUser(env, userId) {
	if (!userId) return;
	await env.road_map_db.prepare(
		'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
	).bind(userId).run();
}
