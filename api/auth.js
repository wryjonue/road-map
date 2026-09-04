import { verifyToken } from '@clerk/backend';

function unauthorized(message = 'Authentication required') {
	return Response.json({ error: message }, { status: 401 });
}

export async function requireUser(request, env) {
	const authorization = request.headers.get('Authorization');
	const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) {
		if (env.ENVIRONMENT === 'development' && env.ALLOW_LOCAL_MOCK_AUTH === 'true' && request.headers.get('X-Local-Mock-Auth') === 'true') {
			return { userId: 'mock-user-local', isMock: true };
		}
		return unauthorized();
	}

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
		return { userId: claims.sub, claims };
	} catch {
		return unauthorized('Invalid authentication token');
	}
}
