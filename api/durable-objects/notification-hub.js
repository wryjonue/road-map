import { DurableObject } from 'cloudflare:workers';

/**
 * NotificationHub Durable Object.
 *
 * One instance per user (keyed by user id via getByName). Accepts a single
 * WebSocket per connected client and is intended to fan out real-time
 * notifications to that user's devices.
 *
 * NOTE: This is scaffolding only. The actual notification payload format,
 * persistence, and fan-out logic are intentionally not implemented yet —
 * only the WebSocket accept/message/close plumbing using the Hibernation API.
 */
export class NotificationHub extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
	}

	async fetch(request) {
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return Response.json({ error: 'Expected WebSocket upgrade' }, { status: 426 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Persist minimal attachment so we can identify the connection after hibernation.
		server.serializeAttachment({ connectedAt: Date.now() });
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * RPC method: broadcast a payload to all connected WebSocket clients.
	 * Called by the notification service when a new notification is created
	 * or the unread count changes.
	 */
	async broadcast(payload) {
		const sockets = this.ctx.getWebSockets();
		for (const ws of sockets) {
			try {
				ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
			} catch {
				// Socket may already be closed; ignore.
			}
		}
		return { sent: sockets.length };
	}

	async webSocketMessage(ws, message) {
		// Client messages are currently unused; acknowledge for keep-alive.
		try {
			ws.send(JSON.stringify({ type: 'ack' }));
		} catch {
			// Connection may already be closed; ignore.
		}
	}

	async webSocketClose(ws, code, reason) {
		try {
			ws.close(code, reason);
		} catch {
			// Already closed; ignore.
		}
	}

	async webSocketError(ws, error) {
		console.error('[NotificationHub] websocket error:', String(error));
		try {
			ws.close(1011, 'Internal error');
		} catch {
			// Ignore.
		}
	}
}
