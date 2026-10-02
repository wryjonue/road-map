import { approveReport, createReport, deletePendingReport, getMapReports, getMedia, getReport, listReports, resolveReport } from './report-service.js';
import { getDashboardMetrics } from './dashboard-service.js';
import { getSampleRoute } from './routing-service.js';
import { getOptionalUser, requireUser } from './auth.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		try {
			if (url.pathname === '/api/routes/sample') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				return getSampleRoute(request, env);
			}
			if (url.pathname === '/api/dashboard/metrics') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getDashboardMetrics(env);
			}
			if (url.pathname === '/api/map/reports') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getMapReports(env, url);
			}
			const statusMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/status$/);
			if (statusMatch) {
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				if (auth.role !== 'authority' && auth.role !== 'admin') return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
				let body;
				try { body = await request.json(); } catch { return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 }); }
				if (body?.status === 'Open') return approveReport(env, Number(statusMatch[1]), auth);
				if (body?.status === 'Resolved') return resolveReport(env, Number(statusMatch[1]), auth);
				return Response.json({ error: 'Only Open and Resolved statuses are supported' }, { status: 400 });
			}
			const deleteMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
			if (deleteMatch && request.method === 'DELETE') {
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return deletePendingReport(env, Number(deleteMatch[1]), auth);
			}
			const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
			if (mediaMatch) {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getMedia(request, env, decodeURIComponent(mediaMatch[1]), auth);
			}
			const reportMatch = url.pathname.match(/^\/api\/reports\/?(\d+)?$/);
			if (!reportMatch) return Response.json({ error: 'Route not found' }, { status: 404 });
			if (reportMatch[1]) {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getReport(env, Number(reportMatch[1]), 200, auth);
			}
			if (request.method === 'GET') {
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return listReports(env, url, auth);
			}
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
