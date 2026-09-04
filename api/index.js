import { createReport, getMedia, getReport, listReports } from './report-service.js';
import { requireUser } from './auth.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		try {
			const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
			if (mediaMatch) {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				return getMedia(request, env, decodeURIComponent(mediaMatch[1]));
			}
			const reportMatch = url.pathname.match(/^\/api\/reports\/?(\d+)?$/);
			if (!reportMatch) return Response.json({ error: 'Route not found' }, { status: 404 });
			if (reportMatch[1]) {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				return getReport(env, Number(reportMatch[1]));
			}
			if (request.method === 'GET') return listReports(env, url);
			if (request.method === 'POST') {
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return createReport(request, env, auth);
			}
			return Response.json({ error: 'Method not allowed' }, { status: 405 });
		} catch (error) {
			console.error(error);
			return Response.json({ error: 'Internal server error' }, { status: 500 });
		}
	},
};
