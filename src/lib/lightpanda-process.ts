import {type ChildProcess, spawn} from "node:child_process"
import {existsSync} from "node:fs"
import net from "node:net"
import path from "node:path"

export interface LightpandaProcess {
  wsEndpoint: string
  pid: number
  kill(): void
}

function defaultLightpandaBin(): string {
  return path.resolve(process.cwd(), "bin/lightpanda")
}

export function resolveLightpandaBin(): string {
  return process.env.LIGHTPANDA_BIN || defaultLightpandaBin()
}

async function findFreePort(host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate lightpanda port")))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

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
    if (Date.now() > deadline) {
      throw new Error(`lightpanda port ${port} not ready within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export async function startLightpandaProcess(): Promise<LightpandaProcess> {
  const bin = resolveLightpandaBin()
  if (!existsSync(bin)) {
    throw new Error(`lightpanda binary missing at ${bin} — run: bash scripts/install-lightpanda.sh`)
  }

  const host = "127.0.0.1"
  const port = await findFreePort(host)
  const child: ChildProcess = spawn(
    bin,
    ["serve", "--host", host, "--port", String(port)],
    {
      env: {
        ...process.env,
        LIGHTPANDA_DISABLE_TELEMETRY: process.env.LIGHTPANDA_DISABLE_TELEMETRY || "true",
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
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
