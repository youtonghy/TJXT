/**
 * User center backend management utilities
 */

import { API_USER_AGENT } from './api-service'

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
 */
export const testBackendLatency = async (backend: IUserCenterBackend): Promise<BackendTestResult> => {
  const startTime = Date.now()

  try {
    const response = await fetch(`${backend.url}/api/v1/guest/comm/config`, {
      method: 'GET',
      headers: {
        'User-Agent': API_USER_AGENT
      },
      signal: AbortSignal.timeout(10000) // 10秒超时
    })

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

/**
 * Test latency for all backends
 */
export const testAllBackendsLatency = async (backends: IUserCenterBackend[]): Promise<BackendTestResult[]> => {
  const promises = backends.map(backend => testBackendLatency(backend))
  return Promise.all(promises)
}

/**
 * Get default backend from configuration
 */
export const getDefaultBackend = (appConfig?: IAppConfig): IUserCenterBackend => {
  const backends = appConfig?.userCenterBackends || []
  
  // Find explicitly marked default backend
  const defaultBackend = backends.find(backend => backend.isDefault)
  if (defaultBackend) {
    return defaultBackend
  }
  
  // Fall back to first backend
  if (backends.length > 0) {
    return backends[0]
  }
  
  // Fall back to default URL (no legacy field)
  return {
    id: 'default',
    name: '默认后端',
    url: 'https://vpn.200461.xyz',
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
      const picked = all.find(b => b.id === selectedId)
      if (picked) return picked
      // If saved id no longer exists, fall back to default
    }
  } catch {}
  return getDefaultBackend(appConfig)
}

/**
 * Get all backends with fallback to legacy configuration
 */
export const getAllBackends = (appConfig?: IAppConfig): IUserCenterBackend[] => {
  const backends = appConfig?.userCenterBackends || []
  
  if (backends.length > 0) {
    return backends
  }
  
  // Fall back to predefined three servers
  return [
    { id: 'default', name: '默认后端', url: 'https://vpn.200461.xyz', isDefault: true },
    { id: 'mainland', name: '大陆后端', url: 'https://ppb.200461.xyz', isDefault: false },
    { id: 'backup', name: '备用后端', url: 'https://[2a14:67c1:a072:1::3d]:59847', isDefault: false }
  ]
}

/**
 * Update backend configuration
 */
export const updateBackends = async (
  newBackends: IUserCenterBackend[],
  patchAppConfig: (config: Partial<IAppConfig>) => Promise<void>
): Promise<void> => {
  // Ensure at least one backend is marked as default
  if (!newBackends.some(backend => backend.isDefault) && newBackends.length > 0) {
    newBackends[0].isDefault = true
  }
  
  await patchAppConfig({ userCenterBackends: newBackends })
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
  const updatedBackends = backends.map(backend => ({
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
  const updatedBackends = existingBackends.map(b => ({
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
  const updatedBackends = existingBackends.filter(backend => backend.id !== backendId)
  
  // If we removed the default backend, make the first remaining backend default
  const removedBackend = existingBackends.find(backend => backend.id === backendId)
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
  const updatedBackends = existingBackends.map(backend => {
    const testResult = testResults.find(result => result.id === backend.id)
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
  const backendsWithPing = backends.filter(backend => backend.lastPing && backend.isActive)
  
  if (backendsWithPing.length === 0) {
    return null
  }
  
  return backendsWithPing.reduce((optimal, current) => {
    if (!optimal.lastPing || !current.lastPing) {
      return optimal.lastPing ? optimal : current
    }
    return current.lastPing < optimal.lastPing ? current : optimal
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
  
  // Check if we need to add predefined servers
  const hasMainlandServer = existingBackends.some(backend => backend.id === 'mainland')
  const hasBackupServer = existingBackends.some(backend => backend.id === 'backup')
  
  // If no backends exist, create default configuration
  if (existingBackends.length === 0) {
    const defaultBackends: IUserCenterBackend[] = [
      {
        id: 'default',
        name: '默认后端',
        url: 'https://vpn.200461.xyz',
        isDefault: true
      },
      {
        id: 'mainland',
        name: '大陆后端',
        url: 'https://ppb.200461.xyz',
        isDefault: false
      },
      {
        id: 'backup',
        name: '备用后端',
        url: 'https://[2a14:67c1:a072:1::3d]:59847',
        isDefault: false
      }
    ]
    
    await updateBackends(defaultBackends, patchAppConfig)
  } 
  // If backends exist, enforce only the three predefined servers and remove others (e.g., 'panel')
  else {
    const allowed = new Map<string, { name: string; url: string }>([
      ['default', { name: '默认后端', url: 'https://vpn.200461.xyz' }],
      ['mainland', { name: '大陆后端', url: 'https://ppb.200461.xyz' }],
      ['backup', { name: '备用后端', url: 'https://[2a14:67c1:a072:1::3d]:59847' }]
    ])

    // Preserve which of the allowed ones was default if any
    const preservedDefault = existingBackends.find(
      b => allowed.has(b.id) && b.isDefault
    )?.id || 'default'

    // Build target list in fixed order, preserving runtime metrics
    const metricsById = new Map(existingBackends
      .filter(b => allowed.has(b.id))
      .map(b => [b.id, { lastPing: b.lastPing, lastTest: b.lastTest, isActive: b.isActive } as Partial<IUserCenterBackend>]))

    const targetBackends: IUserCenterBackend[] = []
    for (const id of ['default', 'mainland', 'backup']) {
      const meta = allowed.get(id)!
      const metrics = metricsById.get(id) || {}
      targetBackends.push({
        id,
        name: meta.name,
        url: meta.url,
        isDefault: id === preservedDefault,
        ...metrics
      } as IUserCenterBackend)
    }

    await updateBackends(targetBackends, patchAppConfig)
  }
}
