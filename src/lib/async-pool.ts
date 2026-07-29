/**
 * Ordered work-claiming pool. Items are claimed in input order, while handlers
 * run concurrently. `shouldStart` is checked immediately before each claim so
 * a time-budget gate can stop new work without cancelling in-flight work.
 */
export async function runAsyncPool<T>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
  shouldStart: () => boolean = () => true,
): Promise<void> {
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (!shouldStart()) return
      const index = nextIndex++
      await handler(items[index]!, index)
    }
  }

  await Promise.all(Array.from({length: workerCount}, () => worker()))
}
