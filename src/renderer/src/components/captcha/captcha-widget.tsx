import React, { useEffect, useRef, useState } from 'react'
import { Spinner } from '@heroui/react'

interface CaptchaWidgetProps {
  type: 'recaptcha' | 'turnstile'
  siteKey: string
  onVerify: (token: string) => void
  onError?: (error: string) => void
  onExpire?: () => void
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: (error?: unknown) => void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact'
          retry?: 'auto' | 'never'
          refreshExpired?: 'auto' | 'manual' | 'never'
        }
      ) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

const SCRIPT_ID = 'cf-turnstile-script'
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loadPromise: Promise<void> | null = null

const loadTurnstile = (): Promise<void> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window not available'))
  }
  if (window.turnstile) {
    return Promise.resolve()
  }
  if (loadPromise) {
    return loadPromise
  }

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      if (window.turnstile) {
        resolve()
      } else {
        reject(new Error('Turnstile API not available after load'))
      }
    }

    const existing = document.getElementById(SCRIPT_ID)
    if (existing) {
      if (window.turnstile) {
        resolve()
        return
      }
      existing.addEventListener('load', finish, { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = TURNSTILE_SRC
    script.async = true
    script.onload = finish
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })

  return loadPromise
}

const CaptchaWidget: React.FC<CaptchaWidgetProps> = ({ type, siteKey, onVerify, onError, onExpire }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onVerifyRef = useRef(onVerify)
  const onErrorRef = useRef(onError)
  const onExpireRef = useRef(onExpire)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState(false)

  useEffect(() => {
    onVerifyRef.current = onVerify
    onErrorRef.current = onError
    onExpireRef.current = onExpire
  }, [onVerify, onError, onExpire])

  useEffect(() => {
    let active = true

    // reset local states before (re)render
    setIsLoading(true)
    setError(null)
    setIsVerified(false)

    if (!siteKey) {
      setError('Missing captcha siteKey configuration')
      setIsLoading(false)
      return
    }

    if (type !== 'turnstile') {
      setError('Only Turnstile captcha is supported')
      setIsLoading(false)
      return
    }

    const renderWidget = () => {
      if (!active || !containerRef.current) return
      if (!window.turnstile) {
        setError('Turnstile API unavailable')
        setIsLoading(false)
        return
      }

      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }

      containerRef.current.innerHTML = ''

      try {
        const widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          retry: 'never',
          refreshExpired: 'never',
          callback: (token: string) => {
            if (!active) return
            setIsVerified(true)
            onVerifyRef.current(token)
          },
          'expired-callback': () => {
            if (!active) return
            setIsVerified(false)
            onExpireRef.current?.()
          },
          'error-callback': (err) => {
            if (!active) return
            setIsVerified(false)
            onErrorRef.current?.('Turnstile validation failed')
            console.error('Turnstile error', err)
          },
          theme: 'auto',
          size: 'normal'
        })

        widgetIdRef.current = widgetId
        setIsLoading(false)
      } catch (e) {
        if (!active) return
        setError('Turnstile render failed')
        setIsLoading(false)
        console.error('Turnstile render failed', e)
      }
    }

    loadTurnstile()
      .then(() => {
        if (active) renderWidget()
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Turnstile script load failed')
        setIsLoading(false)
      })

    return () => {
      active = false
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = null
    }
  }, [type, siteKey])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-danger-50 rounded-lg border border-danger-200">
        <p className="text-danger text-sm">{error}</p>
        <button
          className="mt-2 text-xs text-primary hover:underline"
          onClick={() => {
            if (widgetIdRef.current && window.turnstile) {
              try {
                window.turnstile.remove(widgetIdRef.current)
              } catch {
                // ignore
              }
            }
            widgetIdRef.current = null
            setError(null)
            setIsLoading(true)
            setIsVerified(false)
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center w-full">
      {isLoading && (
        <div className="flex items-center justify-center p-4">
          <Spinner size="sm" />
          <span className="ml-2 text-sm text-default-500">Loading captcha...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="captcha-container"
        style={{
          minHeight: 70,
          visibility: isLoading ? 'hidden' : 'visible'
        }}
      />
      {isVerified && (
        <p className="text-xs text-success mt-2">Verified successfully</p>
      )}
    </div>
  )
}

export default React.memo(CaptchaWidget, (prev, next) => {
  return prev.type === next.type && prev.siteKey === next.siteKey
})
