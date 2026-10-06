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
	const { results: monthlyResults } = await env.road_map_db.prepare(`
		SELECT strftime('%Y-%m', created_at) AS report_month, COUNT(*) AS report_count
		FROM reports
		WHERE deleted_at IS NULL AND status IN ('Open', 'Resolved')
		GROUP BY report_month
		ORDER BY report_month
	`).all();
	const categories = results.map((row) => ({
		id: row.category_id,
		name: row.category_name,
		count: Number(row.report_count) || 0,
	}));
	const total = categories.reduce((sum, category) => sum + category.count, 0);
	const resolved = results.reduce((sum, row) => sum + (Number(row.resolved_count) || 0), 0);
	const resolvedPercentage = total ? Math.round((resolved / total) * 1000) / 10 : 0;
	const monthlyReports = monthlyResults.map((row) => ({ month: row.report_month, count: Number(row.report_count) || 0 }));
	return Response.json({ total, resolved, resolvedPercentage, categories, monthlyReports }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function getMonthlyReport(env, month) {
	if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'Month must be in YYYY-MM format' }, { status: 400 });
	const start = `${month}-01T00:00:00Z`;
	const [year, mon] = month.split('-').map(Number);
	const nextMonth = mon === 12 ? 1 : mon + 1;
	const nextYear = mon === 12 ? year + 1 : year;
	const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`;
	const { results: summaryRows } = await env.road_map_db.prepare(`
		SELECT COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved,
			COALESCE(SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END), 0) AS unresolved
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
	`).bind(start, end).all();
	const summary = summaryRows[0] || { total: 0, resolved: 0, unresolved: 0 };
	const { results: locationRows } = await env.road_map_db.prepare(`
		SELECT COALESCE(NULLIF(barangay, ''), NULLIF(city, ''), NULLIF(province, ''), 'Unknown location') AS area,
			COUNT(*) AS count
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
		GROUP BY area
		ORDER BY count DESC
	`).bind(start, end).all();
	return Response.json({
		month,
		total: Number(summary.total) || 0,
		resolved: Number(summary.resolved) || 0,
		unresolved: Number(summary.unresolved) || 0,
		byArea: locationRows.map((row) => ({ area: row.area, count: Number(row.count) || 0 })),
	}, { headers: { 'Cache-Control': 'no-store' } });
}