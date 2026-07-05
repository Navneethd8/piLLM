import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  ThreadAutoArchiveDuration,
  type Client as DiscordClient,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { HarnessConfig } from "../config.js";
import { AgentLoop } from "../agent/loop.js";
import { globalQueue } from "../queue/single-flight.js";
import { DiscordPendingStore, type PendingDiscordRequest } from "./discord-pending.js";
import { DiscordThreadStore } from "./discord-threads.js";

const DISCORD_MAX = 2000;
const TYPING_REFRESH_MS = 8_000;
const RESTART_NOTICE =
  "_piLLM is restarting — your message will be retried automatically when it's back._";
const RETRY_NOTICE = "_Server restarted — retrying your message…_";

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

function isAllowed(config: HarnessConfig, authorId: string, guildId: string | null): boolean {
  if (config.discordAllowedUserIds.length) {
    if (!authorId || !config.discordAllowedUserIds.includes(authorId)) {
      return false;
    }
  }
  if (config.discordAllowedGuildIds.length && guildId) {
    if (!config.discordAllowedGuildIds.includes(guildId)) {
      return false;
    }
  }
  return true;
}

function stripBotMention(content: string, botId: string | undefined): string {
  if (!botId) return content.trim();
  return content.replace(new RegExp(`<@!?${botId}>`), "").trim();
}

function threadNameFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "piLLM chat";
  return cleaned.length <= 50 ? cleaned : `${cleaned.slice(0, 47)}...`;
}

function shouldRespond(
  config: HarnessConfig,
  message: Message,
  botUserId: string | undefined,
  threadStore: DiscordThreadStore,
): boolean {
  const dm = !message.guild;
  if (dm) return true;

  const mentioned = Boolean(botUserId && message.mentions.users.has(botUserId));
  const isThread = message.channel.isThread();

  if (isThread) {
    if (config.discordThreadRequireMention) return mentioned;
    return mentioned || threadStore.has(message.channelId);
  }

  return mentioned;
}

async function resolveReplyChannel(
  config: HarnessConfig,
  message: Message,
  prompt: string,
  threadStore: DiscordThreadStore,
): Promise<{ channel: SendableChannels; sessionChannelId: string } | null> {
  if (!message.channel.isSendable()) return null;

  const dm = !message.guild;
  const isThread = message.channel.isThread();

  if (dm || isThread) {
    if (isThread) threadStore.add(message.channelId);
    return { channel: message.channel, sessionChannelId: message.channelId };
  }

  const skipThread = config.discordNoThreadChannels.includes(message.channelId);
  if (!config.discordAutoThread || skipThread) {
    return { channel: message.channel, sessionChannelId: message.channelId };
  }

  if (message.channel.type !== ChannelType.GuildText) {
    return { channel: message.channel, sessionChannelId: message.channelId };
  }

  if (message.hasThread) {
    try {
      const fetched = await message.fetch();
      const existing = fetched.thread;
      if (existing?.isSendable()) {
        threadStore.add(existing.id);
        return { channel: existing, sessionChannelId: existing.id };
      }
    } catch (err) {
      console.warn(
        "Discord existing thread fetch failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  try {
    const thread = await message.startThread({
      name: threadNameFromPrompt(prompt),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });
    threadStore.add(thread.id);
    return { channel: thread, sessionChannelId: thread.id };
  } catch (err) {
    console.warn(
      "Discord auto-thread failed, replying inline:",
      err instanceof Error ? err.message : String(err),
    );
    return { channel: message.channel, sessionChannelId: message.channelId };
  }
}

function canInlineReply(channel: SendableChannels, replyTo?: Message): replyTo is Message {
  return Boolean(replyTo && replyTo.channelId === channel.id);
}

async function sendReply(
  channel: SendableChannels,
  text: string,
  replyTo?: Message,
): Promise<void> {
  const chunks = chunkText(text);
  if (canInlineReply(channel, replyTo)) {
    await replyTo.reply({
      content: chunks[0],
      allowedMentions: { repliedUser: false },
    });
  } else {
    await channel.send(chunks[0]);
  }
  for (const chunk of chunks.slice(1)) {
    await channel.send(chunk);
  }
}

async function dismissThinking(thinking: Message | undefined): Promise<void> {
  if (!thinking) return;
  await thinking.delete().catch(() => undefined);
}

function shouldSkipUserAppend(agent: AgentLoop, sessionId: string, prompt: string): boolean {
  const history = agent.getSessionStore().getMessages(sessionId);
  const last = history[history.length - 1];
  return last?.role === "user" && last.content === prompt;
}

interface ProcessContext {
  config: HarnessConfig;
  agent: AgentLoop;
  replyChannel: SendableChannels;
  sessionChannelId: string;
  prompt: string;
  messageId: string;
  authorId: string;
  replyTo?: Message;
  pendingStore: DiscordPendingStore;
  guildId: string | null;
  isRetry?: boolean;
}

async function processDiscordRequest(ctx: ProcessContext): Promise<void> {
  const sessionId = ctx.agent
    .getSessionStore()
    .getOrCreateSession("discord", ctx.sessionChannelId, ctx.sessionChannelId);

  const pendingItem: PendingDiscordRequest = {
    messageId: ctx.messageId,
    channelId: ctx.replyChannel.id,
    sessionChannelId: ctx.sessionChannelId,
    prompt: ctx.prompt,
    authorId: ctx.authorId,
    guildId: ctx.guildId,
    queuedAt: new Date().toISOString(),
  };
  ctx.pendingStore.add(pendingItem);

  let typingTimer: ReturnType<typeof setInterval> | undefined;
  let thinking: Message | undefined;

  try {
    if (ctx.isRetry) {
      await ctx.replyChannel.send(RETRY_NOTICE);
    }

    thinking = await ctx.replyChannel.send(
      "_Thinking… local inference on the Pi can take a few minutes._",
    );

    typingTimer = setInterval(() => {
      void ctx.replyChannel.sendTyping().catch(() => undefined);
    }, TYPING_REFRESH_MS);
    void ctx.replyChannel.sendTyping().catch(() => undefined);

    const result = await globalQueue.enqueue(() =>
      ctx.agent.runTurn({
        sessionId,
        userText: ctx.prompt,
        platform: "discord",
        skipUserAppend: shouldSkipUserAppend(ctx.agent, sessionId, ctx.prompt),
      }),
    );

    await dismissThinking(thinking);
    thinking = undefined;
    await sendReply(
      ctx.replyChannel,
      `_via ${result.provider} (${result.iterations} steps)_\n${result.reply}`,
      ctx.replyTo,
    );
    ctx.pendingStore.remove(ctx.messageId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorText = `Error: ${msg.slice(0, 500)}`;
    await dismissThinking(thinking);
    try {
      if (canInlineReply(ctx.replyChannel, ctx.replyTo)) {
        await ctx.replyTo.reply({ content: errorText, allowedMentions: { repliedUser: false } });
      } else {
        await ctx.replyChannel.send(errorText);
      }
    } catch {
      await ctx.replyChannel.send(errorText);
    }
    ctx.pendingStore.remove(ctx.messageId);
  } finally {
    if (typingTimer) clearInterval(typingTimer);
  }
}

async function notifyRestart(client: DiscordClient, pendingStore: DiscordPendingStore): Promise<void> {
  for (const channelId of pendingStore.channelIds()) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isSendable()) {
        await channel.send(RESTART_NOTICE);
      }
    } catch {
      // best effort
    }
  }
}

async function retryPending(
  client: DiscordClient,
  config: HarnessConfig,
  agent: AgentLoop,
  pendingStore: DiscordPendingStore,
): Promise<void> {
  const pending = pendingStore.list();
  if (!pending.length) return;

  console.log(`Discord retrying ${pending.length} pending message(s) after restart`);
  for (const item of pending) {
    if (!isAllowed(config, item.authorId, item.guildId)) {
      pendingStore.remove(item.messageId);
      continue;
    }

    try {
      const channel = await client.channels.fetch(item.channelId);
      if (!channel?.isSendable()) {
        pendingStore.remove(item.messageId);
        continue;
      }

      let replyTo: Message | undefined;
      try {
        replyTo = await channel.messages.fetch(item.messageId);
      } catch {
        replyTo = undefined;
      }

      await processDiscordRequest({
        config,
        agent,
        replyChannel: channel,
        sessionChannelId: item.sessionChannelId,
        prompt: item.prompt,
        messageId: item.messageId,
        authorId: item.authorId,
        guildId: item.guildId,
        replyTo,
        pendingStore,
        isRetry: true,
      });
    } catch (err) {
      console.warn(
        "Discord pending retry failed:",
        err instanceof Error ? err.message : String(err),
      );
      pendingStore.remove(item.messageId);
    }
  }
}

function registerShutdown(client: DiscordClient, pendingStore: DiscordPendingStore): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Discord gateway shutting down (${signal})`);

    try {
      await notifyRestart(client, pendingStore);
    } catch {
      // continue shutdown
    }

    try {
      client.destroy();
    } catch {
      // continue
    }

    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

export async function startDiscordGateway(config: HarnessConfig): Promise<void> {
  if (!config.discordBotToken) {
    console.log("DISCORD_BOT_TOKEN not set — skipping Discord gateway");
    return;
  }

  const agent = new AgentLoop(config);
  const threadStore = new DiscordThreadStore(config.home);
  const pendingStore = new DiscordPendingStore(config.home);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  registerShutdown(client, pendingStore);

  client.once(Events.ClientReady, async (c) => {
    console.log(`Discord gateway ready as ${c.user.tag}`);
    if (config.discordAutoThread) {
      console.log("Discord auto-thread enabled — @mention starts a thread, then chat freely");
    }
    await retryPending(client, config, agent, pendingStore);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!isAllowed(config, message.author.id, message.guildId)) return;
    if (!shouldRespond(config, message, client.user?.id, threadStore)) return;

    const prompt = stripBotMention(message.content, client.user?.id);
    if (!prompt) return;

    const resolved = await resolveReplyChannel(config, message, prompt, threadStore);
    if (!resolved) return;

    const { channel: replyChannel, sessionChannelId } = resolved;

    await processDiscordRequest({
      config,
      agent,
      replyChannel,
      sessionChannelId,
      prompt,
      messageId: message.id,
      authorId: message.author.id,
      guildId: message.guildId,
      replyTo: message,
      pendingStore,
    });
  });

  await client.login(config.discordBotToken);
}
