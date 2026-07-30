/** 휴면 — 모델컷 선별(macOS 전용). 배선·제약은 `src/select-product-images.ts` 헤더 참조. */
import {spawn, spawnSync, type ChildProcessWithoutNullStreams} from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"

import type {ImageCandidateAnalysis} from "./product-image-selection"

interface NativeResult extends ImageCandidateAnalysis {
  id: string
  error?: string | null
}

interface PendingRequest {
  resolve: (value: ImageCandidateAnalysis) => void
  reject: (error: Error) => void
}

function ensureNativeBinary(cacheDir: string): string {
  if (process.platform !== "darwin") {
    throw new Error("product image selection requires macOS 15+ with Apple Vision")
  }
  const source = path.join(process.cwd(), "tools", "product-image-vision", "main.m")
  if (!fs.existsSync(source)) throw new Error(`Apple Vision source missing: ${source}`)

  const binDir = path.join(cacheDir, "bin")
  const moduleCache = path.join(cacheDir, "clang-module-cache")
  const binary = path.join(binDir, "product-image-vision")
  fs.mkdirSync(binDir, {recursive: true})
  fs.mkdirSync(moduleCache, {recursive: true})

  const sourceMtime = fs.statSync(source).mtimeMs
  const binaryMtime = fs.existsSync(binary) ? fs.statSync(binary).mtimeMs : 0
  if (binaryMtime >= sourceMtime) return binary

  const result = spawnSync(
    "xcrun",
    [
      "clang",
      "-fobjc-arc",
      "-O2",
      "-mmacosx-version-min=15.0",
      source,
      "-framework",
      "Foundation",
      "-framework",
      "Vision",
      "-framework",
      "ImageIO",
      "-framework",
      "CoreGraphics",
      "-o",
      binary,
    ],
    {
      encoding: "utf8",
      env: {...process.env, CLANG_MODULE_CACHE_PATH: moduleCache},
    },
  )
  if (result.status !== 0) {
    throw new Error(`failed to compile Apple Vision helper: ${result.stderr || result.stdout}`)
  }
  return binary
}

export class ProductImageVisionClient {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<string, PendingRequest>()
  readonly #stderr: string[] = []
  #sequence = 0
  #closed = false

  constructor(cacheDir: string) {
    const binary = ensureNativeBinary(cacheDir)
    this.#child = spawn(binary, [], {stdio: ["pipe", "pipe", "pipe"]})
    const lines = readline.createInterface({input: this.#child.stdout})
    lines.on("line", (line) => {
      let result: NativeResult
      try {
        result = JSON.parse(line) as NativeResult
      } catch {
        return
      }
      const pending = this.#pending.get(result.id)
      if (!pending) return
      this.#pending.delete(result.id)
      const {id: _id, error: _error, ...analysis} = result
      pending.resolve(analysis)
    })
    this.#child.stderr.on("data", (chunk: Buffer) => {
      if (this.#stderr.length < 20) this.#stderr.push(chunk.toString("utf8").trim())
    })
    this.#child.on("exit", (code, signal) => {
      const detail = this.#stderr.filter(Boolean).join("\n")
      const error = new Error(
        `Apple Vision helper exited (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`,
      )
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
      this.#closed = true
    })
  }

  analyze(input: {
    path: string
    url: string
    byteLength: number
    mimeType: string
  }): Promise<ImageCandidateAnalysis> {
    if (this.#closed) return Promise.reject(new Error("Apple Vision helper is closed"))
    const id = String(++this.#sequence)
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {resolve, reject})
      this.#child.stdin.write(`${JSON.stringify({id, ...input})}\n`, (error) => {
        if (!error) return
        this.#pending.delete(id)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#child.stdin.end()
    await new Promise<void>((resolve) => {
      this.#child.once("exit", () => resolve())
    })
  }
}
