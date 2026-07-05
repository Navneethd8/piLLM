import type { HarnessConfig } from "../config.js";
import { startDiscordGateway } from "./discord.js";
import { startWebServer } from "../web/server.js";

export async function startGateway(config: HarnessConfig): Promise<void> {
  startWebServer(config);
  await startDiscordGateway(config);
}
