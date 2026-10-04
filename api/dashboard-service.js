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