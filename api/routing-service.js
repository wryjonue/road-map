const SAMPLE_ROUTE_START = '14.676861502666654,120.54443029694232';
const SAMPLE_ROUTE_END = '14.681,120.5505';
const ROUTING_TIMEOUT = 10000;

/**
 * Calculate a driving route between two points using the Geoapify Routing API.
 * Returns a GeoJSON LineString geometry.
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} destLat
 * @param {number} destLng
 * @param {AbortSignal} [signal]
 * @param {{ GEOAPIFY_API_KEY?: string }} [env]
 * @returns {Promise<{ type: 'LineString', coordinates: number[][] }>}
 */
export async function calculateRoute(startLat, startLng, destLat, destLng, signal, env) {
	if (!env?.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');
	const routeUrl = new URL('https://api.geoapify.com/v1/routing');
	routeUrl.searchParams.set('waypoints', `${startLat},${startLng}|${destLat},${destLng}`);
	routeUrl.searchParams.set('mode', 'drive');
	routeUrl.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ROUTING_TIMEOUT);
	const onAbort = () => controller.abort();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		console.log('[routing] requesting Geoapify url=', routeUrl.toString().replace(env.GEOAPIFY_API_KEY, '***'));
		const response = await fetch(routeUrl.toString(), { signal: controller.signal });
		const rawText = await response.text();
		console.log('[routing] status=', response.status, 'body preview=', rawText.slice(0, 500));
		if (!response.ok) throw new Error('Routing service request failed');
		let data;
		try { data = JSON.parse(rawText); } catch { throw new Error('Routing service returned invalid JSON'); }
		if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length === 0) {
			throw new Error('No route found between the selected points');
		}
		const geometry = data.features[0].geometry;
		if (!geometry || !Array.isArray(geometry.coordinates)) {
			throw new Error('Routing service returned invalid geometry');
		}
		if (geometry.type === 'LineString') {
			return geometry;
		}
		// Geoapify may return a MultiLineString for routes with disconnected segments.
		// Merge all line segments into a single LineString for rendering.
		if (geometry.type === 'MultiLineString') {
			const merged = geometry.coordinates.flat(1);
			if (!Array.isArray(merged) || merged.length < 2) {
				throw new Error('Routing service returned invalid geometry');
			}
			return { type: 'LineString', coordinates: merged };
		}
		throw new Error(`Routing service returned unsupported geometry type: ${geometry.type}`);
	} catch (error) {
		if (error.name === 'AbortError') throw new Error('Routing service request timed out');
		throw error;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', onAbort);
	}
}

export async function getSampleRoute(request, env) {
	const url = new URL(request.url);
	if (url.searchParams.get('start') !== SAMPLE_ROUTE_START || url.searchParams.get('end') !== SAMPLE_ROUTE_END) {
		return Response.json({ error: 'Invalid sample route coordinates' }, { status: 400 });
	}

	const cache = caches.default;
	const cachedResponse = await cache.match(request);
	if (cachedResponse) return cachedResponse;

	const [startLat, startLng] = SAMPLE_ROUTE_START.split(',').map(Number);
	const [destLat, destLng] = SAMPLE_ROUTE_END.split(',').map(Number);

	let geometry;
	try {
		geometry = await calculateRoute(startLat, startLng, destLat, destLng, request.signal, env);
	} catch (error) {
		return Response.json({ error: error.message || 'Unable to fetch sample route' }, { status: 502 });
	}

	const featureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
	const response = Response.json(featureCollection, {
		headers: { 'Cache-Control': 'public, max-age=3600' },
	});
	await cache.put(request, response.clone());
	return response;
}

export async function getCalculatedRoute(request, env) {
	const url = new URL(request.url);
	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');
	if (!start || !end) return Response.json({ error: 'start and end parameters are required (lat,lng)' }, { status: 400 });
	const [startLat, startLng] = start.split(',').map(Number);
	const [destLat, destLng] = end.split(',').map(Number);
	if (![startLat, startLng, destLat, destLng].every(Number.isFinite)) {
		return Response.json({ error: 'start and end must be valid lat,lng pairs' }, { status: 400 });
	}

	const cache = caches.default;
	const cachedResponse = await cache.match(request);
	if (cachedResponse) return cachedResponse;

	let geometry;
	try {
		geometry = await calculateRoute(startLat, startLng, destLat, destLng, request.signal, env);
	} catch (error) {
		return Response.json({ error: error.message || 'Unable to calculate route' }, { status: 502 });
	}

	const response = Response.json(geometry, {
		headers: { 'Cache-Control': 'public, max-age=3600' },
	});
	await cache.put(request, response.clone());
	return response;
}