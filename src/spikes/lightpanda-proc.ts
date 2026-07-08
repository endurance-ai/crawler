// Spawn helper for the Lightpanda CDP server used by the perf validation spike.
//
// Lightpanda hard-limits every process to ONE CDP connection / ONE context / ONE page.
// So "N concurrent pages" == "N lightpanda processes". This module encapsulates a single
// process=page unit: spawn `bin/lightpanda serve` on a port, wait until it accepts TCP,
// and hand back the ws endpoint + a killer.
import {type ChildProcess, spawn} from "node:child_process"
import {existsSync} from "node:fs"
import net from "node:net"
import path from "node:path"
import {fileURLToPath} from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Absolute path to the spike binary — also used as the RSS-sampling command matcher. */
export const LIGHTPANDA_BIN = path.resolve(__dirname, "../../bin/lightpanda")
const BIN = LIGHTPANDA_BIN

// Ephemeral port range for spike runs; each process claims one.
let nextPort = 9222

export interface LightpandaProc {
  wsEndpoint: string
  pid: number
  kill: () => void
}

/** Probe a TCP port until it accepts a connection or the deadline passes. */
async function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect({port, host}, () => {
        sock.destroy()
        resolve(true)
      })
      sock.on("error", () => resolve(false))
      sock.setTimeout(500, () => {
        sock.destroy()
        resolve(false)
      })
    })
    if (ok) return
    if (Date.now() > deadline) throw new Error(`lightpanda port ${port} not ready within ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Start one Lightpanda CDP server process (one process == one page, per Lightpanda's hard cap). */
export async function startLightpanda(): Promise<LightpandaProc> {
  if (!existsSync(BIN)) {
    throw new Error(`lightpanda binary missing at ${BIN} — run: bash scripts/install-lightpanda.sh`)
  }
  const host = "127.0.0.1"
  const port = nextPort++
  const child: ChildProcess = spawn(
    BIN,
    ["serve", "--host", host, "--port", String(port)],
    {stdio: ["ignore", "ignore", "inherit"]},
  )

  let exited = false
  child.on("exit", () => {
    exited = true
  })

  await waitForPort(port, host, 15_000).catch((err) => {
    child.kill("SIGKILL")
    throw err
  })

  if (exited || child.pid == null) {
    throw new Error("lightpanda process exited before becoming ready")
  }

  return {
    wsEndpoint: `ws://${host}:${port}`,
    pid: child.pid,
    kill: () => {
      if (!exited) child.kill("SIGKILL")
    },
  }
}
