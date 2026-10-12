export async function getDashboardMetrics(env) {
	const { results } = await env.road_map_db.prepare(`
		SELECT c.id AS category_id, c.name AS category_name,
			COUNT(r.id) AS report_count,
			COALESCE(SUM(CASE WHEN r.status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved_count
		FROM categories c
		LEFT JOIN reports r ON r.category_id = c.id AND r.deleted_at IS NULL
		GROUP BY c.id, c.name
		ORDER BY c.id
	`).all();
	const { results: dailyResults } = await env.road_map_db.prepare(`
		SELECT strftime('%Y-%m-%d', created_at) AS report_day, COUNT(*) AS report_count
		FROM reports
		WHERE deleted_at IS NULL AND status IN ('Open', 'Resolved')
		GROUP BY report_day
		ORDER BY report_day
	`).all();
	const categories = results.map((row) => ({
		id: row.category_id,
		name: row.category_name,
		count: Number(row.report_count) || 0,
	}));
	const total = categories.reduce((sum, category) => sum + category.count, 0);
	const resolved = results.reduce((sum, row) => sum + (Number(row.resolved_count) || 0), 0);
	const resolvedPercentage = total ? Math.round((resolved / total) * 1000) / 10 : 0;
	const dailyReports = dailyResults.map((row) => ({ day: row.report_day, count: Number(row.report_count) || 0 }));
	return Response.json({ total, resolved, resolvedPercentage, categories, dailyReports }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function getPendingReports(env, auth, limit = 10) {
	const role = auth?.role;
	if (role !== 'authority' && role !== 'admin') {
		return Response.json({ error: 'Forbidden' }, { status: 403 });
	}
	const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 10, 1), 20);
	const { results } = await env.road_map_db.prepare(`
		SELECT r.id, r.title, r.description, r.author_name, r.status,
			r.barangay, r.city, r.province, r.resolved_address,
			c.id AS category_id, c.name AS category_name
		FROM reports r JOIN categories c ON c.id = r.category_id
		WHERE r.deleted_at IS NULL AND r.status = 'Pending'
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT ?
	`).bind(safeLimit).all();
	const reports = results.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		poster: row.author_name || 'Community reporter',
		category: { id: row.category_id, name: row.category_name },
		location: { barangay: row.barangay, city: row.city, province: row.province, resolvedAddress: row.resolved_address },
	}));
	return Response.json({ reports }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function getMonthlyReport(env, month, municipality) {
	if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'Month must be in YYYY-MM format' }, { status: 400 });
	const [year, mon] = month.split('-').map(Number);
	const nextMonth = mon === 12 ? 1 : mon + 1;
	const nextYear = mon === 12 ? year + 1 : year;
	const start = `${month}-01`;
	const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

	let muniFilter = '';
	const params = [start, end];
	if (municipality && municipality !== 'all') {
		muniFilter = 'AND city = ?';
		params.push(municipality);
	}

	const { results: summaryRows } = await env.road_map_db.prepare(`
		SELECT COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved,
			COALESCE(SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END), 0) AS unresolved
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ? ${muniFilter}
	`).bind(...params).all();
	const summary = summaryRows[0] || { total: 0, resolved: 0, unresolved: 0 };

	const { results: categoryRows } = await env.road_map_db.prepare(`
		SELECT c.name AS category_name,
			COUNT(r.id) AS total,
			COALESCE(SUM(CASE WHEN r.status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved,
			COALESCE(SUM(CASE WHEN r.status != 'Resolved' THEN 1 ELSE 0 END), 0) AS active
		FROM categories c
		LEFT JOIN reports r ON r.category_id = c.id AND r.deleted_at IS NULL AND r.created_at >= ? AND r.created_at < ? ${muniFilter.replace('AND city', 'AND r.city')}
		GROUP BY c.id, c.name
		HAVING total > 0
		ORDER BY total DESC
	`).bind(...params).all();

	const { results: locationRows } = await env.road_map_db.prepare(`
		SELECT COALESCE(NULLIF(city, ''), 'Unknown municipality') AS municipality,
			COUNT(*) AS count
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
		GROUP BY municipality
		ORDER BY count DESC
	`).bind(start, end).all();

	return Response.json({
		month,
		total: Number(summary.total) || 0,
		resolved: Number(summary.resolved) || 0,
		unresolved: Number(summary.unresolved) || 0,
		byCategory: categoryRows.map((row) => ({ name: row.category_name, total: Number(row.total) || 0, resolved: Number(row.resolved) || 0, active: Number(row.active) || 0 })),
		byMunicipality: locationRows.map((row) => ({ municipality: row.municipality, count: Number(row.count) || 0 })),
	}, { headers: { 'Cache-Control': 'no-store' } });
}