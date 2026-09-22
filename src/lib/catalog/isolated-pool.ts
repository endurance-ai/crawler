export interface IsolatedPoolFailure<T> {
  item: T
  error: unknown
}

/** Run every item while containing an item failure to that item. */
export async function runIsolatedPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<Array<IsolatedPoolFailure<T>>> {
  let cursor = 0
  const failures: Array<IsolatedPoolFailure<T>> = []
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  await Promise.all(Array.from({length: workerCount}, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!
      try {
        await worker(item)
      } catch (error) {
        failures.push({item, error})
      }
    }
  }))
  return failures
}
