import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import categories from '../data/categories';
import styles from './MapView.module.css';

const SOURCE_ID = 'road-reports';
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
		features: reports.map((report) => ({
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
	const selectedReport = reports.find((report) => report.id === selectedReportId) || null;

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
			for (const layer of ['report-clusters', 'report-points']) {
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
		mapRef.current?.setFilter('report-selection', [
			'all',
			['!', ['has', 'point_count']],
			['==', ['get', 'reportId'], selectedReportId ?? -1],
		]);
	}, [isMapLoaded, selectedReportId]);

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
				{isLoading && <div className={styles.mapStatus} role="status">Loading report locations...</div>}
				{!isLoading && !error && reports.length === 0 && <div className={styles.mapStatus} role="status">No matching report locations.</div>}
			</div>
		</section>
	);
}