/**
 * User authentication state management utility
 */

export interface UserTokenData {
  token: string
  expiresAt: number
  createdAt: number
  tokenType?: string
}

/**
 * Create user auth utils with app config
 */
import {
  getActiveBackend,
  callV3Gateway,
  normalizeBackendUrl
} from '@renderer/utils/user-center-backend'
import { API_USER_AGENT } from '@renderer/utils/api-service'
import { secureStoreDelete, secureStoreGet, secureStoreSet } from '@renderer/utils/ipc'

const TOKEN_STORAGE_KEY = 'userTokenData'
const LEGACY_TOKEN_KEY = 'userToken'
const LEGACY_TOKEN_DATA_KEY = 'userTokenData'
const DEFAULT_EXPIRE_DAYS = 7

let tokenCache: UserTokenData | null = null
let tokenLoading: Promise<void> | null = null

const normalizeTokenType = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

export const formatAuthToken = (token: string, _tokenType?: string | null): string => {
  return token
}

const parseTokenData = (raw: string | null): UserTokenData | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<UserTokenData>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.token !== 'string' || !parsed.token.trim()) return null
    if (typeof parsed.expiresAt !== 'number' || typeof parsed.createdAt !== 'number') return null
    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
      createdAt: parsed.createdAt,
      tokenType: normalizeTokenType(parsed.tokenType) || undefined
    }
  } catch {
    return null
  }
}

export const getCachedTokenData = (): UserTokenData | null => tokenCache

const isTokenExpired = (tokenData: UserTokenData): boolean => {
  return Boolean(tokenData.expiresAt && Date.now() > tokenData.expiresAt)
}

const getTokenData = (): UserTokenData | null => {
  if (!tokenCache) return null
  if (isTokenExpired(tokenCache)) {
    tokenCache = null
    void clearUserToken().catch((error) => console.error(error))
    return null
  }
  return tokenCache
}

export async function initUserAuth(): Promise<void> {
  if (tokenLoading) {
    await tokenLoading
    return
  }

  tokenLoading = (async () => {
    let data: UserTokenData | null = null
    const stored = await secureStoreGet(TOKEN_STORAGE_KEY)
    data = parseTokenData(stored)

    if (!data) {
      const legacyData = localStorage.getItem(LEGACY_TOKEN_DATA_KEY)
      const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
      data = parseTokenData(legacyData)
      if (!data && legacyToken) {
        const now = Date.now()
        data = {
          token: legacyToken,
          expiresAt: now + DEFAULT_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
          createdAt: now
        }
      }
      if (data) {
        await secureStoreSet(TOKEN_STORAGE_KEY, JSON.stringify(data))
      }
      localStorage.removeItem(LEGACY_TOKEN_KEY)
      localStorage.removeItem(LEGACY_TOKEN_DATA_KEY)
    }

    if (data && isTokenExpired(data)) {
      await secureStoreDelete(TOKEN_STORAGE_KEY)
      data = null
    }

    tokenCache = data
  })()

  await tokenLoading
  tokenLoading = null
}

export async function setUserToken(
  token: string,
  expiresInDays: number = DEFAULT_EXPIRE_DAYS,
  tokenType?: string | null
): Promise<void> {
  const normalizedType = normalizeTokenType(tokenType)
  const now = Date.now()
  const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000

  const tokenData: UserTokenData = {
    token,
    expiresAt,
    createdAt: now,
    ...(normalizedType ? { tokenType: normalizedType } : {})
  }

  tokenCache = tokenData
  await secureStoreSet(TOKEN_STORAGE_KEY, JSON.stringify(tokenData))
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_DATA_KEY)
}

export async function clearUserToken(): Promise<void> {
  tokenCache = null
  await secureStoreDelete(TOKEN_STORAGE_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_DATA_KEY)
  localStorage.removeItem('userEmail')
}

export const createUserAuthUtils = (appConfig?: IAppConfig) => {
  const debugEnabled = (): boolean => {
    try {
      return localStorage.getItem('userCenter.debug') === '1'
    } catch {
      return false
    }
  }
  const logDebug = (...args: unknown[]): void => {
    if (debugEnabled()) {
      console.info('[UserAuth]', ...args)
    }
  }
  const maskUrl = (raw?: string | null): string | null => {
    if (!raw) return null
    try {
      const url = new URL(raw)
      const keys = ['token', 'access_token', 'accessToken', 'auth_data', 'authData']
      keys.forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.set(key, '***')
        }
      })
      return url.toString()
    } catch {
      return raw
    }
  }

  const utils = {
    isLoggedIn: (): boolean => {
      const tokenData = getTokenData()
      return Boolean(tokenData)
    },

    getToken: (): string | null => {
      const tokenData = getTokenData()
      return tokenData?.token ?? null
    },

    getTokenType: (): string | null => {
      const tokenData = getTokenData()
      return normalizeTokenType(tokenData?.tokenType)
    },

    getAuthHeaderValue: (): string | null => {
      const tokenData = getTokenData()
      if (!tokenData) return null
      return formatAuthToken(tokenData.token, tokenData.tokenType)
    },

    clearToken: (): void => {
      void clearUserToken()
    },

    /**
     * Get user subscription URL by calling API
     * Uses the same method as user-center.tsx
     */
    getUserSubscriptionUrl: async (): Promise<string | null> => {
      const authHeader = await utils.getAuthHeaderValue()
      if (!authHeader) {
        logDebug('getUserSubscriptionUrl abort (missing auth)')
        return null
      }

      const baseUrl = utils.getBaseUrl()
      logDebug('getUserSubscriptionUrl start', { baseUrl })

      try {
        const response = await callV3Gateway(baseUrl, 'user/getSubscribe', 'GET', undefined, {
          Authorization: authHeader,
          'User-Agent': API_USER_AGENT
        })

        logDebug('getUserSubscriptionUrl response', { status: response.status, ok: response.ok })
        if (response.status === 401) {
          // Token invalid, clean up
          utils.clearToken()
          return null
        }

        if (!response.ok) {
          console.error('Failed to get subscription URL:', response.status)
          return null
        }

        const data = await response.json()

        // Helper: ensure subscribe URL carries flag=meta
        const ensureMetaFlag = (rawUrl: string): string => {
          try {
            const u = new URL(rawUrl)
            // Force flag to meta to match Clash Meta format
            u.searchParams.set('flag', 'meta')
            return u.toString()
          } catch {
            // Fallback for non-standard URLs
            if (/([?&])flag=meta(?!\w)/.test(rawUrl)) return rawUrl
            const sep = rawUrl.includes('?') ? '&' : '?'
            return `${rawUrl}${sep}flag=meta`
          }
        }

        const payload = data?.data ?? data
        const rawUrl = payload?.subscribe_url ?? payload?.subscribeUrl ?? payload?.url
        if (typeof rawUrl === 'string' && rawUrl.trim()) {
          const normalized = ensureMetaFlag(rawUrl.trim())
          logDebug('getUserSubscriptionUrl success', { url: maskUrl(normalized) })
          return normalized
        }

        logDebug('getUserSubscriptionUrl missing url', {
          keys: payload ? Object.keys(payload) : null
        })
        return null
      } catch (error) {
        console.error('Error fetching subscription URL:', error)
        return null
      }
    },

    /**
     * Get login URL from configuration
     */
    getLoginUrl: (): string => {
      // Use the active backend (session selection > default)
      const backend = getActiveBackend(appConfig)
      return backend.url
    },

    getBaseUrl: (): string => {
      const backend = getActiveBackend(appConfig)
      return normalizeBackendUrl(backend?.url)
    }
  }

  return utils
}

// Default instance for backward compatibility
export const userAuthUtils = createUserAuthUtils()
