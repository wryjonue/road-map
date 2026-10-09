import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import categories from '../data/categories';
import styles from './CreateReportPage.module.css';

const BATAAN_CENTER = [120.5394, 14.6779];
const initialLocation = { barangay: '', city: '', province: '', address: '', roadName: '', snapDistance: null, coordinates: null };

async function readApiResponse(response, fallbackMessage) {
	const contentType = response.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('application/json')) {
		const responseType = contentType.toLowerCase().includes('text/html') ? 'an HTML page' : 'an unexpected response';
		throw new Error(`${fallbackMessage} (${response.status}). The server returned ${responseType} instead of JSON.`);
	}
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || fallbackMessage);
	return data;
}

export default function CreateReportPage() {
	const navigate = useNavigate();
	const mapContainer = useRef(null);
	const mapRef = useRef(null);
	const startMarkerRef = useRef(null);
	const destMarkerRef = useRef(null);
	const routeLineRef = useRef(null);
	const requestController = useRef(null);
	const { getToken } = useAuth();
	const { user } = useUser();
	const [form, setForm] = useState({ title: '', description: '', categoryId: categories[0].id });
	const [startLocation, setStartLocation] = useState(initialLocation);
	const [destLocation, setDestLocation] = useState(initialLocation);
	const [locationError, setLocationError] = useState('');
	const [isResolving, setIsResolving] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [image, setImage] = useState(null);
	const [imagePreview, setImagePreview] = useState('');

	useEffect(() => {
		if (!mapContainer.current) return undefined;

		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: {
				version: 8,
				sources: { openstreetmap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors' } },
				layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
			},
			center: BATAAN_CENTER,
			zoom: 12,
		});
		mapRef.current = map;

		const startMarker = new maplibregl.Marker({ draggable: true, color: '#2d7a5d' }).setLngLat(BATAAN_CENTER).addTo(map);
		startMarkerRef.current = startMarker;
		const destMarker = new maplibregl.Marker({ draggable: true, color: '#bd3e50' }).setLngLat(BATAAN_CENTER).addTo(map);
		destMarkerRef.current = destMarker;

		const resolveMarkerLocation = async (marker, setter) => {
			const { lat, lng } = marker.getLngLat();
			setIsResolving(true);
			setLocationError('');
			setter(initialLocation);
			requestController.current?.abort();
			const controller = new AbortController();
			requestController.current = controller;
			try {
				const params = new URLSearchParams({ latitude: String(lat), longitude: String(lng) });
				const token = await getToken();
				const response = await fetch(`/api/location/resolve?${params}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : { 'X-Local-Mock-Auth': 'true' },
					signal: controller.signal,
				});
				const result = await readApiResponse(response, 'Unable to resolve this location');
				if (controller.signal.aborted || requestController.current !== controller) return;
				marker.setLngLat([result.longitude, result.latitude]);
				setter({ barangay: result.barangay, city: result.city, province: result.province, address: result.address, roadName: result.roadName, snapDistance: result.snapDistance, coordinates: { lat: result.latitude, lng: result.longitude } });
			} catch (error) {
				if (error.name !== 'AbortError') setLocationError(error.message || 'We could not resolve this location. Please try dragging the marker again.');
			} finally {
				if (!controller.signal.aborted && requestController.current === controller) setIsResolving(false);
			}
		};

		startMarker.on('dragend', () => resolveMarkerLocation(startMarker, setStartLocation));
		destMarker.on('dragend', () => resolveMarkerLocation(destMarker, setDestLocation));

		return () => {
			requestController.current?.abort();
			startMarkerRef.current = null;
			destMarkerRef.current = null;
			routeLineRef.current = null;
			mapRef.current = null;
			startMarker.remove();
			destMarker.remove();
			map.remove();
		};
	}, [getToken]);

	useEffect(() => {
		if (!navigator.geolocation) return undefined;
		let cancelled = false;
		navigator.geolocation.getCurrentPosition(
			(position) => {
				if (cancelled || !startMarkerRef.current || !destMarkerRef.current || !mapRef.current) return;
				const coords = [position.coords.longitude, position.coords.latitude];
				startMarkerRef.current.setLngLat(coords);
				destMarkerRef.current.setLngLat(coords);
				mapRef.current.flyTo({ center: coords, zoom: 14, duration: 1200 });
				const rawCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
				setStartLocation((prev) => ({ ...prev, coordinates: rawCoords }));
				setDestLocation((prev) => ({ ...prev, coordinates: rawCoords }));
			},
			() => {},
			{ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
		);
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		if (!mapRef.current || !startLocation.coordinates || !destLocation.coordinates) return;
		const map = mapRef.current;

		const fetchRoute = async () => {
			try {
				const token = await getToken();
				const response = await fetch(`/api/routes/calculate?start=${startLocation.coordinates.lat},${startLocation.coordinates.lng}&end=${destLocation.coordinates.lat},${destLocation.coordinates.lng}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
				});
				if (!response.ok) return;
				const geometry = await response.json();
				if (routeLineRef.current) {
					map.getSource('route-preview').setData(geometry);
				} else {
					map.addSource('route-preview', { type: 'geojson', data: geometry });
					map.addLayer({
						id: 'route-preview-line',
						type: 'line',
						source: 'route-preview',
						paint: { 'line-color': '#0066ff', 'line-width': 6, 'line-opacity': 0.85 },
					});
					routeLineRef.current = true;
				}
				const bounds = new maplibregl.LngLatBounds();
				geometry.coordinates.forEach((coord) => bounds.extend(coord));
				map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
			} catch {
				// Route preview is optional; fail silently
			}
		};
		void fetchRoute();
	}, [startLocation.coordinates, destLocation.coordinates, getToken]);

	useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

	const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
	const handleImageChange = (event) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setImage(file);
		setImagePreview(URL.createObjectURL(file));
	};
	const handleSubmit = async (event) => {
		event.preventDefault();
		if (!startLocation.coordinates || !startLocation.province.toLowerCase().includes('bataan')) {
			setLocationError('Please set a valid start point inside the Province of Bataan before submitting.');
			return;
		}
		if (!destLocation.coordinates || !destLocation.province.toLowerCase().includes('bataan')) {
			setLocationError('Please set a valid destination inside the Province of Bataan before submitting.');
			return;
		}
		setIsSubmitting(true);
		try {
			const token = await getToken();
			const payload = new FormData();
			payload.append('title', form.title);
			payload.append('description', form.description);
			payload.append('categoryId', String(form.categoryId));
			payload.append('authorId', user?.id || 'mock-user-local');
			payload.append('authorName', [user?.firstName, user?.lastName].filter(Boolean).join(' '));
			payload.append('authorImageUrl', user?.imageUrl || '');
			payload.append('barangay', destLocation.barangay);
			payload.append('city', destLocation.city);
			payload.append('province', destLocation.province);
			payload.append('resolvedAddress', destLocation.address);
			payload.append('longitude', String(destLocation.coordinates.lng));
			payload.append('latitude', String(destLocation.coordinates.lat));
			payload.append('startLongitude', String(startLocation.coordinates.lng));
			payload.append('startLatitude', String(startLocation.coordinates.lat));
			payload.append('destLongitude', String(destLocation.coordinates.lng));
			payload.append('destLatitude', String(destLocation.coordinates.lat));
			if (image) payload.append('image', image);
			const response = await fetch('/api/reports', {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : { 'X-Local-Mock-Auth': 'true' },
				body: payload,
			});
			const data = await readApiResponse(response, 'Unable to create report');
			console.log('Incident report submitted:', data);
			alert('Incident report created successfully.');
			navigate('/feed');
		} catch (submitError) {
			setLocationError(submitError.message);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<section className={`page-card ${styles.page}`}>
			<div className={styles.heading}><div><h1>Create Incident Report</h1></div></div>
			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fields}>
					<label className={styles.field}><span>Post Title</span><input type="text" value={form.title} onChange={(event) => updateField('title', event.target.value)} required /></label>
					<label className={styles.field}><span>Category</span><select value={form.categoryId} onChange={(event) => updateField('categoryId', Number(event.target.value))}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Post Description</span><textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} rows="5" required /></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Image (optional)</span><input type="file" accept="image/*" onChange={handleImageChange} />{imagePreview && <img className={styles.preview} src={imagePreview} alt="Selected incident" />}</label>
				</div>

				<div className={styles.locationSection}>
					<div className={styles.locationHeading}>
						<div><p>Drag the green and red marker on the map to start and end of the Path.</p></div>
						{isResolving && <span className={styles.loading}>Fetching address...</span>}
					</div>
					<div className={styles.markerLegend}>
						<span className={styles.legendItem}><span className={styles.dot} style={{ background: '#2d7a5d' }} /> Path Start</span>
						<span className={styles.legendItem}><span className={styles.dot} style={{ background: '#bd3e50' }} /> Path End</span>
					</div>
					<div ref={mapContainer} className={styles.map} />
					{locationError && <div className={styles.warning} role="alert">{locationError}</div>}
					<div className={styles.routePoints}>
						{startLocation.address && <div className={styles.address}><strong>Path Start</strong><span>{startLocation.address}</span><small className={styles.snapStatus}>{startLocation.roadName ? `Snapped ${Math.round(startLocation.snapDistance)} m to ${startLocation.roadName}` : 'Matched to nearest road'}</small></div>}
						{destLocation.address && <div className={styles.address}><strong>Path End</strong><span>{destLocation.address}</span><small className={styles.snapStatus}>{destLocation.roadName ? `Snapped ${Math.round(destLocation.snapDistance)} m to ${destLocation.roadName}` : 'Matched to nearest road'}</small></div>}
					</div>
				</div>
				<div className={styles.actions}><button type="button" className="ghost-btn danger-btn" onClick={() => navigate('/feed')}>Cancel</button><button type="submit" className="primary-btn" disabled={isSubmitting || isResolving}>{isSubmitting ? 'Submitting...' : 'Submit Report'}</button></div>
			</form>
		</section>
	);
}
