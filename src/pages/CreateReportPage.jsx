import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useUser } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import categories from '../data/categories';
import styles from './CreateReportPage.module.css';

const BATAAN_CENTER = [120.5394, 14.6779];
const initialLocation = { barangay: '', city: '', province: '', address: '', roadName: '', snapDistance: null, coordinates: null };

export default function CreateReportPage() {
	const navigate = useNavigate();
	const mapContainer = useRef(null);
	const requestController = useRef(null);
	const { getToken } = useAuth();
	const { user } = useUser();
	const [form, setForm] = useState({ title: '', description: '', categoryId: categories[0].id });
	const [location, setLocation] = useState(initialLocation);
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
		const marker = new maplibregl.Marker({ draggable: true }).setLngLat(BATAAN_CENTER).addTo(map);

		const resolveLocation = async () => {
			const { lat, lng } = marker.getLngLat();
			setIsResolving(true);
			setLocationError('');
			setLocation(initialLocation);
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
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || 'Unable to resolve this location');
				if (controller.signal.aborted || requestController.current !== controller) return;
				marker.setLngLat([result.longitude, result.latitude]);
				setLocation({ barangay: result.barangay, city: result.city, province: result.province, address: result.address, roadName: result.roadName, snapDistance: result.snapDistance, coordinates: { lat: result.latitude, lng: result.longitude } });
			} catch (error) {
				if (error.name !== 'AbortError') setLocationError(error.message || 'We could not resolve this location. Please try dragging the marker again.');
			} finally {
				if (!controller.signal.aborted && requestController.current === controller) setIsResolving(false);
			}
		};

		marker.on('dragend', resolveLocation);
		return () => {
			requestController.current?.abort();
			marker.remove();
			map.remove();
		};
	}, [getToken]);

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
		if (!location.coordinates || !location.province.toLowerCase().includes('bataan')) {
			setLocationError('Please pin a location inside the Province of Bataan before submitting.');
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
			payload.append('barangay', location.barangay);
			payload.append('city', location.city);
			payload.append('province', location.province);
			payload.append('resolvedAddress', location.address);
			payload.append('longitude', String(location.coordinates.lng));
			payload.append('latitude', String(location.coordinates.lat));
			if (image) payload.append('image', image);
			const response = await fetch('/api/reports', {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : { 'X-Local-Mock-Auth': 'true' },
				body: payload,
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to create report');
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
			<div className={styles.heading}><div><h1>Create Incident Report</h1><p>Pin the incident location and share the details with your road response team.</p></div></div>
			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fields}>
					<label className={styles.field}><span>Post Title</span><input type="text" value={form.title} onChange={(event) => updateField('title', event.target.value)} required /></label>
					<label className={styles.field}><span>Category</span><select value={form.categoryId} onChange={(event) => updateField('categoryId', Number(event.target.value))}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Post Description</span><textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} rows="5" required /></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Image (optional)</span><input type="file" accept="image/*" onChange={handleImageChange} />{imagePreview && <img className={styles.preview} src={imagePreview} alt="Selected incident" />}</label>
				</div>

				<div className={styles.locationSection}><div className={styles.locationHeading}><div><h2>Incident location</h2><p>Drag the marker to the incident. The address will be resolved automatically.</p></div>{isResolving && <span className={styles.loading}>Resolving address...</span>}</div><div ref={mapContainer} className={styles.map} />{locationError && <div className={styles.warning} role="alert">{locationError}</div>}{location.address && <div className={styles.address}><strong>Resolved address</strong><span>{location.address}</span><small className={styles.snapStatus}>{location.roadName ? `Marker snapped ${Math.round(location.snapDistance)} m to ${location.roadName}` : 'Marker matched to the nearest road'}</small><small>{location.barangay || 'Barangay unavailable'} · {location.city || 'Municipality unavailable'} · {location.province}</small></div>}</div>
				<div className={styles.actions}><button type="button" className="ghost-btn danger-btn" onClick={() => navigate('/feed')}>Cancel</button><button type="submit" className="primary-btn" disabled={isSubmitting || isResolving}>{isSubmitting ? 'Submitting...' : 'Submit Report'}</button></div>
			</form>
		</section>
	);
}
