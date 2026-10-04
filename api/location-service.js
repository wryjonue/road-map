const BATAAN_BOUNDS = { minLongitude: 120.15, maxLongitude: 120.75, minLatitude: 14.25, maxLatitude: 15.05 };
const MAX_SNAP_DISTANCE = 100;
const UPSTREAM_TIMEOUT = 10000;

export class LocationResolutionError extends Error {
	constructor(message, status = 502) {
		super(message);
		this.name = 'LocationResolutionError';
		this.status = status;
	}
}

function validateCoordinates(latitude, longitude) {
	if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new LocationResolutionError('latitude must be between -90 and 90', 400);
	if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new LocationResolutionError('longitude must be between -180 and 180', 400);
	if (longitude < BATAAN_BOUNDS.minLongitude || longitude > BATAAN_BOUNDS.maxLongitude || latitude < BATAAN_BOUNDS.minLatitude || latitude > BATAAN_BOUNDS.maxLatitude) {
		throw new LocationResolutionError('Coordinates must be inside the Province of Bataan', 400);
	}
}

async function fetchJson(url, options, signal) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
	const abortRequest = () => controller.abort();
	signal?.addEventListener('abort', abortRequest, { once: true });
	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		let data;
		try { data = await response.json(); } catch { throw new LocationResolutionError('Location provider returned invalid JSON'); }
		if (!response.ok) throw new LocationResolutionError('Location provider request failed');
		return data;
	} catch (error) {
		if (error instanceof LocationResolutionError) throw error;
		if (error.name === 'AbortError') throw new LocationResolutionError('Location provider request timed out', 504);
		throw new LocationResolutionError('Location provider request failed');
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', abortRequest);
	}
}

function getMatchedLocation(result) {
	const waypoint = result?.features?.[0]?.properties?.waypoints?.[0];
	const location = waypoint?.location;
	if (!Array.isArray(location) || location.length !== 2 || !location.every(Number.isFinite)) throw new LocationResolutionError('No road match was found', 422);
	if (waypoint.match_type === 'unmatched' || !Number.isFinite(waypoint.match_distance) || waypoint.match_distance > MAX_SNAP_DISTANCE) {
		throw new LocationResolutionError('The selected location is more than 100 meters from a road', 422);
	}
	const roadName = result.features[0].properties.legs?.[0]?.steps?.find((step) => typeof step.name === 'string' && step.name)?.name || '';
	return { longitude: location[0], latitude: location[1], snapDistance: waypoint.match_distance, roadName };
}

function getLocationFields(address) {
	return {
		barangay: address.quarter || address.suburb || address.village || address.neighbourhood || '',
		city: address.city || address.town || address.municipality || '',
		province: address.state || address.region || address.county || '',
	};
}

function ensureBataan(address) {
	const region = [address.state, address.region, address.county, address.province].filter(Boolean).join(' ').toLowerCase();
	if (!region.includes('bataan')) throw new LocationResolutionError('Reports are currently limited to the Province of Bataan', 422);
}

export async function resolveRoadLocation(latitude, longitude, env, signal) {
	validateCoordinates(latitude, longitude);
	if (!env.GEOAPIFY_API_KEY) throw new LocationResolutionError('GEOAPIFY_API_KEY is not configured', 503);
	const matchResult = await fetchJson(`https://api.geoapify.com/v1/mapmatching?apiKey=${encodeURIComponent(env.GEOAPIFY_API_KEY)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ mode: 'drive', waypoints: [{ location: [longitude, latitude] }, { location: [longitude, latitude] }] }),
	}, signal);
	const snapped = getMatchedLocation(matchResult);
	const params = new URLSearchParams({ format: 'json', addressdetails: '1', lat: String(snapped.latitude), lon: String(snapped.longitude) });
	const addressResult = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
		headers: { Accept: 'application/json', 'User-Agent': 'RoadMapApp/1.0 (road incident reporting)' },
	}, signal);
	const address = addressResult?.address;
	if (!address || typeof addressResult.display_name !== 'string') throw new LocationResolutionError('No address was found for the matched road', 422);
	ensureBataan(address);
	return { ...snapped, ...getLocationFields(address), address: addressResult.display_name };
}