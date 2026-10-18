import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@clerk/react';
import styles from './AssistantPage.module.css';

const MAX_MESSAGE_LENGTH = 2000;

const EXAMPLE_PROMPTS = [
	'How many flooded road reports are there this month?',
	'Find recent road construction reports',
	'What incidents are near Mariveles?',
];

// Parse a single line for inline formatting: bold, italic, markdown links, report refs.
function parseInline(text, keyPrefix) {
	const nodes = [];
	// Pattern: **bold**, *italic*, [text](url), [#id], #id
	const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|\[([^\]]+)\]\(([^)]+)\)|(\[#?(\d+)\])|(#(\d+))/g;
	let lastIndex = 0;
	let match;
	let key = 0;

	while ((match = pattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index));
		}

		if (match[1]) {
			// **bold**
			nodes.push(<strong key={`${keyPrefix}-b-${key++}`}>{match[1].slice(2, -2)}</strong>);
		} else if (match[2]) {
			// *italic*
			nodes.push(<em key={`${keyPrefix}-i-${key++}`}>{match[2].slice(1, -1)}</em>);
		} else if (match[3] && match[4]) {
			// [text](url) markdown link — only linkify /feed/ paths, render others as plain text
			const linkText = match[3];
			const linkUrl = match[4];
			if (linkUrl.startsWith('/feed/')) {
				nodes.push(
					<Link key={`${keyPrefix}-ml-${key++}`} to={linkUrl} className={styles.reportLink}>
						{linkText}
					</Link>
				);
			} else {
				nodes.push(<span key={`${keyPrefix}-ml-${key++}`}>{linkText}</span>);
			}
		} else {
			// [#30] or #30
			const id = match[6] || match[8];
			nodes.push(
				<Link key={`${keyPrefix}-l-${key++}`} to={`/feed/${id}`} className={styles.reportLink}>
					{match[0]}
				</Link>
			);
		}
		lastIndex = pattern.lastIndex;
	}
	if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
	return nodes;
}

// Render assistant text: detects report blocks and renders them as cards.
function renderAssistantContent(text) {
	if (!text) return null;
	const lines = text.split('\n');
	const elements = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		// Detect report entry: starts with number (e.g. "1.") or contains "**ID #"
		// We look ahead to group the report details (Municipality, Status, Date) into one card.
		const isReportStart = /^\d+\.\s/.test(line) || /\*\*ID #\d+/.test(line);

		if (isReportStart) {
			// Collect lines for this report card
			const cardLines = [line];
			let j = i + 1;
			// Heuristic: subsequent lines starting with "-" or indented are part of the card
			while (j < lines.length && (lines[j].startsWith('-') || lines[j].startsWith('  ') || lines[j].trim() === '')) {
				if (lines[j].trim() !== '') cardLines.push(lines[j]);
				j++;
			}

			// Parse the card content
			// Extract ID from the first line
			const idMatch = cardLines[0].match(/#(\d+)/);
			const reportId = idMatch ? idMatch[1] : null;

			// Extract title (usually after the ID bold block)
			// Format: "1. **ID #30**: *Title*" or similar
			let title = 'Report Details';
			const titleMatch = cardLines[0].match(/\*([^*]+)\*/); // Look for *Title*
			if (titleMatch) title = titleMatch[1];
			else {
				// Fallback: try to get text after the colon
				const colonSplit = cardLines[0].split(':');
				if (colonSplit.length > 1) title = colonSplit.slice(1).join(':').replace(/\*/g, '').trim();
			}

			// Extract details (Municipality, Status, Date)
			const details = {};
			cardLines.slice(1).forEach((detailLine) => {
				const cleanLine = detailLine.replace(/^-\s*/, '').trim();
				if (cleanLine.toLowerCase().startsWith('municipality:')) details.municipality = cleanLine.split(':')[1].trim();
				else if (cleanLine.toLowerCase().startsWith('status:')) details.status = cleanLine.split(':')[1].trim();
				else if (cleanLine.toLowerCase().startsWith('date:')) details.date = cleanLine.split(':')[1].trim();
				else if (cleanLine.toLowerCase().startsWith('category:')) details.category = cleanLine.split(':')[1].trim();
			});

			elements.push(
				<Link key={`card-${i}`} to={reportId ? `/feed/${reportId}` : '#'} className={styles.reportCard}>
					<div className={styles.reportCardHeader}>
						{reportId && <span className={styles.reportId}>#{reportId}</span>}
						{details.status && <span className={`${styles.statusPill} ${styles[`status${details.status}`]}`}>{details.status}</span>}
					</div>
					<div className={styles.reportCardTitle}>{title}</div>
					<div className={styles.reportCardMeta}>
						{details.category && <span>{details.category}</span>}
						{details.municipality && <span>📍 {details.municipality}</span>}
						{details.date && <span>🕒 {details.date}</span>}
					</div>
				</Link>
			);

			i = j; // Skip the lines we just processed
		} else {
			// Regular text line
			if (line.trim()) {
				elements.push(
					<span key={`line-${i}`} className={styles.line}>
						{parseInline(line, `l-${i}`)}
					</span>
				);
			} else {
				elements.push(<span key={`space-${i}`} className={styles.line}>&nbsp;</span>);
			}
			i++;
		}
	}

	return elements;
}

export default function AssistantPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const navigate = useNavigate();
	const [messages, setMessages] = useState([]);
	const [input, setInput] = useState('');
	const [isSending, setIsSending] = useState(false);
	const [error, setError] = useState('');
	const [historyLoaded, setHistoryLoaded] = useState(false);
	const transcriptRef = useRef(null);
	const textareaRef = useRef(null);

	const authHeaders = useCallback(async () => {
		const token = isSignedIn ? await getToken() : null;
		return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
	}, [getToken, isSignedIn]);

	useEffect(() => {
		if (!isLoaded || !isSignedIn) {
			setHistoryLoaded(true);
			return undefined;
		}
		const controller = new AbortController();
		const loadHistory = async () => {
			try {
				const response = await fetch('/api/ai/history?limit=40', {
					headers: await authHeaders(),
					signal: controller.signal,
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Unable to load conversation');
				if (!controller.signal.aborted) {
					setMessages(Array.isArray(data.messages) ? data.messages.map((m) => ({ role: m.role, content: m.content, id: m.id })) : []);
				}
			} catch (loadError) {
				if (loadError.name !== 'AbortError') setError(loadError.message || 'Unable to load conversation');
			} finally {
				if (!controller.signal.aborted) setHistoryLoaded(true);
			}
		};
		void loadHistory();
		return () => controller.abort();
	}, [isLoaded, isSignedIn, authHeaders]);

	useEffect(() => {
		const node = transcriptRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [messages, isSending]);

	const sendMessage = async (rawMessage) => {
		const message = (rawMessage ?? input).trim();
		if (!message || isSending || !isSignedIn) return;
		if (message.length > MAX_MESSAGE_LENGTH) {
			setError(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
			return;
		}

		setError('');
		setInput('');
		setIsSending(true);
		const userMsg = { role: 'user', content: message, id: `local-user-${Date.now()}` };
		const thinkingId = `local-thinking-${Date.now()}`;
		const thinkingMsg = { role: 'assistant', content: '', id: thinkingId, thinking: true };
		setMessages((current) => [...current, userMsg, thinkingMsg]);

		try {
			const response = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ message }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Unable to get a response');
			setMessages((current) => current.map((m) => (m.id === thinkingId ? { role: 'assistant', content: data.reply || 'I could not find any information to answer that.', id: thinkingId } : m)));
		} catch (sendError) {
			setError(sendError.message || 'Unable to get a response');
			setMessages((current) => current.filter((m) => m.id !== thinkingId));
		} finally {
			setIsSending(false);
		}
	};

	const clearChat = async () => {
		if (!isSignedIn || isSending) return;
		try {
			const response = await fetch('/api/ai/history', {
				method: 'DELETE',
				headers: await authHeaders(),
			});
			if (!response.ok) throw new Error('Failed to clear history');
			setMessages([]);
			setError('');
		} catch (err) {
			setError(err.message || 'Unable to clear chat');
		}
	};

	const handleKeyDown = (event) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void sendMessage();
		}
	};

	if (!isLoaded) return <div className={styles.page}><p className={styles.state}>Loading…</p></div>;

	if (!isSignedIn) {
		return (
			<div className={styles.page}>
				<div className={styles.card}>
					<div className={styles.empty}>
						<h2 className={styles.emptyTitle}>Sign in to use the Bot</h2>
						<p className={styles.emptyText}>Expensive ang API Key boi.</p>
						<Link to="/sign-in" className="primary-btn">Sign in</Link>
					</div>
				</div>
			</div>
		);
	}

	const charCount = input.length;
	const overLimit = charCount > MAX_MESSAGE_LENGTH;

	return (
		<div className={styles.page}>
			<div className={styles.card}>
				<header className={styles.chatHeader}>
					<div>
						<h2 className={styles.chatTitle}>Chat</h2>
						
					</div>
					<button type="button" className={styles.clearBtn} onClick={clearChat} disabled={isSending || messages.length === 0}>
						Clear Chat
					</button>
				</header>

				{error && <p className={styles.error} role="alert">{error}</p>}

				<div className={styles.transcript} ref={transcriptRef} role="log" aria-live="polite" aria-label="Conversation">
					{!historyLoaded && <p className={styles.state}>Loading conversation…</p>}
					{historyLoaded && messages.length === 0 && !isSending && (
						<div className={styles.empty}>
							<p className={styles.emptyText}>Example prompts:</p>
							<div className={styles.chips}>
								{EXAMPLE_PROMPTS.map((prompt) => (
									<button key={prompt} type="button" className={styles.chip} onClick={() => void sendMessage(prompt)} disabled={isSending}>
										{prompt}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((msg) => (
						<div key={msg.id} className={`${styles.bubbleRow} ${msg.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAssistant}`}>
							<div className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
								{msg.thinking ? (
									<span className={styles.thinking}>
										<span className={styles.thinkingDot} aria-hidden="true" />
										Querying reports…
									</span>
								) : msg.role === 'user' ? (
									<span className={styles.line}>{msg.content}</span>
								) : (
									renderAssistantContent(msg.content)
								)}
							</div>
						</div>
					))}
				</div>

				<div className={styles.composer}>
					<textarea
						ref={textareaRef}
						className={styles.textarea}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask about road incidents… (Enter to send, Shift+Enter for a new line)"
						rows={2}
						disabled={isSending}
						aria-label="Your message"
					/>
					<div className={styles.composerFooter}>
						<span className={`${styles.counter} ${overLimit ? styles.counterOver : ''}`}>
							{charCount}/{MAX_MESSAGE_LENGTH}
						</span>
						<button
							type="button"
							className="primary-btn"
							onClick={() => void sendMessage()}
							disabled={isSending || !input.trim() || overLimit}
						>
							{isSending ? 'Thinking…' : 'Send'}
						</button>
					</div>
					<span className={`${styles.chatSubtitle}`}> Disclaimer: AI messages may be inaccurate. Please double-check important information.
					</span>
				</div>
			</div>
		</div>
	);
}
