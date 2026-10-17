import { verifyWebhook } from '@clerk/backend/webhooks';
import { upsertUserFromPayload, softDeleteUser } from './user-service.js';

/**
 * Handle incoming Clerk webhook events.
 * Endpoint: POST /api/webhooks/clerk
 *
 * Subscribed events (configured in Clerk Dashboard):
 *   - user.updated → upsert user row
 *   - user.deleted → soft-delete user row
 *
 * All other event types are acknowledged with 200 but not processed.
 * Signature verification uses CLERK_WEBHOOK_SECRET; missing secret → 503.
 */
export async function handleClerkWebhook(request, env) {
	if (request.method !== 'POST') {
		return Response.json({ error: 'Method not allowed' }, { status: 405 });
	}

	if (!env.CLERK_WEBHOOK_SECRET) {
		console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET is not configured');
		return Response.json({ error: 'Webhook signing secret is not configured' }, { status: 503 });
	}

	let evt;
	try {
		evt = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SECRET });
	} catch (err) {
		console.error('[clerk-webhook] signature verification failed:', err instanceof Error ? err.message : String(err));
		return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
	}

	const eventType = evt?.type;
	const userId = evt?.data?.id;

	switch (eventType) {
		case 'user.updated':
			console.info('[clerk-webhook] user.updated', { userId });
			await upsertUserFromPayload(env, evt.data);
			break;
		case 'user.deleted':
			console.info('[clerk-webhook] user.deleted', { userId });
			await softDeleteUser(env, userId);
			break;
		default:
			// Acknowledge unhandled event types without processing.
			console.info('[clerk-webhook] ignored event type:', eventType);
			break;
	}

	return Response.json({ received: true }, { status: 200 });
}
