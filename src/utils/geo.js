/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 * @param {[number, number]} a - [longitude, latitude] in degrees
 * @param {[number, number]} b - [longitude, latitude] in degrees
 * @returns {number} Distance in meters
 */
export function haversineDistanceMeters(a, b) {
	const toRad = (deg) => (deg * Math.PI) / 180;
	const R = 6371000;
	const dLat = toRad(b[1] - a[1]);
	const dLon = toRad(b[0] - a[0]);
	const lat1 = toRad(a[1]);
	const lat2 = toRad(b[1]);
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
	return 2 * R * Math.asin(Math.sqrt(h));
}
