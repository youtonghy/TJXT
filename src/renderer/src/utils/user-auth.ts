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
import { getActiveBackend, callV3Gateway, normalizeBackendUrl } from '@renderer/utils/user-center-backend'
import { API_USER_AGENT } from '@renderer/utils/api-service'

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
  const normalizeTokenType = (value?: string | null): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    return trimmed || null
  }

  const formatAuthToken = (token: string, tokenType?: string | null): string => {
    if (/\s/.test(token)) return token
    const normalizedType = normalizeTokenType(tokenType)
    if (!normalizedType) return token
    if (normalizedType.toLowerCase() === 'bearer') return token
    return `${normalizedType} ${token}`
  }

  const utils = {
    /**
     * Check if user is currently logged in (has valid token)
     */
    isLoggedIn: (): boolean => {
      const token = localStorage.getItem('userToken')
      const tokenDataStr = localStorage.getItem('userTokenData')
      
      if (!token || !tokenDataStr) {
        return false
      }
      
      try {
        const tokenData: UserTokenData = JSON.parse(tokenDataStr)
        const now = Date.now()
        
        // Check if token is expired
        if (tokenData.expiresAt && now > tokenData.expiresAt) {
          // Token expired, clean up
          utils.clearToken()
          return false
        }
        
        return true
      } catch {
        // Data format error, clean up
        utils.clearToken()
        return false
      }
    },

    /**
     * Get current auth token if valid
     */
    getToken: (): string | null => {
      if (!utils.isLoggedIn()) {
        return null
      }
      return localStorage.getItem('userToken')
    },

    /**
     * Get token type if present
     */
    getTokenType: (): string | null => {
      const tokenDataStr = localStorage.getItem('userTokenData')
      if (!tokenDataStr) return null
      try {
        const tokenData: UserTokenData = JSON.parse(tokenDataStr)
        return normalizeTokenType(tokenData.tokenType)
      } catch {
        return null
      }
    },

    /**
     * Build Authorization header value with token type when available
     */
    getAuthHeaderValue: (): string | null => {
      const token = utils.getToken()
      if (!token) return null
      return formatAuthToken(token, utils.getTokenType())
    },

    /**
     * Clear stored auth token
     */
    clearToken: (): void => {
      localStorage.removeItem('userToken')
      localStorage.removeItem('userTokenData')
      localStorage.removeItem('userEmail')
    },

    /**
     * Get user subscription URL by calling API
     * Uses the same method as user-center.tsx
     */
    getUserSubscriptionUrl: async (): Promise<string | null> => {
      const authHeader = utils.getAuthHeaderValue()
      if (!authHeader) {
        logDebug('getUserSubscriptionUrl abort (missing auth)')
        return null
      }

      const baseUrl = utils.getBaseUrl()
      logDebug('getUserSubscriptionUrl start', { baseUrl })

      try {
        const response = await callV3Gateway(
          baseUrl,
          'user/getSubscribe',
          'GET',
          undefined,
          {
            'Authorization': authHeader,
            'User-Agent': API_USER_AGENT
          }
        )

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

        logDebug('getUserSubscriptionUrl missing url', { keys: payload ? Object.keys(payload) : null })
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
