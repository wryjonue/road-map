/**
 * DBSCAN clustering with haversine distance for geographic coordinates.
 * All functions are pure vanilla JS — no external dependencies.
 */

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


export function dbscan(points, eps, minPts) {
	const n = points.length;
	const labels = new Int32Array(n); // 0 = unvisited, -1 = noise, >0 = cluster id
	let clusterId = 0;

	function regionQuery(idx) {
		const neighbors = [];
		const p = points[idx];
		for (let i = 0; i < n; i++) {
			if (haversineDistanceMeters([p.longitude, p.latitude], [points[i].longitude, points[i].latitude]) <= eps) {
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
				labels[q] = id; // Border point: was noise, now part of cluster
			}
			if (labels[q] !== 0) continue; // Already assigned to a cluster
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
			labels[i] = -1; // Noise
		} else {
			clusterId++;
			expandCluster(i, neighbors, clusterId);
		}
	}

	const clusters = [];
	for (let c = 1; c <= clusterId; c++) {
		const members = [];
		for (let i = 0; i < n; i++) {
			if (labels[i] === c) members.push(i);
		}
		clusters.push(members);
	}
	return clusters;
}


export function computeHotspots(reports, eps, minPts) {
	if (!reports.length) return { type: 'FeatureCollection', features: [] };

	const clusters = dbscan(reports, eps, minPts);
	const features = clusters.map((memberIndices) => {
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
		const centroidLng = sumLng / count;

		return {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [centroidLng, centroidLat] },
			properties: {
				count,
				centroidLat,
				statusCounts,
				categoryCounts,
				reportIds,
			},
		};
	});

	return { type: 'FeatureCollection', features };
}
