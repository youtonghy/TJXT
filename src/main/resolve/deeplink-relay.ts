import http from 'http'
import net from 'net'
import path from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { createLogger } from '../utils/logger'
import { dataDir } from '../utils/dirs'

const logger = createLogger('deeplink-relay')
const RELAY_HOST = '127.0.0.1'
const DEFAULT_PORT = 27149
const MAX_PORT_OFFSET = 20
const RELAY_PATH = '/deeplink'
const RELAY_FILE = path.join(dataDir(), 'deeplink-relay.json')

type RelayConfig = {
  port: number
}

let server: http.Server | null = null
let currentPort: number | null = null

const sanitizeDeepLink = (raw?: string | null): string | null => {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || null
  }
  return trimmed
}

export const isSupportedDeepLink = (url: string): boolean => {
  return url.startsWith('mihomo://') || url.startsWith('clash://')
}

export const extractDeepLinkFromArgs = (args: string[]): string | null => {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const candidate = sanitizeDeepLink(args[i])
    if (candidate && isSupportedDeepLink(candidate)) return candidate
  }
  return null
}

const readRelayConfig = async (): Promise<RelayConfig | null> => {
  try {
    const raw = await readFile(RELAY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RelayConfig>
    if (parsed && typeof parsed.port === 'number' && parsed.port > 0) {
      return { port: parsed.port }
    }
  } catch {
    // ignore
  }
  return null
}

const writeRelayConfig = async (port: number): Promise<void> => {
  await mkdir(dataDir(), { recursive: true })
  const payload: RelayConfig = { port }
  await writeFile(RELAY_FILE, JSON.stringify(payload, null, 2), 'utf-8')
}

const readRequestBody = async (req: http.IncomingMessage): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

const createRelayServer = (onDeepLink: (url: string) => void): http.Server => {
  return http.createServer(async (req, res) => {
    if (!req.url || req.method !== 'POST' || req.url !== RELAY_PATH) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    try {
      const body = await readRequestBody(req)
      const payload = JSON.parse(body) as { url?: string }
      const url = sanitizeDeepLink(payload?.url)
      if (!url || !isSupportedDeepLink(url)) {
        res.statusCode = 400
        res.end('invalid deeplink')
        return
      }

      onDeepLink(url)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (error) {
      logger.warn('Failed to handle relay request', error)
      res.statusCode = 500
      res.end('error')
    }
  })
}

const tryListen = (port: number, onDeepLink: (url: string) => void): Promise<http.Server> => {
  return new Promise((resolve, reject) => {
    const httpServer = createRelayServer(onDeepLink)
    const onError = (error: NodeJS.ErrnoException) => {
      httpServer.removeAllListeners()
      httpServer.close(() => undefined)
      reject(error)
    }
    httpServer.once('error', onError)
    httpServer.listen(port, RELAY_HOST, () => {
      httpServer.removeListener('error', onError)
      resolve(httpServer)
    })
  })
}

const findAvailablePort = async (startPort: number): Promise<number | null> => {
  for (let offset = 0; offset <= MAX_PORT_OFFSET; offset += 1) {
    const port = startPort + offset
    const isAvailable = await new Promise<boolean>((resolve) => {
      const tester = net.createServer()
      tester.once('error', () => {
        resolve(false)
      })
      tester.once('listening', () => {
        tester.close(() => resolve(true))
      })
      tester.listen(port, RELAY_HOST)
    })
    if (isAvailable) return port
  }
  return null
}

export const startDeepLinkRelay = async (
  onDeepLink: (url: string) => void
): Promise<number | null> => {
  if (server && currentPort) return currentPort

  const config = await readRelayConfig()
  const basePort = config?.port ?? DEFAULT_PORT
  const port = await findAvailablePort(basePort)
  if (!port) {
    logger.warn('No available port for deeplink relay')
    return null
  }

  try {
    server = await tryListen(port, onDeepLink)
    currentPort = port
    await writeRelayConfig(port)
    logger.info(`Deep link relay listening on ${RELAY_HOST}:${port}`)
    return port
  } catch (error) {
    logger.warn('Failed to start deeplink relay server', error)
    return null
  }
}

const postToRelay = (port: number, url: string, timeoutMs: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ url })
    const req = http.request(
      {
        host: RELAY_HOST,
        port,
        path: RELAY_PATH,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )

    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.write(payload)
    req.end()
  })
}

export const sendDeepLinkToRelay = async (rawUrl: string, timeoutMs = 1500): Promise<boolean> => {
  const url = sanitizeDeepLink(rawUrl)
  if (!url || !isSupportedDeepLink(url)) return false

  const config = await readRelayConfig()
  const ports = [config?.port, DEFAULT_PORT].filter(
    (value): value is number => typeof value === 'number'
  )
  const uniquePorts = Array.from(new Set(ports))

  for (const port of uniquePorts) {
    const ok = await postToRelay(port, url, timeoutMs)
    if (ok) return true
  }
  return false
}
