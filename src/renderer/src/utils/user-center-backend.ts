/**
 * User center backend management utilities
 */

import backendSeedsRaw from '@renderer/config/user-center-backends.json'
import { API_USER_AGENT } from './api-service'
import { userCenterApiRequest } from './ipc'

type BackendSeed = {
  id: string
  name: string
  url: string
  isDefault?: boolean
  apiVersion?: string
}

const normalizeApiVersion = (value?: string): 'v1' | 'v3' => {
  return value === 'v1' ? 'v1' : 'v3'
}

export const normalizeBackendUrl = (value?: string): string => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/u, '')
  }
  return `https://${trimmed.replace(/^\/+/, '')}`.replace(/\/+$/u, '')
}

const getBackendSeeds = (): BackendSeed[] => {
  if (!Array.isArray(backendSeedsRaw)) return []
  return backendSeedsRaw
    .filter((item) => {
      if (!item) return false
      const maybe = item as unknown as Partial<BackendSeed>
      return (
        typeof maybe.id === 'string' &&
        typeof maybe.name === 'string' &&
        typeof maybe.url === 'string'
      )
    })
    .map((item) => item as unknown as BackendSeed)
}

const mergeBackendsWithSeeds = (existing: IUserCenterBackend[] = []): IUserCenterBackend[] => {
  const seeds = getBackendSeeds()
  if (seeds.length === 0) return existing

  const existingById = new Map(existing.map((backend) => [backend.id, backend]))
  const merged = seeds.map((seed) => {
    const stored = existingById.get(seed.id)
    return {
      id: seed.id,
      name: seed.name,
      url: normalizeBackendUrl(seed.url || stored?.url),
      apiVersion: normalizeApiVersion(seed.apiVersion ?? stored?.apiVersion),
      isDefault: stored?.isDefault ?? seed.isDefault ?? false,
      lastPing: stored?.lastPing,
      lastTest: stored?.lastTest,
      isActive: stored?.isActive
    } as IUserCenterBackend
  })

  if (!merged.some((backend) => backend.isDefault) && merged.length > 0) {
    merged[0].isDefault = true
  }

  return merged
}

export const getBackendApiPath = (backend?: IUserCenterBackend): string => {
  return `/api/${normalizeApiVersion(backend?.apiVersion)}`
}

export const getBackendApiBaseUrl = (backend?: IUserCenterBackend): string => {
  const baseUrl = normalizeBackendUrl(backend?.url)
  if (!baseUrl) return ''
  return `${baseUrl}${getBackendApiPath(backend)}`
}

/**
 * V3 网关调用辅助函数
 * V3 API 需要通过 /api/v3/server 网关转发请求
 */
export const callV3Gateway = async (
  baseUrl: string,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  params?: Record<string, unknown>,
  headers?: Record<string, string>,
  timeoutMs: number = 10000
): Promise<Response> => {
  const gatewayUrl = `${baseUrl}/api/v3/server`

  const body: Record<string, unknown> = {
    endpoint,
    method
  }

  if (params && Object.keys(params).length > 0) {
    body.params = params
  }

  const response = await userCenterApiRequest({
    url: gatewayUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    timeoutMs
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

export interface BackendTestResult {
  id: string
  url: string
  name: string
  ping: number | null
  isActive: boolean
  error?: string
}

/**
 * Test latency for a single backend
 * 使用 V3 网关调用 guest/comm/config 测试延迟
 * 超时时间为 1 秒
 */
export const testBackendLatency = async (
  backend: IUserCenterBackend
): Promise<BackendTestResult> => {
  const startTime = Date.now()
  const baseUrl = normalizeBackendUrl(backend.url)

  try {
    const response = await callV3Gateway(
      baseUrl,
      'guest/comm/config',
      'GET',
      undefined,
      {
        'User-Agent': API_USER_AGENT
      },
      1000 // 1秒超时
    )

    const endTime = Date.now()
    const ping = endTime - startTime

    return {
      id: backend.id,
      url: backend.url,
      name: backend.name,
      ping: response.ok ? ping : null,
      isActive: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`
    }
  } catch (error) {
    return {
      id: backend.id,
      url: backend.url,
      name: backend.name,
      ping: null,
      isActive: false,
      error: error instanceof Error ? error.message : '连接失败'
    }
  }
}

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  runner: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex
      if (currentIndex >= items.length) return
      nextIndex += 1
      results[currentIndex] = await runner(items[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Test latency for all backends
 */
export const testAllBackendsLatency = async (
  backends: IUserCenterBackend[]
): Promise<BackendTestResult[]> => {
  return runWithConcurrency(backends, 3, (backend) => testBackendLatency(backend))
}

/**
 * Get default backend from configuration
 */
export const getDefaultBackend = (appConfig?: IAppConfig): IUserCenterBackend => {
  const backends = getAllBackends(appConfig)

  // Find explicitly marked default backend
  const defaultBackend = backends.find((backend) => backend.isDefault)
  if (defaultBackend) {
    return defaultBackend
  }

  // Fall back to first backend
  if (backends.length > 0) {
    return backends[0]
  }

  return {
    id: 'default',
    name: 'Default Backend',
    url: '',
    isDefault: true
  }
}

/**
 * Get active backend: prefer user's session selection (localStorage) then default
 */
export const getActiveBackend = (appConfig?: IAppConfig): IUserCenterBackend => {
  try {
    const selectedId = localStorage.getItem('userCenter.selectedBackendId')
    if (selectedId) {
      const all = getAllBackends(appConfig)
      const picked = all.find((b) => b.id === selectedId)
      if (picked) return picked
      // If saved id no longer exists, fall back to default
    }
  } catch {}
  return getDefaultBackend(appConfig)
}

export const getActiveBackendApiBaseUrl = (appConfig?: IAppConfig): string => {
  return getBackendApiBaseUrl(getActiveBackend(appConfig))
}

/**
 * Get all backends with fallback to legacy configuration
 */
export const getAllBackends = (appConfig?: IAppConfig): IUserCenterBackend[] => {
  const backends = appConfig?.userCenterBackends || []
  return mergeBackendsWithSeeds(backends)
}

/**
 * Update backend configuration
 */
export const updateBackends = async (
  newBackends: IUserCenterBackend[],
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>
): Promise<void> => {
  const normalized = newBackends.map((backend) => ({
    ...backend,
    url: normalizeBackendUrl(backend.url),
    apiVersion: normalizeApiVersion(backend.apiVersion)
  }))

  // Ensure at least one backend is marked as default
  if (!normalized.some((backend) => backend.isDefault) && normalized.length > 0) {
    normalized[0].isDefault = true
  }

  await patchAppConfig({ userCenterBackends: normalized })
}

/**
 * Set default backend
 */
export const setDefaultBackend = async (
  backendId: string,
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>,
  appConfig?: IAppConfig
): Promise<void> => {
  const backends = getAllBackends(appConfig)
  const updatedBackends = backends.map((backend) => ({
    ...backend,
    isDefault: backend.id === backendId
  }))

  await updateBackends(updatedBackends, patchAppConfig)
}

/**
 * Add new backend
 */
export const addBackend = async (
  backend: Omit<IUserCenterBackend, 'id'>,
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>,
  appConfig?: IAppConfig
): Promise<void> => {
  const existingBackends = getAllBackends(appConfig)
  const newBackend: IUserCenterBackend = {
    ...backend,
    id: Date.now().toString(),
    isDefault: existingBackends.length === 0 || backend.isDefault
  }

  // If this backend is set as default, unmark others
  const updatedBackends = existingBackends.map((b) => ({
    ...b,
    isDefault: newBackend.isDefault ? false : b.isDefault
  }))

  updatedBackends.push(newBackend)
  await updateBackends(updatedBackends, patchAppConfig)
}

/**
 * Remove backend
 */
export const removeBackend = async (
  backendId: string,
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>,
  appConfig?: IAppConfig
): Promise<void> => {
  const existingBackends = getAllBackends(appConfig)
  const updatedBackends = existingBackends.filter((backend) => backend.id !== backendId)

  // If we removed the default backend, make the first remaining backend default
  const removedBackend = existingBackends.find((backend) => backend.id === backendId)
  if (removedBackend?.isDefault && updatedBackends.length > 0) {
    updatedBackends[0].isDefault = true
  }

  await updateBackends(updatedBackends, patchAppConfig)
}

/**
 * Update backend ping results
 */
export const updateBackendPingResults = async (
  testResults: BackendTestResult[],
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>,
  appConfig?: IAppConfig
): Promise<void> => {
  const existingBackends = getAllBackends(appConfig)
  const updatedBackends = existingBackends.map((backend) => {
    const testResult = testResults.find((result) => result.id === backend.id)
    if (testResult) {
      return {
        ...backend,
        lastPing: testResult.ping,
        lastTest: Date.now(),
        isActive: testResult.isActive
      }
    }
    return backend
  })

  await updateBackends(updatedBackends, patchAppConfig)
}

/**
 * Find backend with lowest ping value
 */
export const findOptimalBackend = (backends: IUserCenterBackend[]): IUserCenterBackend | null => {
  const backendsWithPing = backends.filter(
    (backend) => typeof backend.lastPing === 'number' && backend.isActive
  )

  if (backendsWithPing.length === 0) {
    return null
  }

  return backendsWithPing.reduce((optimal, current) => {
    const optimalPing = optimal.lastPing as number
    const currentPing = current.lastPing as number
    return currentPing < optimalPing ? current : optimal
  })
}

/**
 * Initialize default backends from legacy configuration
 */
export const initializeBackends = async (
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>,
  appConfig?: IAppConfig
): Promise<void> => {
  const existingBackends = appConfig?.userCenterBackends || []
  const merged = mergeBackendsWithSeeds(existingBackends)
  if (merged.length === 0) return

  await updateBackends(merged, patchAppConfig)
}
