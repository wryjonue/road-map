import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './MapView.module.css';

const sampleRoute = {
	start: { lat: 14.676861502666654, lng: 120.54443029694232 },
	end: { lat: 14.681, lng: 120.5505 },
};

export default function MapView() {
	const mapContainer = useRef(null);

	useEffect(() => {
		if (!mapContainer.current) return;

		maplibregl.setWorkerUrl(maplibreWorkerUrl); // THIS LINE IS AI-Generated - I can't explain this. But the entirety of this page only works because of this line.

		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> | <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
			center: [120.5394262, 14.6779294],
			zoom: 13,
		});
		const controller = new AbortController();

		map.once('load', () => {
			const parameters = new URLSearchParams({
				start: `${sampleRoute.start.lat},${sampleRoute.start.lng}`,
				end: `${sampleRoute.end.lat},${sampleRoute.end.lng}`,
			});

			void fetch(`/api/routes/sample?${parameters}`, { signal: controller.signal })
				.then(async (response) => {
					if (!response.ok) throw new Error(`Sample route request failed (${response.status})`);
					return response.json();
				})
				.then((routeData) => {
					if (!routeData.features?.length) throw new Error('No route geometry was returned');

					map.addSource('sample-road-route', { type: 'geojson', data: routeData });
					const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol');
					map.addLayer({
						id: 'sample-road-route-line',
						type: 'line',
						source: 'sample-road-route',
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': '#e14f35', 'line-width': 7, 'line-opacity': 0.9 },
					}, firstSymbolLayer?.id);

					const bounds = new maplibregl.LngLatBounds();
					for (const feature of routeData.features) {
						const geometry = feature.geometry;
						const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.coordinates;
						for (const line of lines ?? []) {
							for (const coordinate of line) bounds.extend(coordinate);
						}
					}
					if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16 });
				})
				.catch((error) => {
					if (error.name !== 'AbortError') console.error('[map] Failed to load sample route', error);
				});
		});

		return () => {
			controller.abort();
			map.remove();
		};
	}, []);

	return (
		<div className={`page-card ${styles.mapCard}`}>
			<div className="section-heading"><h2>Road network map</h2></div>
			<div ref={mapContainer} className={styles.mapCanvas} />
		</div>
	);
}