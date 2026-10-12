// Pure CSV helpers (RFC 4180) + a DOM download trigger. No dependencies.

function escapeCsvField(value) {
	if (value === null || value === undefined) return '';
	const str = String(value);
	// Quote if the field contains a comma, double-quote, or newline.
	if (/[",\r\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

export function rowsToCsv(rows) {
	return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

// Build a sectioned dashboard snapshot CSV.
// metrics: { total, resolved, resolvedPercentage, categories:[{name,count}], dailyReports:[{day,count}] }
// monthly: { month, municipality, data:{ total, resolved, unresolved, byCategory:[{name,total,resolved,active}], byMunicipality:[{municipality,count}] } } | null
export function buildDashboardCsv({ metrics, monthly, monthLabel, year, exportedAt }) {
	const sections = [];

	// Overview
	const active = metrics ? Math.max(metrics.total - metrics.resolved, 0) : 0;
	sections.push(['RoadMap Dashboard Export']);
	sections.push([]);
	sections.push(['Overview']);
	sections.push(['Metric', 'Value']);
	sections.push(['Exported at', exportedAt]);
	sections.push(['Period', `${monthLabel} ${year}`]);
	if (metrics) {
		sections.push(['Total reports', metrics.total]);
		sections.push(['Resolved reports', metrics.resolved]);
		sections.push(['Resolution rate (%)', metrics.resolvedPercentage]);
		sections.push(['Active reports', active]);
	} else {
		sections.push(['Total reports', 'not loaded']);
	}
	sections.push([]);

	// Reports per day
	sections.push(['Reports per day']);
	sections.push(['Date', 'Reports']);
	if (metrics?.dailyReports?.length) {
		for (const d of metrics.dailyReports) sections.push([d.day, d.count]);
	} else {
		sections.push(['(no data)']);
	}
	sections.push([]);

	// Incidents by category
	sections.push(['Incidents by category']);
	sections.push(['Category', 'Reports']);
	if (metrics?.categories?.length) {
		for (const c of metrics.categories) sections.push([c.name, c.count]);
	} else {
		sections.push(['(no data)']);
	}
	sections.push([]);

	// Monthly incident report
	sections.push(['Monthly incident report']);
	if (monthly?.data) {
		const muniLabel = monthly.municipality && monthly.municipality !== 'all' ? monthly.municipality : 'All municipalities';
		sections.push(['Month', monthly.month]);
		sections.push(['Municipality filter', muniLabel]);
		sections.push([]);
		sections.push(['Summary']);
		sections.push(['Metric', 'Value']);
		sections.push(['Total', monthly.data.total]);
		sections.push(['Resolved', monthly.data.resolved]);
		sections.push(['Unresolved', monthly.data.unresolved]);
		sections.push([]);
		sections.push(['By category']);
		sections.push(['Category', 'Total', 'Resolved', 'Active']);
		if (monthly.data.byCategory?.length) {
			for (const c of monthly.data.byCategory) sections.push([c.name, c.total, c.resolved, c.active]);
		} else {
			sections.push(['(no incidents recorded)']);
		}
		sections.push([]);
		sections.push(['By municipality']);
		sections.push(['Municipality', 'Reports']);
		if (monthly.data.byMunicipality?.length) {
			for (const m of monthly.data.byMunicipality) sections.push([m.municipality, m.count]);
		} else {
			sections.push(['(no data)']);
		}
	} else {
		sections.push(['(monthly data not yet loaded)']);
	}

	// UTF-8 BOM so Excel opens accented Filipino place names correctly.
	return '\uFEFF' + rowsToCsv(sections);
}

export function downloadCsv(filename, csvString) {
	const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.rel = 'noopener';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export function exportFilename(date = new Date()) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `roadmap-dashboard-${y}-${m}-${d}.csv`;
}
