import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import type { HarnessConfig } from "../config.js";
import { AgentLoop } from "../agent/loop.js";
import { globalQueue } from "../queue/single-flight.js";

const DISCORD_MAX = 2000;

function chunkText(text: string): string[] {
  if (text.length <= DISCORD_MAX) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > DISCORD_MAX) {
    chunks.push(rest.slice(0, DISCORD_MAX));
    rest = rest.slice(DISCORD_MAX);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function isAllowed(config: HarnessConfig, message: Message): boolean {
  if (config.discordAllowedUserIds.length) {
    if (!message.author.id || !config.discordAllowedUserIds.includes(message.author.id)) {
      return false;
    }
  }
  if (config.discordAllowedGuildIds.length && message.guildId) {
    if (!config.discordAllowedGuildIds.includes(message.guildId)) {
      return false;
    }
  }
  return true;
}

export async function startDiscordGateway(config: HarnessConfig): Promise<void> {
  if (!config.discordBotToken) {
    console.log("DISCORD_BOT_TOKEN not set — skipping Discord gateway");
    return;
  }

  const agent = new AgentLoop(config);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`Discord gateway ready as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!isAllowed(config, message)) return;

    const mention = client.user && message.mentions.has(client.user);
    const dm = !message.guild;
    if (!dm && !mention) return;

    const prompt = message.content
      .replace(new RegExp(`<@!?${client.user?.id}>`), "")
      .trim();
    if (!prompt) return;

    const channelId = message.channelId;
    const sessionId = agent
      .getSessionStore()
      .getOrCreateSession("discord", channelId, message.channel.id);

    try {
      await message.channel.sendTyping();
      const result = await globalQueue.enqueue(() =>
        agent.runTurn({
          sessionId,
          userText: prompt,
          platform: "discord",
        }),
      );

      const header = `_via ${result.provider} (${result.iterations} steps)_\n`;
      for (const chunk of chunkText(header + result.reply)) {
        await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await message.reply(`Error: ${msg.slice(0, 500)}`);
    }
  });

  await client.login(config.discordBotToken);
}
