
const TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6371000;

export function haversineDistanceMeters(a, b) {
	const dLat = (b[1] - a[1]) * TO_RAD;
	const dLon = (b[0] - a[0]) * TO_RAD;
	const lat1 = a[1] * TO_RAD;
	const lat2 = b[1] * TO_RAD;
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function extractSegments(coordinates) {
	const segments = [];
	for (let i = 0; i < coordinates.length - 1; i++) {
		segments.push([coordinates[i], coordinates[i + 1]]);
	}
	return segments;
}

export function segmentDistance(segA, segB) {
	const d1 = haversineDistanceMeters(segA[0], segB[0]);
	const d2 = haversineDistanceMeters(segA[0], segB[1]);
	const d3 = haversineDistanceMeters(segA[1], segB[0]);
	const d4 = haversineDistanceMeters(segA[1], segB[1]);
	return Math.min(d1, d2, d3, d4);
}

/**
 * DBSCAN over line segments using segment-to-segment distance.
 * @param {Array<[[number,number],[number,number]]>} segments
 * @param {number} eps - max distance in meters
 * @param {number} minPts - minimum segments to form a core
 * @returns {Int32Array} cluster labels (-1 = noise, >0 = cluster id)
 */
export function segmentDbscan(segments, eps, minPts) {
	const n = segments.length;
	const labels = new Int32Array(n);
	let clusterId = 0;

	function regionQuery(idx) {
		const neighbors = [];
		const seg = segments[idx];
		for (let i = 0; i < n; i++) {
			if (segmentDistance(seg, segments[i]) <= eps) {
				neighbors.push(i);
			}
		}
		return neighbors;
	}

	function expandCluster(startIdx, neighbors, id) {
		labels[startIdx] = id;
		const queue = [...neighbors];
		while (queue.length > 0) {
			const q = queue.shift();
			if (labels[q] === -1) {
				labels[q] = id;
			}
			if (labels[q] !== 0) continue;
			labels[q] = id;
			const qNeighbors = regionQuery(q);
			if (qNeighbors.length >= minPts) {
				for (const neighbor of qNeighbors) {
					if (labels[neighbor] === 0 || labels[neighbor] === -1) {
						queue.push(neighbor);
					}
				}
			}
		}
	}

	for (let i = 0; i < n; i++) {
		if (labels[i] !== 0) continue;
		const neighbors = regionQuery(i);
		if (neighbors.length < minPts) {
			labels[i] = -1;
		} else {
			clusterId++;
			expandCluster(i, neighbors, clusterId);
		}
	}

	return labels;
}

/**
 * Compute polyline-based hotspot clusters from reports with route_polyline data.
 * @param {Array<{id:number,status:string,category_id:number,route_polyline:string|null}>} reports
 * @param {number} eps
 * @param {number} minPts
 * @returns {{type:'FeatureCollection',features:Array}}
 */
export function computeHotspots(reports, eps, minPts) {
	if (!reports.length) return { type: 'FeatureCollection', features: [] };

	// Parse polylines and extract segments with back-references to parent reports
	const segments = [];
	const segmentReportIndex = [];
	const parsedPolylines = [];

	for (let i = 0; i < reports.length; i++) {
		const r = reports[i];
		if (!r.route_polyline) continue;
		try {
			const geometry = typeof r.route_polyline === 'string' ? JSON.parse(r.route_polyline) : r.route_polyline;
			if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) continue;
			const coords = geometry.coordinates;
			parsedPolylines.push({ reportIndex: i, coordinates: coords });
			const extracted = extractSegments(coords);
			for (const seg of extracted) {
				segments.push(seg);
				segmentReportIndex.push(i);
			}
		} catch {
			// Invalid polyline JSON; skip this report
		}
	}

	if (segments.length === 0) return { type: 'FeatureCollection', features: [] };

	const labels = segmentDbscan(segments, eps, minPts);

	// Group segments by cluster, collecting unique parent report indices
	const clusterReportSets = new Map();
	for (let s = 0; s < segments.length; s++) {
		const label = labels[s];
		if (label <= 0) continue; // noise
		if (!clusterReportSets.has(label)) clusterReportSets.set(label, new Set());
		clusterReportSets.get(label).add(segmentReportIndex[s]);
	}

	const features = [];
	for (const [, reportIndexSet] of clusterReportSets) {
		const reportIndices = Array.from(reportIndexSet);
		const multiLineCoords = [];
		const statusCounts = {};
		const categoryCounts = {};
		const reportIds = [];
		let midLngSum = 0;
		let midLatSum = 0;
		let midCount = 0;

		for (const ri of reportIndices) {
			const r = reports[ri];
			reportIds.push(r.id);
			statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
			categoryCounts[r.category_id] = (categoryCounts[r.category_id] || 0) + 1;

			// Find the parsed coordinates for this report
			const parsed = parsedPolylines.find((p) => p.reportIndex === ri);
			if (parsed) {
				multiLineCoords.push(parsed.coordinates);
				// Compute midpoint of this polyline for label positioning
				const midIdx = Math.floor(parsed.coordinates.length / 2);
				midLngSum += parsed.coordinates[midIdx][0];
				midLatSum += parsed.coordinates[midIdx][1];
				midCount++;
			}
		}

		const count = reportIndices.length;
		const midpointCoordinates = midCount > 0 ? [midLngSum / midCount, midLatSum / midCount] : null;

		features.push({
			type: 'Feature',
			geometry: { type: 'MultiLineString', coordinates: multiLineCoords },
			properties: {
				count,
				statusCounts,
				categoryCounts,
				reportIds,
				midpointCoordinates,
			},
		});
	}

	return { type: 'FeatureCollection', features };
}
