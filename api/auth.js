import { verifyToken } from '@clerk/backend';

const ROLES = new Set(['user', 'authority', 'admin']);

function unauthorized(message = 'Authentication required') {
	return Response.json({ error: message }, { status: 401 });
}

export function normalizeRole(role) {
	return typeof role === 'string' && ROLES.has(role) ? role : 'user';
}

async function getUser(request, env, allowAnonymous) {
	const authorization = request.headers.get('Authorization');
	const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (authorization === null) {
		if (env.ENVIRONMENT === 'development' && env.ALLOW_LOCAL_MOCK_AUTH === 'true' && request.headers.get('X-Local-Mock-Auth') === 'true') {
			return { userId: 'mock-user-local', role: 'user', isMock: true };
		}
		return allowAnonymous ? null : unauthorized();
	}
	if (!token) return unauthorized('Invalid authentication token');

	if (!env.CLERK_JWT_KEY && !env.CLERK_SECRET_KEY) {
		return Response.json({ error: 'Clerk verification is not configured' }, { status: 503 });
	}
	if (!env.CLERK_AUTHORIZED_PARTIES) {
		return Response.json({ error: 'Clerk authorized parties are not configured' }, { status: 503 });
	}

	try {
		const authorizedParties = env.CLERK_AUTHORIZED_PARTIES
			?.split(',')
			.map((party) => party.trim())
			.filter(Boolean);
		if (!authorizedParties?.length) return Response.json({ error: 'Clerk authorized parties are not configured' }, { status: 503 });
		const claims = await verifyToken(token, {
			jwtKey: env.CLERK_JWT_KEY?.replace(/\\n/g, '\n'),
			secretKey: env.CLERK_SECRET_KEY,
			...(authorizedParties?.length ? { authorizedParties } : {}),
		});
		if (!claims.sub) return unauthorized('Authenticated user ID is missing');
		return { userId: claims.sub, role: normalizeRole(claims.role), claims };
	} catch {
		return unauthorized('Invalid authentication token');
	}
}

export function requireUser(request, env) {
	return getUser(request, env, false);
}

export function getOptionalUser(request, env) {
	return getUser(request, env, true);
}
