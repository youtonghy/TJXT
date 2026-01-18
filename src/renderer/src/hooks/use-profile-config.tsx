import React, {
  createContext,
  useContext,
  ReactNode,
  useMemo,
  useEffect,
  useState,
  useRef
} from 'react'
import useSWR from 'swr'
import {
  getProfileConfig,
  setProfileConfig as set,
  addProfileItem as add,
  removeProfileItem as remove,
  updateProfileItem as update,
  changeCurrentProfile as change
} from '@renderer/utils/ipc'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { useAppConfig } from './use-app-config'

interface ProfileConfigContextType {
  profileConfig: IProfileConfig | undefined
  setProfileConfig: (config: IProfileConfig) => Promise<void>
  mutateProfileConfig: () => void
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  updateProfileItem: (item: IProfileItem) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
  refreshUserSubscription: () => Promise<void>
}

const ProfileConfigContext = createContext<ProfileConfigContextType | undefined>(undefined)
const USER_SUBSCRIPTION_ID = 'user-subscription-meta'
const EMPTY_SUBSCRIPTION_URL = 'https://example.com/empty-subscription'
const LOADING_SUBSCRIPTION_URL = 'https://example.com/loading-subscription'

export const ProfileConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: rawProfileConfig, mutate: mutateProfileConfig } = useSWR('getProfileConfig', () =>
    getProfileConfig()
  )
  const { appConfig } = useAppConfig()
  const [userSubscriptionUrl, setUserSubscriptionUrl] = useState<string | null>(null)
  const userSubPrevUrlRef = useRef<string | null>(null)
  const userSubUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch user subscription URL when login state changes
  useEffect(() => {
    const fetchUserSubscriptionUrl = async () => {
      const userAuthUtils = createUserAuthUtils(appConfig)
      const isLoggedIn = userAuthUtils.isLoggedIn()

      if (isLoggedIn) {
        try {
          const url = await userAuthUtils.getUserSubscriptionUrl()
          setUserSubscriptionUrl(url)
        } catch (error) {
          console.error('Failed to fetch user subscription URL:', error)
          setUserSubscriptionUrl(null)
        }
      } else {
        setUserSubscriptionUrl(null)
      }
    }

    fetchUserSubscriptionUrl()
  }, [appConfig])

  // Enhanced profile config that includes user subscription when logged in
  const profileConfig = useMemo(() => {
    if (!rawProfileConfig) return rawProfileConfig

    const userAuthUtils = createUserAuthUtils(appConfig)
    const isLoggedIn = userAuthUtils.isLoggedIn()

    const existingUserSubscription = rawProfileConfig.items.find(
      (item) => item.id === USER_SUBSCRIPTION_ID
    )
    const existingUrl = existingUserSubscription?.url
    const isExistingPlaceholder =
      existingUrl === EMPTY_SUBSCRIPTION_URL || existingUrl === LOADING_SUBSCRIPTION_URL
    const resolvedUrl = isLoggedIn
      ? userSubscriptionUrl ||
        (existingUrl && !isExistingPlaceholder ? existingUrl : LOADING_SUBSCRIPTION_URL)
      : EMPTY_SUBSCRIPTION_URL
    const existingInterval = Number(existingUserSubscription?.interval ?? 0)
    const resolvedInterval = isLoggedIn ? (existingInterval > 0 ? existingInterval : 60) : 0

    // Always create user subscription item, but with different URLs based on login state
    const userSubscriptionItem: IProfileItem = {
      id: USER_SUBSCRIPTION_ID,
      type: 'remote',
      name: existingUserSubscription?.name || '用户订阅 (Clash Meta)',
      url: resolvedUrl,
      interval: resolvedInterval,
      updated: Date.now(),
      override: existingUserSubscription?.override || [],
      useProxy: existingUserSubscription?.useProxy || false,
      allowFixedInterval: existingUserSubscription?.allowFixedInterval || false,
      substore: existingUserSubscription?.substore || false,
      home: existingUserSubscription?.home,
      extra: isLoggedIn ? existingUserSubscription?.extra : undefined
    }

    // Check if user subscription already exists
    const hasUserSubscription = rawProfileConfig.items.some(
      (item) => item.id === USER_SUBSCRIPTION_ID
    )

    let items = [...rawProfileConfig.items]

    if (!hasUserSubscription) {
      // Add user subscription at the beginning of the list
      items.unshift(userSubscriptionItem)
    } else {
      // Update existing user subscription with current URL and settings
      const index = items.findIndex((item) => item.id === USER_SUBSCRIPTION_ID)
      if (index !== -1) {
        items[index] = { ...items[index], ...userSubscriptionItem, updated: Date.now() }
      }
    }

    // Auto-select user subscription if no profile is currently selected and user is logged in
    let current = rawProfileConfig.current
    if (!current && isLoggedIn && userSubscriptionUrl && items.length > 0) {
      current = USER_SUBSCRIPTION_ID
    }

    return {
      ...rawProfileConfig,
      current,
      items
    }
  }, [rawProfileConfig, appConfig, userSubscriptionUrl])

  const setProfileConfig = async (config: IProfileConfig): Promise<void> => {
    try {
      await set(config)
    } catch (e) {
      alert(e)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const addProfileItem = async (item: Partial<IProfileItem>): Promise<void> => {
    // If attempting to add/refresh the user subscription while it's in loading state,
    // trigger a subscription URL refresh instead.
    if (item.id === USER_SUBSCRIPTION_ID) {
      if (item.url === LOADING_SUBSCRIPTION_URL) {
        await refreshUserSubscription()
        return
      }
      if (!item.url || item.url === EMPTY_SUBSCRIPTION_URL) {
        return
      }
    }

    try {
      await add(item)
    } catch (e) {
      alert(e)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const removeProfileItem = async (id: string): Promise<void> => {
    // Prevent deletion of user subscription
    if (id === USER_SUBSCRIPTION_ID) {
      alert('用户订阅不能被删除')
      return
    }

    try {
      await remove(id)
    } catch (e) {
      alert(e)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const updateProfileItem = async (item: IProfileItem): Promise<void> => {
    try {
      await update(item)
    } catch (e) {
      alert(e)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const changeCurrentProfile = async (id: string): Promise<void> => {
    try {
      await change(id)
    } catch (e) {
      alert(e)
    } finally {
      mutateProfileConfig()
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  }

  const refreshUserSubscription = async (): Promise<void> => {
    const userAuthUtils = createUserAuthUtils(appConfig)
    const isLoggedIn = userAuthUtils.isLoggedIn()

    if (isLoggedIn) {
      try {
        const url = await userAuthUtils.getUserSubscriptionUrl()
        setUserSubscriptionUrl(url)
      } catch (error) {
        console.error('Failed to refresh user subscription URL:', error)
        setUserSubscriptionUrl(null)
      }
    } else {
      setUserSubscriptionUrl(null)
    }
  }

  // Auto-update "用户订阅" 2s after a valid URL is added/changed
  useEffect(() => {
    const userAuthUtils = createUserAuthUtils(appConfig)
    const isLoggedIn = userAuthUtils.isLoggedIn()

    // Clear previous scheduled update if URL changes
    if (userSubUpdateTimerRef.current) {
      clearTimeout(userSubUpdateTimerRef.current)
      userSubUpdateTimerRef.current = null
    }

    const url = userSubscriptionUrl
    const prev = userSubPrevUrlRef.current
    userSubPrevUrlRef.current = url

    // Schedule only when logged in and URL becomes a new non-empty value
    if (isLoggedIn && url && url !== prev) {
      userSubUpdateTimerRef.current = setTimeout(async () => {
        try {
          // Ensure the profile exists in main config and fetch latest content
          await add({
            id: USER_SUBSCRIPTION_ID,
            type: 'remote',
            name: '用户订阅 (Clash Meta)',
            url,
            interval: 60,
            override: [],
            useProxy: false,
            allowFixedInterval: false,
            substore: false
          })

          // After fetching, set as current if not already
          try {
            if (rawProfileConfig?.current !== USER_SUBSCRIPTION_ID) {
              await change(USER_SUBSCRIPTION_ID)
            }
          } catch (e) {
            console.warn('Auto-select user subscription as current failed:', e)
          }
        } catch (e) {
          console.error('Auto-update user subscription failed:', e)
        } finally {
          userSubUpdateTimerRef.current = null
          // Reflect changes in UI
          mutateProfileConfig()
          window.electron.ipcRenderer.send('updateTrayMenu')
        }
      }, 2000)
    }

    return () => {
      if (userSubUpdateTimerRef.current) {
        clearTimeout(userSubUpdateTimerRef.current)
        userSubUpdateTimerRef.current = null
      }
    }
  }, [userSubscriptionUrl, appConfig, mutateProfileConfig, rawProfileConfig])

  React.useEffect(() => {
    window.electron.ipcRenderer.on('profileConfigUpdated', () => {
      mutateProfileConfig()
    })
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('profileConfigUpdated')
    }
  }, [])

  return (
    <ProfileConfigContext.Provider
      value={{
        profileConfig,
        setProfileConfig,
        mutateProfileConfig,
        addProfileItem,
        removeProfileItem,
        updateProfileItem,
        changeCurrentProfile,
        refreshUserSubscription
      }}
    >
      {children}
    </ProfileConfigContext.Provider>
  )
}

export const useProfileConfig = (): ProfileConfigContextType => {
  const context = useContext(ProfileConfigContext)
  if (context === undefined) {
    throw new Error('useProfileConfig must be used within a ProfileConfigProvider')
  }
  return context
}
