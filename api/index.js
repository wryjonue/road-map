import { approveReport, createReport, deletePendingReport, getHotspots, getMapReports, getMedia, getReport, getReportFacets, getVoteStatus, listReports, rejectReport, resolveReport, voteReport } from './report-service.js';
import { createComment, deleteComment, getComments } from './comment-service.js';
import { getArchivedReports, getDashboardMetrics, getMonthlyReport, getPendingReports } from './dashboard-service.js';
import { getCalculatedRoute, getSampleRoute } from './routing-service.js';
import { getOptionalUser, requireUser } from './auth.js';
import { chatWithGemini, MAX_MESSAGE_LENGTH } from './ai-service.js';
import { getRecentHistory, saveMessage, clearHistory } from './chat-service.js';
import { LocationResolutionError, resolveRoadLocation } from './location-service.js';
import { getNotifications, getUnreadCount, markAllAsRead, markAsRead, createManagementNotification } from './notification-service.js';
import { handleClerkWebhook } from './clerk-webhook.js';
import { handleAiModerationWebhook } from './webhook-service.js';
import { updateUserRole, softDeleteUser, unblockUser, blockUser } from './user-service.js';

// Durable Object classes must be exported from the Worker entry so Wrangler can bind them.
export { NotificationHub } from './durable-objects/notification-hub.js';
export { ChatRoom } from './durable-objects/chat-room.js';

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		try {
			// Clerk webhook endpoint — no auth required, signature verified internally.
			if (url.pathname === '/api/webhooks/clerk') {
				return handleClerkWebhook(request, env);
			}
			// AI moderation webhook from Render service — no user auth, HMAC verified internally.
			if (url.pathname === '/api/webhooks/ai-moderation') {
				if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				return handleAiModerationWebhook(request, env);
			}
			// WebSocket upgrade: per-user notification hub.
			if (url.pathname === '/ws/notifications') {
				// Browser WebSocket cannot send Authorization headers; accept token via query param.
				const wsToken = url.searchParams.get('token');
				let auth;
				if (wsToken) {
					const syntheticRequest = new Request(request.url, { headers: { Authorization: `Bearer ${wsToken}` } });
					auth = await requireUser(syntheticRequest, env);
				} else {
					auth = await requireUser(request, env);
				}
				if (auth instanceof Response) return auth;
				const stub = env.NOTIFICATION_HUB.getByName(`user:${auth.userId}`);
				return stub.fetch(request);
			}
			// WebSocket upgrade: per-room chat.
			const chatMatch = url.pathname.match(/^\/ws\/chat\/([^/]+)$/);
			if (chatMatch) {
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				const roomId = decodeURIComponent(chatMatch[1]);
				const stub = env.CHAT_ROOM.getByName(`room:${roomId}`);
				return stub.fetch(request);
			}
			if (url.pathname === '/api/ai/chat') {
				if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				let body;
				try { body = await request.json(); } catch { return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 }); }
				const message = typeof body?.message === 'string' ? body.message.trim() : '';
				if (!message) return Response.json({ error: 'message is required' }, { status: 400 });
				if (message.length > MAX_MESSAGE_LENGTH) return Response.json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }, { status: 400 });
				const history = await getRecentHistory(env, auth.userId);
				await saveMessage(env, auth.userId, 'user', message);
				const result = await chatWithGemini(env, message, history);
				await saveMessage(env, auth.userId, 'assistant', result.reply);
				return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
			}
			if (url.pathname === '/api/ai/history') {
				if (request.method === 'GET') {
					const auth = await requireUser(request, env);
					if (auth instanceof Response) return auth;
					const rawLimit = Number(url.searchParams.get('limit') ?? 20);
					const messages = await getRecentHistory(env, auth.userId, rawLimit);
					return Response.json({ messages }, { headers: { 'Cache-Control': 'no-store' } });
				}
				if (request.method === 'DELETE') {
					const auth = await requireUser(request, env);
					if (auth instanceof Response) return auth;
					await clearHistory(env, auth.userId);
					return Response.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
				}
				return Response.json({ error: 'Method not allowed' }, { status: 405 });
			}
			if (url.pathname === '/api/location/resolve') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				const latitude = Number(url.searchParams.get('latitude'));
				const longitude = Number(url.searchParams.get('longitude'));
				const location = await resolveRoadLocation(latitude, longitude, env, request.signal);
				return Response.json(location, { headers: { 'Cache-Control': 'no-store' } });
			}
			if (url.pathname === '/api/routes/sample') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				return getSampleRoute(request, env);
			}
			if (url.pathname === '/api/routes/calculate') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getCalculatedRoute(request, env);
			}
			if (url.pathname === '/api/dashboard/metrics') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getDashboardMetrics(env);
			}
			if (url.pathname === '/api/dashboard/monthly-report') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				const month = url.searchParams.get('month');
				const municipality = url.searchParams.get('municipality') || 'all';
				if (!month) return Response.json({ error: 'Month parameter is required (YYYY-MM)' }, { status: 400 });
				return getMonthlyReport(env, month, municipality);
			}
			if (url.pathname === '/api/dashboard/pending') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				const limit = Number(url.searchParams.get('limit') ?? 10);
				return getPendingReports(env, auth, limit);
			}
			if (url.pathname === '/api/dashboard/archived') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				const limit = Number(url.searchParams.get('limit') ?? 10);
				return getArchivedReports(env, auth, limit);
			}
			// User API
			if (url.pathname === '/api/users') {
					try {
					const stmt = env.road_map_db.prepare(
						'SELECT id, first_name, last_name, image_url, role, deleted_at FROM users ORDER BY created_at DESC'
					);
					const result = await stmt.all();
					return new Response(JSON.stringify(result.results), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (err) {
					console.error('Failed to fetch users:', err);
					return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
						status: 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}

			}
			const userRoleMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/role$/);
			if (userRoleMatch) {
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				if (auth.role !== 'admin') return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
	
				let body;
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
				}
				const userId = decodeURIComponent(userRoleMatch[1]);
				return updateUserRole(env, userId, body.role); // Or whatever parameters your updateUserRole function expects
			}

			const userBlockMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/block$/);
			if (userBlockMatch) {
				console.log("here 1")
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				console.log("here 2")
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				console.log("here 3")
				if (auth.role !== 'admin') return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
				
				console.log("here 5")
				const userId = decodeURIComponent(userBlockMatch[1]);
				return blockUser(env, userId);
			}

			const userUnblockMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/unblock$/);
			if (userUnblockMatch) {
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				if (auth.role !== 'admin') return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
				
				console.log("here 5")
				const userId = decodeURIComponent(userUnblockMatch[1]);
				return unblockUser(env, userId);
			}

			if (url.pathname === '/api/map/reports') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getMapReports(env, url);
			}
			if (url.pathname === '/api/hotspots') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getHotspots(env, url);
			}
			if (url.pathname === '/api/notifications/unread-count') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return getUnreadCount(env, auth.userId);
			}
			if (url.pathname === '/api/notifications/read-all') {
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return markAllAsRead(env, auth.userId);
			}
			const notifReadMatch = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
			if (notifReadMatch) {
				if (request.method !== 'PATCH') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return markAsRead(env, Number(notifReadMatch[1]), auth.userId);
			}
			if (url.pathname === '/api/notifications') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return getNotifications(env, auth.userId, url);
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
				if (body?.status === 'Rejected') return rejectReport(env, Number(statusMatch[1]), auth);
				if (body?.status === 'Resolved') return resolveReport(env, Number(statusMatch[1]), auth);
				return Response.json({ error: 'Only Open, Rejected, and Resolved statuses are supported' }, { status: 400 });
			}
			const deleteMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
			if (deleteMatch && request.method === 'DELETE') {
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return deletePendingReport(env, Number(deleteMatch[1]), auth);
			}
			const voteMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/vote$/);
			if (voteMatch && request.method === 'POST') {
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return voteReport(env, Number(voteMatch[1]), auth.userId);
			}
			const voteStatusMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/vote$/);
			if (voteStatusMatch && request.method === 'GET') {
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getVoteStatus(env, Number(voteStatusMatch[1]), auth?.userId ?? null);
			}
			const commentsMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/comments$/);
			if (commentsMatch) {
				const reportId = Number(commentsMatch[1]);
				if (request.method === 'GET') {
					const auth = await getOptionalUser(request, env);
					if (auth instanceof Response) return auth;
					return getComments(env, reportId, auth);
				}
				if (request.method === 'POST') {
					const auth = await requireUser(request, env);
					if (auth instanceof Response) return auth;
					return createComment(request, env, reportId, auth);
				}
				return Response.json({ error: 'Method not allowed' }, { status: 405 });
			}
			const commentMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/comments\/(\d+)$/);
			if (commentMatch) {
				if (request.method !== 'DELETE') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await requireUser(request, env);
				if (auth instanceof Response) return auth;
				return deleteComment(env, Number(commentMatch[1]), Number(commentMatch[2]), auth);
			}
			const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
			if (mediaMatch) {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getMedia(request, env, decodeURIComponent(mediaMatch[1]), auth);
			}
			if (url.pathname === '/api/reports/facets') {
				if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });
				const auth = await getOptionalUser(request, env);
				if (auth instanceof Response) return auth;
				return getReportFacets(env);
			}
			const reportMatch = url.pathname.match(/^\/api\/reports\/?((\d+))?$/);
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
				return createReport(request, env, auth, ctx);
			}
			return Response.json({ error: 'Method not allowed' }, { status: 405 });
		} catch (error) {
			if (error instanceof LocationResolutionError) return Response.json({ error: error.message }, { status: error.status });
			console.error(error);
			return Response.json({ error: 'Internal server error' }, { status: 500 });
		}
	},
};
