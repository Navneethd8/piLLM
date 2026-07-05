import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { HarnessConfig } from "../config.js";
import { AgentLoop } from "../agent/loop.js";
import { globalQueue } from "../queue/single-flight.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startWebServer(config: HarnessConfig): void {
  const agent = new AgentLoop(config);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "pillm-harness" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as {
          message?: string;
          session_id?: string;
          platform?: string;
        };
        if (!body.message?.trim()) {
          json(res, 400, { error: "message required" });
          return;
        }

        const message = body.message!.trim();
        const sessionId =
          body.session_id ??
          agent.getSessionStore().getOrCreateSession(
            body.platform ?? "web",
            "default",
          );

        const result = await globalQueue.enqueue(() =>
          agent.runTurn({
            sessionId,
            userText: message,
            platform: body.platform ?? "web",
          }),
        );

        json(res, 200, {
          reply: result.reply,
          provider: result.provider,
          iterations: result.iterations,
          session_id: sessionId,
        });
      } catch (err) {
        json(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    json(res, 404, { error: "not found" });
  });

  server.listen(config.webPort, config.webHost, () => {
    console.log(`pillm web listening on http://${config.webHost}:${config.webPort}`);
  });
}
