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
	console.log("Source Extraction\n\n\n" + JSON.stringify(source));
	let firstName = (typeof source.first_name === 'string' ? source.first_name : source.firstName)?.trim() || null;
	let lastName = (typeof source.last_name === 'string' ? source.last_name : source.lastName)?.trim() || null;

	if (!firstName && !lastName && typeof source.name === 'string') {
		const parts = source.name.trim().split(/\s+/);
		if (parts.length >= 2) {
			firstName = parts[0];
			lastName = parts.slice(1).join(' ');
		} else if (parts.length === 1 && parts[0]) {
			firstName = parts[0];
		}
	}
	return { firstName, lastName };
}

/**
 * Upsert a user row from verified JWT claims (lazy creation on first auth).
 * Only writes if the row is missing or if any field has changed, to avoid
 * per-request D1 writes (hazard H4).
 */
export async function upsertUserFromClaims(env, claims) {
	if (!claims?.sub) return;
	const id = claims.sub;
	const { firstName, lastName } = extractNames(claims);

	// Diagnostic: log what the JWT actually contains for name fields.
	console.info('[user-upsert] claims keys:', Object.keys(claims).filter((k) => /name|picture|image/i.test(k)), 'extracted:', { firstName, lastName });

	const existing = await getUserById(env, id);
	if (existing) {
		// Never resurrect a soft-deleted user via webhook.
		if (existing.deleted_at != null) return;
		if (existing.first_name === firstName && existing.last_name === lastName) return;
		await env.road_map_db.prepare(
			'UPDATE users SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
		).bind(firstName, lastName, id).run();
	} else {
		await env.road_map_db.prepare(
			'INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)'
		).bind(id, firstName, lastName, 'user').run();
	}
}

/**
 * Upsert a user row from a Clerk webhook payload (user.updated event).
 * The payload carries the full UserJSON object.
 */
export async function upsertUserFromPayload(env, userData) {
	if (!userData?.id) return;
	const id = userData.id;
	const { firstName, lastName } = extractNames(userData);

	const existing = await getUserById(env, id);
	if (existing) {
		// Never resurrect a soft-deleted user via webhook.
		if (existing.deleted_at != null) return;
		if (existing.first_name === firstName && existing.last_name === lastName) return;
		await env.road_map_db.prepare(
			'UPDATE users SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
		).bind(firstName, lastName, id).run();
	} else {
		await env.road_map_db.prepare(
			'INSERT INTO users (id, first_name, last_name, role) VALUES (?, ?, ?, ?)'
		).bind(id, firstName, lastName, 'user').run();
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

/**
 * Update user role in D1 database
 * @param {Object} env - Worker environment
 * @param {string} userId - Clerk user ID
 * @param {string} newRole - New role value ('user', 'authority', 'admin')
 * @param {string} actorId - ID of user performing the action
 * @returns {Promise<void>}
 */
export async function updateUserRole(env, userId, newRole, actorId) {
	if (!userId || !newRole || !actorId) return;
	// Validate role
	const validRoles = ['user', 'authority', 'admin'];
	if (!validRoles.includes(newRole)) return;

	await env.road_map_db.prepare(
		'UPDATE users SET role = ? WHERE id = ? AND deleted_at IS NULL'
	).bind(newRole, userId).run();

	// Create notification for role change
	const userName = await getUserById(env, userId);
	const actorName = await getUserById(env, actorId);
	const roleName = newRole === 'user' ? 'Member' : newRole === 'authority' ? 'Enforcer' : 'Admin';

	await createManagementNotification(
		env,
		userId,
		'user_role_changed',
		actorId,
		userId,
		`Your role has been changed to ${roleName} by ${actorName?.first_name || 'an admin'}`
	);
}

/**
 * Unblock a user (restore from soft-delete)
 * @param {Object} env - Worker environment
 * @param {string} userId - Clerk user ID
 * @param {string} actorId - ID of user performing the action
 * @returns {Promise<void>}
 */
export async function unblockUser(env, userId, actorId) {
	if (!userId || !actorId) return;
	await env.road_map_db.prepare(
		'UPDATE users SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL'
	).bind(userId).run();

	// Create notification for unblocking
	const userName = await getUserById(env, userId);
	const actorName = await getUserById(env, actorId);

	await createManagementNotification(
		env,
		userId,
		'user_unblocked',
		actorId,
		userId,
		`Your account has been restored by ${actorName?.first_name || 'an admin'}`
	);
}

/**
 * Block a user (soft-delete)
 * @param {Object} env - Worker environment
 * @param {string} userId - Clerk user ID
 * @param {string} actorId - ID of user performing the action
 * @returns {Promise<void>}
 */
export async function blockUser(env, userId, actorId) {
	if (!userId || !actorId) return;
	await env.road_map_db.prepare(
		'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL'
	).bind(userId).run();

	// Create notification for blocking
	const userName = await getUserById(env, userId);
	const actorName = await getUserById(env, actorId);

	await createManagementNotification(
		env,
		userId,
		'user_blocked',
		actorId,
		userId,
		`Your account has been blocked by ${actorName?.first_name || 'an admin'}`
	);
}

/**
 * Get user by ID
 * @param {Object} env - Worker environment
 * @param {string} userId - Clerk user ID
 * @returns {Promise<Object|null>}
 */
export async function getUserById(env, userId) {
	if (!userId) return null;
	return env.road_map_db.prepare(
		'SELECT id, first_name, last_name, image_url, role, created_at, updated_at, deleted_at FROM users WHERE id = ? LIMIT 1'
	).bind(userId).first();
}
