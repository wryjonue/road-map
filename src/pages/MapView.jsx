import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './MapView.module.css';

export default function MapView() {
	const mapContainer = useRef(null);

	useEffect(() => {
		if (!mapContainer.current) return;

		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: {
				version: 8,
				sources: { openstreetmap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors' } },
				layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
			},
			center: [120.5394262, 14.6779294],
			zoom: 13,
		});

		return () => map.remove();
	}, []);

	return (
		<div className={`page-card ${styles.mapCard}`}>
			<div className="section-heading"><h2>Road network map</h2></div>
			<div ref={mapContainer} className={styles.mapCanvas} />
		</div>
	);
}
