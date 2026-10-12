import { GoogleGenAI } from '@google/genai';
import { haversineDistanceMeters } from './clustering.js';

const MODEL = 'gemini-3.8-flash';
const MAX_TURNS = 5;
const MAX_MESSAGE_LENGTH = 2000;

const SYSTEM_PROMPT = `You are RoadMap, a helpful assistant for the Bataan road incident reporting system.
Users report road problems (construction, closures, accidents, damaged/flooded roads, debris, heavy traffic) and you help them find and understand those reports.

Rules:
- Only answer using the provided tools. Never invent report ids, titles, counts, or locations.
- Reports that are rejected or deleted are archived and hidden from the public — your tools already exclude them, so do not mention archived reports.
- Be concise. When listing reports, include their id and title so the user can reference them.
- Distances are in kilometers; coordinates are longitude/latitude (WGS84). Bataan is around latitude 14.68, longitude 120.54.
- If a tool returns no results, say so plainly and suggest broadening the search.`;

// --- Tool definitions (Gemini function declarations) ---
const TOOLS = [
	{
		name: 'search_reports',
		description: 'Find road incident reports by keyword, category, status, or municipality. Returns the most recent matching reports. Excludes archived (rejected/deleted) reports.',
		parameters: {
			type: 'OBJECT',
			properties: {
				query: { type: 'STRING', description: 'Free-text keyword matched against report title and description.' },
				category: { type: 'STRING', description: 'Category name, e.g. "Flooded Road", "Road Construction", "Road Closure", "Damaged Road", "Heavy Traffic", "Fallen Debris", "Road Accident (Self)", "Road Accident (Vehicular)", "Others".' },
				status: { type: 'STRING', description: 'Report status: "Open", "Pending", or "Resolved".', enum: ['Open', 'Pending', 'Resolved'] },
				municipality: { type: 'STRING', description: 'City/municipality name, e.g. "Mariveles", "Limay", "Balanga".' },
				limit: { type: 'INTEGER', description: 'Max number of reports to return (default 5, max 10).' },
			},
			required: [],
		},
	},
	{
		name: 'get_report_stats',
		description: 'Get aggregated incident counts (total, resolved, unresolved) and the top categories for a given month and/or municipality. Excludes archived reports.',
		parameters: {
			type: 'OBJECT',
			properties: {
				month: { type: 'STRING', description: 'Month in YYYY-MM format, e.g. "2026-10". Omit for all-time.' },
				municipality: { type: 'STRING', description: 'City/municipality name to scope the stats. Omit for all municipalities.' },
			},
			required: [],
		},
	},
	{
		name: 'find_nearby_incidents',
		description: 'Find the road incident reports nearest to a given latitude/longitude within a radius. Excludes archived reports.',
		parameters: {
			type: 'OBJECT',
			properties: {
				latitude: { type: 'NUMBER', description: 'Latitude in degrees (-90 to 90).' },
				longitude: { type: 'NUMBER', description: 'Longitude in degrees (-180 to 180).' },
				radius_km: { type: 'NUMBER', description: 'Search radius in kilometers (default 5, max 50).' },
				limit: { type: 'INTEGER', description: 'Max number of reports to return (default 5, max 10).' },
			},
			required: ['latitude', 'longitude'],
		},
	},
];

const FUNCTION_DECLARATIONS = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));

// --- Helpers ---
function clampInt(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(Math.floor(n), min), max);
}
function clampFloat(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}
const ALLOWED_STATUSES = new Set(['Open', 'Pending', 'Resolved']);

// Shared base filter: never surface archived (rejected / soft-deleted) reports.
const ARCHIVE_FILTER = "r.deleted_at IS NULL AND r.status <> 'Rejected'";
const ARCHIVE_FILTER_NO_ALIAS = "deleted_at IS NULL AND status <> 'Rejected'";

async function toolSearchReports(env, args) {
	const limit = clampInt(args.limit, 5, 1, 10);
	let filters = '';
	const bindings = [];

	if (typeof args.query === 'string' && args.query.trim()) {
		const like = `%${args.query.trim().slice(0, 200)}%`;
		filters += ' AND (r.title LIKE ? OR r.description LIKE ?)';
		bindings.push(like, like);
	}
	if (typeof args.category === 'string' && args.category.trim()) {
		filters += ' AND LOWER(c.name) = LOWER(?)';
		bindings.push(args.category.trim());
	}
	if (typeof args.status === 'string' && ALLOWED_STATUSES.has(args.status)) {
		filters += ' AND r.status = ?';
		bindings.push(args.status);
	}
	if (typeof args.municipality === 'string' && args.municipality.trim()) {
		filters += ' AND LOWER(r.city) = LOWER(?)';
		bindings.push(args.municipality.trim());
	}

	const { results } = await env.road_map_db.prepare(`
		SELECT r.id, r.title, r.status, r.city, r.created_at, c.name AS category_name
		FROM reports r JOIN categories c ON c.id = r.category_id
		WHERE ${ARCHIVE_FILTER}${filters}
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT ?
	`).bind(...bindings, limit).all();

	return results.map((row) => ({
		id: row.id,
		title: row.title,
		status: row.status,
		category: row.category_name,
		city: row.city || null,
		created_at: row.created_at,
	}));
}

async function toolGetReportStats(env, args) {
	let dateFilter = '';
	const bindings = [];
	if (typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month)) {
		const [year, mon] = args.month.split('-').map(Number);
		const nextMonth = mon === 12 ? 1 : mon + 1;
		const nextYear = mon === 12 ? year + 1 : year;
		const start = `${args.month}-01`;
		const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
		dateFilter = ' AND created_at >= ? AND created_at < ?';
		bindings.push(start, end);
	}
	let muniFilter = '';
	if (typeof args.municipality === 'string' && args.municipality.trim()) {
		muniFilter = ' AND LOWER(city) = LOWER(?)';
		bindings.push(args.municipality.trim());
	}

	const { results: summaryRows } = await env.road_map_db.prepare(`
		SELECT COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved,
			COALESCE(SUM(CASE WHEN status <> 'Resolved' THEN 1 ELSE 0 END), 0) AS unresolved
		FROM reports
		WHERE ${ARCHIVE_FILTER_NO_ALIAS}${dateFilter}${muniFilter}
	`).bind(...bindings).all();
	const summary = summaryRows[0] || { total: 0, resolved: 0, unresolved: 0 };

	const { results: categoryRows } = await env.road_map_db.prepare(`
		SELECT c.name AS category_name, COUNT(r.id) AS count
		FROM categories c
		LEFT JOIN reports r ON r.category_id = c.id AND ${ARCHIVE_FILTER}${dateFilter.replace(/created_at/g, 'r.created_at')}${muniFilter.replace(/city/g, 'r.city')}
		GROUP BY c.id, c.name
		HAVING count > 0
		ORDER BY count DESC
		LIMIT 5
	`).bind(...bindings).all();

	return {
		total: Number(summary.total) || 0,
		resolved: Number(summary.resolved) || 0,
		unresolved: Number(summary.unresolved) || 0,
		topCategories: categoryRows.map((row) => ({ name: row.category_name, count: Number(row.count) || 0 })),
	};
}

async function toolFindNearbyIncidents(env, args) {
	const lat = clampFloat(args.latitude, NaN, -90, 90);
	const lng = clampFloat(args.longitude, NaN, -180, 180);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'latitude and longitude are required and must be valid numbers' };
	const radiusKm = clampFloat(args.radius_km, 5, 0.1, 50);
	const limit = clampInt(args.limit, 5, 1, 10);

	// Bounding-box pre-filter (roughly radius_km in degrees) to keep the SQL result set small.
	const delta = radiusKm / 111;
	const { results } = await env.road_map_db.prepare(`
		SELECT r.id, r.title, r.status, r.city, r.latitude, r.longitude, c.name AS category_name
		FROM reports r JOIN categories c ON c.id = r.category_id
		WHERE ${ARCHIVE_FILTER}
			AND r.latitude BETWEEN ? AND ?
			AND r.longitude BETWEEN ? AND ?
			AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
		LIMIT 200
	`).bind(lat - delta, lat + delta, lng - delta, lng + delta).all();

	const radiusM = radiusKm * 1000;
	const ranked = results
		.map((row) => ({ row, distanceM: haversineDistanceMeters([lng, lat], [row.longitude, row.latitude]) }))
		.filter((item) => item.distanceM <= radiusM)
		.sort((a, b) => a.distanceM - b.distanceM)
		.slice(0, limit);

	return ranked.map(({ row, distanceM }) => ({
		id: row.id,
		title: row.title,
		category: row.category_name,
		status: row.status,
		city: row.city || null,
		distance_km: Math.round(distanceM / 100) / 10,
	}));
}

async function executeTool(env, name, args) {
	try {
		switch (name) {
			case 'search_reports': return await toolSearchReports(env, args || {});
			case 'get_report_stats': return await toolGetReportStats(env, args || {});
			case 'find_nearby_incidents': return await toolFindNearbyIncidents(env, args || {});
			default: return { error: `Unknown tool: ${name}` };
		}
	} catch (error) {
		return { error: error?.message || 'Tool execution failed' };
	}
}

export async function chatWithGemini(env, message) {
	if (!env.GEMINI_API_KEY) {
		return { reply: 'The AI assistant is not configured on this server.' };
	}
	const trimmed = typeof message === 'string' ? message.trim() : '';
	if (!trimmed) return { reply: 'Please provide a message.' };
	const safeMessage = trimmed.slice(0, MAX_MESSAGE_LENGTH);

	let ai;
	try {
		ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
	} catch {
		return { reply: 'Unable to initialize the AI assistant.' };
	}

	const contents = [{ role: 'user', parts: [{ text: safeMessage }] }];

	try {
		for (let turn = 0; turn < MAX_TURNS; turn++) {
			const response = await ai.models.generateContent({
				model: MODEL,
				contents,
				config: {
					systemInstruction: SYSTEM_PROMPT,
					tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
				},
			});

			const candidate = response.candidates?.[0];
			const parts = candidate?.content?.parts ?? [];

			const functionCallParts = parts.filter((p) => p.functionCall);
			if (functionCallParts.length === 0) {
				const text = parts.map((p) => p.text).filter((t) => typeof t === 'string').join('').trim();
				return { reply: text || 'I could not find any information to answer that.' };
			}

			// Model wants to call tools. Preserve each part wholesale (Gemini 3.x attaches a
			// thoughtSignature to functionCall parts that MUST be echoed back or the next turn
			// fails with INVALID_ARGUMENT). Run each tool, then feed the results back.
			contents.push({ role: 'model', parts: functionCallParts });
			const toolResponseParts = [];
			for (const part of functionCallParts) {
				const fc = part.functionCall;
				const result = await executeTool(env, fc.name, fc.args || {});
				toolResponseParts.push({
					functionResponse: { name: fc.name, response: { result } },
				});
			}
			contents.push({ role: 'user', parts: toolResponseParts });
		}

		return { reply: 'I reached the limit of my lookups and could not finish answering. Try narrowing your question.' };
	} catch (error) {
		console.error('[ai-chat] error', error?.message || error);
		return { reply: 'Sorry, the AI assistant encountered an error. Please try again.' };
	}
}

export { MAX_MESSAGE_LENGTH };
