import assert from "node:assert/strict"
import {createServer, type Server} from "node:http"
import test, {afterEach} from "node:test"

import {z} from "zod"

import {
  assertQwenReady,
  generateQwenObject,
  loadQwenConfig,
  QwenUnavailableError,
  resetQwenRuntimeForTests,
  runWithQwen,
} from "../src/lib/qwen-client"

const ORIGINAL_ENV = {...process.env}

afterEach(() => {
  process.env = {...ORIGINAL_ENV}
  resetQwenRuntimeForTests()
})

async function listen(
  handler: Parameters<typeof createServer>[0],
): Promise<{server: Server; baseUrl: string}> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  return {server, baseUrl: `http://127.0.0.1:${address.port}/v1`}
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

test("rejects non-loopback Qwen endpoints", () => {
  assert.throws(
    () => loadQwenConfig({QWEN_BASE_URLS: "https://api.openai.com/v1"}),
    /loopback host/,
  )
})

test("defaults to the single 8001 endpoint", () => {
  const config = loadQwenConfig({})
  assert.deepEqual(config.baseUrls, ["http://127.0.0.1:8001/v1"])
})

test("preflight requires every endpoint to expose the configured model", async () => {
  const healthy = await listen((_request, response) => {
    response.writeHead(200, {"content-type": "application/json"})
    response.end(JSON.stringify({data: [{id: "qwen3-vl-30b-awq"}]}))
  })
  const wrongModel = await listen((_request, response) => {
    response.writeHead(200, {"content-type": "application/json"})
    response.end(JSON.stringify({data: [{id: "another-model"}]}))
  })

  try {
    const ready = await assertQwenReady(loadQwenConfig({
      QWEN_BASE_URLS: healthy.baseUrl,
      QWEN_MODEL: "qwen3-vl-30b-awq",
    }))
    assert.deepEqual(ready, [{endpoint: healthy.baseUrl, model: "qwen3-vl-30b-awq"}])

    await assert.rejects(
      assertQwenReady(loadQwenConfig({
        QWEN_BASE_URLS: `${healthy.baseUrl},${wrongModel.baseUrl}`,
        QWEN_MODEL: "qwen3-vl-30b-awq",
      })),
      /configured model qwen3-vl-30b-awq not found/,
    )
  } finally {
    await close(healthy.server)
    await close(wrongModel.server)
  }
})

test("preflight reports the missing SSH tunnel as unavailable", async () => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  await close(server)

  await assert.rejects(
    assertQwenReady(loadQwenConfig({
      QWEN_BASE_URLS: baseUrl,
      QWEN_MAX_RETRIES: "0",
    })),
    (error: unknown) =>
      error instanceof QwenUnavailableError &&
      /Create the SSH tunnel first/.test(error.message),
  )
})

test("round-robins calls across configured endpoints", async () => {
  const seen: string[] = []
  const config = loadQwenConfig({
    QWEN_BASE_URLS: "http://127.0.0.1:8001/v1,http://127.0.0.1:8002/v1",
    QWEN_MAX_RETRIES: "0",
  })

  await runWithQwen(async ({endpoint}) => seen.push(endpoint), config)
  await runWithQwen(async ({endpoint}) => seen.push(endpoint), config)

  assert.deepEqual(seen, ["http://127.0.0.1:8001/v1", "http://127.0.0.1:8002/v1"])
})

test("fails over to the next endpoint after a transient error", async () => {
  const seen: string[] = []
  const config = loadQwenConfig({
    QWEN_BASE_URLS: "http://127.0.0.1:8001/v1,http://127.0.0.1:8002/v1",
    QWEN_MAX_RETRIES: "1",
  })

  const result = await runWithQwen(async ({endpoint}) => {
    seen.push(endpoint)
    if (endpoint.includes("8001")) throw Object.assign(new Error("busy"), {status: 503})
    return "ok"
  }, config)

  assert.equal(result.value, "ok")
  assert.equal(result.attempts, 2)
  assert.deepEqual(seen, ["http://127.0.0.1:8001/v1", "http://127.0.0.1:8002/v1"])
})

test("aborts an attempt at the configured timeout", async () => {
  const config = loadQwenConfig({
    QWEN_BASE_URLS: "http://127.0.0.1:8001/v1",
    QWEN_TIMEOUT_MS: "10",
    QWEN_MAX_RETRIES: "0",
  })

  await assert.rejects(
    runWithQwen(
      ({abortSignal}) =>
        new Promise((_, reject) => {
          const guard = setTimeout(() => reject(new Error("timeout signal was not delivered")), 100)
          abortSignal.addEventListener("abort", () => {
            clearTimeout(guard)
            reject(abortSignal.reason)
          }, {once: true})
        }),
      config,
    ),
    QwenUnavailableError,
  )
})

test("opens the circuit after every endpoint fails", async () => {
  let attempts = 0
  const config = loadQwenConfig({
    QWEN_BASE_URLS: "http://127.0.0.1:8001/v1,http://127.0.0.1:8002/v1",
    QWEN_MAX_RETRIES: "1",
  })
  const fail = () => {
    attempts++
    throw Object.assign(new Error("unavailable"), {status: 503})
  }

  await assert.rejects(runWithQwen(fail, config), QwenUnavailableError)
  assert.equal(attempts, 2)
  await assert.rejects(runWithQwen(fail, config), /circuit is open/)
  assert.equal(attempts, 2, "an open circuit must reject before another model call")
})

test("limits concurrent calls per endpoint", async () => {
  let active = 0
  let maxActive = 0
  const config = loadQwenConfig({
    QWEN_BASE_URLS: "http://127.0.0.1:8001/v1",
    QWEN_CONCURRENCY_PER_ENDPOINT: "1",
    QWEN_MAX_RETRIES: "0",
  })
  const operation = () =>
    runWithQwen(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
    }, config)

  await Promise.all([operation(), operation(), operation()])
  assert.equal(maxActive, 1)
})

test("sends the Qwen model and strict json_schema to the local chat endpoint", async () => {
  let requestBody: Record<string, unknown> | undefined
  const {server, baseUrl} = await listen((request, response) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      requestBody = JSON.parse(body) as Record<string, unknown>
      response.writeHead(200, {"content-type": "application/json"})
      response.end(
        JSON.stringify({
          id: "chatcmpl-local",
          object: "chat.completion",
          created: 1,
          model: "qwen3-vl-30b-awq",
          choices: [
            {
              index: 0,
              message: {role: "assistant", content: '{"category":"other"}'},
              finish_reason: "stop",
            },
          ],
          usage: {prompt_tokens: 2, completion_tokens: 1, total_tokens: 3},
        }),
      )
    })
  })

  process.env.QWEN_BASE_URLS = baseUrl
  process.env.QWEN_MODEL = "qwen3-vl-30b-awq"
  process.env.QWEN_MAX_RETRIES = "0"
  try {
    const result = await generateQwenObject({
      schema: z.object({category: z.literal("other")}),
      system: "Classify.",
      prompt: "one item",
    })
    assert.deepEqual(result.value, {category: "other"})
    assert.equal(requestBody?.model, "qwen3-vl-30b-awq")
    assert.deepEqual(requestBody?.response_format, {
      type: "json_schema",
      json_schema: {
        schema: {
          type: "object",
          properties: {category: {type: "string", const: "other"}},
          required: ["category"],
          additionalProperties: false,
          $schema: "http://json-schema.org/draft-07/schema#",
        },
        strict: true,
        name: "response",
      },
    })
  } finally {
    await close(server)
  }
})

test("sends an image URL as multimodal content when requested", async () => {
  let requestBody: any
  const {server, baseUrl} = await listen((request, response) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      requestBody = JSON.parse(body)
      response.writeHead(200, {"content-type": "application/json"})
      response.end(JSON.stringify({
        id: "chatcmpl-vision", object: "chat.completion", created: 1,
        model: "qwen3-vl-30b-awq",
        choices: [{index: 0, message: {role: "assistant", content: '{"color":"BLACK"}'}, finish_reason: "stop"}],
        usage: {prompt_tokens: 2, completion_tokens: 1, total_tokens: 3},
      }))
    })
  })
  process.env.QWEN_BASE_URLS = baseUrl
  process.env.QWEN_MAX_RETRIES = "0"
  try {
    await generateQwenObject({
      schema: z.object({color: z.literal("BLACK")}),
      system: "Inspect.", prompt: "product", imageUrl: "https://cdn.example.com/product.jpg",
    })
    assert.deepEqual(requestBody.messages[1].content, [
      {type: "text", text: "product"},
      {type: "image_url", image_url: {url: "https://cdn.example.com/product.jpg"}},
    ])
  } finally {
    await close(server)
  }
})
