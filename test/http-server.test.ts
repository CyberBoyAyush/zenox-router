import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ZenoxRouterServer } from "../src/server/http-server"
import type { ProxyDeps } from "../src/server/proxy"

let server: ZenoxRouterServer
let port: number
const TOKEN = "test-token-abc"

beforeEach(async () => {
  server = new ZenoxRouterServer((): ProxyDeps | undefined => undefined, TOKEN)
  port = await server.start()
})

afterEach(async () => {
  await server.stop()
})

describe("ZenoxRouterServer auth", () => {
  test("rejects requests with no Authorization header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`)
    expect(res.status).toBe(401)
  })

  test("rejects requests with the wrong token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: "Bearer wrong-token" } })
    expect(res.status).toBe(401)
  })

  test("accepts requests with the correct bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
  })

  test("chat completions also requires auth", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" })
    expect(res.status).toBe(401)
  })

  test("returns a clear 503 when not configured (authorized but no deps)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [] }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("not_configured")
  })

  test("unknown route returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`)
    expect(res.status).toBe(404)
  })
})
