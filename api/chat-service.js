// Persistence for the AI assistant conversation history (per Clerk user).

export const MAX_HISTORY_TURNS = 10;
export const MAX_CONTENT_LENGTH = 4000;

export async function saveMessage(env, userId, role, content) {
	if (!userId || !content) return null;
	const safeRole = role === 'assistant' ? 'assistant' : 'user';
	const safeContent = String(content).slice(0, MAX_CONTENT_LENGTH);
	const result = await env.road_map_db.prepare(
		'INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)'
	).bind(userId, safeRole, safeContent).run();
	return result.meta?.last_row_id ?? null;
}

// Returns the most recent messages for a user, ordered oldest-first so they can be
// fed straight into the model as conversation context.
export async function getRecentHistory(env, userId, limit = MAX_HISTORY_TURNS * 2) {
	const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : MAX_HISTORY_TURNS * 2, 1), 40);
	const { results } = await env.road_map_db.prepare(
		`SELECT id, role, content, created_at FROM (
			SELECT id, role, content, created_at FROM chat_messages
			WHERE user_id = ?
			ORDER BY id DESC
			LIMIT ?
		) ORDER BY id ASC`
	).bind(userId, safeLimit).all();
	return results.map((row) => ({
		id: row.id,
		role: row.role,
		content: row.content,
		createdAt: row.created_at,
	}));
}

export async function clearHistory(env, userId) {
	if (!userId) return;
	await env.road_map_db.prepare('DELETE FROM chat_messages WHERE user_id = ?').bind(userId).run();
}
