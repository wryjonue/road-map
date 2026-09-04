import { useState } from 'react';
import { VIOLATION_TICKETS } from '../data/tickets';
import styles from './TicketsPage.module.css';

const emptyForm = { plate: '', offense: 'Illegal Parking', fine: '$150', location: '', issuedBy: 'Officer On Duty' };

export default function TicketsPage() {
	const [tickets, setTickets] = useState(VIOLATION_TICKETS);
	const [showModal, setShowModal] = useState(false);
	const [form, setForm] = useState(emptyForm);
	const updateField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
	const handleSubmit = (event) => {
		event.preventDefault();
		const nextId = tickets.length ? Math.max(...tickets.map((ticket) => ticket.id)) + 1 : 1;
		setTickets((current) => [{ id: nextId, ticketNo: `TCK-${1000 + nextId}`, offense: form.offense, violatorPlate: form.plate || 'UNKNOWN', location: form.location || 'Unspecified location', dateTime: new Date().toISOString().slice(0, 16).replace('T', ' '), fineAmount: form.fine || '$150', status: 'Pending', issuedBy: form.issuedBy || 'Officer On Duty' }, ...current]);
		setForm(emptyForm);
		setShowModal(false);
	};
	const updateStatus = (ticketId, status) => setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, status } : ticket));

	return (
		<section className={`page-card ${styles.ticketsPage}`}>
			<div className={styles.header}><div><p className="eyebrow">Enforcement center</p><h1>Road violation & ticketing</h1></div><button type="button" className="primary-btn" onClick={() => setShowModal(true)}>Issue New Ticket</button></div>
			<div className={styles.tableWrap}><table className="tickets-table"><thead><tr><th>Ticket</th><th>Offense</th><th>Plate</th><th>Location</th><th>Fine</th><th>Status</th><th>Issued By</th><th>Action</th></tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}><td>{ticket.ticketNo}</td><td>{ticket.offense}</td><td>{ticket.violatorPlate}</td><td>{ticket.location}</td><td>{ticket.fineAmount}</td><td><span className={`status-pill status-${ticket.status.toLowerCase()}`}>{ticket.status}</span></td><td>{ticket.issuedBy}</td><td><div className={styles.tableActions}><button type="button" className="secondary-btn small-btn" onClick={() => updateStatus(ticket.id, 'Paid')}>Pay Fine</button><button type="button" className="ghost-btn small-btn" onClick={() => updateStatus(ticket.id, 'Issued')}>Resolve</button></div></td></tr>)}</tbody></table></div>
			{showModal ? <div className={styles.modalBackdrop} onClick={() => setShowModal(false)}><div className={styles.modal} onClick={(event) => event.stopPropagation()}><div className={styles.modalHeader}><h2>Issue violation ticket</h2><button type="button" className={styles.closeButton} onClick={() => setShowModal(false)}>×</button></div><form className={styles.form} onSubmit={handleSubmit}><div className={styles.formGrid}><label className={styles.field}><span>License plate</span><input value={form.plate} onChange={(event) => updateField('plate', event.target.value)} placeholder="ABC-1234" required /></label><label className={styles.field}><span>Offense</span><select value={form.offense} onChange={(event) => updateField('offense', event.target.value)}><option>Illegal Parking</option><option>Red Light Signal</option><option>Over-speeding</option><option>Blocking Intersection</option></select></label><label className={styles.field}><span>Fine</span><input value={form.fine} onChange={(event) => updateField('fine', event.target.value)} placeholder="$150" required /></label><label className={styles.field}><span>Location</span><input value={form.location} onChange={(event) => updateField('location', event.target.value)} placeholder="Main St / Ridge Blvd" required /></label><label className={styles.field}><span>Issued by</span><input value={form.issuedBy} onChange={(event) => updateField('issuedBy', event.target.value)} placeholder="Officer On Duty" required /></label></div><div className={styles.modalActions}><button type="button" className="ghost-btn" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="primary-btn">Save Ticket</button></div></form></div></div> : null}
		</section>
	);
}
