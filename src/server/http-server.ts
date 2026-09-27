import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { handleChatCompletion, type ProxyDeps } from "./proxy"
import type { OpenAIChatRequest } from "./openai-types"

/**
 * A local-only OpenAI-compatible server, deliberately built on `node:http`
 * and NOT `Bun.serve()` — Bun.serve() conflicts with OpenCode's own internal
 * server (only one instance is allowed per process; confirmed via a real
 * fix in the opencode-preview plugin — see docs/implementation.md).
 * Started once per plugin load, lives for the OpenCode process's lifetime.
 *
 * Requires a bearer token (generated at startup, passed to OpenCode via the
 * provider's `options.apiKey`/`settings.apiKey`) — binding to loopback only
 * stops remote connections, but any other local process running as the same
 * OS user could otherwise reach it and spend the configured API keys.
 */
export class ZenoxRouterServer {
  private server: http.Server
  private port = 0

  constructor(
    private getDeps: () => ProxyDeps | undefined,
    private authToken: string,
  ) {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" })
        if (!res.writableEnded) res.end(JSON.stringify({ error: { message: "internal error" } }))
      })
    })
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve))
    this.port = (this.server.address() as AddressInfo).port
    return this.port
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => this.server.close((err) => (err ? reject(err) : resolve())))
  }

  getPort(): number {
    return this.port
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")

    if (url.pathname === "/v1/models" && req.method === "GET") {
      if (!this.isAuthorized(req)) return unauthorized(res)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ object: "list", data: [{ id: "auto", object: "model", owned_by: "zenox-router" }] }))
      return
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      if (!this.isAuthorized(req)) return unauthorized(res)
      await this.handleChatCompletions(req, res)
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: { message: "Not found" } }))
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization
    return header === `Bearer ${this.authToken}`
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const deps = this.getDeps()
    if (!deps) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "zenox-router is not configured yet — run `zenox-router setup`.", code: "not_configured" } }))
      return
    }

    const body = await readBody(req, MAX_BODY_BYTES)
    if (body === null) {
      res.writeHead(413, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "Request body too large" } }))
      return
    }

    let request: OpenAIChatRequest
    try {
      request = JSON.parse(body) as OpenAIChatRequest
    } catch {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }))
      return
    }

    const precomputedCategoryId = firstHeader(req.headers["x-zenox-category"]) || undefined
    const result = await handleChatCompletion(request, precomputedCategoryId, deps)

    res.writeHead(result.status, result.headers)
    if (result.stream) {
      try {
        for await (const piece of result.stream) {
          if (!res.write(piece)) await once(res, "drain")
        }
        res.end()
      } catch {
        // The response is already committed as 200 with headers sent — we cannot switch to an error
        // status at this point. Destroy the connection (rather than a clean res.end()) so the client
        // sees an aborted/truncated read, not a response that looks like it completed successfully —
        // res.end() here would silently present a corrupted answer as a normal one. (Mid-stream provider
        // failures are the case this handles; an immediate connection failure is already caught before
        // headers are written — see callDownstream's separate stream-start status checks.)
        res.destroy()
      }
      return
    }
    res.end(result.bodyText ?? "")
  }
}

const MAX_BODY_BYTES = 50 * 1024 * 1024 // 50MB — generous for large agentic tool-output-heavy conversations, still bounded

function unauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: { message: "Unauthorized" } }))
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function once(emitter: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => emitter.once(event, () => resolve()))
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on("data", (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        tooLarge = true
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf-8")))
    req.on("error", (err) => (tooLarge ? resolve(null) : reject(err)))
  })
}
