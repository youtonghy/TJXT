/**
 * 页面：用户中心
 * Page: User Center
 */

// ======================== 导入区 ========================
// React 核心
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  clearUserToken,
  formatAuthToken as formatStoredAuthToken,
  getCachedTokenData,
  initUserAuth,
  setUserToken
} from '@renderer/utils/user-auth'
import DOMPurify from 'dompurify'

// UI 组件
import {
  Card,
  CardBody,
  CardHeader,
  Input,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Divider,
  Spinner,
  Progress,
  Chip,
  Tabs,
  Tab
} from '@heroui/react'
import { API_USER_AGENT } from '@renderer/utils/api-service'
import {
  IoCloseOutline,
  IoPersonOutline,
  IoServerOutline,
  IoSpeedometer,
  IoPaperPlaneOutline,
  IoLogInOutline
} from 'react-icons/io5'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import {
  getAllBackends,
  getDefaultBackend,
  getActiveBackend,
  testAllBackendsLatency,
  updateBackendPingResults,
  initializeBackends,
  findOptimalBackend,
  callV3Gateway,
  normalizeBackendUrl,
  BackendTestResult
} from '@renderer/utils/user-center-backend'

interface UserInfo {
  email: string
  traffic: {
    upload: number
    download: number
    total: number
    expire: number | null
  }
}

interface Announcement {
  id: string
  title: string
  content: string
  date: string
  imgUrl?: string
  tags?: string[]
  createdAt?: number
  updatedAt?: number
  show?: number
}

interface LoadingState {
  userInfo: boolean
  announcements: boolean
}

interface ErrorState {
  userInfo: string | null
  announcements: string | null
}

interface NetworkStatus {
  isOnline: boolean
  lastConnected: Date | null
}

const WEB_LOGIN_STATE_KEY = 'userCenter.webLoginState'
const WEB_LOGIN_REDIRECT_URI = 'mihomo://user-center-login'
const TELEGRAM_POLLING_TIMEOUT_MS = 90 * 1000
const TELEGRAM_POLLING_BACKOFF_MS = [5000, 10000, 15000, 20000]
const BACKEND_AUTO_TEST_BACKOFF_MS = [5000, 10000, 15000, 20000]

const UserCenter: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { refreshUserSubscription } = useProfileConfig()
  const debugEnabled = useMemo(() => {
    try {
      return import.meta.env.DEV || localStorage.getItem('userCenter.debug') === '1'
    } catch {
      return import.meta.env.DEV
    }
  }, [])
  const logDebug = useCallback(
    (...args: unknown[]) => {
      if (debugEnabled) {
        console.info('[UserCenter]', ...args)
      }
    },
    [debugEnabled]
  )
  const maskToken = useCallback((token?: string | null) => {
    if (!token) return null
    const trimmed = token.trim()
    if (!trimmed) return null
    if (trimmed.length <= 12) return `${trimmed.slice(0, 2)}***`
    return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`
  }, [])
  const maskUrl = useCallback((raw?: string | null) => {
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
  }, [])
  const shouldMarkOffline = useCallback((error: unknown) => {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return true
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      if (message.startsWith('http ')) return false
      if (message.includes('server response error')) return false
      if (message.includes('timeout') || message.includes('timed out')) return true
      if (
        message.includes('failed to fetch') ||
        message.includes('network') ||
        message.includes('fetch')
      ) {
        return true
      }
    }
    return false
  }, [])

  // Backend management
  const [backends, setBackends] = useState<IUserCenterBackend[]>([])
  const [selectedBackend, setSelectedBackend] = useState<IUserCenterBackend | null>(null)
  const [, setBackendTestResults] = useState<BackendTestResult[]>([])
  const [isTestingBackends, setIsTestingBackends] = useState(false)
  // Track if user has manually picked a backend in this session
  const [, setUserSelectedBackendId] = useState<string | null>(null)
  const SELECTED_BACKEND_KEY = 'userCenter.selectedBackendId'
  const READ_ANNOUNCEMENTS_KEY = 'userCenter.readAnnouncementIds'

  // Use selected backend URL or fallback to active backend (selected > default)
  const activeBackend = selectedBackend || getActiveBackend(appConfig)
  const getNormalizedBaseUrl = useCallback(() => {
    return normalizeBackendUrl(activeBackend?.url)
  }, [activeBackend])

  // 状态管理
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(READ_ANNOUNCEMENTS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          return new Set(parsed.map((id) => String(id)))
        }
      }
    } catch (error) {
      console.warn('Failed to restore read announcements from storage:', error)
    }
    return new Set()
  })
  const [email, setEmail] = useState('')

  const [loginMode, setLoginMode] = useState<'web' | 'telegram'>('web')
  const [telegramLoginEnabled, setTelegramLoginEnabled] = useState(false)
  const [webLoginStatus, setWebLoginStatus] = useState<'idle' | 'starting' | 'pending'>('idle')
  const webLoginStateRef = useRef<string | null>(null)
  const webLoginTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Telegram Login State
  const [telegramToken, setTelegramToken] = useState<string | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<
    'idle' | 'pending' | 'approved' | 'rejected' | 'expired'
  >('idle')
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const telegramPollingStartedAtRef = useRef<number | null>(null)
  const telegramPollingAttemptRef = useRef(0)

  // 加载状态
  const [loading, setLoading] = useState<LoadingState>({
    userInfo: false,
    announcements: false
  })

  // 错误状态
  const [errors, setErrors] = useState<ErrorState>({
    userInfo: null,
    announcements: null
  })

  // 模态框状态
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // 自动刷新相关
  const [, setLastUpdate] = useState<Date | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const backendsRef = useRef<IUserCenterBackend[]>([])
  const hasStartedAutoTest = useRef<boolean>(false)
  const backendAutoTestAttemptRef = useRef(0)

  // 网络状态 - 默认假设在线，通过实际 API 请求结果来判断
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: true,
    lastConnected: new Date()
  })

  // 服务器测试状态
  const [, setServerTestStatus] = useState<{
    isLoading: boolean
    lastPing: number | null
    lastTest: Date | null
  }>({
    isLoading: false,
    lastPing: null,
    lastTest: null
  })

  const normalizeTokenType = (value?: string | null): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    return trimmed || null
  }

  type AuthPayload = { token: string; tokenType?: string | null }

  const normalizeAuthPayload = (payload: unknown): AuthPayload | null => {
    if (typeof payload === 'string' && payload.trim()) {
      return { token: payload.trim() }
    }
    if (!payload || typeof payload !== 'object') return null

    const data = payload as Record<string, unknown>
    const tokenType =
      normalizeTokenType(
        (data.token_type as string | undefined) || (data.tokenType as string | undefined)
      ) || undefined

    if (data.auth_data && typeof data.auth_data === 'object') {
      const nested = normalizeAuthPayload(data.auth_data)
      if (nested) {
        return { ...nested, tokenType: nested.tokenType ?? tokenType }
      }
    }

    const tokenCandidates = [
      data.auth_data,
      data.authData,
      data.access_token,
      data.accessToken,
      data.token
    ]
    const token = tokenCandidates.find((value) => typeof value === 'string' && value.trim()) as
      | string
      | undefined
    if (!token) return null
    return { token: token.trim(), tokenType }
  }

  // Token管理工具函数
  const tokenManager = {
    setToken: async (token: string, expiresInDays: number = 7, tokenType?: string | null) => {
      const normalizedType = normalizeTokenType(tokenType)
      await setUserToken(token, expiresInDays, normalizedType)
      logDebug('token stored', {
        token: maskToken(token),
        tokenType: normalizedType
      })
    },

    getToken: (): string | null => {
      return getCachedTokenData()?.token ?? null
    },

    getTokenType: (): string | null => {
      return normalizeTokenType(getCachedTokenData()?.tokenType)
    },

    getAuthHeaderValue: (): string | null => {
      const tokenData = getCachedTokenData()
      if (!tokenData) return null
      const headerValue = formatStoredAuthToken(tokenData.token, tokenData.tokenType)
      logDebug('auth header prepared', {
        token: maskToken(tokenData.token),
        header: maskToken(headerValue)
      })
      return headerValue
    },

    clearToken: () => {
      void clearUserToken()
    },

    isTokenExpiringSoon: (): boolean => {
      const tokenData = getCachedTokenData()
      if (!tokenData) return false
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      return Boolean(tokenData.expiresAt && tokenData.expiresAt - now < oneDay)
    },

    getTokenRemainingDays: (): number => {
      const tokenData = getCachedTokenData()
      if (!tokenData?.expiresAt) return 0
      const now = Date.now()
      if (now > tokenData.expiresAt) {
        return 0
      }
      return Math.ceil((tokenData.expiresAt - now) / (24 * 60 * 60 * 1000))
    }
  }

  // 通用API请求函数（优化token处理）
  const clearWebLoginState = useCallback(() => {
    webLoginStateRef.current = null
    localStorage.removeItem(WEB_LOGIN_STATE_KEY)
    if (webLoginTimeoutRef.current) {
      clearTimeout(webLoginTimeoutRef.current)
      webLoginTimeoutRef.current = null
    }
  }, [])

  const resetWebLogin = useCallback(() => {
    setWebLoginStatus('idle')
    clearWebLoginState()
  }, [clearWebLoginState])

  const getWebLoginState = useCallback(() => {
    return webLoginStateRef.current || localStorage.getItem(WEB_LOGIN_STATE_KEY)
  }, [])

  const scheduleWebLoginTimeout = useCallback(
    (expiresInSeconds?: number) => {
      if (!expiresInSeconds || expiresInSeconds <= 0) return
      if (webLoginTimeoutRef.current) {
        clearTimeout(webLoginTimeoutRef.current)
        webLoginTimeoutRef.current = null
      }
      webLoginTimeoutRef.current = setTimeout(() => {
        setWebLoginStatus('idle')
        clearWebLoginState()
        setErrors((prev) => ({ ...prev, userInfo: t('userCenter.webLoginExpired') }))
      }, expiresInSeconds * 1000)
    },
    [clearWebLoginState, t]
  )

  // 通用API请求函数（使用 V3 网关）
  const apiRequest = useCallback(
    async (
      endpoint: string,
      options: { method?: 'GET' | 'POST'; params?: Record<string, unknown> } = {}
    ) => {
      const authHeader = tokenManager.getAuthHeaderValue()
      if (!authHeader) {
        logDebug('apiRequest aborted (missing auth)', { endpoint, method: options.method || 'GET' })
        setIsLoggedIn(false)
        return null
      }

      // 移除开头的斜杠
      const cleanEndpoint = endpoint.replace(/^\/+/, '')
      const baseUrl = getNormalizedBaseUrl()

      try {
        logDebug('apiRequest start', {
          endpoint: cleanEndpoint,
          method: options.method || 'GET',
          baseUrl
        })
        const response = await callV3Gateway(
          baseUrl,
          cleanEndpoint,
          options.method || 'GET',
          options.params,
          {
            Authorization: authHeader,
            'User-Agent': API_USER_AGENT
          }
        )
        logDebug('apiRequest response', {
          endpoint: cleanEndpoint,
          status: response.status,
          ok: response.ok
        })

        if (response.status === 401) {
          // Token无效或过期，清除并重新登录
          tokenManager.clearToken()
          setIsLoggedIn(false)
          return null
        }

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`
          try {
            const text = await response.text()
            const obj = JSON.parse(text)
            const keys = ['message', 'msg', 'error', 'detail', 'info']
            for (const k of keys) {
              const v = (obj as Record<string, unknown>)[k]
              if (typeof v === 'string' && v.trim()) {
                errorMessage = v.trim()
                break
              }
            }
          } catch {
            // ignore parse errors
          }
          throw new Error(errorMessage)
        }

        const data = await response.json()

        // API请求成功，更新网络状态
        setNetworkStatus({
          isOnline: true,
          lastConnected: new Date()
        })

        return data.data || data
      } catch (error) {
        // 仅在网络错误时设置离线状态
        if (shouldMarkOffline(error)) {
          setNetworkStatus((prev) => ({ ...prev, isOnline: false }))
        }

        console.error(`API request failed for ${endpoint}:`, error)
        logDebug('apiRequest failed', { endpoint: cleanEndpoint, error })
        throw error
      }
    },
    [activeBackend, getNormalizedBaseUrl, logDebug, shouldMarkOffline]
  )

  // 获取用户信息
  const fetchUserInfo = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading((prev) => ({ ...prev, userInfo: true }))
        setErrors((prev) => ({ ...prev, userInfo: null }))
      }

      try {
        // 使用 getSubscribe 接口获取详细流量信息
        const data = await apiRequest('/user/getSubscribe')

        if (data) {
          const newUserInfo: UserInfo = {
            email: data.email || t('userCenter.defaultEmail'),
            traffic: {
              upload: Number(data.u) || 0,
              download: Number(data.d) || 0,
              total: Number(data.transfer_enable) || 0,
              expire: data.expired_at ? data.expired_at * 1000 : null
            }
          }
          setUserInfo(newUserInfo)
          setIsLoggedIn(true)
          setLastUpdate(new Date())
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t('userCenter.fetchUserInfoFailed')
        setErrors((prev) => ({ ...prev, userInfo: errorMessage }))

        // API失败时，仅在初次加载时使用模拟数据
        console.warn(t('userCenter.fetchUserInfoFallbackLog'), error)
      } finally {
        setLoading((prev) => ({ ...prev, userInfo: false }))
      }
    },
    [apiRequest]
  ) // 移除userInfo依赖，避免无限循环

  // 获取公告
  const fetchAnnouncements = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading((prev) => ({ ...prev, announcements: true }))
        setErrors((prev) => ({ ...prev, announcements: null }))
      }

      try {
        const data = await apiRequest('/user/notice/fetch')

        // 处理不同的响应格式
        let notices: any[] = []
        if (Array.isArray(data)) {
          notices = data
        } else if (data && Array.isArray(data.data)) {
          notices = data.data
        } else if (data && data.data && Array.isArray(data.data.list)) {
          notices = data.data.list
        }

        if (notices && notices.length > 0) {
          const filteredAnnouncements: Announcement[] = notices
            .filter((notice: any) => String(notice?.show ?? '1') === '1')
            .map((notice: any) => {
              const createdAtMs = notice?.created_at
                ? Number(notice.created_at) * 1000
                : notice?.createdAt
                  ? Number(notice.createdAt) * 1000
                  : notice?.updated_at
                    ? Number(notice.updated_at) * 1000
                    : Date.now()
              const tags = Array.isArray(notice?.tags)
                ? notice.tags.map((tag: any) => String(tag))
                : []
              const imgUrl = notice?.img_url || notice?.image_url || notice?.image || ''

              return {
                id: String(notice.id || Math.random().toString(36).slice(2)),
                title: notice.title || t('userCenter.announcementFallbackTitle'),
                content: notice.content || '',
                date: new Date(createdAtMs).toLocaleString('zh-CN'),
                imgUrl,
                tags,
                createdAt: createdAtMs,
                updatedAt: notice?.updated_at ? Number(notice.updated_at) * 1000 : undefined,
                show: notice.show
              }
            })
            .sort((a, b) => {
              const dateA = a.createdAt || 0
              const dateB = b.createdAt || 0
              return dateB - dateA
            })
          setAnnouncements(filteredAnnouncements)
        } else {
          setAnnouncements([])
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t('userCenter.fetchAnnouncementsFailed')
        setErrors((prev) => ({ ...prev, announcements: errorMessage }))

        // API失败时，仅在初次加载时使用模拟数据
        console.warn(t('userCenter.fetchAnnouncementsFallbackLog'), error)
      } finally {
        setLoading((prev) => ({ ...prev, announcements: false }))
      }
    },
    [apiRequest]
  )

  const markAnnouncementAsRead = useCallback(
    (id: string) => {
      if (!id) return
      setReadAnnouncementIds((prev) => {
        if (prev.has(id)) return prev
        const updated = new Set(prev)
        updated.add(id)
        localStorage.setItem(READ_ANNOUNCEMENTS_KEY, JSON.stringify(Array.from(updated)))
        return updated
      })
    },
    [READ_ANNOUNCEMENTS_KEY]
  )

  // 服务器连接测试（使用 V3 网关）
  const testServerConnection = useCallback(async () => {
    setServerTestStatus((prev) => ({ ...prev, isLoading: true }))

    const baseUrl = getNormalizedBaseUrl()
    logDebug('testServerConnection start', { baseUrl })

    try {
      const startTime = Date.now()
      const response = await callV3Gateway(baseUrl, 'guest/comm/config', 'GET', undefined, {
        'User-Agent': API_USER_AGENT
      })
      const endTime = Date.now()
      const ping = endTime - startTime

      setServerTestStatus({
        isLoading: false,
        lastPing: ping,
        lastTest: new Date()
      })

      if (response.ok) {
        let configData: any = null
        try {
          const payload = await response.json()
          configData = payload?.data ?? payload
        } catch {
          configData = null
        }
        if (configData) {
          const rawEnable = configData.telegram_login_enable ?? configData.is_telegram
          const telegramEnabled = rawEnable === 1 || rawEnable === '1' || rawEnable === true
          setTelegramLoginEnabled(telegramEnabled)
        } else {
          setTelegramLoginEnabled(false)
        }
        setNetworkStatus({
          isOnline: true,
          lastConnected: new Date()
        })
        setErrors((prev) => ({ ...prev, userInfo: null }))
      } else {
        throw new Error(t('userCenter.serverResponseError', { status: response.status }))
      }
    } catch (error) {
      setServerTestStatus((prev) => ({
        ...prev,
        isLoading: false,
        lastTest: new Date()
      }))
      setTelegramLoginEnabled(false)

      let errorMsg = t('userCenter.serverConnectionFailed')
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          errorMsg = t('userCenter.serverTimeout')
        } else if (error.message.includes('fetch')) {
          errorMsg = t('userCenter.networkError')
        } else {
          errorMsg = error.message
        }
      }

      setErrors((prev) => ({
        ...prev,
        userInfo: t('userCenter.serverTestFailed', { error: errorMsg })
      }))
      if (shouldMarkOffline(error)) {
        setNetworkStatus((prev) => ({ ...prev, isOnline: false }))
      }
    }
  }, [getNormalizedBaseUrl, logDebug, shouldMarkOffline])

  // Backend management functions
  const initializeBackendList = useCallback(async () => {
    try {
      await initializeBackends(patchAppConfig, appConfig)
      const availableBackends = getAllBackends(appConfig)
      setBackends(availableBackends)
      backendsRef.current = availableBackends // 更新 ref
      // Restore previously selected backend from storage if exists
      const savedId = localStorage.getItem(SELECTED_BACKEND_KEY)
      const saved = availableBackends.find((b) => b.id === savedId)
      if (saved) {
        setSelectedBackend(saved)
        setUserSelectedBackendId(saved.id)
      } else {
        const def = getDefaultBackend(appConfig)
        setSelectedBackend(def)
      }
    } catch (error) {
      console.error('Failed to initialize backends:', error)
    }
  }, [appConfig, patchAppConfig])

  const testAllBackends = useCallback(async (): Promise<BackendTestResult[]> => {
    const currentBackends = backendsRef.current
    if (currentBackends.length === 0) return []

    setIsTestingBackends(true)
    try {
      const results = await testAllBackendsLatency(currentBackends)
      setBackendTestResults(results)

      // 直接使用测速结果更新本地 backends 状态
      const updatedBackends = currentBackends.map((backend) => {
        const testResult = results.find((result) => result.id === backend.id)
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

      setBackends(updatedBackends)
      backendsRef.current = updatedBackends

      // 异步更新配置（不阻塞 UI 更新）
      updateBackendPingResults(results, patchAppConfig, appConfig).catch(console.error)

      return results
    } catch (error) {
      console.error('Backend testing failed:', error)
      return []
    } finally {
      setIsTestingBackends(false)
    }
  }, [patchAppConfig, appConfig])

  const testAllBackendsAndSelectOptimal = useCallback(async () => {
    const currentBackends = backendsRef.current
    if (currentBackends.length <= 1) return

    setIsTestingBackends(true)
    try {
      const results = await testAllBackendsLatency(currentBackends)
      setBackendTestResults(results)

      // 直接使用测速结果更新本地 backends 状态
      const updatedBackends = currentBackends.map((backend) => {
        const testResult = results.find((result) => result.id === backend.id)
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

      setBackends(updatedBackends)
      backendsRef.current = updatedBackends

      // 异步更新配置（不阻塞 UI 更新）
      updateBackendPingResults(results, patchAppConfig, appConfig).catch(console.error)

      // Find optimal backend and set as current selection (do not change default)
      const optimalBackend = findOptimalBackend(updatedBackends)
      if (optimalBackend && optimalBackend.id !== selectedBackend?.id) {
        setSelectedBackend(optimalBackend)
        setUserSelectedBackendId(optimalBackend.id)
        localStorage.setItem(SELECTED_BACKEND_KEY, optimalBackend.id)
        console.log(
          `Selected optimal backend: ${optimalBackend.name} (${optimalBackend.lastPing}ms)`
        )
      }

      return results
    } catch (error) {
      console.error('Backend testing and selection failed:', error)
      return []
    } finally {
      setIsTestingBackends(false)
    }
  }, [patchAppConfig, appConfig, selectedBackend])

  const handleBackendSelection = useCallback(
    async (backendId: string) => {
      try {
        // Treat as session selection only; do not change default
        const picked = backendsRef.current.find((b) => b.id === backendId) || null
        if (picked) {
          setSelectedBackend(picked)
          setUserSelectedBackendId(backendId)
          localStorage.setItem(SELECTED_BACKEND_KEY, backendId)
        }
      } catch (error) {
        console.error('Failed to select backend:', error)
      }
    },
    [patchAppConfig, appConfig]
  )

  const completeLogin = useCallback(
    async (authPayload: AuthPayload | string) => {
      const normalized = normalizeAuthPayload(authPayload)
      if (!normalized) {
        logDebug('completeLogin failed to normalize payload', { payload: authPayload })
        throw new Error(t('userCenter.responseFormatError'))
      }
      logDebug('completeLogin start', {
        token: maskToken(normalized.token),
        tokenType: normalized.tokenType || null
      })
      await tokenManager.setToken(normalized.token, 7, normalized.tokenType)
      setIsLoggedIn(true)
      setErrors((prev) => ({ ...prev, userInfo: null }))
      setTelegramToken(null)
      setTelegramStatus('idle')
      resetWebLogin()

      setNetworkStatus({
        isOnline: true,
        lastConnected: new Date()
      })

      try {
        await Promise.all([fetchUserInfo(), fetchAnnouncements(), refreshUserSubscription()])
        logDebug('completeLogin refresh done')
      } catch (e) {
        console.warn('Initial data load failed:', e)
      }
    },
    [fetchAnnouncements, fetchUserInfo, refreshUserSubscription, resetWebLogin]
  )

  const handleWebLogin = async () => {
    const baseUrl = getNormalizedBaseUrl()

    if (!baseUrl) {
      setErrors((prev) => ({ ...prev, userInfo: t('userCenter.webLoginBackendMissing') }))
      return
    }

    logDebug('webLogin init', {
      baseUrl,
      redirectUri: WEB_LOGIN_REDIRECT_URI
    })
    resetWebLogin()
    setWebLoginStatus('starting')
    setLoading((prev) => ({ ...prev, userInfo: true }))
    setErrors((prev) => ({ ...prev, userInfo: null }))

    try {
      const state =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      webLoginStateRef.current = state
      localStorage.setItem(WEB_LOGIN_STATE_KEY, state)
      logDebug('webLogin state generated', { state })

      const response = await callV3Gateway(
        baseUrl,
        'passport/auth/thirdPartyLogin/init',
        'POST',
        {
          redirect_uri: WEB_LOGIN_REDIRECT_URI,
          state
        },
        {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': API_USER_AGENT
        }
      )

      const contentType = response.headers.get('content-type') || ''
      logDebug('webLogin init response', {
        status: response.status,
        ok: response.ok,
        contentType
      })
      if (!contentType.includes('application/json')) {
        if (response.status === 404) {
          throw new Error(t('userCenter.webLoginNotSupported'))
        }
        throw new Error(
          response.ok ? t('userCenter.webLoginInitFailed') : `HTTP ${response.status}`
        )
      }

      let data: any = null
      try {
        data = await response.json()
      } catch {
        throw new Error(t('userCenter.webLoginInitFailed'))
      }
      logDebug('webLogin init payload', {
        keys: data ? Object.keys(data) : null,
        appName: data?.data?.app_name ?? data?.app_name ?? null,
        expiresIn: data?.data?.expires_in ?? null
      })

      if (!response.ok) {
        const fallback =
          response.status === 404
            ? t('userCenter.webLoginNotSupported')
            : t('userCenter.webLoginInitFailed')
        throw new Error(data?.message || fallback)
      }

      const loginPageUrl = data?.data?.url ?? data?.url
      if (!loginPageUrl) {
        throw new Error(t('userCenter.webLoginInitFailed'))
      }
      logDebug('webLogin open page', { url: maskUrl(loginPageUrl) })

      setWebLoginStatus('pending')
      scheduleWebLoginTimeout(data?.data?.expires_in)
      window.open(loginPageUrl, '_blank')
    } catch (error) {
      logDebug('webLogin init failed', error)
      resetWebLogin()
      const errorMessage =
        error instanceof Error ? error.message : t('userCenter.webLoginInitFailed')
      setErrors((prev) => ({ ...prev, userInfo: errorMessage }))
    } finally {
      setLoading((prev) => ({ ...prev, userInfo: false }))
    }
  }

  // 登录处理（使用 V3 网关）
  const handleTelegramLogin = async () => {
    if (!email.trim()) {
      setErrors((prev) => ({ ...prev, userInfo: t('userCenter.emailRequired') }))
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setErrors((prev) => ({ ...prev, userInfo: t('userCenter.emailInvalid') }))
      return
    }

    resetWebLogin()
    setLoading((prev) => ({ ...prev, userInfo: true }))
    setErrors((prev) => ({ ...prev, userInfo: null }))
    setTelegramStatus('idle')

    const baseUrl = getNormalizedBaseUrl()

    try {
      const response = await callV3Gateway(
        baseUrl,
        'passport/auth/loginWithTelegram',
        'POST',
        { email: email.trim() },
        {
          'User-Agent': API_USER_AGENT
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || t('userCenter.requestFailed'))
      }

      if (data.data && data.data.token) {
        setTelegramToken(data.data.token)
        setTelegramStatus('pending')
        // 保存用户邮箱
        localStorage.setItem('userEmail', email.trim())
      } else {
        throw new Error(t('userCenter.loginTokenMissing'))
      }
    } catch (error: any) {
      setErrors((prev) => ({
        ...prev,
        userInfo: error.message || t('userCenter.loginRequestFailed')
      }))
    } finally {
      setLoading((prev) => ({ ...prev, userInfo: false }))
    }
  }

  const cancelTelegramLogin = () => {
    setTelegramToken(null)
    setTelegramStatus('idle')
    telegramPollingStartedAtRef.current = null
    telegramPollingAttemptRef.current = 0
    if (pollingIntervalRef.current) {
      clearTimeout(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }

  // Poll Status（使用 V3 网关）
  useEffect(() => {
    if (!telegramToken || telegramStatus !== 'pending') {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      telegramPollingStartedAtRef.current = null
      telegramPollingAttemptRef.current = 0
      return
    }

    const baseUrl = getNormalizedBaseUrl()
    let cancelled = false

    const scheduleNext = (delayMs: number) => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current)
      }
      pollingIntervalRef.current = setTimeout(() => {
        void checkStatus()
      }, delayMs)
    }

    const resolveDelay = (attempt: number) => {
      if (attempt < TELEGRAM_POLLING_BACKOFF_MS.length) {
        return TELEGRAM_POLLING_BACKOFF_MS[attempt]
      }
      return TELEGRAM_POLLING_BACKOFF_MS[TELEGRAM_POLLING_BACKOFF_MS.length - 1]
    }

    const finishPolling = (status: 'rejected' | 'expired') => {
      setTelegramStatus(status)
      setErrors((prev) => ({
        ...prev,
        userInfo:
          status === 'rejected'
            ? t('userCenter.telegramLoginRejected')
            : t('userCenter.telegramLoginExpired')
      }))
      setTelegramToken(null)
      telegramPollingStartedAtRef.current = null
      telegramPollingAttemptRef.current = 0
    }

    const checkStatus = async () => {
      if (cancelled) return
      const startedAt = telegramPollingStartedAtRef.current
      if (startedAt && Date.now() - startedAt >= TELEGRAM_POLLING_TIMEOUT_MS) {
        finishPolling('expired')
        return
      }

      try {
        const response = await callV3Gateway(
          baseUrl,
          'passport/auth/checkTelegramLogin',
          'GET',
          { token: telegramToken },
          {
            'User-Agent': API_USER_AGENT
          }
        )
        const data = await response.json()

        if (response.ok && data.data) {
          const { status, verify_code } = data.data

          if (status === 'approved' && verify_code) {
            setTelegramStatus('approved')
            telegramPollingStartedAtRef.current = null
            telegramPollingAttemptRef.current = 0
            await performTokenLogin(verify_code)
            return
          }

          if (status === 'rejected' || status === 'expired') {
            finishPolling(status)
            return
          }
        }
      } catch (error) {
        console.error('Polling error:', error)
      }

      const nextAttempt = telegramPollingAttemptRef.current + 1
      telegramPollingAttemptRef.current = nextAttempt
      scheduleNext(resolveDelay(nextAttempt - 1))
    }

    if (!telegramPollingStartedAtRef.current) {
      telegramPollingStartedAtRef.current = Date.now()
      telegramPollingAttemptRef.current = 0
    }

    scheduleNext(0)

    return () => {
      cancelled = true
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [telegramToken, telegramStatus, activeBackend, getNormalizedBaseUrl])

  // Token Login (Final Step)（使用 V3 网关）
  const performTokenLogin = async (verifyCode: string) => {
    setLoading((prev) => ({ ...prev, userInfo: true }))
    const baseUrl = getNormalizedBaseUrl()

    try {
      logDebug('telegram token2Login start', { baseUrl, verify: maskToken(verifyCode) })
      const response = await callV3Gateway(
        baseUrl,
        'passport/auth/token2Login',
        'GET',
        { verify: verifyCode },
        {
          'User-Agent': API_USER_AGENT
        }
      )

      logDebug('telegram token2Login response', { status: response.status, ok: response.ok })
      if (!response.ok) {
        throw new Error(t('userCenter.verifyLoginFailed'))
      }

      const data = await response.json()
      logDebug('telegram token2Login payload', {
        keys: data ? Object.keys(data) : null
      })

      const authPayload = normalizeAuthPayload(data?.data ?? data)
      if (authPayload) {
        await completeLogin(authPayload)
      } else {
        throw new Error(t('userCenter.responseFormatError'))
      }
    } catch (error: any) {
      setErrors((prev) => ({
        ...prev,
        userInfo: error.message || t('userCenter.loginVerifyFailed')
      }))
      setTelegramStatus('idle')
      setTelegramToken(null)
    } finally {
      setLoading((prev) => ({ ...prev, userInfo: false }))
    }
  }

  useEffect(() => {
    const handleUserCenterLogin = async (
      _event: Electron.IpcRendererEvent,
      payload?: {
        accessToken?: string | null
        tokenType?: string | null
        error?: string | null
        state?: string | null
      }
    ): Promise<void> => {
      if (!payload) return
      logDebug('deeplink received', {
        accessToken: maskToken(payload.accessToken),
        tokenType: payload.tokenType || null,
        error: payload.error || null,
        state: payload.state || null
      })
      const expectedState = getWebLoginState()
      if (payload.state && expectedState && payload.state !== expectedState) {
        logDebug('deeplink state mismatch', { expected: expectedState, actual: payload.state })
        setErrors((prev) => ({ ...prev, userInfo: t('userCenter.webLoginStateMismatch') }))
        resetWebLogin()
        return
      }

      if (payload.error) {
        const message =
          payload.error === 'access_denied'
            ? t('userCenter.webLoginDenied')
            : t('userCenter.webLoginFailed')
        logDebug('deeplink error', { error: payload.error })
        setErrors((prev) => ({ ...prev, userInfo: message }))
        resetWebLogin()
        return
      }

      if (payload.accessToken) {
        setLoading((prev) => ({ ...prev, userInfo: true }))
        try {
          logDebug('deeplink login start')
          await completeLogin({ token: payload.accessToken, tokenType: payload.tokenType })
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : t('userCenter.webLoginFailed')
          setErrors((prev) => ({ ...prev, userInfo: errorMessage }))
        } finally {
          setLoading((prev) => ({ ...prev, userInfo: false }))
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on('userCenterLogin', handleUserCenterLogin as any)
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.electron.ipcRenderer.removeListener('userCenterLogin', handleUserCenterLogin as any)
    }
  }, [completeLogin, getWebLoginState, resetWebLogin, t])

  useEffect(() => {
    return () => {
      clearWebLoginState()
    }
  }, [clearWebLoginState])

  // 退出登录
  const handleLogout = () => {
    tokenManager.clearToken()
    setIsLoggedIn(false)
    setUserInfo(null)
    setAnnouncements([])
    setEmail('')
    resetWebLogin()
    // Reset Telegram State
    setTelegramToken(null)
    setTelegramStatus('idle')
    telegramPollingStartedAtRef.current = null
    telegramPollingAttemptRef.current = 0
    if (pollingIntervalRef.current) {
      clearTimeout(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    // 重置自动测试标志
    hasStartedAutoTest.current = false

    // 清理定时器
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // 清理错误状态
    setErrors({
      userInfo: null,
      announcements: null
    })

    // 刷新用户订阅为空白状态，并更新订阅内容为默认空白配置
    refreshUserSubscription()
      .then(async () => {
        try {
          // 获取用户订阅项ID
          const USER_SUBSCRIPTION_ID = 'user-subscription-meta'

          // 关键修复：将订阅项在配置中改为“空白占位”URL并禁用自动更新，避免重启后被重新拉取
          // 说明：主进程 profileUpdater 在 URL 为 'https://example.com/empty-subscription' 或 interval 为 0 时都不会触发更新
          try {
            const currentItem = await window.electron.ipcRenderer.invoke(
              'getProfileItem',
              USER_SUBSCRIPTION_ID
            )
            if (currentItem) {
              const patchedItem = {
                ...currentItem,
                url: 'https://example.com/empty-subscription',
                interval: 0,
                extra: undefined
              }
              await window.electron.ipcRenderer.invoke('updateProfileItem', patchedItem)
            }
          } catch (e) {
            console.warn('更新用户订阅占位状态失败（将继续清理本地文件）:', e)
          }

          // 同步将本地配置文件重置为空白（即使随后删除文件，也可立即生效为干净配置）
          await window.electron.ipcRenderer.invoke(
            'setProfileStr',
            USER_SUBSCRIPTION_ID,
            `# 空白订阅配置
# 退出登录后的默认配置，包含基本结构但无具体代理内容

proxies:
  # 无代理配置

proxy-groups:
  # 无代理组配置

rules:
  # 无规则配置
  - MATCH,DIRECT
`
          )

          console.log('用户订阅内容已清空为默认配置')
        } catch (error) {
          console.error('清空用户订阅内容失败:', error)
        }
      })
      .catch(console.error)
  }

  useEffect(() => {
    if (!telegramLoginEnabled && loginMode === 'telegram') {
      setLoginMode('web')
    }
  }, [loginMode, telegramLoginEnabled])

  // 初始化（只运行一次）
  useEffect(() => {
    // Initialize backend list
    initializeBackendList()

    // 检查并加载保存的token
    ;(async () => {
      try {
        await initUserAuth()
      } catch (error) {
        console.warn('initUserAuth failed in user-center init:', error)
      }

      const token = tokenManager.getToken()
      logDebug('init token check', { hasToken: Boolean(token), token: maskToken(token) })
      if (token) {
        setIsLoggedIn(true)
        fetchUserInfo()
        fetchAnnouncements()
      } else {
        // 未登录状态，自动测试服务器连接
        testServerConnection()
      }
    })()

    // 自动填充上次登录的邮箱
    const savedEmail = localStorage.getItem('userEmail')
    if (savedEmail) {
      setEmail(savedEmail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 空依赖数组，只在组件挂载时运行一次

  // Sync backendsRef with backends state
  useEffect(() => {
    backendsRef.current = backends
  }, [backends])

  // Auto-test backends: 初始测试一次，只有所有后端都不可用时才每5秒刷新
  useEffect(() => {
    if (!isLoggedIn && backends.length > 0 && !hasStartedAutoTest.current) {
      hasStartedAutoTest.current = true

      // Clear any existing timers
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      // Initial test after 500ms
      const initialTimer = setTimeout(async () => {
        const currentBackends = backendsRef.current
        if (currentBackends.length >= 1) {
          const results = await testAllBackends()
          // 检查是否有任何一个后端可用
          const hasActiveBackend = results?.some((r) => r.isActive) ?? false

          // 只有所有后端都不可用时，才启动定时刷新
          if (!hasActiveBackend) {
            const resolveDelay = (attempt: number) => {
              if (attempt < BACKEND_AUTO_TEST_BACKOFF_MS.length) {
                return BACKEND_AUTO_TEST_BACKOFF_MS[attempt]
              }
              return BACKEND_AUTO_TEST_BACKOFF_MS[BACKEND_AUTO_TEST_BACKOFF_MS.length - 1]
            }

            const scheduleRetry = (delayMs: number) => {
              if (intervalRef.current) {
                clearTimeout(intervalRef.current)
              }
              intervalRef.current = setTimeout(async () => {
                const latestBackends = backendsRef.current
                if (latestBackends.length >= 1) {
                  const retryResults = await testAllBackends()
                  // 如果有后端可用了，停止刷新
                  const nowHasActive = retryResults?.some((r) => r.isActive) ?? false
                  if (nowHasActive) {
                    if (intervalRef.current) {
                      clearTimeout(intervalRef.current)
                      intervalRef.current = null
                    }
                    backendAutoTestAttemptRef.current = 0
                    return
                  }
                }

                const nextAttempt = backendAutoTestAttemptRef.current + 1
                backendAutoTestAttemptRef.current = nextAttempt
                scheduleRetry(resolveDelay(nextAttempt - 1))
              }, delayMs)
            }

            backendAutoTestAttemptRef.current = 0
            scheduleRetry(resolveDelay(0))
          }
        }
      }, 500)

      return () => {
        clearTimeout(initialTimer)
        if (intervalRef.current) {
          clearTimeout(intervalRef.current)
          intervalRef.current = null
        }
      }
    }

    // Reset when user logs in
    if (isLoggedIn) {
      hasStartedAutoTest.current = false
      backendAutoTestAttemptRef.current = 0
      if (intervalRef.current) {
        clearTimeout(intervalRef.current)
        intervalRef.current = null
      }
    }

    return
  }, [isLoggedIn, backends.length]) // 依赖于登录状态和后端数量

  // Token过期检查和提醒
  useEffect(() => {
    if (!isLoggedIn) return

    const checkTokenExpiration = () => {
      if (tokenManager.isTokenExpiringSoon()) {
        const remainingDays = tokenManager.getTokenRemainingDays()
        if (remainingDays > 0) {
          setErrors((prev) => ({
            ...prev,
            userInfo: t('userCenter.loginExpiring', { days: remainingDays })
          }))
        }
      }
    }

    // 立即检查一次
    checkTokenExpiration()

    // 每小时检查一次
    const tokenCheckInterval = setInterval(checkTokenExpiration, 60 * 60 * 1000)

    return () => {
      clearInterval(tokenCheckInterval)
    }
  }, [isLoggedIn])

  // 网络状态监听 - 仅监听恢复在线事件，离线状态由实际请求失败来判断
  useEffect(() => {
    const handleOnline = () => {
      setNetworkStatus({
        isOnline: true,
        lastConnected: new Date()
      })
      // 移除自动刷新，让用户手动点击刷新
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  // 工具函数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('zh-CN')
  }

  const showAnnouncementModal = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
    markAnnouncementAsRead(announcement.id)
    setIsModalOpen(true)
  }

  const getUsagePercentage = () => {
    if (!userInfo) return 0
    const used = userInfo.traffic.upload + userInfo.traffic.download
    return Math.min((used / userInfo.traffic.total) * 100, 100)
  }

  const isExpiringSoon = () => {
    if (!userInfo?.traffic.expire) return false
    const oneWeek = 7 * 24 * 60 * 60 * 1000
    return userInfo.traffic.expire < Date.now() + oneWeek
  }

  const hasUnreadAnnouncements = announcements.some(
    (announcement) => !readAnnouncementIds.has(announcement.id)
  )

  if (!isLoggedIn) {
    return (
      <BasePage title={t('userCenter.title')}>
        <div className="relative min-h-[72vh] flex justify-center items-center">
          <div className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_40%_at_50%_-10%,black,transparent_70%)]">
            <div className="absolute inset-0 bg-[radial-gradient(1000px_600px_at_50%_-10%,rgba(147,197,253,0.28),transparent_60%)]" />
          </div>
          <Card className="relative w-full max-w-lg shadow-2xl border border-default-200">
            <CardHeader className="pb-4 pt-8 px-8 bg-gradient-to-b from-background to-primary/5">
              <div className="w-full text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <IoPersonOutline className="text-primary text-3xl" />
                </div>
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground">
                  {t('userCenter.login')}
                </h2>
                <p className="text-default-500 mt-2">{t('userCenter.loginHint')}</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-5 px-8 pb-8">
              {/* 网络状态提示 */}
              {!networkStatus.isOnline && (
                <div className="flex items-center gap-2 text-warning text-sm p-3 bg-warning/10 rounded-lg border border-warning/20">
                  <div className="w-2 h-2 rounded-full bg-warning animate-pulse"></div>
                  <span>{t('userCenter.networkDisconnected')}</span>
                </div>
              )}

              {/* 登录错误提示 */}
              {errors.userInfo && (
                <div className="p-4 bg-danger/10 border border-danger/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-danger/20 flex items-center justify-center mt-0.5">
                      <span className="text-danger text-xs font-bold">!</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-danger text-sm font-medium">{errors.userInfo}</p>
                      <Button
                        variant="light"
                        size="sm"
                        onPress={() => setErrors((prev) => ({ ...prev, userInfo: null }))}
                        className="mt-2 text-danger hover:bg-danger/10"
                      >
                        {t('userCenter.dismissNotice')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {telegramLoginEnabled && (
                <Tabs
                  aria-label={t('userCenter.loginMethod')}
                  selectedKey={loginMode}
                  onSelectionChange={(key) => setLoginMode(key as 'web' | 'telegram')}
                  variant="underlined"
                  className="mb-2"
                >
                  <Tab key="web" title={t('userCenter.loginWebTab')} />
                  <Tab key="telegram" title={t('userCenter.loginTelegramTab')} />
                </Tabs>
              )}

              {loginMode === 'web' && (
                <div className="space-y-4">
                  <div className="p-4 bg-default-50 border border-default-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <IoLogInOutline />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-semibold text-foreground">
                          {t('userCenter.webLoginTitle')}
                        </h4>
                        <p className="text-xs text-default-500">{t('userCenter.webLoginHint')}</p>
                      </div>
                    </div>
                  </div>

                  {webLoginStatus === 'pending' && (
                    <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg animate-pulse">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <IoLogInOutline />
                        </div>
                        <h4 className="font-bold text-primary">
                          {t('userCenter.webLoginPendingTitle')}
                        </h4>
                        <p className="text-xs text-default-500">
                          {t('userCenter.webLoginPendingDesc')}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Button
                      color="primary"
                      size="lg"
                      variant="solid"
                      radius="lg"
                      className="w-full h-12 text-base font-extrabold shadow-lg"
                      onPress={handleWebLogin}
                      isLoading={webLoginStatus === 'starting'}
                      isDisabled={
                        !networkStatus.isOnline ||
                        webLoginStatus === 'starting' ||
                        telegramStatus === 'pending'
                      }
                      startContent={webLoginStatus !== 'starting' && <IoLogInOutline />}
                    >
                      {webLoginStatus === 'pending'
                        ? t('userCenter.webLoginOpenAgain')
                        : t('userCenter.webLoginButton')}
                    </Button>
                    {webLoginStatus === 'pending' && (
                      <Button
                        color="danger"
                        size="lg"
                        variant="flat"
                        radius="lg"
                        className="w-full h-12 text-base font-medium"
                        onPress={resetWebLogin}
                      >
                        {t('userCenter.webLoginCancel')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {loginMode === 'telegram' && (
                <>
                  <div className="space-y-4">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('userCenter.emailPlaceholder')}
                      size="lg"
                      variant="bordered"
                      radius="lg"
                      isDisabled={
                        loading.userInfo ||
                        !networkStatus.isOnline ||
                        telegramStatus === 'pending' ||
                        webLoginStatus === 'pending'
                      }
                      startContent={<IoPersonOutline className="text-default-400" />}
                      classNames={{
                        input: 'text-base',
                        inputWrapper: 'h-12 shadow-sm'
                      }}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleTelegramLogin()
                        }
                      }}
                    />

                    {telegramStatus === 'pending' && (
                      <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg animate-pulse">
                        <div className="flex flex-col items-center gap-2 text-center">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <IoPaperPlaneOutline />
                          </div>
                          <h4 className="font-bold text-primary">
                            {t('userCenter.telegramConfirmTitle')}
                          </h4>
                          <p className="text-xs text-default-500">
                            {t('userCenter.telegramConfirmDesc')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {telegramStatus === 'pending' ? (
                    <Button
                      color="danger"
                      size="lg"
                      variant="flat"
                      radius="lg"
                      className="w-full h-12 text-base font-medium"
                      onPress={cancelTelegramLogin}
                    >
                      {t('userCenter.telegramCancel')}
                    </Button>
                  ) : (
                    <Button
                      color="primary"
                      size="lg"
                      variant="solid"
                      radius="lg"
                      className="w-full h-12 text-base font-extrabold shadow-lg"
                      onPress={handleTelegramLogin}
                      isLoading={loading.userInfo}
                      isDisabled={!email || !networkStatus.isOnline || webLoginStatus === 'pending'}
                      startContent={!loading.userInfo && <IoPaperPlaneOutline />}
                    >
                      {loading.userInfo
                        ? t('userCenter.requesting')
                        : t('userCenter.telegramLogin')}
                    </Button>
                  )}

                  {/* 服务器选择和测试（未登录也可选择，会话生效） */}
                </>
              )}

              {backends.length >= 1 && (
                <div className="text-center border-t border-default-200 pt-4">
                  <div className="space-y-4 p-4 bg-default-50 rounded-xl border border-default-200 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IoServerOutline className="text-primary text-lg" />
                        <label className="text-sm font-semibold text-foreground">
                          {t('userCenter.selectBackend')}
                        </label>
                      </div>
                      <Button
                        size="sm"
                        variant="flat"
                        color="primary"
                        isLoading={isTestingBackends}
                        startContent={!isTestingBackends && <IoSpeedometer className="text-sm" />}
                        onPress={
                          backends.length > 1 ? testAllBackendsAndSelectOptimal : testAllBackends
                        }
                        disabled={isTestingBackends}
                        className="text-xs min-w-fit px-3 shadow-sm"
                      >
                        {isTestingBackends
                          ? t('userCenter.testing')
                          : backends.length > 1
                            ? t('userCenter.testAndPickBest')
                            : t('userCenter.testLatency')}
                      </Button>
                    </div>

                    {isTestingBackends && (
                      <div className="flex items-center justify-center gap-2 text-primary text-xs">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                        <span>{t('userCenter.testingAllBackends')}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {backends.map((backend) => (
                        <div
                          key={backend.id}
                          className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:border-primary hover:shadow-sm ${
                            selectedBackend?.id === backend.id
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-default-200 hover:bg-default-100'
                          }`}
                          onClick={() => {
                            setSelectedBackend(backend)
                            handleBackendSelection(backend.id)
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-foreground truncate">
                                  {backend.name}
                                </span>
                                {backend.isDefault && (
                                  <Chip
                                    size="sm"
                                    color="primary"
                                    variant="solid"
                                    className="text-xs"
                                  >
                                    {t('userCenter.backendDefault')}
                                  </Chip>
                                )}
                                {selectedBackend?.id === backend.id && (
                                  <Chip
                                    size="sm"
                                    color="secondary"
                                    variant="bordered"
                                    className="text-xs"
                                  >
                                    {t('userCenter.backendSelected')}
                                  </Chip>
                                )}
                                {selectedBackend?.id === backend.id && (
                                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                {backend.isActive !== undefined && (
                                  <div
                                    className={`flex items-center gap-1 text-xs ${
                                      backend.isActive ? 'text-success' : 'text-danger'
                                    }`}
                                  >
                                    <div
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        backend.isActive ? 'bg-success' : 'bg-danger'
                                      }`}
                                    ></div>
                                    {backend.isActive
                                      ? t('userCenter.backendOnline')
                                      : t('userCenter.backendOffline')}
                                  </div>
                                )}
                                {backend.lastPing && (
                                  <div
                                    className={`flex items-center gap-1 text-xs ${
                                      backend.lastPing < 300
                                        ? 'text-success'
                                        : backend.lastPing < 1000
                                          ? 'text-warning'
                                          : 'text-danger'
                                    }`}
                                  >
                                    <div
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        backend.lastPing < 300
                                          ? 'bg-success'
                                          : backend.lastPing < 1000
                                            ? 'bg-warning'
                                            : 'bg-danger'
                                      }`}
                                    ></div>
                                    {backend.lastPing < 100
                                      ? t('userCenter.pingVeryFast')
                                      : backend.lastPing < 300
                                        ? t('userCenter.pingFast')
                                        : backend.lastPing < 1000
                                          ? t('userCenter.pingGood')
                                          : t('userCenter.pingSlow')}
                                    ({backend.lastPing}ms)
                                  </div>
                                )}
                                {!backend.lastPing && !isTestingBackends && (
                                  <div className="text-xs text-default-400">
                                    {t('userCenter.notTested')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="text-xs text-default-500 text-center">
                      {backends.length > 1
                        ? t('userCenter.autoTestDelayHint')
                        : t('userCenter.autoTestConnectionHint')}
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </BasePage>
    )
  }

  return (
    <BasePage title={t('userCenter.title')}>
      <div className="space-y-6">
        {/* 网络状态提示 */}
        {!networkStatus.isOnline && (
          <Card className="border-warning">
            <CardBody className="py-3">
              <div className="flex items-center gap-2 text-warning">
                <div className="w-2 h-2 rounded-full bg-warning animate-pulse"></div>
                <span className="text-sm">{t('userCenter.networkDisconnectedStale')}</span>
              </div>
            </CardBody>
          </Card>
        )}
        {/* 顶部操作区：刷新 / 退出登录 */}
        <div className="flex justify-end gap-2">
          <Button variant="light" size="sm" onPress={handleLogout} color="danger">
            {t('userCenter.logout')}
          </Button>
        </div>

        {/* 公告模块 —— 列表展示 */}
        <Card>
          <CardHeader className="flex justify-between">
            <h3 className="text-lg font-semibold">{t('userCenter.announcements')}</h3>
            <div className="flex items-center gap-2">
              {hasUnreadAnnouncements && (
                <span
                  className="w-2 h-2 rounded-full bg-danger animate-pulse"
                  aria-label={t('userCenter.unreadAnnouncementsLabel')}
                ></span>
              )}
              {loading.announcements && <Spinner size="sm" />}
            </div>
          </CardHeader>
          <CardBody>
            {errors.announcements ? (
              <div className="text-center py-8">
                <div className="text-danger mb-2">
                  <p>{t('userCenter.loadFailed', { error: errors.announcements })}</p>
                </div>
                <div className="flex justify-center gap-2">
                  <Button
                    variant="light"
                    size="sm"
                    onPress={() => fetchAnnouncements(true)}
                    isLoading={loading.announcements}
                  >
                    {t('userCenter.retry')}
                  </Button>
                  <Button
                    variant="light"
                    size="sm"
                    onPress={() => setErrors((prev) => ({ ...prev, announcements: null }))}
                  >
                    {t('userCenter.dismissError')}
                  </Button>
                </div>
              </div>
            ) : loading.announcements && announcements.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="flex flex-col items-center gap-2">
                  <Spinner />
                  <p className="text-sm text-default-500">{t('userCenter.loadingAnnouncements')}</p>
                </div>
              </div>
            ) : announcements.length > 0 ? (
              <div className="divide-y divide-default-200">
                {announcements.map((announcement) => {
                  const isRead = readAnnouncementIds.has(announcement.id)
                  const previewText = announcement.content
                    ? announcement.content
                        .replace(/<[^>]*>/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                    : ''
                  const truncatedPreview =
                    previewText.length > 140 ? `${previewText.slice(0, 140)}...` : previewText

                  return (
                    <div
                      key={announcement.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => showAnnouncementModal(announcement)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          showAnnouncementModal(announcement)
                        }
                      }}
                      className="py-3 px-2 hover:bg-default-100 rounded cursor-pointer transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-1">
                          <span
                            className={`block w-2 h-2 rounded-full ${isRead ? 'opacity-0' : 'bg-danger animate-pulse'}`}
                          ></span>
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-default-400">📢</span>
                              <span className="font-medium text-foreground truncate">
                                {announcement.title}
                              </span>
                            </div>
                            {announcement.date && (
                              <span className="text-xs text-default-500 shrink-0">
                                {announcement.date}
                              </span>
                            )}
                          </div>

                          {announcement.tags && announcement.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {announcement.tags.slice(0, 4).map((tag) => (
                                <Chip
                                  key={`${announcement.id}-${tag}`}
                                  size="sm"
                                  variant="flat"
                                  color="primary"
                                  className="text-xs"
                                >
                                  {tag}
                                </Chip>
                              ))}
                            </div>
                          )}

                          {truncatedPreview && (
                            <p
                              className="text-sm text-default-500"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}
                            >
                              {truncatedPreview}
                            </p>
                          )}
                        </div>

                        {announcement.imgUrl && (
                          <div className="shrink-0 w-28 max-h-24 overflow-hidden rounded-md border border-default-200 bg-default-100 flex items-center justify-center">
                            <img
                              src={announcement.imgUrl}
                              alt={announcement.title}
                              className="w-full h-auto max-h-24 object-contain"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center text-default-500 py-8">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-default-100 flex items-center justify-center">
                    <span className="text-default-400">📢</span>
                  </div>
                  <p>{t('userCenter.noAnnouncements')}</p>
                  <Button variant="light" size="sm" onPress={() => fetchAnnouncements(true)}>
                    {t('userCenter.refreshTry')}
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* 流量信息模块 */}
        <Card>
          <CardHeader className="flex justify-between">
            <h3 className="text-lg font-semibold">{t('userCenter.traffic')}</h3>
            {loading.userInfo && <Spinner size="sm" />}
          </CardHeader>
          <CardBody>
            {errors.userInfo ? (
              <div className="text-center py-8 text-danger">
                <p>{t('userCenter.loadFailed', { error: errors.userInfo })}</p>
                <Button
                  variant="light"
                  size="sm"
                  onPress={() => fetchUserInfo(true)}
                  className="mt-2"
                >
                  {t('userCenter.retry')}
                </Button>
              </div>
            ) : userInfo ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatBytes(userInfo.traffic.upload)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">{t('userCenter.upload')}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatBytes(userInfo.traffic.download)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">{t('userCenter.download')}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatBytes(userInfo.traffic.upload + userInfo.traffic.download)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">{t('userCenter.totalUsed')}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatBytes(userInfo.traffic.total)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">
                      {t('userCenter.totalLimit')}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>{t('userCenter.usageProgress')}</span>
                    <span>{getUsagePercentage().toFixed(1)}%</span>
                  </div>
                  <Progress
                    value={getUsagePercentage()}
                    color={
                      getUsagePercentage() > 80
                        ? 'danger'
                        : getUsagePercentage() > 60
                          ? 'warning'
                          : 'primary'
                    }
                    className="h-3"
                  />
                </div>

                <div className="pt-4 border-t border-default-200">
                  <div className="flex justify-between">
                    <span className="font-medium">{t('userCenter.expire')}:</span>
                    <span
                      className={isExpiringSoon() ? 'text-warning font-medium' : 'text-foreground'}
                    >
                      {userInfo.traffic.expire
                        ? formatDate(userInfo.traffic.expire)
                        : t('sider.cards.neverExpire')}
                      {isExpiringSoon() && (
                        <span className="ml-2 text-xs">({t('userCenter.expiringSoon')})</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            )}
          </CardBody>
        </Card>

        {/* 服务器选择和测试（登录后） */}
        {backends.length >= 1 && (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IoServerOutline className="text-primary text-lg" />
                <h3 className="text-lg font-semibold">{t('userCenter.selectBackend')}</h3>
              </div>
              <Button
                size="sm"
                variant="flat"
                color="primary"
                isLoading={isTestingBackends}
                startContent={!isTestingBackends && <IoSpeedometer className="text-sm" />}
                onPress={backends.length > 1 ? testAllBackendsAndSelectOptimal : testAllBackends}
                disabled={isTestingBackends}
                className="text-xs min-w-fit px-3 shadow-sm"
              >
                {isTestingBackends
                  ? t('userCenter.testing')
                  : backends.length > 1
                    ? t('userCenter.testAndPickBest')
                    : t('userCenter.testLatency')}
              </Button>
            </CardHeader>
            <Divider />
            <CardBody>
              {isTestingBackends && (
                <div className="flex items-center justify-center gap-2 text-primary text-xs mb-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                  <span>{t('userCenter.testingAllBackends')}</span>
                </div>
              )}

              <div className="space-y-2">
                {backends.map((backend) => (
                  <div
                    key={backend.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:border-primary hover:shadow-sm ${
                      selectedBackend?.id === backend.id
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-default-200 hover:bg-default-100'
                    }`}
                    onClick={() => {
                      setSelectedBackend(backend)
                      handleBackendSelection(backend.id)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-foreground truncate">
                            {backend.name}
                          </span>
                          {backend.isDefault && (
                            <Chip size="sm" color="primary" variant="solid" className="text-xs">
                              {t('userCenter.backendDefault')}
                            </Chip>
                          )}
                          {selectedBackend?.id === backend.id && (
                            <Chip
                              size="sm"
                              color="secondary"
                              variant="bordered"
                              className="text-xs"
                            >
                              {t('userCenter.backendSelected')}
                            </Chip>
                          )}
                          {selectedBackend?.id === backend.id && (
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          {backend.isActive !== undefined && (
                            <div
                              className={`flex items-center gap-1 text-xs ${
                                backend.isActive ? 'text-success' : 'text-danger'
                              }`}
                            >
                              <div
                                className={`w-1.5 h-1.5 rounded-full ${
                                  backend.isActive ? 'bg-success' : 'bg-danger'
                                }`}
                              ></div>
                              {backend.isActive
                                ? t('userCenter.backendOnline')
                                : t('userCenter.backendOffline')}
                            </div>
                          )}
                          {backend.lastPing && (
                            <div
                              className={`flex items-center gap-1 text-xs ${
                                backend.lastPing < 300
                                  ? 'text-success'
                                  : backend.lastPing < 1000
                                    ? 'text-warning'
                                    : 'text-danger'
                              }`}
                            >
                              <div
                                className={`w-1.5 h-1.5 rounded-full ${
                                  backend.lastPing < 300
                                    ? 'bg-success'
                                    : backend.lastPing < 1000
                                      ? 'bg-warning'
                                      : 'bg-danger'
                                }`}
                              ></div>
                              {backend.lastPing < 100
                                ? t('userCenter.pingVeryFast')
                                : backend.lastPing < 300
                                  ? t('userCenter.pingFast')
                                  : backend.lastPing < 1000
                                    ? t('userCenter.pingGood')
                                    : t('userCenter.pingSlow')}
                              ({backend.lastPing}ms)
                            </div>
                          )}
                          {!backend.lastPing && !isTestingBackends && (
                            <div className="text-xs text-default-400">
                              {t('userCenter.notTested')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-default-500 text-center mt-2">
                {t('userCenter.loggedInNoAutoSwitchHint')}
              </div>
            </CardBody>
          </Card>
        )}

        {/* 公告详情模态框 */}
        <Modal
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          size="2xl"
          scrollBehavior="inside"
        >
          <ModalContent>
            <ModalHeader className="flex justify-between items-center">
              <div className="flex flex-col gap-1 flex-1">
                <h3 className="text-xl font-bold">{selectedAnnouncement?.title}</h3>
                <span className="text-sm text-default-500">{selectedAnnouncement?.date}</span>
              </div>
              <Button isIconOnly variant="light" size="sm" onPress={() => setIsModalOpen(false)}>
                <IoCloseOutline />
              </Button>
            </ModalHeader>
            <Divider />
            <ModalBody className="py-6 space-y-4">
              {selectedAnnouncement?.tags && selectedAnnouncement.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedAnnouncement.tags.map((tag) => (
                    <Chip
                      key={`${selectedAnnouncement.id}-${tag}`}
                      size="sm"
                      variant="flat"
                      color="primary"
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
              )}

              {selectedAnnouncement?.imgUrl && (
                <div className="overflow-hidden rounded-lg border border-default-200 bg-default-50">
                  <img
                    src={selectedAnnouncement.imgUrl}
                    alt={selectedAnnouncement.title}
                    className="w-full h-auto max-h-[70vh] object-contain mx-auto"
                  />
                </div>
              )}

              <div className="prose max-w-none">
                <div
                  className="whitespace-pre-wrap leading-relaxed text-foreground"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      selectedAnnouncement?.content?.replace(/\n/g, '<br>') || '',
                      {
                        ALLOWED_TAGS: [
                          'a',
                          'abbr',
                          'b',
                          'blockquote',
                          'br',
                          'code',
                          'em',
                          'i',
                          'img',
                          'li',
                          'ol',
                          'p',
                          'pre',
                          'strong',
                          'ul',
                          'span'
                        ],
                        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt'],
                        ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image)\b/i
                      }
                    )
                  }}
                />
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>
      </div>
    </BasePage>
  )
}

export default UserCenter
