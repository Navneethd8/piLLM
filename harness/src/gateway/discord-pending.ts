import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PendingDiscordRequest {
  messageId: string;
  channelId: string;
  sessionChannelId: string;
  prompt: string;
  authorId: string;
  guildId: string | null;
  queuedAt: string;
}

interface PendingFile {
  items: PendingDiscordRequest[];
}

export class DiscordPendingStore {
  private path: string;
  private items = new Map<string, PendingDiscordRequest>();

  constructor(home: string) {
    mkdirSync(join(home, "data"), { recursive: true });
    this.path = join(home, "data", "discord_pending.json");
    this.load();
  }

  add(item: PendingDiscordRequest): void {
    this.items.set(item.messageId, item);
    this.save();
  }

  remove(messageId: string): void {
    if (!this.items.delete(messageId)) return;
    this.save();
  }

  list(): PendingDiscordRequest[] {
    return [...this.items.values()];
  }

  channelIds(): string[] {
    return [...new Set(this.list().map((i) => i.channelId))];
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8")) as PendingFile;
      for (const item of data.items ?? []) {
        this.items.set(item.messageId, item);
      }
    } catch {
      this.items.clear();
    }
  }

  private save(): void {
    const data: PendingFile = { items: [...this.items.values()] };
    writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
  }
}
