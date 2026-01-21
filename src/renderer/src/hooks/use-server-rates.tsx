import { useCallback, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { createApiService, ServerInfo } from '@renderer/utils/api-service'
import { createUserAuthUtils, getCachedTokenData } from '@renderer/utils/user-auth'
import { useAppConfig } from './use-app-config'

interface ServerRatesResult {
  rateMap: Map<string, number>
  isLoading: boolean
  refresh: () => void
}

const buildRateMap = (servers?: ServerInfo[]): Map<string, number> => {
  const map = new Map<string, number>()
  if (!servers) return map
  servers.forEach((server) => {
    if (!server || typeof server.name !== 'string') return
    const rawRate = server.rate
    const parsedRate = typeof rawRate === 'string' ? parseFloat(rawRate) : rawRate
    if (!Number.isFinite(parsedRate)) return
    map.set(server.name, parsedRate)
  })
  return map
}

export const useServerRates = (): ServerRatesResult => {
  const { appConfig } = useAppConfig()
  const debugEnabled = useMemo(() => {
    try {
      return import.meta.env.DEV || localStorage.getItem('userCenter.debug') === '1'
    } catch {
      return import.meta.env.DEV
    }
  }, [])
  const logDebug = useCallback(
    (message: string, payload?: Record<string, unknown>) => {
      if (!debugEnabled) return
      if (payload) {
        console.info('[ServerRates]', message, payload)
      } else {
        console.info('[ServerRates]', message)
      }
    },
    [debugEnabled]
  )
  const authUtils = useMemo(() => createUserAuthUtils(appConfig), [appConfig])
  const tokenData = getCachedTokenData()
  const isLoggedIn = Boolean(tokenData)
  const baseUrl = authUtils.getBaseUrl()
  const authHeader = isLoggedIn ? authUtils.getAuthHeaderValue() : null
  const shouldFetch = Boolean(baseUrl && authHeader && isLoggedIn)

  const fetchServers = useCallback(async (): Promise<ServerInfo[]> => {
    if (!baseUrl || !authHeader) {
      logDebug('fetch skipped (missing auth or baseUrl)')
      return []
    }
    logDebug('fetch servers start', { baseUrl })
    const api = createApiService(baseUrl, authHeader, () => {
      authUtils.clearToken()
    })
    const servers = await api.getServers()
    logDebug('fetch servers done', { count: servers.length })
    return servers
  }, [authHeader, baseUrl, authUtils, logDebug])

  const { data: servers, isLoading, mutate } = useSWR(
    shouldFetch ? ['userCenterServers', baseUrl, authHeader] : null,
    fetchServers,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false
    }
  )

  const rateMap = useMemo(() => {
    if (!shouldFetch) return new Map<string, number>()
    return buildRateMap(servers)
  }, [servers, shouldFetch])

  useEffect(() => {
    if (!debugEnabled) return
    if (!isLoggedIn) {
      logDebug('skip fetch (not logged in)')
      return
    }
    if (!baseUrl) {
      logDebug('skip fetch (missing baseUrl)')
      return
    }
    if (!authHeader) {
      logDebug('skip fetch (missing auth header)')
    }
  }, [authHeader, baseUrl, debugEnabled, isLoggedIn, logDebug])

  useEffect(() => {
    if (!debugEnabled || !shouldFetch) return
    const sample = servers?.slice(0, 3).map((server) => ({
      name: server.name,
      rate: server.rate
    }))
    logDebug('servers response', { count: servers?.length ?? 0, sample })
  }, [debugEnabled, logDebug, servers, shouldFetch])

  useEffect(() => {
    if (!debugEnabled || !shouldFetch) return
    logDebug('rate map ready', { count: rateMap.size })
  }, [debugEnabled, logDebug, rateMap, shouldFetch])

  return { rateMap, isLoading, refresh: mutate }
}
