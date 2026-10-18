import { createNotification } from './notification-service.js';
import { insertSystemComment } from './comment-service.js';

/**
 * Verify HMAC-SHA256 signature on incoming webhook request.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */
async function verifyWebhookSignature(request, env) {
	const secret = env.AI_WEBHOOK_SECRET;
	if (!secret) {
		console.error('[webhook] AI_WEBHOOK_SECRET not configured');
		return false;
	}

	const signature = request.headers.get('x-webhook-signature');
	if (!signature) {
		console.warn('[webhook] Missing x-webhook-signature header');
		return false;
	}

	// Clone request to read body without consuming it
	const bodyText = await request.clone().text();
	const encoder = new TextEncoder();
	const keyData = encoder.encode(secret);
	const bodyData = encoder.encode(bodyText);

	const key = await crypto.subtle.importKey(
		'raw',
		keyData,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signatureBuffer = await crypto.subtle.sign('HMAC', key, bodyData);
	const expectedHex = Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// Constant-time comparison
	if (expectedHex.length !== signature.length) return false;
	let mismatch = 0;
	for (let i = 0; i < expectedHex.length; i++) {
		mismatch |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return mismatch === 0;
}

/**
 * Handle AI moderation webhook from Render service.
 * Expected payload:
 * {
 *   "reportId": 123,
 *   "verdict": "approve" | "reject",
 *   "confidence": 0.85,
 *   "reason": "Clear road hazard description",
 *   "needsManualReview": false,
 *   "timestamp": "2026-10-18T09:00:05Z"
 * }
 */
/** Maximum allowed age of webhook timestamp in milliseconds (5 minutes). */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export async function handleAiModerationWebhook(request, env) {
	try {
		// Strict HMAC verification
		const isValid = await verifyWebhookSignature(request, env);
		if (!isValid) {
			console.warn('[webhook] Invalid or missing HMAC signature');
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
		}

		const body = await request.json();
		const { reportId, verdict, confidence, reason, needsManualReview, timestamp } = body;

		if (!reportId || !verdict || confidence === undefined) {
			return new Response(JSON.stringify({ error: 'Invalid payload: reportId, verdict, and confidence are required' }), { status: 400 });
		}

		// Replay-window protection: reject payloads older than 5 minutes
		if (timestamp) {
			const payloadAge = Date.now() - new Date(timestamp).getTime();
			if (payloadAge > REPLAY_WINDOW_MS) {
				console.warn('[webhook] Replay window exceeded:', { reportId, timestamp, ageMs: payloadAge });
				return new Response(JSON.stringify({ error: 'Payload too old' }), { status: 400 });
			}
		}

		console.log('[webhook] Received AI moderation result:', { reportId, verdict, confidence, needsManualReview });

		// Look up the report's author for notification targeting
		const reportRow = await env.road_map_db.prepare('SELECT author_id, status FROM reports WHERE id = ? AND deleted_at IS NULL').bind(reportId).first();
		if (!reportRow) {
			console.warn('[webhook] Report not found or deleted:', reportId);
			return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 });
		}

		// Only process if report is still Pending
		if (reportRow.status !== 'Pending') {
			console.log('[webhook] Report already processed, current status:', reportRow.status);
			return new Response(JSON.stringify({ success: true, message: 'Already processed' }), { status: 200 });
		}

		const now = new Date().toISOString();
		const authorId = reportRow.author_id;

		// Update report with AI moderation metadata
		await env.road_map_db.prepare(
			'UPDATE reports SET ai_verdict = ?, ai_confidence = ?, ai_reason = ?, ai_reviewed_at = ? WHERE id = ?',
		).bind(verdict, confidence, reason || null, now, reportId).run();

		// Apply verdict
		if (verdict === 'approve' && !needsManualReview) {
			await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending'").bind(now, reportId).run();
			await createNotification(env, { userId: authorId, type: 'report_auto_approved', reportId, actorId: 'ai-system', message: 'Your report was auto-approved by AI and is now visible to the community.' });
			await insertSystemComment(env, reportId, `AI auto-approved this report (confidence: ${Math.round(confidence * 100)}%).`);
		} else if (verdict === 'reject' && !needsManualReview) {
			await env.road_map_db.prepare("UPDATE reports SET status = 'Rejected', updated_at = ?, archived_at = ? WHERE id = ? AND status = 'Pending'").bind(now, now, reportId).run();
			await createNotification(env, { userId: authorId, type: 'report_auto_rejected', reportId, actorId: 'ai-system', message: `Your report was auto-rejected by AI. Reason: ${reason || 'No reason provided'}` });
			await insertSystemComment(env, reportId, `AI auto-rejected this report (confidence: ${Math.round(confidence * 100)}%). Reason: ${reason || 'No reason provided'}`);
		} else {
			// Needs manual review — stays Pending
			await createNotification(env, { userId: authorId, type: 'report_needs_review', reportId, actorId: 'ai-system', message: `Your report requires manual review. AI confidence: ${Math.round(confidence * 100)}%.` });
		}

		return new Response(JSON.stringify({ success: true, message: 'Processed' }), { status: 200 });
	} catch (error) {
		console.error('[webhook] Error handling AI moderation webhook:', error);
		return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
	}
}
