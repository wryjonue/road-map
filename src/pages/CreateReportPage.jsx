import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useUser } from '@clerk/react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import categories from '../data/categories';
import styles from './CreateReportPage.module.css';

const BATAAN_CENTER = [120.5394, 14.6779];
const initialLocation = { barangay: '', city: '', province: '', address: '', coordinates: null };

function getLocationFields(address) {
	return {
		barangay: address.quarter || address.suburb || address.village || address.neighbourhood || '',
		city: address.city || address.town || address.municipality || '',
		province: address.state || address.region || '',
	};
}

export default function CreateReportPage() {
	const navigate = useNavigate();
	const mapContainer = useRef(null);
	const requestController = useRef(null);
	const { user } = useUser();
	const [form, setForm] = useState({ title: '', description: '', category: categories[0] });
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
			requestController.current?.abort();
			const controller = new AbortController();
			requestController.current = controller;
			try {
				const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
					headers: { 'User-Agent': 'RoadMapApp/1.0' },
					signal: controller.signal,
				});
				if (!response.ok) throw new Error('Reverse geocoding failed');
				const result = await response.json();
				const address = result.address || {};
				const region = `${address.state || ''} ${address.region || ''} ${address.county || ''}`.toLowerCase();
				if (!region.includes('bataan')) {
					setLocation(initialLocation);
					setLocationError('Reports are currently limited to the Province of Bataan. Please pin a location inside Bataan.');
					return;
				}
				setLocation({ ...getLocationFields(address), address: result.display_name || '', coordinates: { lat, lng } });
			} catch (error) {
				if (error.name !== 'AbortError') setLocationError('We could not resolve this location. Please try dragging the marker again.');
			} finally {
				if (!controller.signal.aborted) setIsResolving(false);
			}
		};

		marker.on('dragend', resolveLocation);
		return () => {
			requestController.current?.abort();
			marker.remove();
			map.remove();
		};
	}, []);

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
			const payload = new FormData();
			payload.append('title', form.title);
			payload.append('description', form.description);
			payload.append('categoryId', String(categories.indexOf(form.category) + 1));
			payload.append('authorId', user?.id || 'mock-user-local');
			payload.append('authorName', user?.fullName || user?.username || 'Local Reporter');
			payload.append('barangay', location.barangay);
			payload.append('city', location.city);
			payload.append('province', location.province);
			payload.append('resolvedAddress', location.address);
			payload.append('longitude', String(location.coordinates.lng));
			payload.append('latitude', String(location.coordinates.lat));
			if (image) payload.append('image', image);
			const response = await fetch('/api/reports', {
				method: 'POST',
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
			<div className={styles.heading}><div><p className="eyebrow">Community reporting</p><h1>Create Incident Report</h1><p>Pin the incident location and share the details with your road response team.</p></div></div>
			<form className={styles.form} onSubmit={handleSubmit}>
				<div className={styles.fields}>
					<label className={styles.field}><span>Post Title</span><input type="text" value={form.title} onChange={(event) => updateField('title', event.target.value)} required /></label>
					<label className={styles.field}><span>Category</span><select value={form.category} onChange={(event) => updateField('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Post Description</span><textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} rows="5" required /></label>
					<label className={`${styles.field} ${styles.fullWidth}`}><span>Image (optional)</span><input type="file" accept="image/*" onChange={handleImageChange} />{imagePreview && <img className={styles.preview} src={imagePreview} alt="Selected incident" />}</label>
				</div>

				<div className={styles.locationSection}><div className={styles.locationHeading}><div><h2>Incident location</h2><p>Drag the marker to the incident. The address will be resolved automatically.</p></div>{isResolving && <span className={styles.loading}>Resolving address...</span>}</div><div ref={mapContainer} className={styles.map} />{locationError && <div className={styles.warning} role="alert">{locationError}</div>}{location.address && <div className={styles.address}><strong>Resolved address</strong><span>{location.address}</span><small>{location.barangay || 'Barangay unavailable'} · {location.city || 'Municipality unavailable'} · {location.province}</small></div>}</div>
				<div className={styles.actions}><button type="button" className="ghost-btn" onClick={() => navigate('/feed')}>Cancel</button><button type="submit" className="primary-btn" disabled={isSubmitting || isResolving}>{isSubmitting ? 'Submitting...' : 'Submit Report'}</button></div>
			</form>
		</section>
	);
}
