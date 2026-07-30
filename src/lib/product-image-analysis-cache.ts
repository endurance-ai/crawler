/** 휴면 — 모델컷 선별(macOS 전용). 배선·제약은 `src/select-product-images.ts` 헤더 참조. */
import * as fs from "node:fs"
import * as path from "node:path"
import {createRequire} from "node:module"

import {
  IMAGE_SELECTION_VERSION,
  type ImageCandidateAnalysis,
} from "./product-image-selection"

type SqliteStatement = {
  get: (...params: unknown[]) => unknown
  run: (...params: unknown[]) => unknown
}

type SqliteDatabase = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

export class ProductImageAnalysisCache {
  readonly #db: SqliteDatabase
  readonly #get: SqliteStatement
  readonly #put: SqliteStatement

  constructor(cacheDir: string) {
    fs.mkdirSync(cacheDir, {recursive: true})
    const require = createRequire(import.meta.url)
    const {DatabaseSync} = require("node:sqlite") as {
      DatabaseSync: new (filename: string) => SqliteDatabase
    }
    this.#db = new DatabaseSync(path.join(cacheDir, "analysis.sqlite"))
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS image_analysis (
        url TEXT NOT NULL,
        version TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (url, version)
      );
    `)
    this.#get = this.#db.prepare(
      "SELECT analysis_json FROM image_analysis WHERE url = ? AND version = ?",
    )
    this.#put = this.#db.prepare(`
      INSERT INTO image_analysis (url, version, analysis_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (url, version) DO UPDATE SET
        analysis_json = excluded.analysis_json,
        updated_at = excluded.updated_at
    `)
  }

  get(url: string): ImageCandidateAnalysis | null {
    const row = this.#get.get(url, IMAGE_SELECTION_VERSION) as
      | {analysis_json?: unknown}
      | undefined
    if (!row || typeof row.analysis_json !== "string") return null
    try {
      return JSON.parse(row.analysis_json) as ImageCandidateAnalysis
    } catch {
      return null
    }
  }

  put(analysis: ImageCandidateAnalysis): void {
    this.#put.run(
      analysis.url,
      IMAGE_SELECTION_VERSION,
      JSON.stringify(analysis),
      new Date().toISOString(),
    )
  }

  close(): void {
    this.#db.close()
  }
}
