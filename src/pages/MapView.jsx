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