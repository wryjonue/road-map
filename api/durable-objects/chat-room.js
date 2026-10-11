import { DurableObject } from 'cloudflare:workers';

/**
 * ChatRoom Durable Object.
 *
 * One instance per chat room (keyed by room id via getByName). Accepts
 * WebSocket connections from participants and is intended to broadcast
 * messages to everyone in the room.
 *
 * NOTE: This is scaffolding only. The actual message format, persistence,
 * and broadcast logic are intentionally not implemented yet — only the
 * WebSocket accept/message/close plumbing using the Hibernation API.
 */
export class ChatRoom extends DurableObject {
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

		server.serializeAttachment({ connectedAt: Date.now() });
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws, message) {
		// Placeholder: broadcast the raw message to every other socket in the room
		// so the wiring can be smoke-tested. Real chat handling comes later.
		try {
			const sockets = this.ctx.getWebSockets();
			const payload = typeof message === 'string' ? message : JSON.stringify({ binary: true });
			for (const socket of sockets) {
				if (socket !== ws) socket.send(payload);
			}
		} catch {
			// Ignore send failures on closed sockets.
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
		console.error('[ChatRoom] websocket error:', String(error));
		try {
			ws.close(1011, 'Internal error');
		} catch {
			// Ignore.
		}
	}
}
