import {createOpenAI} from "@ai-sdk/openai"
import {generateText, Output, type LanguageModelUsage} from "ai"
import {z} from "zod"

const DEFAULT_BASE_URLS = ["http://127.0.0.1:8001/v1", "http://127.0.0.1:8002/v1"]
const DEFAULT_MODEL = "qwen3-vl-30b-awq"
const CIRCUIT_OPEN_MS = 30_000
const LOCAL_API_KEY = "local-qwen"

export interface QwenRuntimeConfig {
  enabled: boolean
  baseUrls: string[]
  model: string
  timeoutMs: number
  maxRetries: number
  concurrencyPerEndpoint: number
}

export interface QwenAttemptContext {
  model: ReturnType<ReturnType<typeof createOpenAI>["chat"]>
  modelId: string
  endpoint: string
  abortSignal: AbortSignal
}

export interface QwenRunResult<T> {
  value: T
  model: string
  endpoint: string
  attempts: number
}

export interface QwenObjectResult<T> extends QwenRunResult<T> {
  usage: LanguageModelUsage
}

export class QwenDisabledError extends Error {
  constructor() {
    super("Qwen normalization is disabled")
    this.name = "QwenDisabledError"
  }
}

export class QwenUnavailableError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options)
    this.name = "QwenUnavailableError"
  }
}

class Semaphore {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.queue.shift()?.()
    }
  }
}

const semaphores = new Map<string, Semaphore>()
const roundRobinOffsets = new Map<string, number>()
const circuitOpenUntil = new Map<string, number>()

function parseInteger(raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`invalid Qwen numeric setting: ${raw}`)
  }
  return parsed
}

function normalizeLoopbackBaseUrl(raw: string): string {
  const url = new URL(raw.trim())
  const hostname = url.hostname.toLowerCase()
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(`QWEN_BASE_URLS must use a loopback host: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`QWEN_BASE_URLS must use http(s): ${raw}`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`QWEN_BASE_URLS contains unsupported URL components: ${raw}`)
  }
  return url.toString().replace(/\/$/, "")
}

export function loadQwenConfig(env: NodeJS.ProcessEnv = process.env): QwenRuntimeConfig {
  const enabled = env.QWEN_ENABLED?.trim().toLowerCase() !== "false"
  const rawBaseUrls = env.QWEN_BASE_URLS?.split(",") ?? DEFAULT_BASE_URLS
  const baseUrls = [...new Set(rawBaseUrls.map(normalizeLoopbackBaseUrl))]
  if (baseUrls.length === 0) throw new Error("QWEN_BASE_URLS must contain at least one endpoint")

  return {
    enabled,
    baseUrls,
    model: env.QWEN_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: parseInteger(env.QWEN_TIMEOUT_MS, 45_000, 1),
    maxRetries: parseInteger(env.QWEN_MAX_RETRIES, 2, 0),
    concurrencyPerEndpoint: parseInteger(env.QWEN_CONCURRENCY_PER_ENDPOINT, 1, 1),
  }
}

function runtimeKey(config: QwenRuntimeConfig): string {
  return `${config.baseUrls.join(",")}|${config.model}|${config.concurrencyPerEndpoint}`
}

function semaphoreFor(endpoint: string, concurrency: number): Semaphore {
  const key = `${endpoint}|${concurrency}`
  let semaphore = semaphores.get(key)
  if (!semaphore) {
    semaphore = new Semaphore(concurrency)
    semaphores.set(key, semaphore)
  }
  return semaphore
}

function statusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const candidate = error as {status?: unknown; statusCode?: unknown; cause?: unknown}
  const direct = candidate.status ?? candidate.statusCode
  if (typeof direct === "number") return direct
  return candidate.cause === error ? null : statusCode(candidate.cause)
}

function isTransient(error: unknown): boolean {
  if (error instanceof QwenDisabledError || error instanceof QwenUnavailableError) return false
  const name = error instanceof Error ? error.name : ""
  if (/NoObjectGenerated|TypeValidation|InvalidResponseData/i.test(name)) return false
  const status = statusCode(error)
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500
  return true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runWithQwen<T>(
  operation: (context: QwenAttemptContext) => Promise<T>,
  config: QwenRuntimeConfig = loadQwenConfig(),
): Promise<QwenRunResult<T>> {
  if (!config.enabled) throw new QwenDisabledError()

  const key = runtimeKey(config)
  const now = Date.now()
  const openUntil = circuitOpenUntil.get(key) ?? 0
  if (openUntil > now) {
    throw new QwenUnavailableError(`Qwen circuit is open for ${openUntil - now}ms`)
  }

  const start = roundRobinOffsets.get(key) ?? 0
  roundRobinOffsets.set(key, (start + 1) % config.baseUrls.length)
  const failedEndpoints = new Set<string>()
  let lastError: unknown

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const endpoint = config.baseUrls[(start + attempt) % config.baseUrls.length]!
    const release = await semaphoreFor(endpoint, config.concurrencyPerEndpoint).acquire()
    try {
      const currentOpenUntil = circuitOpenUntil.get(key) ?? 0
      if (currentOpenUntil > Date.now()) {
        throw new QwenUnavailableError(`Qwen circuit is open for ${currentOpenUntil - Date.now()}ms`)
      }
      const provider = createOpenAI({
        baseURL: endpoint,
        apiKey: LOCAL_API_KEY,
        name: "qwen-local",
      })
      const value = await operation({
        model: provider.chat(config.model),
        modelId: config.model,
        endpoint,
        abortSignal: AbortSignal.timeout(config.timeoutMs),
      })
      circuitOpenUntil.delete(key)
      return {value, model: config.model, endpoint, attempts: attempt + 1}
    } catch (error) {
      lastError = error
      if (!isTransient(error)) throw error
      failedEndpoints.add(endpoint)
    } finally {
      release()
    }

    if (attempt < config.maxRetries) await delay(Math.min(1000, 200 * 2 ** attempt))
  }

  if (failedEndpoints.size === config.baseUrls.length) {
    circuitOpenUntil.set(key, Date.now() + CIRCUIT_OPEN_MS)
  }
  throw new QwenUnavailableError(
    `Qwen request failed after ${config.maxRetries + 1} attempt(s): ${errorMessage(lastError)}`,
    {cause: lastError},
  )
}

export async function generateQwenObject<T>(options: {
  schema: z.ZodType<T>
  system: string
  prompt: string
  temperature?: number
}): Promise<QwenObjectResult<T>> {
  const result = await runWithQwen(async ({model, abortSignal}) => {
    const generated = await generateText({
      model,
      output: Output.object({schema: options.schema}),
      system: options.system,
      prompt: options.prompt,
      temperature: options.temperature ?? 0,
      maxRetries: 0,
      abortSignal,
    })
    return {output: generated.output, usage: generated.usage}
  })
  return {
    value: result.value.output,
    usage: result.value.usage,
    model: result.model,
    endpoint: result.endpoint,
    attempts: result.attempts,
  }
}

export function resetQwenRuntimeForTests(): void {
  semaphores.clear()
  roundRobinOffsets.clear()
  circuitOpenUntil.clear()
}
