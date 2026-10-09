import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import categories from '../data/categories';
import ProximityAlerts from '../components/ProximityAlerts';
import { haversineDistanceMeters } from '../utils/geo';
import styles from './MapView.module.css';

const SOURCE_ID = 'road-reports';
const HOTSPOT_SOURCE_ID = 'hotspots';
const CATEGORY_COLORS = {
	1: '#c65d2e',
	2: '#bd3e50',
	3: '#8b6aad',
	4: '#27829a',
	5: '#607d35',
	6: '#c28a22',
	7: '#376fa3',
	8: '#aa4776',
	9: '#5f6972',
};
const STATUS_COLORS = { Open: '#2d7a5d', Resolved: '#626b73' };

function createFeatureCollection(reports, colorMode) {
	return {
		type: 'FeatureCollection',
		// Omit reports that have a route polyline — they render as lines instead of dots.
		features: reports
			.filter((report) => !report.routePolyline)
			.map((report) => ({
				type: 'Feature',
				properties: {
					reportId: report.id,
					categoryId: report.category.id,
					pinColor: colorMode === 'status' ? STATUS_COLORS[report.status] : CATEGORY_COLORS[report.category.id],
				},
				geometry: {
					type: 'Point',
					coordinates: [report.location.longitude, report.location.latitude],
				},
			})),
	};
}

function createRouteFeatureCollection(reports, colorMode) {
	return {
		type: 'FeatureCollection',
		features: reports
			.filter((report) => report.routePolyline)
			.map((report) => {
				try {
					const lineColor = colorMode === 'status'
						? (STATUS_COLORS[report.status] || '#0066ff')
						: (CATEGORY_COLORS[report.category?.id] || '#0066ff');
					return {
						type: 'Feature',
						properties: { reportId: report.id, categoryId: report.category?.id, status: report.status, lineColor },
						geometry: JSON.parse(report.routePolyline),
					};
				} catch {
					return null;
				}
			})
			.filter(Boolean),
	};
}

export default function MapView() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const mapContainer = useRef(null);
	const mapRef = useRef(null);
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [reports, setReports] = useState([]);
	const [categoryFilter, setCategoryFilter] = useState('all');
	const [statusFilter, setStatusFilter] = useState('all');
	const [colorMode, setColorMode] = useState('category');
	const [selectedReportId, setSelectedReportId] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState('');
	const [userLocation, setUserLocation] = useState(null);
	const [locationError, setLocationError] = useState('');
	const [autoCenter, setAutoCenter] = useState(true);
	const [hasInitialFix, setHasInitialFix] = useState(false);
	const [proximityThreshold, setProximityThreshold] = useState(300);
	const [showHotspots, setShowHotspots] = useState(true);
	const [hotspots, setHotspots] = useState({ type: 'FeatureCollection', features: [] });
	const selectedReport = reports.find((report) => report.id === selectedReportId) || null;

	const { nearbyReports, referenceLabel } = useMemo(() => {
		const refCoords = userLocation || [120.5394262, 14.6779294];
		const label = userLocation ? 'Distance from your current location' : 'Distance from map center (location unavailable)';
		const nearby = reports
			.filter((report) => report.status === 'Open')
			.map((report) => ({
				...report,
				distanceMeters: haversineDistanceMeters(refCoords, [report.location.longitude, report.location.latitude]),
			}))
			.filter((report) => report.distanceMeters <= proximityThreshold)
			.sort((a, b) => a.distanceMeters - b.distanceMeters);
		return { nearbyReports: nearby, referenceLabel: label };
	}, [reports, userLocation, proximityThreshold]);

	useEffect(() => {
		if (!isLoaded) return undefined;
		const controller = new AbortController();
		const loadReports = async () => {
			setIsLoading(true);
			setError('');
			setReports([]);
			setSelectedReportId(null);
			try {
				const token = isSignedIn ? await getToken() : null;
				const allReports = [];
				let offset = 0;
				let hasMore = true;
				while (hasMore) {
					const params = new URLSearchParams({ limit: '10', offset: String(offset) });
					if (categoryFilter !== 'all') params.set('categoryId', categoryFilter);
					if (statusFilter !== 'all') params.set('status', statusFilter);
					const response = await fetch(`/api/map/reports?${params}`, {
						headers: token ? { Authorization: `Bearer ${token}` } : {},
						signal: controller.signal,
					});
					const data = await response.json();
					if (!response.ok) throw new Error(data.error || 'Unable to load map reports');
					allReports.push(...data.reports);
					offset += data.pagination.limit;
					hasMore = data.pagination.hasMore;
				}
				if (!controller.signal.aborted) setReports(allReports);
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load map reports');
			} finally {
				if (!controller.signal.aborted) setIsLoading(false);
			}
		};
		void loadReports();
		return () => controller.abort();
	}, [categoryFilter, getToken, isLoaded, isSignedIn, statusFilter]);

	useEffect(() => {
		if (!isLoaded || !showHotspots) return undefined;
		const controller = new AbortController();
		const loadHotspots = async () => {
			try {
				const token = isSignedIn ? await getToken() : null;
				const response = await fetch('/api/hotspots?days=90&eps=300&minPts=3', {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Unable to load hotspots');
				if (!controller.signal.aborted) setHotspots(data);
			} catch (loadError) {
				if (loadError.name !== 'AbortError') console.error('Hotspot load failed:', loadError.message);
			}
		};
		void loadHotspots();
		return () => controller.abort();
	}, [getToken, isLoaded, isSignedIn, showHotspots]);

	useEffect(() => {
		if (!mapContainer.current) return undefined;
		maplibregl.setWorkerUrl(maplibreWorkerUrl);
		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
			center: [120.5394262, 14.6779294],
			zoom: 11,
		});
		mapRef.current = map;

		map.once('load', () => {
			map.addSource('route-lines', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			map.addLayer({
				id: 'route-paths',
				type: 'line',
				source: 'route-lines',
				paint: {
					'line-color': ['get', 'lineColor'],
					'line-width': 6,
					'line-opacity': 0.85,
				},
			});
			map.addSource(SOURCE_ID, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
				cluster: true,
				clusterMaxZoom: 14,
				clusterRadius: 42,
			});
			map.addLayer({
				id: 'report-clusters',
				type: 'circle',
				source: SOURCE_ID,
				filter: ['has', 'point_count'],
				paint: {
					'circle-color': '#344b53',
					'circle-radius': ['step', ['get', 'point_count'], 17, 20, 21, 60, 25],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2,
				},
			});
			map.addLayer({
				id: 'report-cluster-count',
				type: 'symbol',
				source: SOURCE_ID,
				filter: ['has', 'point_count'],
				layout: {
					'text-field': ['get', 'point_count_abbreviated'],
					'text-size': 12,
					'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
				},
				paint: { 'text-color': '#ffffff' },
			});
			map.addLayer({
				id: 'report-points',
				type: 'circle',
				source: SOURCE_ID,
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-color': ['get', 'pinColor'],
					'circle-radius': 8,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2,
				},
			});
			map.addLayer({
				id: 'report-selection',
				type: 'circle',
				source: SOURCE_ID,
				filter: ['==', ['get', 'reportId'], -1],
				paint: {
					'circle-color': 'rgba(255,255,255,0.01)',
					'circle-radius': 12,
					'circle-stroke-color': '#171717',
					'circle-stroke-width': 3,
				},
			});

			map.addSource(HOTSPOT_SOURCE_ID, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			map.addLayer({
				id: 'hotspot-circles',
				type: 'circle',
				source: HOTSPOT_SOURCE_ID,
				paint: {
					'circle-color': '#e74c3c',
					'circle-opacity': 0.35,
					// Radius scales exponentially with zoom to cover ~300m on the ground.
					// Base 2 interpolation matches the Web Mercator 2^zoom scaling.
					// Stops calculated as: (300m * 2^zoom) / (156543 * cos(14.5deg))
					'circle-radius': [
						'interpolate',
						['exponential', 2],
						['zoom'],
						10, 4,
						12, 8,
						14, 32,
						16, 130,
						18, 520,
					],
					'circle-stroke-color': '#e74c3c',
					'circle-stroke-width': 1.5,
					'circle-stroke-opacity': 0.6,
				},
			});
			map.addLayer({
				id: 'hotspot-labels',
				type: 'symbol',
				source: HOTSPOT_SOURCE_ID,
				layout: {
					'text-field': ['concat', ['get', 'count'], ' incidents'],
					'text-size': 11,
					'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
					'text-offset': [0, 1.8],
					'text-anchor': 'top',
				},
				paint: {
					'text-color': '#c0392b',
					'text-halo-color': '#ffffff',
					'text-halo-width': 1.5,
				},
			});

			map.on('click', 'hotspot-circles', (event) => {
				const feature = event.features?.[0];
				if (!feature) return;
				const coords = feature.geometry.coordinates;
				map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 14), duration: 600 });
			});
			map.on('mouseenter', 'hotspot-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
			map.on('mouseleave', 'hotspot-circles', () => { map.getCanvas().style.cursor = ''; });

			map.addSource('user-location', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});
			map.addLayer({
				id: 'user-location-pulse',
				type: 'circle',
				source: 'user-location',
				paint: {
					'circle-color': 'rgba(59, 130, 246, 0.25)',
					'circle-radius': 18,
					'circle-stroke-color': 'rgba(59, 130, 246, 0.4)',
					'circle-stroke-width': 2,
				},
			});
			map.addLayer({
				id: 'user-location-dot',
				type: 'circle',
				source: 'user-location',
				paint: {
					'circle-color': '#3b82f6',
					'circle-radius': 7,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2.5,
				},
			});

			map.on('click', 'report-clusters', async (event) => {
				const feature = event.features?.[0];
				const clusterId = feature?.properties?.cluster_id;
				const source = map.getSource(SOURCE_ID);
				if (clusterId === undefined || !source) return;
				try {
					const zoom = await source.getClusterExpansionZoom(Number(clusterId));
					const coordinates = feature.geometry.coordinates;
					map.easeTo({ center: coordinates, zoom });
				} catch {
					setError('Unable to expand this group of map pins.');
				}
			});
			map.on('click', 'report-points', (event) => {
				const reportId = Number(event.features?.[0]?.properties?.reportId);
				if (Number.isSafeInteger(reportId)) setSelectedReportId(reportId);
			});
			map.on('click', 'route-paths', (event) => {
				const reportId = Number(event.features?.[0]?.properties?.reportId);
				if (Number.isSafeInteger(reportId)) setSelectedReportId(reportId);
			});
			for (const layer of ['report-clusters', 'report-points', 'route-paths']) {
				map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
				map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
			}
			setIsMapLoaded(true);
		});

		return () => {
			mapRef.current = null;
			map.remove();
			setIsMapLoaded(false);
		};
	}, []);

	useEffect(() => {
		if (!isMapLoaded) return;
		const source = mapRef.current?.getSource(SOURCE_ID);
		if (!source) return;
		void source.setData(createFeatureCollection(reports, colorMode)).catch(() => {
			setError('Unable to render report locations.');
		});
	}, [colorMode, isMapLoaded, reports]);

	useEffect(() => {
		if (!isMapLoaded) return;
		const source = mapRef.current?.getSource('route-lines');
		if (!source) return;
		source.setData(createRouteFeatureCollection(reports, colorMode));
	}, [isMapLoaded, reports, colorMode]);

	useEffect(() => {
		if (!isMapLoaded) return;
		mapRef.current?.setFilter('report-selection', [
			'all',
			['!', ['has', 'point_count']],
			['==', ['get', 'reportId'], selectedReportId ?? -1],
		]);
	}, [isMapLoaded, selectedReportId]);

	useEffect(() => {
		if (!isMapLoaded || !navigator.geolocation) return undefined;
		setLocationError('');
		const watcherId = navigator.geolocation.watchPosition(
			(position) => {
				const coords = [position.coords.longitude, position.coords.latitude];
				setUserLocation(coords);
				setLocationError('');
				if (!hasInitialFix) {
					setHasInitialFix(true);
					if (autoCenter) {
						mapRef.current?.flyTo({ center: coords, zoom: 14, duration: 1500 });
					}
				} else if (autoCenter) {
					mapRef.current?.easeTo({ center: coords, duration: 800 });
				}
			},
			(geoError) => {
				if (geoError.code === geoError.PERMISSION_DENIED) {
					setLocationError('Location permission denied.');
				} else if (geoError.code === geoError.TIMEOUT) {
					setLocationError('Location request timed out.');
				} else {
					setLocationError('Unable to determine your location.');
				}
				setUserLocation(null);
			},
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
		);
		return () => {
			navigator.geolocation.clearWatch(watcherId);
		};
	}, [isMapLoaded, autoCenter, hasInitialFix]);

	useEffect(() => {
		if (!isMapLoaded) return;
		const source = mapRef.current?.getSource('user-location');
		if (!source) return;
		const data = userLocation
			? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: userLocation } }] }
			: { type: 'FeatureCollection', features: [] };
		source.setData(data);
	}, [isMapLoaded, userLocation]);

	useEffect(() => {
		if (!isMapLoaded) return;
		const source = mapRef.current?.getSource(HOTSPOT_SOURCE_ID);
		if (!source) return;
		source.setData(showHotspots ? hotspots : { type: 'FeatureCollection', features: [] });
	}, [isMapLoaded, hotspots, showHotspots]);

	const legendItems = colorMode === 'status'
		? Object.entries(STATUS_COLORS).map(([name, color]) => ({ name, color }))
		: categories.map((category) => ({ name: category.name, color: CATEGORY_COLORS[category.id] }));

	return (
		<section className={`page-card ${styles.mapPage}`}>
			<div className={styles.heading}>
				<div><h1>Road network map</h1></div>
				<span className={styles.resultCount}>{reports.length} reports</span>
			</div>

			<div className={styles.toolbar}>
				<label className={styles.filterControl}>
					<span>Category</span>
					<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
						<option value="all">All Categories</option>
						{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
					</select>
				</label>
				<label className={styles.filterControl}>
					<span>Status</span>
					<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
						<option value="all">All Statuses</option>
						<option value="Open">Open</option>
						<option value="Resolved">Resolved</option>
					</select>
				</label>
				<label className={`${styles.filterControl} ${styles.hotspotToggle}`}>
				<span>Hotspots</span>
				<button
					type="button"
					className={styles.toggleButton}
					aria-pressed={showHotspots}
					onClick={() => setShowHotspots((prev) => !prev)}
				>
					{showHotspots ? 'On' : 'Off'}
				</button>
			</label>
			<fieldset className={styles.colorControl}>
					<legend>Color pins by</legend>
					<div className={styles.segmentedControl} role="group" aria-label="Color pins by">
						<button type="button" aria-pressed={colorMode === 'category'} onClick={() => setColorMode('category')}>Category</button>
						<button type="button" aria-pressed={colorMode === 'status'} onClick={() => setColorMode('status')}>Status</button>
					</div>
				</fieldset>
			</div>

			<div className={styles.legend} aria-label={`Pin colors by ${colorMode}`}>
				{legendItems.map((item) => <span className={styles.legendItem} key={item.name}><i style={{ '--legend-color': item.color }} />{item.name}</span>)}
			</div>

			{error && <p className={styles.error} role="alert">{error}</p>}
			<div className={styles.mapStage}>
				<div ref={mapContainer} className={styles.mapCanvas} aria-label="Map of road incident reports" />
				{selectedReport && <aside className={styles.preview} aria-label="Selected report details">
					<div className={styles.previewHeading}>
						<div><span className={styles.previewCategory}>{selectedReport.category.name}</span><h2>{selectedReport.title}</h2></div>
						<button type="button" className={styles.closePreview} onClick={() => setSelectedReportId(null)} aria-label="Close report preview">×</button>
					</div>
					<div className={styles.previewMeta}><span className={selectedReport.status === 'Open' ? styles.openStatus : styles.resolvedStatus}>{selectedReport.status}</span><span>{selectedReport.authorName || 'Community reporter'}</span></div>
					<p className={styles.previewAddress}>{selectedReport.location.resolvedAddress || [selectedReport.location.barangay, selectedReport.location.city, selectedReport.location.province].filter(Boolean).join(', ')}</p>
					<p className={styles.previewDescription}>{selectedReport.description}</p>
					<small>{new Date(selectedReport.createdAt).toLocaleString()}</small>
				</aside>}
					<button
						type="button"
						className={`${styles.locateButton} ${autoCenter ? styles.locateActive : ''}`}
						onClick={() => {
							if (!userLocation) {
								setAutoCenter(true);
								setHasInitialFix(false);
								return;
							}
							const next = !autoCenter;
							setAutoCenter(next);
							if (next) mapRef.current?.flyTo({ center: userLocation, zoom: 14, duration: 1200 });
						}}
						aria-label={autoCenter ? 'Disable auto-center' : 'Center on my location'}
						title={autoCenter ? 'Auto-centering enabled' : 'Center on my location'}
					>
						⌖
					</button>
					{locationError && <div className={styles.locationStatus} role="alert">{locationError}</div>}
					{!locationError && !userLocation && isMapLoaded && <div className={styles.locationStatus} role="status">Requesting location…</div>}
					{isLoading && <div className={styles.mapStatus} role="status">Loading report locations...</div>}
					{!isLoading && !error && reports.length === 0 && <div className={styles.mapStatus} role="status">No matching report locations.</div>}
			</div>

			<ProximityAlerts
					nearbyReports={nearbyReports}
					threshold={proximityThreshold}
					onThresholdChange={setProximityThreshold}
					referenceLabel={referenceLabel}
			/>
		</section>
	);
}