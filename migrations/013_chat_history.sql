-- Chat history table
-- Persists the AI assistant conversation per user so chats survive page reloads.
-- user_id stores the Clerk subject (external string), so there is no FK to a local users table.

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
