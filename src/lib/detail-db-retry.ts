export type DetailDbError = {code?: string; message?: string}

type DetailWriteResult<T> = {data: T[] | null; error: DetailDbError | null}
type DetailReadResult<T> = {data: T | null; error: DetailDbError | null}

export type DetailCasOutcome<T> =
  | {kind: "written"}
  | {kind: "conflict"; current: T}
  | {kind: "failed"; code?: string}

/** Retry connection, timeout, and transaction failures without replaying permanent DB errors. */
export function isRetryableDetailDbError(error: DetailDbError): boolean {
  const code = typeof error.code === "string" ? error.code : ""
  if (/^(?:08|PGRST00[0-3]$)/.test(code) || code === "AbortError") return true
  if (["40001", "40P01", "53300", "57014", "57P01", "57P03", "502", "503", "504"].includes(code)) return true
  if (code) return false
  return /fetch failed|network|timed? out|timeout|aborted|ECONNRESET|ETIMEDOUT/i.test(error.message ?? "")
}

/** A timed-out response may hide a write that reached Postgres. */
export function wasDetailWriteRecorded(currentUpdatedAt: string, observedAt: string): boolean {
  const current = Date.parse(currentUpdatedAt)
  return Number.isFinite(current) && current === Date.parse(observedAt)
}

export async function retryTransientDetailWrite<T>(
  write: () => PromiseLike<DetailWriteResult<T>>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<DetailWriteResult<T> & {hadTransientError: boolean}> {
  let hadTransientError = false
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: DetailWriteResult<T>
    try {
      result = await write()
    } catch (error) {
      const value = error && typeof error === "object" ? error as DetailDbError : {message: String(error)}
      const code = typeof value.code === "string" ? value.code : undefined
      if (!code && !isRetryableDetailDbError(value)) throw error
      result = {data: null, error: {code, message: value.message ?? String(error)}}
    }
    const transient = Boolean(result.error && isRetryableDetailDbError(result.error))
    hadTransientError ||= transient
    if (!transient || attempt === 1) return {...result, hadTransientError}
    await wait(300)
  }
  throw new Error("unreachable detail DB retry state")
}

/** Resolve an ambiguous CAS response before reporting a conflict or DB failure. */
export async function applyDetailCasWrite<Row extends {updated_at: string}, Written>(
  observedAt: string,
  write: () => PromiseLike<DetailWriteResult<Written>>,
  reload: () => PromiseLike<DetailReadResult<Row>>,
  wait?: (ms: number) => Promise<void>,
): Promise<DetailCasOutcome<Row>> {
  const result = await retryTransientDetailWrite(write, wait)
  if (!result.error && result.data?.length === 1) return {kind: "written"}
  if (result.error && !result.hadTransientError) return {kind: "failed", code: result.error.code}

  const current = await reload()
  if (current.error || !current.data) return {kind: "failed", code: current.error?.code}
  if (wasDetailWriteRecorded(current.data.updated_at, observedAt)) return {kind: "written"}
  if (result.error) return {kind: "failed", code: result.error.code}
  return {kind: "conflict", current: current.data}
}

/** Preserve the old URL when a canonical redirect points at another stored product. */
export async function recoverDuplicateCanonicalUrl<Row extends {updated_at: string}>(
  outcome: DetailCasOutcome<Row>,
  patch: {product_url?: string},
  currentId: string,
  findCanonicalProduct: () => PromiseLike<DetailReadResult<{id: string}>>,
  retryWithoutUrl: () => Promise<DetailCasOutcome<Row>>,
): Promise<{outcome: DetailCasOutcome<Row>; preservedUrl: boolean}> {
  if (outcome.kind !== "failed" || outcome.code !== "23505" || !patch.product_url) {
    return {outcome, preservedUrl: false}
  }
  const target = await findCanonicalProduct()
  if (target.error || !target.data || String(target.data.id) === String(currentId)) {
    return {outcome, preservedUrl: false}
  }
  delete patch.product_url
  return {outcome: await retryWithoutUrl(), preservedUrl: true}
}
