import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "../providers/types.js";

export interface SessionRow {
  id: string;
  platform: string;
  channel_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(home: string) {
    mkdirSync(join(home, "sessions"), { recursive: true });
    const path = join(home, "sessions", "pillm.db");
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(platform, channel_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        name TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    `);
  }

  getOrCreateSession(platform: string, channelId: string, title = ""): string {
    const existing = this.db
      .prepare(
        "SELECT id FROM sessions WHERE platform = ? AND channel_id = ?",
      )
      .get(platform, channelId) as { id: string } | undefined;
    if (existing) return existing.id;

    const id = `${platform}:${channelId}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, platform, channel_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, platform, channelId, title || id, now, now);
    return id;
  }

  getMessages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, tool_call_id, name FROM messages
         WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId) as Array<{
      role: string;
      content: string;
      tool_call_id: string | null;
      name: string | null;
    }>;

    return rows.map((r) => ({
      role: r.role as ChatMessage["role"],
      content: r.content,
      ...(r.tool_call_id ? { tool_call_id: r.tool_call_id } : {}),
      ...(r.name ? { name: r.name } : {}),
    }));
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO messages (session_id, role, content, tool_call_id, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        message.role,
        message.content,
        message.tool_call_id ?? null,
        message.name ?? null,
        now,
      );
    this.db
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionId);
  }

  replaceMessages(sessionId: string, messages: ChatMessage[]): void {
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    for (const m of messages) {
      this.appendMessage(sessionId, m);
    }
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}

export function sessionExists(home: string): boolean {
  return existsSync(join(home, "sessions", "pillm.db"));
}
