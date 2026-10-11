import { DurableObject } from "cloudflare:workers";
//#region api/location-service.js
var BATAAN_BOUNDS = {
	minLongitude: 120.15,
	maxLongitude: 120.75,
	minLatitude: 14.25,
	maxLatitude: 15.05
};
var MAX_SNAP_DISTANCE = 100;
var UPSTREAM_TIMEOUT = 1e4;
var LocationResolutionError = class extends Error {
	constructor(message, status = 502) {
		super(message);
		this.name = "LocationResolutionError";
		this.status = status;
	}
};
function validateCoordinates(latitude, longitude) {
	if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new LocationResolutionError("latitude must be between -90 and 90", 400);
	if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new LocationResolutionError("longitude must be between -180 and 180", 400);
	if (longitude < BATAAN_BOUNDS.minLongitude || longitude > BATAAN_BOUNDS.maxLongitude || latitude < BATAAN_BOUNDS.minLatitude || latitude > BATAAN_BOUNDS.maxLatitude) throw new LocationResolutionError("Coordinates must be inside the Province of Bataan", 400);
}
async function fetchJson(url, options, signal) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
	const abortRequest = () => controller.abort();
	signal?.addEventListener("abort", abortRequest, { once: true });
	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal
		});
		let data;
		try {
			data = await response.json();
		} catch {
			throw new LocationResolutionError("Location provider returned invalid JSON");
		}
		if (!response.ok) throw new LocationResolutionError("Location provider request failed");
		return data;
	} catch (error) {
		if (error instanceof LocationResolutionError) throw error;
		if (error.name === "AbortError") throw new LocationResolutionError("Location provider request timed out", 504);
		throw new LocationResolutionError("Location provider request failed");
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abortRequest);
	}
}
function getMatchedLocation(result) {
	const waypoint = result?.features?.[0]?.properties?.waypoints?.[0];
	const location = waypoint?.location;
	if (!Array.isArray(location) || location.length !== 2 || !location.every(Number.isFinite)) throw new LocationResolutionError("No road match was found", 422);
	if (waypoint.match_type === "unmatched" || !Number.isFinite(waypoint.match_distance) || waypoint.match_distance > MAX_SNAP_DISTANCE) throw new LocationResolutionError("The selected location is more than 100 meters from a road", 422);
	const roadName = result.features[0].properties.legs?.[0]?.steps?.find((step) => typeof step.name === "string" && step.name)?.name || "";
	return {
		longitude: location[0],
		latitude: location[1],
		snapDistance: waypoint.match_distance,
		roadName
	};
}
function getLocationFields(address) {
	return {
		barangay: address.quarter || address.suburb || address.village || address.neighbourhood || "",
		city: address.city || address.town || address.municipality || "",
		province: address.state || address.region || address.county || ""
	};
}
function ensureBataan(address) {
	if (![
		address.state,
		address.region,
		address.county,
		address.province
	].filter(Boolean).join(" ").toLowerCase().includes("bataan")) throw new LocationResolutionError("Reports are currently limited to the Province of Bataan", 422);
}
async function resolveRoadLocation(latitude, longitude, env, signal) {
	validateCoordinates(latitude, longitude);
	if (!env.GEOAPIFY_API_KEY) throw new LocationResolutionError("GEOAPIFY_API_KEY is not configured", 503);
	console.log("[resolve] input lat/lng=", latitude, longitude);
	const matchResult = await fetchJson(`https://api.geoapify.com/v1/mapmatching?apiKey=${encodeURIComponent(env.GEOAPIFY_API_KEY)}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			mode: "drive",
			waypoints: [{ location: [longitude, latitude] }, { location: [longitude, latitude] }]
		})
	}, signal);
	console.log("[resolve] Geoapify mapmatch full GeoJSON=", JSON.stringify(matchResult));
	const snapped = getMatchedLocation(matchResult);
	const addressResult = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({
		format: "json",
		addressdetails: "1",
		lat: String(snapped.latitude),
		lon: String(snapped.longitude)
	})}`, { headers: {
		Accept: "application/json",
		"User-Agent": "RoadMapApp/1.0 (road incident reporting)"
	} }, signal);
	console.log("[resolve] Nominatim reverse-geocode full response=", JSON.stringify(addressResult));
	const address = addressResult?.address;
	if (!address || typeof addressResult.display_name !== "string") throw new LocationResolutionError("No address was found for the matched road", 422);
	ensureBataan(address);
	return {
		...snapped,
		...getLocationFields(address),
		address: addressResult.display_name
	};
}
//#endregion
//#region api/clustering.js
/**
* DBSCAN clustering with haversine distance for geographic coordinates.
* All functions are pure vanilla JS — no external dependencies.
*/
var TO_RAD = Math.PI / 180;
var EARTH_RADIUS_M = 6371e3;
function haversineDistanceMeters(a, b) {
	const dLat = (b[1] - a[1]) * TO_RAD;
	const dLon = (b[0] - a[0]) * TO_RAD;
	const lat1 = a[1] * TO_RAD;
	const lat2 = b[1] * TO_RAD;
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
function dbscan(points, eps, minPts) {
	const n = points.length;
	const labels = new Int32Array(n);
	let clusterId = 0;
	function regionQuery(idx) {
		const neighbors = [];
		const p = points[idx];
		for (let i = 0; i < n; i++) if (haversineDistanceMeters([p.longitude, p.latitude], [points[i].longitude, points[i].latitude]) <= eps) neighbors.push(i);
		return neighbors;
	}
	function expandCluster(startIdx, neighbors, id) {
		labels[startIdx] = id;
		const queue = [...neighbors];
		while (queue.length > 0) {
			const q = queue.shift();
			if (labels[q] === -1) labels[q] = id;
			if (labels[q] !== 0) continue;
			labels[q] = id;
			const qNeighbors = regionQuery(q);
			if (qNeighbors.length >= minPts) {
				for (const neighbor of qNeighbors) if (labels[neighbor] === 0 || labels[neighbor] === -1) queue.push(neighbor);
			}
		}
	}
	for (let i = 0; i < n; i++) {
		if (labels[i] !== 0) continue;
		const neighbors = regionQuery(i);
		if (neighbors.length < minPts) labels[i] = -1;
		else {
			clusterId++;
			expandCluster(i, neighbors, clusterId);
		}
	}
	const clusters = [];
	for (let c = 1; c <= clusterId; c++) {
		const members = [];
		for (let i = 0; i < n; i++) if (labels[i] === c) members.push(i);
		clusters.push(members);
	}
	return clusters;
}
function computeHotspots(reports, eps, minPts) {
	if (!reports.length) return {
		type: "FeatureCollection",
		features: []
	};
	return {
		type: "FeatureCollection",
		features: dbscan(reports, eps, minPts).map((memberIndices) => {
			let sumLat = 0;
			let sumLng = 0;
			const statusCounts = {};
			const categoryCounts = {};
			const reportIds = [];
			for (const idx of memberIndices) {
				const r = reports[idx];
				sumLat += r.latitude;
				sumLng += r.longitude;
				statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
				categoryCounts[r.category_id] = (categoryCounts[r.category_id] || 0) + 1;
				reportIds.push(r.id);
			}
			const count = memberIndices.length;
			const centroidLat = sumLat / count;
			return {
				type: "Feature",
				geometry: {
					type: "Point",
					coordinates: [sumLng / count, centroidLat]
				},
				properties: {
					count,
					centroidLat,
					statusCounts,
					categoryCounts,
					reportIds
				}
			};
		})
	};
}
//#endregion
//#region api/routing-service.js
var SAMPLE_ROUTE_START = "14.676861502666654,120.54443029694232";
var SAMPLE_ROUTE_END = "14.681,120.5505";
var ROUTING_TIMEOUT = 1e4;
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
async function calculateRoute(startLat, startLng, destLat, destLng, signal, env) {
	if (!env?.GEOAPIFY_API_KEY) throw new Error("GEOAPIFY_API_KEY is not configured");
	const routeUrl = new URL("https://api.geoapify.com/v1/routing");
	routeUrl.searchParams.set("waypoints", `${startLat},${startLng}|${destLat},${destLng}`);
	routeUrl.searchParams.set("mode", "drive");
	routeUrl.searchParams.set("apiKey", env.GEOAPIFY_API_KEY);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ROUTING_TIMEOUT);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		console.log("[routing] requesting Geoapify url=", routeUrl.toString().replace(env.GEOAPIFY_API_KEY, "***"));
		const response = await fetch(routeUrl.toString(), { signal: controller.signal });
		const rawText = await response.text();
		console.log("[routing] status=", response.status, "body preview=", rawText.slice(0, 500));
		if (!response.ok) throw new Error("Routing service request failed");
		let data;
		try {
			data = JSON.parse(rawText);
		} catch {
			throw new Error("Routing service returned invalid JSON");
		}
		if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length === 0) throw new Error("No route found between the selected points");
		const geometry = data.features[0].geometry;
		if (!geometry || !Array.isArray(geometry.coordinates)) throw new Error("Routing service returned invalid geometry");
		if (geometry.type === "LineString") return geometry;
		if (geometry.type === "MultiLineString") {
			const merged = geometry.coordinates.flat(1);
			if (!Array.isArray(merged) || merged.length < 2) throw new Error("Routing service returned invalid geometry");
			return {
				type: "LineString",
				coordinates: merged
			};
		}
		throw new Error(`Routing service returned unsupported geometry type: ${geometry.type}`);
	} catch (error) {
		if (error.name === "AbortError") throw new Error("Routing service request timed out");
		throw error;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", onAbort);
	}
}
async function getSampleRoute(request, env) {
	const url = new URL(request.url);
	if (url.searchParams.get("start") !== SAMPLE_ROUTE_START || url.searchParams.get("end") !== SAMPLE_ROUTE_END) return Response.json({ error: "Invalid sample route coordinates" }, { status: 400 });
	const cache = caches.default;
	const cachedResponse = await cache.match(request);
	if (cachedResponse) return cachedResponse;
	const [startLat, startLng] = SAMPLE_ROUTE_START.split(",").map(Number);
	const [destLat, destLng] = SAMPLE_ROUTE_END.split(",").map(Number);
	let geometry;
	try {
		geometry = await calculateRoute(startLat, startLng, destLat, destLng, request.signal, env);
	} catch (error) {
		return Response.json({ error: error.message || "Unable to fetch sample route" }, { status: 502 });
	}
	const featureCollection = {
		type: "FeatureCollection",
		features: [{
			type: "Feature",
			properties: {},
			geometry
		}]
	};
	const response = Response.json(featureCollection, { headers: { "Cache-Control": "public, max-age=3600" } });
	await cache.put(request, response.clone());
	return response;
}
async function getCalculatedRoute(request, env) {
	const url = new URL(request.url);
	const start = url.searchParams.get("start");
	const end = url.searchParams.get("end");
	if (!start || !end) return Response.json({ error: "start and end parameters are required (lat,lng)" }, { status: 400 });
	const [startLat, startLng] = start.split(",").map(Number);
	const [destLat, destLng] = end.split(",").map(Number);
	if (![
		startLat,
		startLng,
		destLat,
		destLng
	].every(Number.isFinite)) return Response.json({ error: "start and end must be valid lat,lng pairs" }, { status: 400 });
	const cache = caches.default;
	const cachedResponse = await cache.match(request);
	if (cachedResponse) return cachedResponse;
	let geometry;
	try {
		geometry = await calculateRoute(startLat, startLng, destLat, destLng, request.signal, env);
	} catch (error) {
		return Response.json({ error: error.message || "Unable to calculate route" }, { status: 502 });
	}
	const response = Response.json(geometry, { headers: { "Cache-Control": "public, max-age=3600" } });
	await cache.put(request, response.clone());
	return response;
}
//#endregion
//#region api/report-service.js
var MAX_PAGE_SIZE = 10;
var MAX_IMAGE_SIZE = 5242880;
var MAX_REQUEST_SIZE = 5505024;
var GEOAPIFY_TIMEOUT = 1e4;
var IMAGE_TYPES = /* @__PURE__ */ new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp"
]);
var MAP_REPORT_STATUSES = /* @__PURE__ */ new Set(["Open", "Resolved"]);
var REPORT_SELECT = `
	SELECT r.id, r.title, r.description, r.author_id, r.author_name, r.author_image_url, r.status,
		r.image_url, r.static_map_url, r.barangay, r.city, r.province, r.resolved_address,
		r.longitude, r.latitude, r.start_longitude, r.start_latitude, r.dest_longitude, r.dest_latitude,
		r.route_polyline, r.vote_count, r.comment_count, r.created_at, r.updated_at,
		r.static_map_r2_key, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
	FROM reports r JOIN categories c ON c.id = r.category_id
`;
function json(data, status = 200) {
	return Response.json(data, {
		status,
		headers: { "Cache-Control": "no-store" }
	});
}
function errorResponse(message, status = 400) {
	return json({ error: message }, status);
}
function mediaUrl(key) {
	return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}
function canManageReports(auth) {
	return auth?.role === "authority" || auth?.role === "admin";
}
function canReadPending(report, auth) {
	return canManageReports(auth) || auth?.userId === report.author_id;
}
function getAuthorName(body, auth) {
	const verifiedName = [auth.claims?.first_name, auth.claims?.last_name].filter((part) => typeof part === "string" && part.trim()).join(" ").trim();
	const suppliedName = typeof body.authorName === "string" ? body.authorName.trim() : "";
	return (verifiedName || suppliedName).slice(0, 160) || null;
}
function getAuthorImageUrl(body, auth) {
	const imageUrl = typeof auth.claims?.picture === "string" ? auth.claims.picture : body.authorImageUrl;
	if (typeof imageUrl !== "string" || !imageUrl.trim() || imageUrl.length > 2048) return null;
	try {
		const url = new URL(imageUrl);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}
function toReport(row, images = []) {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		authorId: row.author_id,
		authorName: row.author_name,
		authorImageUrl: row.author_image_url,
		category: {
			id: row.category_id,
			name: row.category_name,
			slug: row.category_slug
		},
		status: row.status,
		imageUrl: row.image_url ? mediaUrl(row.image_url) : null,
		images: images.filter((image) => image.r2_key).map((image) => ({
			id: image.id,
			url: mediaUrl(image.r2_key),
			fileName: image.file_name,
			contentType: image.content_type
		})),
		staticMapUrl: row.static_map_r2_key ? mediaUrl(row.static_map_r2_key) : row.static_map_url,
		location: {
			barangay: row.barangay,
			city: row.city,
			province: row.province,
			resolvedAddress: row.resolved_address,
			longitude: row.longitude,
			latitude: row.latitude
		},
		startLocation: row.start_longitude != null && row.start_latitude != null ? {
			longitude: row.start_longitude,
			latitude: row.start_latitude
		} : null,
		destLocation: row.dest_longitude != null && row.dest_latitude != null ? {
			longitude: row.dest_longitude,
			latitude: row.dest_latitude
		} : null,
		routePolyline: row.route_polyline || null,
		barangay: row.barangay,
		city: row.city,
		province: row.province,
		resolvedAddress: row.resolved_address,
		longitude: row.longitude,
		latitude: row.latitude,
		voteCount: row.vote_count,
		commentCount: row.comment_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
async function findReport(env, id) {
	const { results } = await env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`).bind(id).all();
	if (!results.length) return null;
	const { results: images } = await env.road_map_db.prepare("SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id").bind(id).all();
	return toReport(results[0], images);
}
function parsePagination(url) {
	const rawLimit = Number(url.searchParams.get("limit") ?? 10);
	const rawOffset = Number(url.searchParams.get("offset") ?? 0);
	if (!Number.isInteger(rawLimit) || rawLimit < 1) return { error: "limit must be a positive integer" };
	if (!Number.isInteger(rawOffset) || rawOffset < 0) return { error: "offset must be a non-negative integer" };
	return {
		limit: Math.min(rawLimit, MAX_PAGE_SIZE),
		offset: rawOffset
	};
}
async function listReports(env, url, auth = null) {
	const pagination = parsePagination(url);
	if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;
	let reportVisibility = "";
	let countVisibility = "";
	let reportBindings = [limit, offset];
	let countBindings = [];
	if (!canManageReports(auth)) if (auth?.userId) {
		reportVisibility = " AND (r.status <> 'Pending' OR r.author_id = ?)";
		countVisibility = " AND (status <> 'Pending' OR author_id = ?)";
		reportBindings = [
			auth.userId,
			limit,
			offset
		];
		countBindings = [auth.userId];
	} else {
		reportVisibility = " AND r.status <> 'Pending'";
		countVisibility = " AND status <> 'Pending'";
	}
	const [{ results }, countResult] = await Promise.all([env.road_map_db.prepare(`${REPORT_SELECT} WHERE r.deleted_at IS NULL${reportVisibility} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).bind(...reportBindings).all(), env.road_map_db.prepare(`SELECT COUNT(*) AS total FROM reports WHERE deleted_at IS NULL${countVisibility}`).bind(...countBindings).all()]);
	const reports = await Promise.all(results.map(async (row) => {
		const { results: images } = await env.road_map_db.prepare("SELECT id, r2_key, file_name, content_type FROM report_images WHERE report_id = ? ORDER BY id").bind(row.id).all();
		return toReport(row, images);
	}));
	const total = countResult.results[0]?.total ?? 0;
	return json({
		reports,
		pagination: {
			limit,
			offset,
			total,
			hasMore: offset + reports.length < total
		}
	});
}
async function getMapReports(env, url) {
	const pagination = parsePagination(url);
	if (pagination.error) return errorResponse(pagination.error);
	const { limit, offset } = pagination;
	const rawCategoryId = url.searchParams.get("categoryId");
	const categoryId = rawCategoryId === null ? null : Number(rawCategoryId);
	if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return errorResponse("categoryId must be a positive integer");
	const status = url.searchParams.get("status");
	if (status !== null && !MAP_REPORT_STATUSES.has(status)) return errorResponse("status must be Open or Resolved");
	let filters = "";
	const filterValues = [];
	if (categoryId !== null) {
		filters += " AND r.category_id = ?";
		filterValues.push(categoryId);
	}
	if (status !== null) {
		filters += " AND r.status = ?";
		filterValues.push(status);
	}
	const mapQuery = `
		SELECT r.id, r.title, r.description, r.author_id, r.author_name, r.author_image_url,
			r.status, r.barangay, r.city, r.province, r.resolved_address,
			r.longitude, r.latitude, r.start_longitude, r.start_latitude, r.dest_longitude, r.dest_latitude,
			r.route_polyline, r.created_at,
			c.id AS category_id, c.name AS category_name, c.slug AS category_slug
		FROM reports r JOIN categories c ON c.id = r.category_id
		WHERE r.deleted_at IS NULL AND r.status IN ('Open', 'Resolved')${filters}
		ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`;
	const countQuery = `SELECT COUNT(*) AS total FROM reports r WHERE r.deleted_at IS NULL AND r.status IN ('Open', 'Resolved')${filters}`;
	const values = [
		...filterValues,
		limit,
		offset
	];
	const [{ results }, countResult] = await Promise.all([env.road_map_db.prepare(mapQuery).bind(...values).all(), env.road_map_db.prepare(countQuery).bind(...filterValues).first()]);
	const reports = results.map((row) => ({
		id: row.id,
		title: row.title,
		description: row.description,
		authorId: row.author_id,
		authorName: row.author_name,
		authorImageUrl: row.author_image_url,
		status: row.status,
		category: {
			id: row.category_id,
			name: row.category_name,
			slug: row.category_slug
		},
		location: {
			barangay: row.barangay,
			city: row.city,
			province: row.province,
			resolvedAddress: row.resolved_address,
			longitude: row.longitude,
			latitude: row.latitude
		},
		startLocation: row.start_longitude != null && row.start_latitude != null ? {
			longitude: row.start_longitude,
			latitude: row.start_latitude
		} : null,
		destLocation: row.dest_longitude != null && row.dest_latitude != null ? {
			longitude: row.dest_longitude,
			latitude: row.dest_latitude
		} : null,
		routePolyline: row.route_polyline || null,
		longitude: row.longitude,
		latitude: row.latitude,
		createdAt: row.created_at
	}));
	const total = countResult?.total ?? 0;
	return json({
		reports,
		pagination: {
			limit,
			offset,
			total,
			hasMore: offset + reports.length < total
		}
	});
}
var MAX_HOTSPOT_POINTS = 2e3;
async function getHotspots(env, url) {
	const rawDays = Number(url.searchParams.get("days") ?? 90);
	const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 365) : 90;
	const rawEps = Number(url.searchParams.get("eps") ?? 300);
	const eps = Number.isFinite(rawEps) && rawEps > 0 ? Math.min(rawEps, 5e3) : 300;
	const rawMinPts = Number(url.searchParams.get("minPts") ?? 3);
	const minPts = Number.isInteger(rawMinPts) && rawMinPts > 0 ? Math.min(rawMinPts, 50) : 3;
	const sinceDate = /* @__PURE__ */ new Date(Date.now() - days * 864e5);
	const since = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`;
	let bboxClause = "";
	const bboxValues = [];
	const rawSwLng = url.searchParams.get("sw_lng");
	const rawSwLat = url.searchParams.get("sw_lat");
	const rawNeLng = url.searchParams.get("ne_lng");
	const rawNeLat = url.searchParams.get("ne_lat");
	const swLng = rawSwLng !== null ? Number(rawSwLng) : NaN;
	const swLat = rawSwLat !== null ? Number(rawSwLat) : NaN;
	const neLng = rawNeLng !== null ? Number(rawNeLng) : NaN;
	const neLat = rawNeLat !== null ? Number(rawNeLat) : NaN;
	if ([
		swLng,
		swLat,
		neLng,
		neLat
	].every(Number.isFinite)) {
		bboxClause = " AND r.longitude >= ? AND r.longitude <= ? AND r.latitude >= ? AND r.latitude <= ?";
		bboxValues.push(swLng, neLng, swLat, neLat);
	}
	const query = `
		SELECT r.id, r.latitude, r.longitude, r.status, r.category_id
		FROM reports r
		WHERE r.deleted_at IS NULL
			AND r.status IN ('Open', 'Resolved')
			AND r.latitude IS NOT NULL
			AND r.longitude IS NOT NULL
			AND r.created_at >= ?${bboxClause}
		ORDER BY r.created_at DESC
		LIMIT ?`;
	const values = [
		since,
		...bboxValues,
		MAX_HOTSPOT_POINTS
	];
	const { results } = await env.road_map_db.prepare(query).bind(...values).all();
	return json(computeHotspots(results, eps, minPts));
}
async function getReport(env, id, status = 200, auth = null) {
	const report = await findReport(env, id);
	if (!report || report.status === "Pending" && !canReadPending({
		status: report.status,
		author_id: report.authorId
	}, auth)) return errorResponse("Report not found", 404);
	return json(report, status);
}
async function approveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse("Insufficient permissions", 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL").bind(id).first();
	if (!report) return errorResponse("Report not found", 404);
	if (report.status !== "Pending") return errorResponse("Only pending reports can be approved", 409);
	if (!(await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL").bind((/* @__PURE__ */ new Date()).toISOString(), id).run()).meta.changes) return errorResponse("Report status changed; reload and try again", 409);
	return getReport(env, id, 200, auth);
}
async function rejectReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse("Insufficient permissions", 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL").bind(id).first();
	if (!report) return errorResponse("Report not found", 404);
	if (report.status !== "Pending") return errorResponse("Only pending reports can be rejected", 409);
	if (!(await env.road_map_db.prepare("UPDATE reports SET status = 'Rejected', updated_at = ? WHERE id = ? AND status = 'Pending' AND deleted_at IS NULL").bind((/* @__PURE__ */ new Date()).toISOString(), id).run()).meta.changes) return errorResponse("Report status changed; reload and try again", 409);
	return getReport(env, id, 200, auth);
}
async function deletePendingReport(env, id, auth) {
	if (!auth?.userId) return errorResponse("Authentication required", 401);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT status, author_id FROM reports WHERE id = ? AND deleted_at IS NULL").bind(id).first();
	if (!report) return errorResponse("Report not found", 404);
	if (!canManageReports(auth) && auth.userId !== report.author_id) return errorResponse("Report not found", 404);
	if (report.status !== "Pending" && report.status !== "Open") return errorResponse("Only pending or open reports can be deleted", 409);
	const deletedAt = (/* @__PURE__ */ new Date()).toISOString();
	const ownershipClause = canManageReports(auth) ? "" : " AND author_id = ?";
	const bindings = canManageReports(auth) ? [
		deletedAt,
		deletedAt,
		id
	] : [
		deletedAt,
		deletedAt,
		id,
		auth.userId
	];
	if (!(await env.road_map_db.prepare(`UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ? AND status IN ('Pending', 'Open') AND deleted_at IS NULL${ownershipClause}`).bind(...bindings).run()).meta.changes) return errorResponse("Report changed; reload and try again", 409);
	return json({
		id,
		deleted: true
	});
}
async function resolveReport(env, id, auth) {
	if (!canManageReports(auth)) return errorResponse("Insufficient permissions", 403);
	if (!Number.isSafeInteger(id) || id < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL").bind(id).first();
	if (!report) return errorResponse("Report not found", 404);
	if (report.status === "Pending") return errorResponse("Pending reports must be approved before resolution", 409);
	if (report.status !== "Resolved") {
		const resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
		if (!(await env.road_map_db.prepare("UPDATE reports SET status = 'Resolved', updated_at = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status NOT IN ('Pending', 'Resolved') AND deleted_at IS NULL").bind(resolvedAt, resolvedAt, auth.userId, id).run()).meta.changes) return errorResponse("Report status changed; reload and try again", 409);
	}
	return getReport(env, id, 200, auth);
}
var VOTABLE_STATUSES = /* @__PURE__ */ new Set(["Open", "Resolved"]);
async function getUserVoteStatus(env, reportId, userId) {
	return !!await env.road_map_db.prepare("SELECT 1 FROM report_votes WHERE report_id = ? AND user_id = ?").bind(reportId, userId).first();
}
async function voteReport(env, reportId, userId) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT status FROM reports WHERE id = ? AND deleted_at IS NULL").bind(reportId).first();
	if (!report) return errorResponse("Report not found", 404);
	if (!VOTABLE_STATUSES.has(report.status)) return errorResponse("Voting is only allowed on Open or Resolved reports", 409);
	if (await env.road_map_db.prepare("SELECT 1 FROM report_votes WHERE report_id = ? AND user_id = ?").bind(reportId, userId).first()) {
		if ((await env.road_map_db.prepare("DELETE FROM report_votes WHERE report_id = ? AND user_id = ?").bind(reportId, userId).run()).meta.changes) await env.road_map_db.prepare("UPDATE reports SET vote_count = vote_count - 1 WHERE id = ?").bind(reportId).run();
		return json({
			voteCount: (await env.road_map_db.prepare("SELECT vote_count FROM reports WHERE id = ?").bind(reportId).first())?.vote_count ?? 0,
			hasVoted: false
		});
	}
	if ((await env.road_map_db.prepare("INSERT INTO report_votes (report_id, user_id) VALUES (?, ?)").bind(reportId, userId).run()).meta.changes) await env.road_map_db.prepare("UPDATE reports SET vote_count = vote_count + 1 WHERE id = ?").bind(reportId).run();
	return json({
		voteCount: (await env.road_map_db.prepare("SELECT vote_count FROM reports WHERE id = ?").bind(reportId).first())?.vote_count ?? 0,
		hasVoted: true
	});
}
async function getVoteStatus(env, reportId, userId) {
	if (!Number.isSafeInteger(reportId) || reportId < 1) return errorResponse("Report not found", 404);
	const report = await env.road_map_db.prepare("SELECT vote_count FROM reports WHERE id = ? AND deleted_at IS NULL").bind(reportId).first();
	if (!report) return errorResponse("Report not found", 404);
	const hasVoted = userId ? await getUserVoteStatus(env, reportId, userId) : false;
	return json({
		voteCount: report.vote_count,
		hasVoted
	});
}
function formValue(form, key, fallback = null) {
	const value = form.get(key);
	return typeof value === "string" ? value : fallback;
}
async function parseBody(request) {
	if (request.headers.get("content-type")?.includes("multipart/form-data")) {
		const form = await request.formData();
		return {
			title: formValue(form, "title", ""),
			description: formValue(form, "description", ""),
			authorId: formValue(form, "authorId", ""),
			authorName: formValue(form, "authorName"),
			authorImageUrl: formValue(form, "authorImageUrl"),
			categoryId: formValue(form, "categoryId"),
			status: formValue(form, "status"),
			imageUrl: null,
			barangay: formValue(form, "barangay"),
			city: formValue(form, "city"),
			province: formValue(form, "province", ""),
			resolvedAddress: formValue(form, "resolvedAddress"),
			longitude: formValue(form, "longitude"),
			latitude: formValue(form, "latitude"),
			startLongitude: formValue(form, "startLongitude"),
			startLatitude: formValue(form, "startLatitude"),
			destLongitude: formValue(form, "destLongitude"),
			destLatitude: formValue(form, "destLatitude"),
			image: form.get("image")
		};
	}
	return {
		...await request.json(),
		image: null
	};
}
function extension(contentType) {
	return {
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/gif": "gif",
		"image/webp": "webp"
	}[contentType] || "bin";
}
async function createStaticMap(env, reportId, longitude, latitude, routeGeometry, startLng, startLat, destLng, destLat) {
	if (!env.GEOAPIFY_API_KEY) throw new Error("GEOAPIFY_API_KEY is not configured");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), GEOAPIFY_TIMEOUT);
	let url;
	if (routeGeometry && Array.isArray(routeGeometry.coordinates) && routeGeometry.coordinates.length > 0) {
		url = `https://maps.geoapify.com/v1/staticmap?style=osm-bright-smooth&width=1000&height=600&marker=${`${`lonlat:${Number(startLng).toFixed(6)},${Number(startLat).toFixed(6)};color:%232d7a5d;size:32`}|${`lonlat:${Number(destLng).toFixed(6)},${Number(destLat).toFixed(6)};color:%23bd3e50;size:32`}`}&fit=auto&apiKey=${encodeURIComponent(env.GEOAPIFY_API_KEY)}`;
		console.log("[static-map] markers-only url length=", url.length);
	} else url = `https://maps.geoapify.com/v1/staticmap?${new URLSearchParams({
		style: "osm-bright-smooth",
		width: "1000",
		height: "600",
		center: `lonlat:${longitude},${latitude}`,
		zoom: "12",
		marker: `lonlat:${longitude},${latitude}`,
		apiKey: env.GEOAPIFY_API_KEY
	})}`;
	let response;
	try {
		response = await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
	if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
		let detail = "";
		try {
			detail = (await response.clone().text()).slice(0, 200);
		} catch {}
		console.error("[static-map] failed status=", response.status, "detail=", detail);
		throw new Error("Geoapify static map generation failed");
	}
	const key = `reports/${reportId}/static-map.png`;
	await env.ROAD_MAP_MEDIA.put(key, await response.arrayBuffer(), { httpMetadata: { contentType: response.headers.get("content-type") } });
	return key;
}
async function createReport(request, env, auth) {
	const contentLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) return errorResponse("Request is too large");
	let body;
	try {
		body = await parseBody(request);
	} catch {
		return errorResponse("Request body must be valid JSON or multipart form data");
	}
	const title = typeof body.title === "string" ? body.title.trim() : "";
	const description = typeof body.description === "string" ? body.description.trim() : "";
	const longitude = Number(body.longitude);
	const latitude = Number(body.latitude);
	const categoryId = Number(body.categoryId);
	const startLongitude = body.startLongitude != null ? Number(body.startLongitude) : null;
	const startLatitude = body.startLatitude != null ? Number(body.startLatitude) : null;
	const destLongitude = body.destLongitude != null ? Number(body.destLongitude) : null;
	const destLatitude = body.destLatitude != null ? Number(body.destLatitude) : null;
	if (!title) return errorResponse("title is required");
	if (!description) return errorResponse("description is required");
	if (title.length > 160) return errorResponse("title must be 160 characters or fewer");
	if (description.length > 5e3) return errorResponse("description must be 5000 characters or fewer");
	if (!Number.isInteger(categoryId) || categoryId < 1) return errorResponse("categoryId must be a positive integer");
	let resolvedLocation;
	try {
		resolvedLocation = await resolveRoadLocation(latitude, longitude, env, request.signal);
	} catch (error) {
		if (error instanceof LocationResolutionError) return errorResponse(error.message, error.status);
		throw error;
	}
	let resolvedStart = null;
	let resolvedDest = null;
	let routePolyline = null;
	if (Number.isFinite(startLongitude) && Number.isFinite(startLatitude) && Number.isFinite(destLongitude) && Number.isFinite(destLatitude)) {
		try {
			resolvedStart = await resolveRoadLocation(startLatitude, startLongitude, env, request.signal);
			resolvedDest = await resolveRoadLocation(destLatitude, destLongitude, env, request.signal);
		} catch (error) {
			if (error instanceof LocationResolutionError) return errorResponse(`Route point: ${error.message}`, error.status);
			throw error;
		}
		try {
			routePolyline = JSON.stringify(await calculateRoute(resolvedStart.latitude, resolvedStart.longitude, resolvedDest.latitude, resolvedDest.longitude, request.signal, env));
		} catch (error) {
			return errorResponse(error.message || "Unable to calculate route between points", 502);
		}
	}
	if (!await env.road_map_db.prepare("SELECT id FROM categories WHERE id = ?").bind(categoryId).first()) return errorResponse("categoryId does not reference an existing category");
	const image = body.image;
	if (image && (typeof image.type !== "string" || !IMAGE_TYPES.has(image.type))) return errorResponse("image must be a JPEG, PNG, GIF, or WebP file");
	if (image && image.size > MAX_IMAGE_SIZE) return errorResponse("image must be 5 MB or smaller");
	let reportId;
	let imageKey;
	let staticMapKey;
	try {
		const authorName = getAuthorName(body, auth);
		const authorImageUrl = getAuthorImageUrl(body, auth);
		reportId = (await env.road_map_db.prepare("INSERT INTO reports (title, description, author_id, author_name, author_image_url, category_id, status, image_url, barangay, city, province, resolved_address, longitude, latitude, start_longitude, start_latitude, dest_longitude, dest_latitude, route_polyline) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(title, description, auth.userId, authorName, authorImageUrl, categoryId, "Pending", resolvedLocation.barangay || null, resolvedLocation.city || null, resolvedLocation.province, resolvedLocation.address, resolvedLocation.longitude, resolvedLocation.latitude, resolvedStart?.longitude ?? null, resolvedStart?.latitude ?? null, resolvedDest?.longitude ?? null, resolvedDest?.latitude ?? null, routePolyline).run()).meta.last_row_id;
		if (image) {
			imageKey = `reports/${reportId}/images/${crypto.randomUUID()}.${extension(image.type)}`;
			await env.ROAD_MAP_MEDIA.put(imageKey, image.stream(), {
				httpMetadata: { contentType: image.type },
				customMetadata: { fileName: image.name || "upload" }
			});
			await env.road_map_db.prepare("INSERT INTO report_images (report_id, image_url, r2_key, content_type, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)").bind(reportId, imageKey, imageKey, image.type, image.name || null, image.size).run();
		}
		const parsedRoute = routePolyline ? JSON.parse(routePolyline) : null;
		staticMapKey = await createStaticMap(env, reportId, longitude, latitude, parsedRoute, resolvedStart?.longitude ?? longitude, resolvedStart?.latitude ?? latitude, resolvedDest?.longitude ?? longitude, resolvedDest?.latitude ?? latitude);
		await env.road_map_db.prepare("UPDATE reports SET static_map_r2_key = ?, static_map_url = ? WHERE id = ?").bind(staticMapKey, mediaUrl(staticMapKey), reportId).run();
		return getReport(env, reportId, 201, auth);
	} catch (error) {
		if (imageKey) await env.ROAD_MAP_MEDIA.delete(imageKey).catch(() => {});
		if (staticMapKey) await env.ROAD_MAP_MEDIA.delete(staticMapKey).catch(() => {});
		if (reportId) await env.road_map_db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId).run().catch(() => {});
		throw error;
	}
}
async function getMedia(request, env, key, auth = null) {
	if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) return errorResponse("Invalid media key", 400);
	const report = await env.road_map_db.prepare("SELECT r.status, r.author_id FROM reports r WHERE r.deleted_at IS NULL AND (r.static_map_r2_key = ? OR r.image_url = ? OR EXISTS (SELECT 1 FROM report_images ri WHERE ri.report_id = r.id AND ri.r2_key = ?)) LIMIT 1").bind(key, key, key).first();
	if (!report || report.status === "Pending" && !canReadPending(report, auth)) return errorResponse("Media not found", 404);
	const object = await env.ROAD_MAP_MEDIA.get(key);
	if (!object) return errorResponse("Media not found", 404);
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Cache-Control", "private, no-store");
	return new Response(object.body, { headers });
}
//#endregion
//#region api/dashboard-service.js
async function getDashboardMetrics(env) {
	const { results } = await env.road_map_db.prepare(`
		SELECT c.id AS category_id, c.name AS category_name,
			COUNT(r.id) AS report_count,
			COALESCE(SUM(CASE WHEN r.status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved_count
		FROM categories c
		LEFT JOIN reports r ON r.category_id = c.id AND r.deleted_at IS NULL
		GROUP BY c.id, c.name
		ORDER BY c.id
	`).all();
	const { results: dailyResults } = await env.road_map_db.prepare(`
		SELECT strftime('%Y-%m-%d', created_at) AS report_day, COUNT(*) AS report_count
		FROM reports
		WHERE deleted_at IS NULL AND status IN ('Open', 'Resolved')
		GROUP BY report_day
		ORDER BY report_day
	`).all();
	const categories = results.map((row) => ({
		id: row.category_id,
		name: row.category_name,
		count: Number(row.report_count) || 0
	}));
	const total = categories.reduce((sum, category) => sum + category.count, 0);
	const resolved = results.reduce((sum, row) => sum + (Number(row.resolved_count) || 0), 0);
	const resolvedPercentage = total ? Math.round(resolved / total * 1e3) / 10 : 0;
	const dailyReports = dailyResults.map((row) => ({
		day: row.report_day,
		count: Number(row.report_count) || 0
	}));
	return Response.json({
		total,
		resolved,
		resolvedPercentage,
		categories,
		dailyReports
	}, { headers: { "Cache-Control": "no-store" } });
}
async function getMonthlyReport(env, month) {
	if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: "Month must be in YYYY-MM format" }, { status: 400 });
	const [year, mon] = month.split("-").map(Number);
	const nextMonth = mon === 12 ? 1 : mon + 1;
	const nextYear = mon === 12 ? year + 1 : year;
	const start = `${month}-01`;
	const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
	const { results: summaryRows } = await env.road_map_db.prepare(`
		SELECT COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END), 0) AS resolved,
			COALESCE(SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END), 0) AS unresolved
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
	`).bind(start, end).all();
	const summary = summaryRows[0] || {
		total: 0,
		resolved: 0,
		unresolved: 0
	};
	const { results: locationRows } = await env.road_map_db.prepare(`
		SELECT COALESCE(NULLIF(city, ''), 'Unknown municipality') AS municipality,
			COUNT(*) AS count
		FROM reports
		WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
		GROUP BY municipality
		ORDER BY count DESC
	`).bind(start, end).all();
	return Response.json({
		month,
		total: Number(summary.total) || 0,
		resolved: Number(summary.resolved) || 0,
		unresolved: Number(summary.unresolved) || 0,
		byMunicipality: locationRows.map((row) => ({
			municipality: row.municipality,
			count: Number(row.count) || 0
		}))
	}, { headers: { "Cache-Control": "no-store" } });
}
//#endregion
//#region node_modules/@clerk/shared/dist/constants.mjs
var DEV_OR_STAGING_SUFFIXES = [
	".lcl.dev",
	".stg.dev",
	".lclstage.dev",
	".stgstage.dev",
	".dev.lclclerk.com",
	".stg.lclclerk.com",
	".accounts.lclclerk.com",
	"accountsstage.dev",
	"accounts.dev"
];
//#endregion
//#region node_modules/@clerk/shared/dist/isomorphicAtob.mjs
/**
* A function that decodes a string of data which has been encoded using base-64 encoding.
* Uses `atob` if available, otherwise uses `Buffer` from `globalThis`. If neither are available, returns the data as-is.
*/
var isomorphicAtob = (data) => {
	if (typeof atob !== "undefined" && typeof atob === "function") return atob(data);
	else if (typeof globalThis.Buffer !== "undefined") return globalThis.Buffer.from(data, "base64").toString();
	return data;
};
//#endregion
//#region node_modules/@clerk/shared/dist/keys.mjs
/**
* Creates a memoized cache for checking if URLs are development or staging environments.
* Uses a Map to cache results for better performance on repeated checks.
*
* @returns An object with an isDevOrStagingUrl method that checks if a URL is dev/staging.
*/
function createDevOrStagingUrlCache() {
	const devOrStagingUrlCache = /* @__PURE__ */ new Map();
	return { 
	/**
	* Checks if a URL is a development or staging environment.
	*
	* @param url - The URL to check (string or URL object).
	* @returns `true` if the URL is a development or staging environment, `false` otherwise.
	*/
isDevOrStagingUrl: (url) => {
		if (!url) return false;
		const hostname = typeof url === "string" ? url : url.hostname;
		let res = devOrStagingUrlCache.get(hostname);
		if (res === void 0) {
			res = DEV_OR_STAGING_SUFFIXES.some((s) => hostname.endsWith(s));
			devOrStagingUrlCache.set(hostname, res);
		}
		return res;
	} };
}
//#endregion
//#region node_modules/@clerk/shared/dist/retry.mjs
var defaultOptions = {
	initialDelay: 125,
	maxDelayBetweenRetries: 0,
	factor: 2,
	shouldRetry: (_, iteration) => iteration < 5,
	retryImmediately: false,
	jitter: true
};
var RETRY_IMMEDIATELY_DELAY = 100;
var sleep = async (ms) => new Promise((s) => setTimeout(s, ms));
var applyJitter = (delay, jitter) => {
	return jitter ? delay * (1 + Math.random()) : delay;
};
var createExponentialDelayAsyncFn = (opts) => {
	let timesCalled = 0;
	const calculateDelayInMs = () => {
		const constant = opts.initialDelay;
		const base = opts.factor;
		let delay = constant * Math.pow(base, timesCalled);
		delay = applyJitter(delay, opts.jitter);
		return Math.min(opts.maxDelayBetweenRetries || delay, delay);
	};
	return async () => {
		await sleep(calculateDelayInMs());
		timesCalled++;
	};
};
/**
* Retries a callback until it succeeds or the shouldRetry function returns false.
* See {@link RetryOptions} for the available options.
*/
var retry = async (callback, options = {}) => {
	let iterations = 0;
	const { shouldRetry, initialDelay, maxDelayBetweenRetries, factor, retryImmediately, jitter, onBeforeRetry } = {
		...defaultOptions,
		...options
	};
	const delay = createExponentialDelayAsyncFn({
		initialDelay,
		maxDelayBetweenRetries,
		factor,
		jitter
	});
	while (true) try {
		return await callback();
	} catch (e) {
		iterations++;
		if (!shouldRetry(e, iterations)) throw e;
		if (onBeforeRetry) await onBeforeRetry(iterations);
		if (retryImmediately && iterations === 1) await sleep(applyJitter(RETRY_IMMEDIATELY_DELAY, jitter));
		else await delay();
	}
};
var ClerkError = class ClerkError extends Error {
	static kind = "ClerkError";
	clerkError = true;
	code;
	longMessage;
	docsUrl;
	cause;
	get name() {
		return this.constructor.name;
	}
	constructor(opts) {
		super(new.target.formatMessage(new.target.kind, opts.message, opts.code, opts.docsUrl), { cause: opts.cause });
		Object.setPrototypeOf(this, ClerkError.prototype);
		this.code = opts.code;
		this.docsUrl = opts.docsUrl;
		this.longMessage = opts.longMessage;
		this.cause = opts.cause;
	}
	toString() {
		return `[${this.name}]\nMessage:${this.message}`;
	}
	static formatMessage(name, msg, code, docsUrl) {
		const prefix = "Clerk:";
		const regex = new RegExp(prefix.replace(" ", "\\s*"), "i");
		msg = msg.replace(regex, "");
		msg = `${prefix} ${msg.trim()}\n\n(code="${code}")\n\n`;
		if (docsUrl) msg += `\n\nDocs: ${docsUrl}`;
		return msg;
	}
};
var DefaultMessages = Object.freeze({
	InvalidProxyUrlErrorMessage: `The proxyUrl passed to Clerk is invalid. The expected value for proxyUrl is an absolute URL or a relative path with a leading '/'. (key={{url}})`,
	InvalidPublishableKeyErrorMessage: `The publishableKey passed to Clerk is invalid (key={{key}}, expected format: pk_test_... or pk_live_...). To create a Clerk application with valid keys, in your terminal run:

npx clerk@latest init

\`npx clerk@latest init\` creates a Clerk application and writes keys to your .env file. No Clerk account or login required and the command is non-interactive.

If you have a Clerk application, run \`npx clerk@latest env pull\` to write the keys (\`--instance prod\` for production keys). Or copy its Publishable key from https://dashboard.clerk.com/last-active?path=api-keys.`,
	MissingPublishableKeyErrorMessage: `Missing publishableKey. To set up Clerk for this project, in your terminal run:

npx clerk@latest init

\`npx clerk@latest init\` creates a Clerk application and writes keys to your .env file. No Clerk account or login required and the command is non-interactive.

If you have a Clerk application, run \`npx clerk@latest env pull\` to write the keys. Or copy them from https://dashboard.clerk.com/last-active?path=api-keys. Deploy a production instance by running \`npx clerk@latest deploy\`, or \`npx clerk@latest env pull --instance prod\` to use an existing one.`,
	MissingSecretKeyErrorMessage: `Missing secretKey. To set up Clerk for this project, in your terminal run:

npx clerk@latest init

\`npx clerk@latest init\` creates a Clerk application and writes keys to your .env file. No Clerk account or login required and the command is non-interactive.

If you have a Clerk application, run \`npx clerk@latest env pull\` to write the keys. Or copy them from https://dashboard.clerk.com/last-active?path=api-keys. Deploy a production instance by running \`npx clerk@latest deploy\`, or \`npx clerk@latest env pull --instance prod\` to use an existing one.`,
	MissingClerkProvider: `{{source}} can only be used within the <ClerkProvider /> component. Learn more: https://clerk.com/docs/components/clerk-provider`
});
/**
* Builds an error thrower.
*
* @internal
*/
function buildErrorThrower({ packageName, customMessages }) {
	let pkg = packageName;
	/**
	* Builds a message from a raw message and replacements.
	*
	* @internal
	*/
	function buildMessage(rawMessage, replacements) {
		if (!replacements) return `${pkg}: ${rawMessage}`;
		let msg = rawMessage;
		const matches = rawMessage.matchAll(/{{([a-zA-Z0-9-_]+)}}/g);
		for (const match of matches) {
			const replacement = (replacements[match[1]] || "").toString();
			msg = msg.replace(`{{${match[1]}}}`, replacement);
		}
		return `${pkg}: ${msg}`;
	}
	const messages = {
		...DefaultMessages,
		...customMessages
	};
	return {
		setPackageName({ packageName }) {
			if (typeof packageName === "string") pkg = packageName;
			return this;
		},
		setMessages({ customMessages }) {
			Object.assign(messages, customMessages || {});
			return this;
		},
		throwInvalidPublishableKeyError(params) {
			throw new Error(buildMessage(messages.InvalidPublishableKeyErrorMessage, params));
		},
		throwInvalidProxyUrl(params) {
			throw new Error(buildMessage(messages.InvalidProxyUrlErrorMessage, params));
		},
		throwMissingPublishableKeyError() {
			throw new Error(buildMessage(messages.MissingPublishableKeyErrorMessage));
		},
		throwMissingSecretKeyError() {
			throw new Error(buildMessage(messages.MissingSecretKeyErrorMessage));
		},
		throwMissingClerkProviderError(params) {
			throw new Error(buildMessage(messages.MissingClerkProvider, params));
		},
		throw(message) {
			throw new Error(buildMessage(message));
		}
	};
}
buildErrorThrower({ packageName: "@clerk/backend" });
var { isDevOrStagingUrl } = createDevOrStagingUrlCache();
//#endregion
//#region node_modules/@clerk/backend/dist/chunk-RZ7A7F6X.mjs
var TokenVerificationErrorCode = { InvalidSecretKey: "clerk_key_invalid" };
var TokenVerificationErrorReason = {
	TokenExpired: "token-expired",
	TokenInvalid: "token-invalid",
	TokenInvalidAlgorithm: "token-invalid-algorithm",
	TokenInvalidAuthorizedParties: "token-invalid-authorized-parties",
	TokenInvalidSignature: "token-invalid-signature",
	TokenNotActiveYet: "token-not-active-yet",
	TokenIatInTheFuture: "token-iat-in-the-future",
	TokenVerificationFailed: "token-verification-failed",
	InvalidSecretKey: "secret-key-invalid",
	LocalJWKMissing: "jwk-local-missing",
	RemoteJWKFailedToLoad: "jwk-remote-failed-to-load",
	RemoteJWKInvalid: "jwk-remote-invalid",
	RemoteJWKMissing: "jwk-remote-missing",
	JWKFailedToResolve: "jwk-failed-to-resolve",
	JWKKidMismatch: "jwk-kid-mismatch"
};
var TokenVerificationErrorAction = {
	ContactSupport: "Contact support@clerk.com",
	EnsureClerkJWT: "Make sure that this is a valid Clerk-generated JWT.",
	SetClerkJWTKey: "Set the CLERK_JWT_KEY environment variable.",
	SetClerkSecretKey: "Set the CLERK_SECRET_KEY environment variable.",
	EnsureClockSync: "Make sure your system clock is in sync (e.g. turn off and on automatic time synchronization)."
};
var TokenVerificationError = class _TokenVerificationError extends Error {
	constructor({ action, message, reason }) {
		super(message);
		Object.setPrototypeOf(this, _TokenVerificationError.prototype);
		this.reason = reason;
		this.message = message;
		this.action = action;
	}
	getFullMessage() {
		return `${[this.message, this.action].filter((m) => m).join(" ")} (reason=${this.reason}, token-carrier=${this.tokenCarrier})`;
	}
};
var _MachineTokenVerificationError = class _MachineTokenVerificationError extends ClerkError {
	constructor({ message, code, status, action }) {
		super({
			message,
			code
		});
		Object.setPrototypeOf(this, _MachineTokenVerificationError.prototype);
		this.status = status;
		this.action = action;
	}
	static formatMessage(_name, msg, _code, _docsUrl) {
		return msg;
	}
	getFullMessage() {
		return `${this.message} (code=${this.code}, status=${this.status || "n/a"})`;
	}
};
_MachineTokenVerificationError.kind = "MachineTokenVerificationError";
//#endregion
//#region node_modules/@clerk/backend/dist/runtime/browser/crypto.mjs
var webcrypto = crypto;
//#endregion
//#region node_modules/@clerk/backend/dist/chunk-QOX5XVDR.mjs
var globalFetch = fetch.bind(globalThis);
var runtime = {
	crypto: webcrypto,
	get fetch() {
		return globalFetch;
	},
	AbortController: globalThis.AbortController,
	Blob: globalThis.Blob,
	FormData: globalThis.FormData,
	Headers: globalThis.Headers,
	Request: globalThis.Request,
	Response: globalThis.Response
};
var base64url = {
	parse(string, opts) {
		return parse(string, base64UrlEncoding, opts);
	},
	stringify(data, opts) {
		return stringify(data, base64UrlEncoding, opts);
	}
};
var base64UrlEncoding = {
	chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
	bits: 6
};
function parse(string, encoding, opts = {}) {
	if (!encoding.codes) {
		encoding.codes = {};
		for (let i = 0; i < encoding.chars.length; ++i) encoding.codes[encoding.chars[i]] = i;
	}
	if (!opts.loose && string.length * encoding.bits & 7) throw new SyntaxError("Invalid padding");
	let end = string.length;
	while (string[end - 1] === "=") {
		--end;
		if (!opts.loose && !((string.length - end) * encoding.bits & 7)) throw new SyntaxError("Invalid padding");
	}
	const out = new (opts.out ?? Uint8Array)(end * encoding.bits / 8 | 0);
	let bits = 0;
	let buffer = 0;
	let written = 0;
	for (let i = 0; i < end; ++i) {
		const value = encoding.codes[string[i]];
		if (value === void 0) throw new SyntaxError("Invalid character " + string[i]);
		buffer = buffer << encoding.bits | value;
		bits += encoding.bits;
		if (bits >= 8) {
			bits -= 8;
			out[written++] = 255 & buffer >> bits;
		}
	}
	if (bits >= encoding.bits || 255 & buffer << 8 - bits) throw new SyntaxError("Unexpected end of data");
	return out;
}
function stringify(data, encoding, opts = {}) {
	const { pad = true } = opts;
	const mask = (1 << encoding.bits) - 1;
	let out = "";
	let bits = 0;
	let buffer = 0;
	for (let i = 0; i < data.length; ++i) {
		buffer = buffer << 8 | 255 & data[i];
		bits += 8;
		while (bits > encoding.bits) {
			bits -= encoding.bits;
			out += encoding.chars[mask & buffer >> bits];
		}
	}
	if (bits) out += encoding.chars[mask & buffer << encoding.bits - bits];
	if (pad) while (out.length * encoding.bits & 7) out += "=";
	return out;
}
var algToHash = {
	RS256: "SHA-256",
	RS384: "SHA-384",
	RS512: "SHA-512"
};
var RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";
var jwksAlgToCryptoAlg = {
	RS256: RSA_ALGORITHM_NAME,
	RS384: RSA_ALGORITHM_NAME,
	RS512: RSA_ALGORITHM_NAME
};
var algs = Object.keys(algToHash);
function getCryptoAlgorithm(algorithmName) {
	const hash = algToHash[algorithmName];
	const name = jwksAlgToCryptoAlg[algorithmName];
	if (!hash || !name) throw new Error(`Unsupported algorithm ${algorithmName}, expected one of ${algs.join(",")}.`);
	return {
		hash: { name: algToHash[algorithmName] },
		name: jwksAlgToCryptoAlg[algorithmName]
	};
}
var isArrayString = (s) => {
	return Array.isArray(s) && s.length > 0 && s.every((a) => typeof a === "string");
};
var assertAudienceClaim = (aud, audience) => {
	const audienceList = [audience].flat().filter((a) => !!a);
	const audList = [aud].flat().filter((a) => !!a);
	if (!(audienceList.length > 0 && audList.length > 0)) return;
	if (typeof aud === "string") {
		if (!audienceList.includes(aud)) throw new TokenVerificationError({
			action: TokenVerificationErrorAction.EnsureClerkJWT,
			reason: TokenVerificationErrorReason.TokenVerificationFailed,
			message: `Invalid JWT audience claim (aud) ${JSON.stringify(aud)}. Is not included in "${JSON.stringify(audienceList)}".`
		});
	} else if (isArrayString(aud)) {
		if (!aud.some((a) => audienceList.includes(a))) throw new TokenVerificationError({
			action: TokenVerificationErrorAction.EnsureClerkJWT,
			reason: TokenVerificationErrorReason.TokenVerificationFailed,
			message: `Invalid JWT audience claim array (aud) ${JSON.stringify(aud)}. Is not included in "${JSON.stringify(audienceList)}".`
		});
	}
};
var assertHeaderType = (typ, allowedTypes) => {
	if (typeof typ === "undefined" && typeof allowedTypes === "undefined") return;
	const expectedTypes = allowedTypes ?? "JWT";
	const allowed = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
	if (!allowed.includes(typ)) throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenInvalid,
		message: `Invalid JWT type ${JSON.stringify(typ)}. Expected "${allowed.join(", ")}".`
	});
};
var assertHeaderAlgorithm = (alg) => {
	if (!algs.includes(alg)) throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenInvalidAlgorithm,
		message: `Invalid JWT algorithm ${JSON.stringify(alg)}. Supported: ${algs}.`
	});
};
var assertSubClaim = (sub) => {
	if (typeof sub !== "string") throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenVerificationFailed,
		message: `Subject claim (sub) is required and must be a string. Received ${JSON.stringify(sub)}.`
	});
};
var assertAuthorizedPartiesClaim = (azp, authorizedParties) => {
	if (!authorizedParties || authorizedParties.length === 0) return;
	if (!azp || !authorizedParties.includes(azp)) throw new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
		message: `Invalid JWT Authorized party claim (azp) ${JSON.stringify(azp)}. Expected "${authorizedParties}".`
	});
};
var assertExpirationClaim = (exp, clockSkewInMs) => {
	if (typeof exp !== "number") throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenVerificationFailed,
		message: `Invalid JWT expiry date claim (exp) ${JSON.stringify(exp)}. Expected number.`
	});
	const currentDate = new Date(Date.now());
	const expiryDate = /* @__PURE__ */ new Date(0);
	expiryDate.setUTCSeconds(exp);
	if (expiryDate.getTime() <= currentDate.getTime() - clockSkewInMs) throw new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenExpired,
		message: `JWT is expired. Expiry date: ${expiryDate.toUTCString()}, Current date: ${currentDate.toUTCString()}.`
	});
};
var assertActivationClaim = (nbf, clockSkewInMs) => {
	if (typeof nbf === "undefined") return;
	if (typeof nbf !== "number") throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenVerificationFailed,
		message: `Invalid JWT not before date claim (nbf) ${JSON.stringify(nbf)}. Expected number.`
	});
	const currentDate = new Date(Date.now());
	const notBeforeDate = /* @__PURE__ */ new Date(0);
	notBeforeDate.setUTCSeconds(nbf);
	if (notBeforeDate.getTime() > currentDate.getTime() + clockSkewInMs) throw new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenNotActiveYet,
		message: `JWT cannot be used prior to not before date claim (nbf). Not before date: ${notBeforeDate.toUTCString()}; Current date: ${currentDate.toUTCString()};`
	});
};
var assertIssuedAtClaim = (iat, clockSkewInMs) => {
	if (typeof iat === "undefined") return;
	if (typeof iat !== "number") throw new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenVerificationFailed,
		message: `Invalid JWT issued at date claim (iat) ${JSON.stringify(iat)}. Expected number.`
	});
	const currentDate = new Date(Date.now());
	const issuedAtDate = /* @__PURE__ */ new Date(0);
	issuedAtDate.setUTCSeconds(iat);
	if (issuedAtDate.getTime() > currentDate.getTime() + clockSkewInMs) throw new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenIatInTheFuture,
		message: `JWT issued at date claim (iat) is in the future. Issued at date: ${issuedAtDate.toUTCString()}; Current date: ${currentDate.toUTCString()};`
	});
};
function pemToBuffer(secret) {
	const decoded = isomorphicAtob(secret.replace(/-----BEGIN.*?-----/g, "").replace(/-----END.*?-----/g, "").replace(/\s/g, ""));
	const buffer = new ArrayBuffer(decoded.length);
	const bufView = new Uint8Array(buffer);
	for (let i = 0, strLen = decoded.length; i < strLen; i++) bufView[i] = decoded.charCodeAt(i);
	return bufView;
}
function importKey(key, algorithm, keyUsage) {
	if (typeof key === "object") return runtime.crypto.subtle.importKey("jwk", key, algorithm, false, [keyUsage]);
	const keyData = pemToBuffer(key);
	const format = keyUsage === "sign" ? "pkcs8" : "spki";
	return runtime.crypto.subtle.importKey(format, keyData, algorithm, false, [keyUsage]);
}
var DEFAULT_CLOCK_SKEW_IN_MS = 5e3;
async function hasValidSignature(jwt, key) {
	const { header, signature, raw } = jwt;
	const data = new TextEncoder().encode([raw.header, raw.payload].join("."));
	const algorithm = getCryptoAlgorithm(header.alg);
	try {
		const cryptoKey = await importKey(key, algorithm, "verify");
		return { data: await runtime.crypto.subtle.verify(algorithm.name, cryptoKey, signature, data) };
	} catch (error) {
		return { errors: [new TokenVerificationError({
			reason: TokenVerificationErrorReason.TokenInvalidSignature,
			message: error?.message
		})] };
	}
}
function decodeJwt(token) {
	const tokenParts = (token || "").toString().split(".");
	if (tokenParts.length !== 3) return { errors: [new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenInvalid,
		message: `Invalid JWT form. A JWT consists of three parts separated by dots.`
	})] };
	const [rawHeader, rawPayload, rawSignature] = tokenParts;
	const decoder = new TextDecoder();
	let header, payload, signature;
	try {
		header = JSON.parse(decoder.decode(base64url.parse(rawHeader, { loose: true })));
		payload = JSON.parse(decoder.decode(base64url.parse(rawPayload, { loose: true })));
		signature = base64url.parse(rawSignature, { loose: true });
	} catch {
		return { errors: [new TokenVerificationError({
			reason: TokenVerificationErrorReason.TokenInvalid,
			message: `Invalid JWT form. The header, payload, or signature could not be decoded.`
		})] };
	}
	return { data: {
		header,
		payload,
		signature,
		raw: {
			header: rawHeader,
			payload: rawPayload,
			signature: rawSignature,
			text: token
		}
	} };
}
async function verifyJwt(token, options) {
	const { audience, authorizedParties, clockSkewInMs, key, headerType } = options;
	const clockSkew = typeof clockSkewInMs === "number" && Number.isFinite(clockSkewInMs) ? clockSkewInMs : DEFAULT_CLOCK_SKEW_IN_MS;
	const { data: decoded, errors } = decodeJwt(token);
	if (errors) return { errors };
	const { header, payload } = decoded;
	try {
		const { typ, alg } = header;
		assertHeaderType(typ, headerType);
		assertHeaderAlgorithm(alg);
	} catch (err) {
		return { errors: [err] };
	}
	const { data: signatureValid, errors: signatureErrors } = await hasValidSignature(decoded, key);
	if (signatureErrors) return { errors: [new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenVerificationFailed,
		message: `Error verifying JWT signature. ${signatureErrors[0]}`
	})] };
	if (!signatureValid) return { errors: [new TokenVerificationError({
		reason: TokenVerificationErrorReason.TokenInvalidSignature,
		message: "JWT signature is invalid."
	})] };
	try {
		const { azp, sub, aud, iat, exp, nbf } = payload;
		assertSubClaim(sub);
		assertAudienceClaim(aud, audience);
		assertAuthorizedPartiesClaim(azp, authorizedParties);
		assertExpirationClaim(exp, clockSkew);
		assertActivationClaim(nbf, clockSkew);
		assertIssuedAtClaim(iat, clockSkew);
	} catch (err) {
		return { errors: [err] };
	}
	return { data: payload };
}
//#endregion
//#region node_modules/@clerk/backend/dist/chunk-TOROEX6P.mjs
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (let key of __getOwnPropNames(from)) if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: () => from[key],
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region node_modules/@clerk/backend/dist/chunk-73GEKEET.mjs
var require_dist = __commonJS({ "../../node_modules/.pnpm/cookie@1.1.1/node_modules/cookie/dist/index.js"(exports) {
	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.parseCookie = parseCookie;
	exports.parse = parseCookie;
	exports.stringifyCookie = stringifyCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	exports.parseSetCookie = parseSetCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	var cookieNameRegExp = /^[\u0021-\u003A\u003C\u003E-\u007E]+$/;
	var cookieValueRegExp = /^[\u0021-\u003A\u003C-\u007E]*$/;
	var domainValueRegExp = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
	var pathValueRegExp = /^[\u0020-\u003A\u003D-\u007E]*$/;
	var maxAgeRegExp = /^-?\d+$/;
	var __toString = Object.prototype.toString;
	var NullObject = /* @__PURE__ */ (() => {
		const C = function() {};
		C.prototype = /* @__PURE__ */ Object.create(null);
		return C;
	})();
	function parseCookie(str, options) {
		const obj = new NullObject();
		const len = str.length;
		if (len < 2) return obj;
		const dec = options?.decode || decode;
		let index = 0;
		do {
			const eqIdx = eqIndex(str, index, len);
			if (eqIdx === -1) break;
			const endIdx = endIndex(str, index, len);
			if (eqIdx > endIdx) {
				index = str.lastIndexOf(";", eqIdx - 1) + 1;
				continue;
			}
			const key = valueSlice(str, index, eqIdx);
			if (obj[key] === void 0) obj[key] = dec(valueSlice(str, eqIdx + 1, endIdx));
			index = endIdx + 1;
		} while (index < len);
		return obj;
	}
	function stringifyCookie(cookie, options) {
		const enc = options?.encode || encodeURIComponent;
		const cookieStrings = [];
		for (const name of Object.keys(cookie)) {
			const val = cookie[name];
			if (val === void 0) continue;
			if (!cookieNameRegExp.test(name)) throw new TypeError(`cookie name is invalid: ${name}`);
			const value = enc(val);
			if (!cookieValueRegExp.test(value)) throw new TypeError(`cookie val is invalid: ${val}`);
			cookieStrings.push(`${name}=${value}`);
		}
		return cookieStrings.join("; ");
	}
	function stringifySetCookie(_name, _val, _opts) {
		const cookie = typeof _name === "object" ? _name : {
			..._opts,
			name: _name,
			value: String(_val)
		};
		const enc = (typeof _val === "object" ? _val : _opts)?.encode || encodeURIComponent;
		if (!cookieNameRegExp.test(cookie.name)) throw new TypeError(`argument name is invalid: ${cookie.name}`);
		const value = cookie.value ? enc(cookie.value) : "";
		if (!cookieValueRegExp.test(value)) throw new TypeError(`argument val is invalid: ${cookie.value}`);
		let str = cookie.name + "=" + value;
		if (cookie.maxAge !== void 0) {
			if (!Number.isInteger(cookie.maxAge)) throw new TypeError(`option maxAge is invalid: ${cookie.maxAge}`);
			str += "; Max-Age=" + cookie.maxAge;
		}
		if (cookie.domain) {
			if (!domainValueRegExp.test(cookie.domain)) throw new TypeError(`option domain is invalid: ${cookie.domain}`);
			str += "; Domain=" + cookie.domain;
		}
		if (cookie.path) {
			if (!pathValueRegExp.test(cookie.path)) throw new TypeError(`option path is invalid: ${cookie.path}`);
			str += "; Path=" + cookie.path;
		}
		if (cookie.expires) {
			if (!isDate(cookie.expires) || !Number.isFinite(cookie.expires.valueOf())) throw new TypeError(`option expires is invalid: ${cookie.expires}`);
			str += "; Expires=" + cookie.expires.toUTCString();
		}
		if (cookie.httpOnly) str += "; HttpOnly";
		if (cookie.secure) str += "; Secure";
		if (cookie.partitioned) str += "; Partitioned";
		if (cookie.priority) switch (typeof cookie.priority === "string" ? cookie.priority.toLowerCase() : void 0) {
			case "low":
				str += "; Priority=Low";
				break;
			case "medium":
				str += "; Priority=Medium";
				break;
			case "high":
				str += "; Priority=High";
				break;
			default: throw new TypeError(`option priority is invalid: ${cookie.priority}`);
		}
		if (cookie.sameSite) switch (typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : cookie.sameSite) {
			case true:
			case "strict":
				str += "; SameSite=Strict";
				break;
			case "lax":
				str += "; SameSite=Lax";
				break;
			case "none":
				str += "; SameSite=None";
				break;
			default: throw new TypeError(`option sameSite is invalid: ${cookie.sameSite}`);
		}
		return str;
	}
	function parseSetCookie(str, options) {
		const dec = options?.decode || decode;
		const len = str.length;
		const endIdx = endIndex(str, 0, len);
		const eqIdx = eqIndex(str, 0, endIdx);
		const setCookie = eqIdx === -1 ? {
			name: "",
			value: dec(valueSlice(str, 0, endIdx))
		} : {
			name: valueSlice(str, 0, eqIdx),
			value: dec(valueSlice(str, eqIdx + 1, endIdx))
		};
		let index = endIdx + 1;
		while (index < len) {
			const endIdx2 = endIndex(str, index, len);
			const eqIdx2 = eqIndex(str, index, endIdx2);
			const attr = eqIdx2 === -1 ? valueSlice(str, index, endIdx2) : valueSlice(str, index, eqIdx2);
			const val = eqIdx2 === -1 ? void 0 : valueSlice(str, eqIdx2 + 1, endIdx2);
			switch (attr.toLowerCase()) {
				case "httponly":
					setCookie.httpOnly = true;
					break;
				case "secure":
					setCookie.secure = true;
					break;
				case "partitioned":
					setCookie.partitioned = true;
					break;
				case "domain":
					setCookie.domain = val;
					break;
				case "path":
					setCookie.path = val;
					break;
				case "max-age":
					if (val && maxAgeRegExp.test(val)) setCookie.maxAge = Number(val);
					break;
				case "expires":
					if (!val) break;
					const date = new Date(val);
					if (Number.isFinite(date.valueOf())) setCookie.expires = date;
					break;
				case "priority":
					if (!val) break;
					const priority = val.toLowerCase();
					if (priority === "low" || priority === "medium" || priority === "high") setCookie.priority = priority;
					break;
				case "samesite":
					if (!val) break;
					const sameSite = val.toLowerCase();
					if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") setCookie.sameSite = sameSite;
			}
			index = endIdx2 + 1;
		}
		return setCookie;
	}
	function endIndex(str, min, len) {
		const index = str.indexOf(";", min);
		return index === -1 ? len : index;
	}
	function eqIndex(str, min, max) {
		const index = str.indexOf("=", min);
		return index < max ? index : -1;
	}
	function valueSlice(str, min, max) {
		let start = min;
		let end = max;
		do {
			const code = str.charCodeAt(start);
			if (code !== 32 && code !== 9) break;
		} while (++start < end);
		while (end > start) {
			const code = str.charCodeAt(end - 1);
			if (code !== 32 && code !== 9) break;
			end--;
		}
		return str.slice(start, end);
	}
	function decode(str) {
		if (str.indexOf("%") === -1) return str;
		try {
			return decodeURIComponent(str);
		} catch (e) {
			return str;
		}
	}
	function isDate(val) {
		return __toString.call(val) === "[object Date]";
	}
} });
var API_URL = "https://api.clerk.com";
var API_VERSION = "v1";
var USER_AGENT = `@clerk/backend@3.17.1`;
var MAX_CACHE_LAST_UPDATED_AT_SECONDS = 300;
var SUPPORTED_BAPI_VERSION = "2026-05-12";
var Cookies = {
	Session: "__session",
	Refresh: "__refresh",
	ClientUat: "__client_uat",
	Handshake: "__clerk_handshake",
	DevBrowser: "__clerk_db_jwt",
	RedirectCount: "__clerk_redirect_count",
	HandshakeNonce: "__clerk_handshake_nonce"
};
Cookies.DevBrowser, Cookies.Handshake, Cookies.HandshakeNonce;
var TokenType = {
	SessionToken: "session_token",
	ApiKey: "api_key",
	M2MToken: "m2m_token",
	OAuthToken: "oauth_token"
};
var SEPARATOR = "/";
var MULTIPLE_SEPARATOR_REGEX = new RegExp("(?<!:)" + SEPARATOR + "{1,}", "g");
var MAX_DECODES = 10;
function isDotSegment(segment) {
	let candidate = segment;
	for (let i = 0; i <= MAX_DECODES; i++) {
		if (candidate.split(/[/\\]/).some((p) => p === "." || p === "..")) return true;
		if (i === MAX_DECODES) throw new Error(`joinPaths: too many layers of encoding in ${segment}`);
		try {
			const next = decodeURIComponent(candidate);
			if (next === candidate) break;
			candidate = next;
		} catch {
			break;
		}
	}
	return false;
}
function joinPaths(...args) {
	const result = args.filter((p) => p).join(SEPARATOR).replace(MULTIPLE_SEPARATOR_REGEX, SEPARATOR);
	for (const segment of result.split(SEPARATOR)) if (isDotSegment(segment)) throw new Error(`joinPaths: "." and ".." path segments are not allowed (received "${result}")`);
	return result;
}
var JWT_CATEGORY_M2M_TOKEN = "cl_B7d4PD333AAA";
var remoteCaches = /* @__PURE__ */ new Map();
function getRemoteCache(scope) {
	let cache = remoteCaches.get(scope);
	if (!cache) {
		for (const [key, entry] of remoteCaches) if (cacheHasExpired(entry)) remoteCaches.delete(key);
		cache = {
			keys: {},
			lastUpdatedAt: 0
		};
		remoteCaches.set(scope, cache);
	}
	return cache;
}
var PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
var PEM_TRAILER = "-----END PUBLIC KEY-----";
var RSA_PREFIX = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";
var RSA_SUFFIX = "IDAQAB";
function loadClerkJwkFromPem(params) {
	const { kid, pem } = params;
	if (!pem) throw new TokenVerificationError({
		action: TokenVerificationErrorAction.SetClerkJWTKey,
		message: "Missing local JWK.",
		reason: TokenVerificationErrorReason.LocalJWKMissing
	});
	const modulus = pem.replace(/\r\n|\n|\r/g, "").replace(PEM_HEADER, "").replace(PEM_TRAILER, "").replace(RSA_PREFIX, "").replace(RSA_SUFFIX, "").replace(/\+/g, "-").replace(/\//g, "_");
	return {
		kid: `local-${kid}`,
		kty: "RSA",
		alg: "RS256",
		n: modulus,
		e: "AQAB"
	};
}
async function loadClerkJWKFromRemote(params) {
	const { secretKey, apiUrl = API_URL, apiVersion = API_VERSION, kid, skipJwksCache } = params;
	const cache = getRemoteCache(`${apiUrl}|${apiVersion}|${secretKey ?? ""}`);
	if (skipJwksCache || cacheHasExpired(cache) || !cache.keys[kid]) {
		if (!secretKey) throw new TokenVerificationError({
			action: TokenVerificationErrorAction.ContactSupport,
			message: "Failed to load JWKS from Clerk Backend or Frontend API.",
			reason: TokenVerificationErrorReason.RemoteJWKFailedToLoad
		});
		const fetcher = () => fetchJWKSFromBAPI(apiUrl, secretKey, apiVersion);
		const { keys } = await retry(fetcher);
		if (!keys || !keys.length) throw new TokenVerificationError({
			action: TokenVerificationErrorAction.ContactSupport,
			message: "The JWKS endpoint did not contain any signing keys. Contact support@clerk.com.",
			reason: TokenVerificationErrorReason.RemoteJWKFailedToLoad
		});
		keys.forEach((key) => {
			cache.keys[key.kid] = key;
		});
		cache.lastUpdatedAt = Date.now();
	}
	const jwk = cache.keys[kid];
	if (!jwk) throw new TokenVerificationError({
		action: `Go to your Dashboard and validate your secret and public keys are correct. ${TokenVerificationErrorAction.ContactSupport} if the issue persists.`,
		message: `Unable to find a signing key in JWKS that matches the kid='${kid}' of the provided session token. Please make sure that the __session cookie or the HTTP authorization header contain a Clerk-generated session JWT.`,
		reason: TokenVerificationErrorReason.JWKKidMismatch
	});
	return jwk;
}
async function fetchJWKSFromBAPI(apiUrl, key, apiVersion) {
	if (!key) throw new TokenVerificationError({
		action: TokenVerificationErrorAction.SetClerkSecretKey,
		message: "Missing Clerk Secret Key or API Key. Go to https://dashboard.clerk.com and get your key for your instance.",
		reason: TokenVerificationErrorReason.RemoteJWKFailedToLoad
	});
	const url = new URL(apiUrl);
	url.pathname = joinPaths(url.pathname, apiVersion, "/jwks");
	const response = await runtime.fetch(url.href, { headers: {
		Authorization: `Bearer ${key}`,
		"Clerk-API-Version": SUPPORTED_BAPI_VERSION,
		"Content-Type": "application/json",
		"User-Agent": USER_AGENT
	} });
	if (!response.ok) {
		const invalidSecretKeyError = getErrorObjectByCode((await response.json())?.errors, TokenVerificationErrorCode.InvalidSecretKey);
		if (invalidSecretKeyError) {
			const reason = TokenVerificationErrorReason.InvalidSecretKey;
			throw new TokenVerificationError({
				action: TokenVerificationErrorAction.ContactSupport,
				message: invalidSecretKeyError.message,
				reason
			});
		}
		throw new TokenVerificationError({
			action: TokenVerificationErrorAction.ContactSupport,
			message: `Error loading Clerk JWKS from ${url.href} with code=${response.status}`,
			reason: TokenVerificationErrorReason.RemoteJWKFailedToLoad
		});
	}
	return response.json();
}
function cacheHasExpired(cache) {
	const isExpired = Date.now() - cache.lastUpdatedAt >= MAX_CACHE_LAST_UPDATED_AT_SECONDS * 1e3;
	if (isExpired) cache.keys = {};
	return isExpired;
}
var getErrorObjectByCode = (errors, code) => {
	if (!errors) return null;
	return errors.find((err) => err.code === code);
};
TokenType.ApiKey, TokenType.M2MToken, TokenType.OAuthToken;
({}).constructor;
__toESM(require_dist());
async function verifyToken(token, options) {
	const { data: decodedResult, errors } = decodeJwt(token);
	if (errors) return { errors };
	const { header } = decodedResult;
	const { kid } = header;
	if (header.cat === JWT_CATEGORY_M2M_TOKEN) return { errors: [new TokenVerificationError({
		action: TokenVerificationErrorAction.EnsureClerkJWT,
		reason: TokenVerificationErrorReason.TokenInvalid,
		message: "Invalid session token category."
	})] };
	try {
		let key;
		if (options.jwtKey) key = loadClerkJwkFromPem({
			kid,
			pem: options.jwtKey
		});
		else if (options.secretKey) key = await loadClerkJWKFromRemote({
			...options,
			kid
		});
		else return { errors: [new TokenVerificationError({
			action: TokenVerificationErrorAction.SetClerkJWTKey,
			message: "Failed to resolve JWK during verification.",
			reason: TokenVerificationErrorReason.JWKFailedToResolve
		})] };
		return await verifyJwt(token, {
			...options,
			key
		});
	} catch (error) {
		return { errors: [error] };
	}
}
//#endregion
//#region node_modules/@clerk/backend/dist/chunk-P263NW7Z.mjs
function withLegacyReturn(cb) {
	return async (...args) => {
		const { data, errors } = await cb(...args);
		if (errors) throw errors[0];
		return data;
	};
}
//#endregion
//#region node_modules/@clerk/backend/dist/index.mjs
var verifyToken2 = withLegacyReturn(verifyToken);
//#endregion
//#region api/auth.js
var ROLES = /* @__PURE__ */ new Set([
	"user",
	"authority",
	"admin"
]);
function unauthorized(message = "Authentication required") {
	return Response.json({ error: message }, { status: 401 });
}
function normalizeRole(role) {
	return typeof role === "string" && ROLES.has(role) ? role : "user";
}
async function getUser(request, env, allowAnonymous) {
	const authorization = request.headers.get("Authorization");
	const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (authorization === null) {
		if (env.ENVIRONMENT === "development" && env.ALLOW_LOCAL_MOCK_AUTH === "true" && request.headers.get("X-Local-Mock-Auth") === "true") return {
			userId: "mock-user-local",
			role: "user",
			isMock: true
		};
		return allowAnonymous ? null : unauthorized();
	}
	if (!token) return unauthorized("Invalid authentication token");
	if (!env.CLERK_JWT_KEY && !env.CLERK_SECRET_KEY) return Response.json({ error: "Clerk verification is not configured" }, { status: 503 });
	if (!env.CLERK_AUTHORIZED_PARTIES) return Response.json({ error: "Clerk authorized parties are not configured" }, { status: 503 });
	try {
		const authorizedParties = env.CLERK_AUTHORIZED_PARTIES?.split(",").map((party) => party.trim()).filter(Boolean);
		if (!authorizedParties?.length) return Response.json({ error: "Clerk authorized parties are not configured" }, { status: 503 });
		const claims = await verifyToken2(token, {
			jwtKey: env.CLERK_JWT_KEY?.replace(/\\n/g, "\n"),
			secretKey: env.CLERK_SECRET_KEY,
			...authorizedParties?.length ? { authorizedParties } : {}
		});
		if (!claims.sub) return unauthorized("Authenticated user ID is missing");
		return {
			userId: claims.sub,
			role: normalizeRole(claims.role),
			claims
		};
	} catch {
		return unauthorized("Invalid authentication token");
	}
}
function requireUser(request, env) {
	return getUser(request, env, false);
}
function getOptionalUser(request, env) {
	return getUser(request, env, true);
}
//#endregion
//#region api/durable-objects/notification-hub.js
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
var NotificationHub = class extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
	}
	async fetch(request) {
		const upgradeHeader = request.headers.get("Upgrade");
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") return Response.json({ error: "Expected WebSocket upgrade" }, { status: 426 });
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		server.serializeAttachment({ connectedAt: Date.now() });
		this.ctx.acceptWebSocket(server);
		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}
	async webSocketMessage(ws, message) {
		try {
			ws.send(JSON.stringify({
				type: "ack",
				received: typeof message === "string" ? message : "[binary]"
			}));
		} catch {}
	}
	async webSocketClose(ws, code, reason) {
		try {
			ws.close(code, reason);
		} catch {}
	}
	async webSocketError(ws, error) {
		console.error("[NotificationHub] websocket error:", String(error));
		try {
			ws.close(1011, "Internal error");
		} catch {}
	}
};
//#endregion
//#region api/durable-objects/chat-room.js
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
var ChatRoom = class extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
	}
	async fetch(request) {
		const upgradeHeader = request.headers.get("Upgrade");
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") return Response.json({ error: "Expected WebSocket upgrade" }, { status: 426 });
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		server.serializeAttachment({ connectedAt: Date.now() });
		this.ctx.acceptWebSocket(server);
		return new Response(null, {
			status: 101,
			webSocket: client
		});
	}
	async webSocketMessage(ws, message) {
		try {
			const sockets = this.ctx.getWebSockets();
			const payload = typeof message === "string" ? message : JSON.stringify({ binary: true });
			for (const socket of sockets) if (socket !== ws) socket.send(payload);
		} catch {}
	}
	async webSocketClose(ws, code, reason) {
		try {
			ws.close(code, reason);
		} catch {}
	}
	async webSocketError(ws, error) {
		console.error("[ChatRoom] websocket error:", String(error));
		try {
			ws.close(1011, "Internal error");
		} catch {}
	}
};
//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = { async fetch(request, env) {
	const url = new URL(request.url);
	try {
		if (url.pathname === "/ws/notifications") {
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			return env.NOTIFICATION_HUB.getByName(`user:${auth.userId}`).fetch(request);
		}
		const chatMatch = url.pathname.match(/^\/ws\/chat\/([^/]+)$/);
		if (chatMatch) {
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			const roomId = decodeURIComponent(chatMatch[1]);
			return env.CHAT_ROOM.getByName(`room:${roomId}`).fetch(request);
		}
		if (url.pathname === "/api/location/resolve") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			const location = await resolveRoadLocation(Number(url.searchParams.get("latitude")), Number(url.searchParams.get("longitude")), env, request.signal);
			return Response.json(location, { headers: { "Cache-Control": "no-store" } });
		}
		if (url.pathname === "/api/routes/sample") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			return getSampleRoute(request, env);
		}
		if (url.pathname === "/api/routes/calculate") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getCalculatedRoute(request, env);
		}
		if (url.pathname === "/api/dashboard/metrics") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getDashboardMetrics(env);
		}
		if (url.pathname === "/api/dashboard/monthly-report") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			const month = url.searchParams.get("month");
			if (!month) return Response.json({ error: "Month parameter is required (YYYY-MM)" }, { status: 400 });
			return getMonthlyReport(env, month);
		}
		if (url.pathname === "/api/map/reports") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getMapReports(env, url);
		}
		if (url.pathname === "/api/hotspots") {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getHotspots(env, url);
		}
		const statusMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/status$/);
		if (statusMatch) {
			if (request.method !== "PATCH") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			if (auth.role !== "authority" && auth.role !== "admin") return Response.json({ error: "Insufficient permissions" }, { status: 403 });
			let body;
			try {
				body = await request.json();
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}
			if (body?.status === "Open") return approveReport(env, Number(statusMatch[1]), auth);
			if (body?.status === "Rejected") return rejectReport(env, Number(statusMatch[1]), auth);
			if (body?.status === "Resolved") return resolveReport(env, Number(statusMatch[1]), auth);
			return Response.json({ error: "Only Open, Rejected, and Resolved statuses are supported" }, { status: 400 });
		}
		const deleteMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
		if (deleteMatch && request.method === "DELETE") {
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			return deletePendingReport(env, Number(deleteMatch[1]), auth);
		}
		const voteMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/vote$/);
		if (voteMatch && request.method === "POST") {
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			return voteReport(env, Number(voteMatch[1]), auth.userId);
		}
		const voteStatusMatch = url.pathname.match(/^\/api\/reports\/(\d+)\/vote$/);
		if (voteStatusMatch && request.method === "GET") {
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getVoteStatus(env, Number(voteStatusMatch[1]), auth?.userId ?? null);
		}
		const mediaMatch = url.pathname.match(/^\/api\/media\/(.+)$/);
		if (mediaMatch) {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getMedia(request, env, decodeURIComponent(mediaMatch[1]), auth);
		}
		const reportMatch = url.pathname.match(/^\/api\/reports\/?(\d+)?$/);
		if (!reportMatch) return Response.json({ error: "Route not found" }, { status: 404 });
		if (reportMatch[1]) {
			if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return getReport(env, Number(reportMatch[1]), 200, auth);
		}
		if (request.method === "GET") {
			const auth = await getOptionalUser(request, env);
			if (auth instanceof Response) return auth;
			return listReports(env, url, auth);
		}
		if (request.method === "POST") {
			const auth = await requireUser(request, env);
			if (auth instanceof Response) return auth;
			return createReport(request, env, auth);
		}
		return Response.json({ error: "Method not allowed" }, { status: 405 });
	} catch (error) {
		if (error instanceof LocationResolutionError) return Response.json({ error: error.message }, { status: error.status });
		console.error(error);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
} };
//#endregion
export { ChatRoom, NotificationHub, worker_entry_default as default };
