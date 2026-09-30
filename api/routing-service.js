const SAMPLE_ROUTE_START = '14.676861502666654,120.54443029694232';
const SAMPLE_ROUTE_END = '14.681,120.5505';

export async function getSampleRoute(request, env) {
	const url = new URL(request.url);
	if (url.searchParams.get('start') !== SAMPLE_ROUTE_START || url.searchParams.get('end') !== SAMPLE_ROUTE_END) {
		return Response.json({ error: 'Invalid sample route coordinates' }, { status: 400 });
	}

	if (!env.GEOAPIFY_API_KEY) {
		return Response.json({ error: 'Route service is not configured' }, { status: 503 });
	}

	const cache = caches.default;
	const cachedResponse = await cache.match(request);
	if (cachedResponse) return cachedResponse;

	const routeUrl = new URL('https://api.geoapify.com/v1/routing');
	routeUrl.searchParams.set('waypoints', `${SAMPLE_ROUTE_START}|${SAMPLE_ROUTE_END}`);
	routeUrl.searchParams.set('mode', 'drive');
	routeUrl.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);

	let routeResponse;
	try {
		routeResponse = await fetch(routeUrl);
	} catch {
		return Response.json({ error: 'Unable to fetch sample route' }, { status: 502 });
	}

	if (!routeResponse.ok) {
		return Response.json({ error: 'Route provider rejected the request' }, { status: 502 });
	}

	let routeData;
	try {
		routeData = await routeResponse.json();
	} catch {
		return Response.json({ error: 'Route provider returned invalid data' }, { status: 502 });
	}

	if (routeData.type !== 'FeatureCollection' || !Array.isArray(routeData.features) || routeData.features.length === 0) {
		return Response.json({ error: 'Route provider returned no route' }, { status: 502 });
	}

	const response = Response.json(routeData, {
		headers: { 'Cache-Control': 'public, max-age=3600' },
	});
	await cache.put(request, response.clone());
	return response;
}