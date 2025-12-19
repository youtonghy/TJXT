import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardBody, CardHeader, Input, Button, Modal, ModalContent, ModalHeader, ModalBody, Divider, Spinner, Progress, Select, SelectItem, Badge, Chip, Tooltip } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { IoRefreshOutline, IoCloseOutline, IoPersonOutline, IoLockClosedOutline, IoServerOutline, IoSpeedometer, IoCheckmarkCircle, IoEyeOutline, IoEyeOffOutline } from 'react-icons/io5'
import BasePage from '@renderer/components/base/base-page'
import { 
  getAllBackends, 
  getDefaultBackend, 
  getActiveBackend,
  testAllBackendsLatency, 
  updateBackendPingResults, 
  setDefaultBackend, 
  initializeBackends,
  findOptimalBackend,
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
  created_at?: string
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

const UserCenter: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { refreshUserSubscription, addProfileItem, changeCurrentProfile } = useProfileConfig()
  
  // Backend management
  const [backends, setBackends] = useState<IUserCenterBackend[]>([])
  const [selectedBackend, setSelectedBackend] = useState<IUserCenterBackend | null>(null)
  const [backendTestResults, setBackendTestResults] = useState<BackendTestResult[]>([])
  const [isTestingBackends, setIsTestingBackends] = useState(false)
  // Track if user has manually picked a backend in this session
  const [userSelectedBackendId, setUserSelectedBackendId] = useState<string | null>(null)
  const SELECTED_BACKEND_KEY = 'userCenter.selectedBackendId'
  
  // Use selected backend URL or fallback to active backend (selected > default)
  const loginUrl = selectedBackend?.url || getActiveBackend(appConfig).url
  
  // ç¶æç®¡ç?  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  
  // å è½½ç¶æ?  const [loading, setLoading] = useState<LoadingState>({
    userInfo: false,
    announcements: false
  })
  
  // éè¯¯ç¶æ?  const [errors, setErrors] = useState<ErrorState>({
    userInfo: null,
    announcements: null
  })
  
  // æ¨¡ææ¡ç¶æ?  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // èªå¨å·æ°ç¸å
³
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const backendsRef = useRef<IUserCenterBackend[]>([])
  const hasStartedAutoTest = useRef<boolean>(false)
  
  // ç½ç»ç¶æ?  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    lastConnected: navigator.onLine ? new Date() : null
  })
  
  // æå¡å¨æµè¯ç¶æ?  const [serverTestStatus, setServerTestStatus] = useState<{
    isLoading: boolean
    lastPing: number | null
    lastTest: Date | null
  }>({
    isLoading: false,
    lastPing: null,
    lastTest: null
  })
  
  // Tokenç®¡çå·¥å
·å½æ°
  const tokenManager = {
    // è®¾ç½®Tokenï¼å¸¦è¿ææ¶é´ï¼?    setToken: (token: string, expiresInDays: number = 7) => {
      const now = new Date()
      const expiresAt = now.getTime() + (expiresInDays * 24 * 60 * 60 * 1000)
      
      const tokenData = {
        token,
        expiresAt,
        createdAt: now.getTime()
      }
      
      localStorage.setItem('userToken', token)
      localStorage.setItem('userTokenData', JSON.stringify(tokenData))
    },
    
    // è·åToken
    getToken: (): string | null => {
      const token = localStorage.getItem('userToken')
      const tokenDataStr = localStorage.getItem('userTokenData')
      
      if (!token || !tokenDataStr) {
        return null
      }
      
      try {
        const tokenData = JSON.parse(tokenDataStr)
        const now = Date.now()
        
        // æ£æ¥æ¯å¦è¿æ?        if (tokenData.expiresAt && now > tokenData.expiresAt) {
          tokenManager.clearToken()
          return null
        }
        
        return token
      } catch {
        // æ°æ®æ ¼å¼éè¯¯ï¼æ¸
é¤token
        tokenManager.clearToken()
        return null
      }
    },
    
    // æ¸
é¤Token
    clearToken: () => {
      localStorage.removeItem('userToken')
      localStorage.removeItem('userTokenData')
      localStorage.removeItem('userEmail') // æ¸
é¤è®°ä½çé®ç®?    },
    
    // æ£æ¥Tokenæ¯å¦å³å°è¿æï¼?4å°æ¶å
ï¼
    isTokenExpiringSoon: (): boolean => {
      const tokenDataStr = localStorage.getItem('userTokenData')
      if (!tokenDataStr) return false
      
      try {
        const tokenData = JSON.parse(tokenDataStr)
        const now = Date.now()
        const oneDay = 24 * 60 * 60 * 1000
        
        return tokenData.expiresAt && (tokenData.expiresAt - now) < oneDay
      } catch {
        return false
      }
    },
    
    // è·åTokenå©ä½å¤©æ°
    getTokenRemainingDays: (): number => {
      const tokenDataStr = localStorage.getItem('userTokenData')
      if (!tokenDataStr) return 0
      
      try {
        const tokenData = JSON.parse(tokenDataStr)
        const now = Date.now()
        
        if (!tokenData.expiresAt || now > tokenData.expiresAt) {
          return 0
        }
        
        return Math.ceil((tokenData.expiresAt - now) / (24 * 60 * 60 * 1000))
      } catch {
        return 0
      }
    }
  }

  // éç¨APIè¯·æ±å½æ°ï¼ä¼åtokenå¤çï¼?  const apiRequest = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const token = tokenManager.getToken()
    if (!token) {
      setIsLoggedIn(false)
      return null
    }

    try {
      // æ£æ¥ç½ç»ç¶æ?      if (!navigator.onLine) {
        throw new Error('ç½ç»è¿æ¥å·²æ­å¼')
      }

      const response = await fetch(`${loginUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': token, // åèdashboard.htmlï¼ç´æ¥ä½¿ç¨tokenèä¸æ¯Beareræ ¼å¼
          'Content-Type': 'application/json',
          ...options.headers
        }
      })

      if (response.status === 401) {
        // Tokenæ ææè¿æï¼æ¸
é¤å¹¶éæ°ç»å½?        tokenManager.clearToken()
        setIsLoggedIn(false)
        return null
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      
      // APIè¯·æ±æåï¼æ´æ°ç½ç»ç¶æ?      setNetworkStatus({
        isOnline: true,
        lastConnected: new Date()
      })
      
      return data.data || data
    } catch (error) {
      // æ£æ¥æ¯å¦æ¯ç½ç»éè¯¯
      if (!navigator.onLine) {
        setNetworkStatus(prev => ({ ...prev, isOnline: false }))
      }
      
      console.error(`API request failed for ${endpoint}:`, error)
      throw error
    }
  }, [loginUrl])

  // è·åç¨æ·ä¿¡æ¯
  const fetchUserInfo = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(prev => ({ ...prev, userInfo: true }))
      setErrors(prev => ({ ...prev, userInfo: null }))
    }

    try {
      // ä½¿ç¨ getSubscribe æ¥å£è·åè¯¦ç»æµéä¿¡æ¯
      const data = await apiRequest('/api/v3/user/getSubscribe')
      
      if (data) {
        const newUserInfo: UserInfo = {
          email: data.email || 'user@example.com',
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
      const errorMessage = error instanceof Error ? error.message : 'è·åç¨æ·ä¿¡æ¯å¤±è´¥'
      setErrors(prev => ({ ...prev, userInfo: errorMessage }))
      
      // APIå¤±è´¥æ¶ï¼ä»
å¨åæ¬¡å è½½æ¶ä½¿ç¨æ¨¡ææ°æ?      console.warn('ç¨æ·ä¿¡æ¯å è½½å¤±è´¥ï¼ä½¿ç¨æ¨¡ææ°æ?', error)
    } finally {
      setLoading(prev => ({ ...prev, userInfo: false }))
    }
  }, [apiRequest]) // ç§»é¤userInfoä¾èµï¼é¿å
æ éå¾ªç?
  // è·åå
¬å
  const fetchAnnouncements = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(prev => ({ ...prev, announcements: true }))
      setErrors(prev => ({ ...prev, announcements: null }))
    }

    try {
      const data = await apiRequest('/api/v3/user/notice/fetch')
      
      // å¤çä¸åçååºæ ¼å¼?      let notices = []
      if (Array.isArray(data)) {
        notices = data
      } else if (data && Array.isArray(data.data)) {
        notices = data.data
      } else if (data && data.data && Array.isArray(data.data.list)) {
        notices = data.data.list
      }
      
      if (notices && notices.length > 0) {
        const filteredAnnouncements = notices
          .filter((notice: any) => notice.show !== 0)
          .map((notice: any) => ({
            id: String(notice.id || Math.random().toString(36).slice(2)),
            title: notice.title || 'å
¬å',
            content: notice.content || '',
            date: notice.created_at ? 
              new Date(notice.created_at * 1000).toLocaleDateString('zh-CN') :
              new Date().toLocaleDateString('zh-CN'),
            show: notice.show
          }))
          .sort((a: any, b: any) => {
            // ææ¥æéåºæåï¼ææ°çå¨åï¼?            const dateA = new Date(a.date).getTime()
            const dateB = new Date(b.date).getTime()
            return dateB - dateA
          })
        setAnnouncements(filteredAnnouncements)
      } else {
        setAnnouncements([])
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'è·åå
¬åå¤±è´¥'
      setErrors(prev => ({ ...prev, announcements: errorMessage }))
      
      // APIå¤±è´¥æ¶ï¼ä»
å¨åæ¬¡å è½½æ¶ä½¿ç¨æ¨¡ææ°æ?      console.warn('å
¬åå è½½å¤±è´¥ï¼ä½¿ç¨æ¨¡ææ°æ?', error)
    } finally {
      setLoading(prev => ({ ...prev, announcements: false }))
    }
  }, [apiRequest])

  // ç»ä¸å·æ°æææ°æ®ï¼ä»
å¨åå§åæ¶ä½¿ç¨ï¼?  const refreshAllData = useCallback(async (showLoading = false) => {
    if (!isLoggedIn) return
    
    await Promise.all([
      fetchUserInfo(showLoading),
      fetchAnnouncements(showLoading)
    ])
  }, [isLoggedIn, fetchUserInfo, fetchAnnouncements])

  // æå¡å¨è¿æ¥æµè¯?  const testServerConnection = useCallback(async () => {
    setServerTestStatus(prev => ({ ...prev, isLoading: true }))
    
    try {
      const startTime = Date.now()
      const response = await fetch(`${loginUrl}/api/v3/guest/comm/config`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000) // 10ç§è¶
æ?      })
      const endTime = Date.now()
      const ping = endTime - startTime
      
      setServerTestStatus({
        isLoading: false,
        lastPing: ping,
        lastTest: new Date()
      })
      
      if (response.ok) {
        setNetworkStatus({
          isOnline: true,
          lastConnected: new Date()
        })
        setErrors(prev => ({ ...prev, userInfo: null }))
      } else {
        throw new Error(`æå¡å¨ååºå¼å¸?(${response.status})`)
      }
    } catch (error) {
      setServerTestStatus(prev => ({
        ...prev,
        isLoading: false,
        lastTest: new Date()
      }))
      
      let errorMsg = 'æå¡å¨è¿æ¥å¤±è´?
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          errorMsg = 'æå¡å¨ååºè¶
æ?
        } else if (error.message.includes('fetch')) {
          errorMsg = 'ç½ç»è¿æ¥éè¯¯'
        } else {
          errorMsg = error.message
        }
      }
      
      setErrors(prev => ({ 
        ...prev, 
        userInfo: `æå¡å¨æµè¯å¤±è´? ${errorMsg}` 
      }))
      
      setNetworkStatus(prev => ({ ...prev, isOnline: false }))
    }
  }, [loginUrl])

  // Backend management functions
  const initializeBackendList = useCallback(async () => {
    try {
      await initializeBackends(patchAppConfig, appConfig)
      const availableBackends = getAllBackends(appConfig)
      setBackends(availableBackends)
      backendsRef.current = availableBackends // æ´æ° ref
      // Restore previously selected backend from storage if exists
      const savedId = localStorage.getItem(SELECTED_BACKEND_KEY)
      const saved = availableBackends.find(b => b.id === savedId)
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

  const testAllBackends = useCallback(async () => {
    const currentBackends = backendsRef.current
    if (currentBackends.length === 0) return
    
    setIsTestingBackends(true)
    try {
      const results = await testAllBackendsLatency(currentBackends)
      setBackendTestResults(results)
      
      // Update backend ping results in configuration
      await updateBackendPingResults(results, patchAppConfig, appConfig)
      
      // Update local backend list
      const updatedBackends = getAllBackends(appConfig)
      setBackends(updatedBackends)
      backendsRef.current = updatedBackends // æ´æ° ref
      
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
      
      // Update backend ping results in configuration
      await updateBackendPingResults(results, patchAppConfig, appConfig)
      
      // Get updated backends with ping results
      const updatedBackends = getAllBackends(appConfig)
      setBackends(updatedBackends)
      backendsRef.current = updatedBackends // æ´æ° ref
      
      // Find optimal backend and set as current selection (do not change default)
      const optimalBackend = findOptimalBackend(updatedBackends)
      if (optimalBackend && optimalBackend.id !== selectedBackend?.id) {
        setSelectedBackend(optimalBackend)
        setUserSelectedBackendId(optimalBackend.id)
        localStorage.setItem(SELECTED_BACKEND_KEY, optimalBackend.id)
        console.log(`Selected optimal backend: ${optimalBackend.name} (${optimalBackend.lastPing}ms)`)
      }
      
      return results
    } catch (error) {
      console.error('Backend testing and selection failed:', error)
      return []
    } finally {
      setIsTestingBackends(false)
    }
  }, [patchAppConfig, appConfig, selectedBackend])

  const handleBackendSelection = useCallback(async (backendId: string) => {
    try {
      // Treat as session selection only; do not change default
      const picked = backendsRef.current.find(b => b.id === backendId) || null
      if (picked) {
        setSelectedBackend(picked)
        setUserSelectedBackendId(backendId)
        localStorage.setItem(SELECTED_BACKEND_KEY, backendId)
      }
    } catch (error) {
      console.error('Failed to select backend:', error)
    }
  }, [patchAppConfig, appConfig])

  const getBackendStatusColor = (backend: IUserCenterBackend): 'success' | 'warning' | 'danger' | 'default' => {
    if (!backend.lastPing) return 'default'
    if (backend.lastPing < 300) return 'success'
    if (backend.lastPing < 1000) return 'warning'
    return 'danger'
  }

  const getBackendStatusText = (backend: IUserCenterBackend): string => {
    if (!backend.lastPing) return 'æªæµè¯?
    if (backend.lastPing < 100) return `æå¿« (${backend.lastPing}ms)`
    if (backend.lastPing < 300) return `å¾å¿« (${backend.lastPing}ms)`
    if (backend.lastPing < 1000) return `è¯å¥½ (${backend.lastPing}ms)`
    return `è¾æ
¢ (${backend.lastPing}ms)`
  }

  // ç»å½å¤ç
  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrors(prev => ({ ...prev, userInfo: 'è¯·å¡«åå®æ´çé®ç®±åå¯ç ? }))
      return
    }
    
    // ç®åçé®ç®±æ ¼å¼éªè¯
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setErrors(prev => ({ ...prev, userInfo: 'è¯·è¾å
¥æ­£ç¡®çé®ç®±æ ¼å¼' }))
      return
    }
    
    // æ£æ¥ç½ç»ç¶æ?    if (!navigator.onLine) {
      setErrors(prev => ({ ...prev, userInfo: 'ç½ç»è¿æ¥å·²æ­å¼ï¼è¯·æ£æ¥ç½ç»åéè¯' }))
      return
    }
    
    setLoading(prev => ({ ...prev, userInfo: true }))
    setErrors(prev => ({ ...prev, userInfo: null }))
    
    try {
      // åèlogin.htmlçAPIè°ç¨æ¹å¼
      const response = await fetch(`${loginUrl}/api/v3/passport/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: email.trim(),
          password: password
        })
      })
      
      // æ£æ¥ååºç¶æ?      if (!response.ok) {
        let errorMessage = 'ç»å½å¤±è´¥'
        
        switch (response.status) {
          case 400:
            errorMessage = 'è¯·æ±åæ°éè¯¯ï¼è¯·æ£æ¥é®ç®±åå¯ç æ ¼å¼'
            break
          case 401:
            errorMessage = 'é®ç®±æå¯ç éè¯¯ï¼è¯·éæ°è¾å
?
            break
          case 403:
            errorMessage = 'è´¦æ·å·²è¢«ç¦ç¨ï¼è¯·èç³»ç®¡çå?
            break
          case 429:
            errorMessage = 'ç»å½å°è¯è¿äºé¢ç¹ï¼è¯·ç¨åéè¯'
            break
          case 500:
          case 502:
          case 503:
          case 504:
            errorMessage = 'æå¡å¨ææ¶æ æ³è®¿é®ï¼è¯·ç¨åéè¯?
            break
          default:
            errorMessage = `æå¡å¨éè¯?(${response.status})`
        }
        
        throw new Error(errorMessage)
      }
      
      const data = await response.json()
      
      if (data.data && data.data.auth_data) {
        // ç»å½æåï¼ä½¿ç¨tokenç®¡çå¨ä¿å­tokenï¼?å¤©æææï¼?        tokenManager.setToken(data.data.auth_data, 7)
        
        // ä¿å­ç¨æ·é®ç®±ä»¥ä¾¿ä¸æ¬¡èªå¨å¡«å
¥
        localStorage.setItem('userEmail', email.trim())
        
        setIsLoggedIn(true)
        setErrors(prev => ({ ...prev, userInfo: null }))
        
        // æ´æ°ç½ç»ç¶æ?        setNetworkStatus({
          isOnline: true,
          lastConnected: new Date()
        })
        
        // å¹¶è¡å è½½ç¨æ·æ°æ®
        try {
          await Promise.all([
            fetchUserInfo(),
            fetchAnnouncements(),
            refreshUserSubscription() // å·æ°ç¨æ·è®¢é
é¾æ¥
          ])

          // ç«å³æåè®¢é
å¹¶åæ¢ä¸ºå½åé
ç½®ï¼é¿å
ä»æ¾ç¤ºåå§å
å®¹
          try {
            const authUtils = createUserAuthUtils(appConfig)
            const subUrl = await authUtils.getUserSubscriptionUrl()
            if (subUrl) {
              await addProfileItem({
                id: 'user-subscription-meta',
                type: 'remote',
                name: 'ç¨æ·è®¢é
 (Clash Meta)',
                url: subUrl,
                interval: 60 * 60, // 60åé
                override: [],
                useProxy: false,
                allowFixedInterval: false,
                substore: false
              })
              await changeCurrentProfile('user-subscription-meta')
            } else {
              console.warn('æªè·åå°è®¢é
é¾æ¥ï¼è·³è¿ç«å³æå?)
            }
          } catch (e) {
            console.warn('ç»å½åç«å³æåå¹¶åæ¢è®¢é
å¤±è´¥ï¼?, e)
          }
        } catch (dataError) {
          // å³ä½¿æ°æ®å è½½å¤±è´¥ï¼ç»å½ä»ç¶æå?          console.warn('Initial data loading failed:', dataError)
        }
        
      } else {
        // APIè¿åæåä½æ°æ®æ ¼å¼ä¸æ­£ç¡®
        throw new Error(data.message || 'ç»å½ååºæ°æ®æ ¼å¼éè¯¯')
      }
    } catch (error) {
      let errorMessage = 'ç»å½å¤±è´¥ï¼è¯·ç¨åéè¯'
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        // ç½ç»è¿æ¥éè¯¯
        errorMessage = 'æ æ³è¿æ¥å°æå¡å¨ï¼è¯·æ£æ¥ç½ç»è¿æ¥åæå¡å¨å°å'
        setNetworkStatus(prev => ({ ...prev, isOnline: false }))
      } else if (!navigator.onLine) {
        // ç½ç»å·²æ­å¼
        errorMessage = 'ç½ç»è¿æ¥å·²æ­å¼'
        setNetworkStatus(prev => ({ ...prev, isOnline: false }))
      } else if (error instanceof Error) {
        // ä½¿ç¨å
·ä½çéè¯¯ä¿¡æ?        errorMessage = error.message
      }
      
      setErrors(prev => ({ ...prev, userInfo: errorMessage }))
      
      // è®°å½éè¯¯ç¨äºè°è¯
      console.error('Login failed:', {
        error,
        email: email.trim(),
        loginUrl,
        timestamp: new Date().toISOString()
      })
    } finally {
      setLoading(prev => ({ ...prev, userInfo: false }))
    }
  }

  // éåºç»å½?  const handleLogout = () => {
    tokenManager.clearToken()
    setIsLoggedIn(false)
    setUserInfo(null)
    setAnnouncements([])
    setEmail('')
    setPassword('')
    
    // éç½®èªå¨æµè¯æ å¿
    hasStartedAutoTest.current = false
    
    // æ¸
çå®æ¶å?    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    
    // æ¸
çéè¯¯ç¶æ?    setErrors({
      userInfo: null,
      announcements: null
    })
    
    // å·æ°ç¨æ·è®¢é
ä¸ºç©ºç½ç¶æï¼å¹¶æ´æ°è®¢é
å
å®¹ä¸ºé»è®¤ç©ºç½é
ç½®
    refreshUserSubscription().then(async () => {
      try {
        // è·åç¨æ·è®¢é
é¡¹ID
        const USER_SUBSCRIPTION_ID = 'user-subscription-meta'

        // å
³é®ä¿®å¤ï¼å°è®¢é
é¡¹å¨é
ç½®ä¸­æ¹ä¸ºâç©ºç½å ä½âURLå¹¶ç¦ç¨èªå¨æ´æ°ï¼é¿å
éå¯åè¢«éæ°æå
        // è¯´æï¼ä¸»è¿ç¨ profileUpdater å?URL ä¸?'https://example.com/empty-subscription' æ?interval ä¸?0 æ¶é½ä¸ä¼è§¦åæ´æ°
        try {
          const currentItem = await window.electron.ipcRenderer.invoke('getProfileItem', USER_SUBSCRIPTION_ID)
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
          console.warn('æ´æ°ç¨æ·è®¢é
å ä½ç¶æå¤±è´¥ï¼å°ç»§ç»­æ¸
çæ¬å°æä»¶ï¼:', e)
        }

        // åæ­¥å°æ¬å°é
ç½®æä»¶éç½®ä¸ºç©ºç½ï¼å³ä½¿éåå é¤æä»¶ï¼ä¹å¯ç«å³çæä¸ºå¹²åé
ç½®ï¼?        await window.electron.ipcRenderer.invoke('setProfileStr', USER_SUBSCRIPTION_ID, `# ç©ºç½è®¢é
é
ç½®
# éåºç»å½åçé»è®¤é
ç½®ï¼å
å«åºæ¬ç»æä½æ å
·ä½ä»£çå
å®¹

proxies:
  # æ ä»£çé
ç½?
proxy-groups:
  # æ ä»£çç»é
ç½®

rules:
  # æ è§åé
ç½?  - MATCH,DIRECT
`)
        
        // å¼ºå¶å é¤AppDataä¸­çç¨æ·è®¢é
æä»¶
        try {
          await window.electron.ipcRenderer.invoke('removeProfileFile', USER_SUBSCRIPTION_ID)
          console.log('AppDataä¸­çç¨æ·è®¢é
æä»¶å·²å é?)
        } catch (fileError) {
          console.warn('å é¤AppDataä¸­çç¨æ·è®¢é
æä»¶å¤±è´¥:', fileError)
        }

        console.log('ç¨æ·è®¢é
å
å®¹å·²æ¸
ç©ºä¸ºé»è®¤é
ç½®')
      } catch (error) {
        console.error('æ¸
ç©ºç¨æ·è®¢é
å
å®¹å¤±è´¥:', error)
      }
    }).catch(console.error)
  }

  // åå§å?  useEffect(() => {
    // Initialize backend list
    initializeBackendList()
    
    // æ£æ¥å¹¶å è½½ä¿å­çtoken
    const token = tokenManager.getToken()
    if (token) {
      setIsLoggedIn(true)
      fetchUserInfo()
      fetchAnnouncements()
    } else {
      // æªç»å½ç¶æï¼èªå¨æµè¯æå¡å¨è¿æ?      testServerConnection()
    }
    
    // èªå¨å¡«å

ä¸æ¬¡ç»å½çé®ç®?    const savedEmail = localStorage.getItem('userEmail')
    if (savedEmail && !email) {
      setEmail(savedEmail)
    }
  }, [fetchUserInfo, fetchAnnouncements, testServerConnection, initializeBackendList])

  // Sync backendsRef with backends state
  useEffect(() => {
    backendsRef.current = backends
  }, [backends])

  // Auto-test backends after initialization and every 10 seconds
  useEffect(() => {
    if (!isLoggedIn && backends.length > 0 && !hasStartedAutoTest.current) {
      hasStartedAutoTest.current = true
      console.log('Starting auto-test for backends...') // è°è¯ä¿¡æ¯
      
      // Clear any existing timers
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      
      // Initial test after 1 second
      const initialTimer = setTimeout(() => {
        console.log('Initial backend test after 1 second...') // è°è¯ä¿¡æ¯
        const currentBackends = backendsRef.current
        // Only test latency automatically; do not auto-switch backends
        if (currentBackends.length >= 1) {
          testAllBackends()
        }
      }, 1000)
      
      // Then test every 10 seconds
      intervalRef.current = setInterval(() => {
        console.log('Auto-testing backends every 10 seconds...') // è°è¯ä¿¡æ¯
        const currentBackends = backendsRef.current
        // Only test latency automatically; do not auto-switch backends
        if (currentBackends.length >= 1) {
          testAllBackends()
        }
      }, 10000) // 10 seconds
      
      return () => {
        clearTimeout(initialTimer)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }
    
    // Reset when user logs in
    if (isLoggedIn) {
      hasStartedAutoTest.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isLoggedIn, backends.length]) // ä¾èµäºç»å½ç¶æååç«¯æ°é

  // Tokenè¿ææ£æ¥åæé
  useEffect(() => {
    if (!isLoggedIn) return

    const checkTokenExpiration = () => {
      if (tokenManager.isTokenExpiringSoon()) {
        const remainingDays = tokenManager.getTokenRemainingDays()
        if (remainingDays > 0) {
          setErrors(prev => ({ 
            ...prev, 
            userInfo: `ç»å½å°å¨${remainingDays}å¤©åè¿æï¼è¯·åæ¶éæ°ç»å½` 
          }))
        }
      }
    }

    // ç«å³æ£æ¥ä¸æ¬?    checkTokenExpiration()
    
    // æ¯å°æ¶æ£æ¥ä¸æ¬?    const tokenCheckInterval = setInterval(checkTokenExpiration, 60 * 60 * 1000)
    
    return () => {
      clearInterval(tokenCheckInterval)
    }
  }, [isLoggedIn])

  // ç½ç»ç¶æçå?  useEffect(() => {
    const handleOnline = () => {
      setNetworkStatus({
        isOnline: true,
        lastConnected: new Date()
      })
      // ç§»é¤èªå¨å·æ°ï¼è®©ç¨æ·æå¨ç¹å»å·æ°
    }

    const handleOffline = () => {
      setNetworkStatus(prev => ({ ...prev, isOnline: false }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, []) // ç§»é¤ä¾èµï¼ä¸åéè¦refreshAllData

  // å·¥å
·å½æ°
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

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const showAnnouncementModal = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
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
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground">{t('userCenter.login')}</h2>
                <p className="text-default-500 mt-2">ç»å½ä»¥è®¿é®æ¨çç¨æ·ä¸­å¿?/p>
              </div>
            </CardHeader>
            <CardBody className="space-y-5 px-8 pb-8">
              {/* ç½ç»ç¶ææç¤?*/}
              {!networkStatus.isOnline && (
                <div className="flex items-center gap-2 text-warning text-sm p-3 bg-warning/10 rounded-lg border border-warning/20">
                  <div className="w-2 h-2 rounded-full bg-warning animate-pulse"></div>
                  <span>ç½ç»è¿æ¥å·²æ­å¼ï¼è¯·æ£æ¥ç½ç»è¿æ?/span>
                </div>
              )}
              
              {/* ç»å½éè¯¯æç¤º */}
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
                        onPress={() => setErrors(prev => ({ ...prev, userInfo: null }))}
                        className="mt-2 text-danger hover:bg-danger/10"
                      >
                        å
³é­æç¤º
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="space-y-4">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="è¯·è¾å
¥é®ç®?
                  size="lg"
                  variant="bordered"
                  radius="lg"
                  isDisabled={loading.userInfo || !networkStatus.isOnline}
                  startContent={<IoPersonOutline className="text-default-400" />}
                  classNames={{
                    input: "text-base",
                    inputWrapper: "h-12 shadow-sm"
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && password) {
                      handleLogin()
                    }
                  }}
                />
                
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="è¯·è¾å
¥å¯ç ?
                  size="lg"
                  variant="bordered"
                  radius="lg"
                  isDisabled={loading.userInfo || !networkStatus.isOnline}
                  startContent={<IoLockClosedOutline className="text-default-400" />}
                  endContent={
                    <button
                      type="button"
                      className="text-default-400 hover:text-foreground transition"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'éèå¯ç ' : 'æ¾ç¤ºå¯ç '}
                    >
                      {showPassword ? <IoEyeOffOutline /> : <IoEyeOutline />}
                    </button>
                  }
                  classNames={{
                    input: "text-base",
                    inputWrapper: "h-12 shadow-sm"
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && email && password) {
                      handleLogin()
                    }
                  }}
                />
              </div>
              
              <Button
                color="primary"
                size="lg"
                variant="solid"
                radius="lg"
                className="w-full h-12 text-base font-extrabold shadow-lg"
                onPress={handleLogin}
                isLoading={loading.userInfo}
                disabled={!email || !password || !networkStatus.isOnline}
              >
                {loading.userInfo ? 'ç»å½ä¸?..' : t('userCenter.loginButton')}
              </Button>
              
              {/* æå¡å¨éæ©åæµè¯ï¼æªç»å½ä¹å¯éæ©ï¼ä¼è¯çæï¼ */}
              {backends.length >= 1 && (
                <div className="text-center border-t border-default-200 pt-4">
                  <div className="space-y-4 p-4 bg-default-50 rounded-xl border border-default-200 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IoServerOutline className="text-primary text-lg" />
                        <label className="text-sm font-semibold text-foreground">éæ©åç«¯æå¡å?/label>
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
                        {isTestingBackends ? 'æµè¯ä¸?..' : (backends.length > 1 ? 'æµè¯å¹¶éæ©æä¼? : 'æµè¯å»¶è¿')}
                      </Button>
                    </div>
                    
                    {isTestingBackends && (
                      <div className="flex items-center justify-center gap-2 text-primary text-xs">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                        <span>æ­£å¨æµè¯ææåç«¯æå¡å¨å»¶è¿...</span>
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
                                    é»è®¤
                                  </Chip>
                                )}
                                {selectedBackend?.id === backend.id && (
                                  <Chip size="sm" color="secondary" variant="bordered" className="text-xs">
                                    å½åéæ©
                                  </Chip>
                                )}
                                {selectedBackend?.id === backend.id && (
                                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-3">
                                {backend.isActive !== undefined && (
                                  <div className={`flex items-center gap-1 text-xs ${
                                    backend.isActive ? 'text-success' : 'text-danger'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${
                                      backend.isActive ? 'bg-success' : 'bg-danger'
                                    }`}></div>
                                    {backend.isActive ? 'å¨çº¿' : 'ç¦»çº¿'}
                                  </div>
                                )}
                                {backend.lastPing && (
                                  <div className={`flex items-center gap-1 text-xs ${
                                    backend.lastPing < 300 ? 'text-success' : 
                                    backend.lastPing < 1000 ? 'text-warning' : 'text-danger'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${
                                      backend.lastPing < 300 ? 'bg-success' : 
                                      backend.lastPing < 1000 ? 'bg-warning' : 'bg-danger'
                                    }`}></div>
                                    {backend.lastPing < 100 ? 'æå¿«' : 
                                     backend.lastPing < 300 ? 'å¾å¿«' : 
                                     backend.lastPing < 1000 ? 'è¯å¥½' : 'è¾æ
¢'} 
                                    ({backend.lastPing}ms)
                                  </div>
                                )}
                                {!backend.lastPing && !isTestingBackends && (
                                  <div className="text-xs text-default-400">
                                    æªæµè¯?                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="text-xs text-default-500 text-center">
                      {backends.length > 1 ? 
                        'æ¯?0ç§èªå¨æµè¯å»¶è¿ï¼ä¸ä¼èªå¨åæ¢' : 
                        'æ¯?0ç§èªå¨æµè¯æå¡å¨è¿æ¥ç¶æ?
                      }
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
        {/* ç½ç»ç¶ææç¤?*/}
        {!networkStatus.isOnline && (
          <Card className="border-warning">
            <CardBody className="py-3">
              <div className="flex items-center gap-2 text-warning">
                <div className="w-2 h-2 rounded-full bg-warning animate-pulse"></div>
                <span className="text-sm">ç½ç»è¿æ¥å·²æ­å¼ï¼æ°æ®å¯è½ä¸æ¯ææ°ç</span>
              </div>
            </CardBody>
          </Card>
        )}
        {/* é¡¶é¨æä½åºï¼å·æ° / éåºç»å½?*/}
        <div className="flex justify-end gap-2">
          <Button variant="light" size="sm" onPress={handleLogout} color="danger">
            {t('userCenter.logout')}
          </Button>
        </div>

        {/* å
¬åæ¨¡å ââ?åè¡¨å±ç¤º */}
        <Card>
          <CardHeader className="flex justify-between">
            <h3 className="text-lg font-semibold">{t('userCenter.announcements')}</h3>
            <div className="flex items-center gap-2">
              {loading.announcements && <Spinner size="sm" />}
            </div>
          </CardHeader>
          <CardBody>
            {errors.announcements ? (
              <div className="text-center py-8">
                <div className="text-danger mb-2">
                  <p>å è½½å¤±è´¥: {errors.announcements}</p>
                </div>
                <div className="flex justify-center gap-2">
                  <Button 
                    variant="light" 
                    size="sm" 
                    onPress={() => fetchAnnouncements(true)}
                    isLoading={loading.announcements}
                  >
                    éè¯
                  </Button>
                  <Button 
                    variant="light" 
                    size="sm" 
                    onPress={() => setErrors(prev => ({ ...prev, announcements: null }))}
                  >
                    å
³é­éè¯¯
                  </Button>
                </div>
              </div>
            ) : loading.announcements && announcements.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="flex flex-col items-center gap-2">
                  <Spinner />
                  <p className="text-sm text-default-500">å è½½å
¬åä¸?..</p>
                </div>
              </div>
            ) : announcements.length > 0 ? (
              <div className="divide-y divide-default-200">
                {announcements.map((announcement) => (
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-default-400">ð¢</span>
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
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-default-500 py-8">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-default-100 flex items-center justify-center">
                    <span className="text-default-400">ð¢</span>
                  </div>
                  <p>ææ å
¬å</p>
                  <Button 
                    variant="light" 
                    size="sm" 
                    onPress={() => fetchAnnouncements(true)}
                  >
                    å·æ°è¯è¯
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* æµéä¿¡æ¯æ¨¡å */}
        <Card>
          <CardHeader className="flex justify-between">
            <h3 className="text-lg font-semibold">{t('userCenter.traffic')}</h3>
            {loading.userInfo && <Spinner size="sm" />}
          </CardHeader>
          <CardBody>
            {errors.userInfo ? (
              <div className="text-center py-8 text-danger">
                <p>å è½½å¤±è´¥: {errors.userInfo}</p>
                <Button 
                  variant="light" 
                  size="sm" 
                  onPress={() => fetchUserInfo(true)}
                  className="mt-2"
                >
                  éè¯
                </Button>
              </div>
            ) : userInfo ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatBytes(userInfo.traffic.upload)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">
                      {t('userCenter.upload')}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatBytes(userInfo.traffic.download)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">
                      {t('userCenter.download')}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatBytes(userInfo.traffic.upload + userInfo.traffic.download)}
                    </div>
                    <div className="text-sm text-default-500 mt-1">
                      {t('userCenter.totalUsed')}
                    </div>
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
                    <span>ä½¿ç¨è¿åº¦</span>
                    <span>{getUsagePercentage().toFixed(1)}%</span>
                  </div>
                  <Progress 
                    value={getUsagePercentage()} 
                    color={getUsagePercentage() > 80 ? 'danger' : getUsagePercentage() > 60 ? 'warning' : 'primary'}
                    className="h-3"
                  />
                </div>

                <div className="pt-4 border-t border-default-200">
                  <div className="flex justify-between">
                    <span className="font-medium">{t('userCenter.expire')}:</span>
                    <span className={isExpiringSoon() ? 'text-warning font-medium' : 'text-foreground'}>
                      {userInfo.traffic.expire ? formatDate(userInfo.traffic.expire) : t('sider.cards.neverExpire')}
                      {isExpiringSoon() && <span className="ml-2 text-xs">(å³å°è¿æ)</span>}
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

        {/* æå¡å¨éæ©åæµè¯ï¼ç»å½åï¼ */}
        {backends.length >= 1 && (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IoServerOutline className="text-primary text-lg" />
                <h3 className="text-lg font-semibold">éæ©åç«¯æå¡å?/h3>
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
                {isTestingBackends ? 'æµè¯ä¸?..' : (backends.length > 1 ? 'æµè¯å¹¶éæ©æä¼? : 'æµè¯å»¶è¿')}
              </Button>
            </CardHeader>
            <Divider />
            <CardBody>
              {isTestingBackends && (
                <div className="flex items-center justify-center gap-2 text-primary text-xs mb-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                  <span>æ­£å¨æµè¯ææåç«¯æå¡å¨å»¶è¿...</span>
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
                              é»è®¤
                            </Chip>
                          )}
                          {selectedBackend?.id === backend.id && (
                            <Chip size="sm" color="secondary" variant="bordered" className="text-xs">
                              å½åéæ©
                            </Chip>
                          )}
                          {selectedBackend?.id === backend.id && (
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {backend.isActive !== undefined && (
                            <div className={`flex items-center gap-1 text-xs ${
                              backend.isActive ? 'text-success' : 'text-danger'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                backend.isActive ? 'bg-success' : 'bg-danger'
                              }`}></div>
                              {backend.isActive ? 'å¨çº¿' : 'ç¦»çº¿'}
                            </div>
                          )}
                          {backend.lastPing && (
                            <div className={`flex items-center gap-1 text-xs ${
                              backend.lastPing < 300 ? 'text-success' : 
                              backend.lastPing < 1000 ? 'text-warning' : 'text-danger'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                backend.lastPing < 300 ? 'bg-success' : 
                                backend.lastPing < 1000 ? 'bg-warning' : 'bg-danger'
                              }`}></div>
                              {backend.lastPing < 100 ? 'æå¿«' : 
                               backend.lastPing < 300 ? 'å¾å¿«' : 
                               backend.lastPing < 1000 ? 'è¯å¥½' : 'è¾æ
¢'} 
                              ({backend.lastPing}ms)
                            </div>
                          )}
                          {!backend.lastPing && !isTestingBackends && (
                            <div className="text-xs text-default-400">
                              æªæµè¯?                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-default-500 text-center mt-2">
                ç»å½ç¶æä¸ä¸ä¼èªå¨åæ¢åç«¯ï¼å¯æå¨æµè¯æéæ©æä¼?              </div>
            </CardBody>
          </Card>
        )}

        {/* å
¬åè¯¦æ
æ¨¡ææ¡ */}
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
              <Button
                isIconOnly
                variant="light"
                size="sm"
                onPress={() => setIsModalOpen(false)}
              >
                <IoCloseOutline />
              </Button>
            </ModalHeader>
            <Divider />
            <ModalBody className="py-6">
              <div className="prose max-w-none">
                <div 
                  className="whitespace-pre-wrap leading-relaxed text-foreground"
                  dangerouslySetInnerHTML={{ 
                    __html: selectedAnnouncement?.content?.replace(/\n/g, '<br>') || ''
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
