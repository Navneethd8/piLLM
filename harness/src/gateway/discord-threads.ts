import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ThreadStoreFile {
  threadIds: string[];
}

export class DiscordThreadStore {
  private path: string;
  private threads = new Set<string>();

  constructor(home: string) {
    mkdirSync(join(home, "data"), { recursive: true });
    this.path = join(home, "data", "discord_threads.json");
    this.load();
  }

  has(threadId: string): boolean {
    return this.threads.has(threadId);
  }

  add(threadId: string): void {
    if (this.threads.has(threadId)) return;
    this.threads.add(threadId);
    this.save();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8")) as ThreadStoreFile;
      for (const id of data.threadIds ?? []) {
        this.threads.add(id);
      }
    } catch {
      this.threads.clear();
    }
  }

  private save(): void {
    const data: ThreadStoreFile = { threadIds: [...this.threads] };
    writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
  }
}
