/**
 * User authentication state management utility
 */

export interface UserTokenData {
  token: string
  expiresAt: number
  createdAt: number
}

/**
 * Create user auth utils with app config
 */
import { getActiveBackend, callV3Gateway } from '@renderer/utils/user-center-backend'
import { API_USER_AGENT } from '@renderer/utils/api-service'

export const createUserAuthUtils = (appConfig?: IAppConfig) => {
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
      const token = utils.getToken()
      if (!token) return null

      const baseUrl = utils.getBaseUrl()

      try {
        const response = await callV3Gateway(
          baseUrl,
          'user/getSubscribe',
          'GET',
          undefined,
          {
            'Authorization': token,
            'User-Agent': API_USER_AGENT
          }
        )

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

        // Return the subscribe_url from response data, appending &flag=meta
        if (data.data && data.data.subscribe_url) {
          return ensureMetaFlag(data.data.subscribe_url)
        }

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
      return backend?.url?.replace(/\/+$/, '') || ''
    }
  }

  return utils
}

// Default instance for backward compatibility
export const userAuthUtils = createUserAuthUtils()
