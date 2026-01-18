/**
 * 页面：商店
 * Page: Store
 */

// ======================== 导入区 ========================
// React 核心
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// UI 组件
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner
} from '@heroui/react'

// 自定义组件
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { getActiveBackend, callV3Gateway } from '@renderer/utils/user-center-backend'
import { API_USER_AGENT } from '@renderer/utils/api-service'
import dayjs from '@renderer/utils/dayjs'
import { IoCheckmark, IoChevronBack, IoChevronForward } from 'react-icons/io5'
import { useNavigate } from 'react-router-dom'

type Plan = {
  id: number
  name: string
  transfer_enable?: number | null
  device_limit?: number | null
  speed_limit?: number | null
  content?: string | null
  month_price?: number | null
  quarter_price?: number | null
  half_year_price?: number | null
  year_price?: number | null
  two_year_price?: number | null
  three_year_price?: number | null
  onetime_price?: number | null
  reset_price?: number | null
  created_at?: number
  updated_at?: number
}

type OrderDetail = {
  id: number
  trade_no: string
  period: string
  total_amount: number
  created_at: number
  plan: Plan
}

type PaymentMethod = {
  id: number
  name: string
  payment: string
  icon?: string | null
}

const periodLabelMap: Record<string, string> = {
  month_price: 'store.period.month',
  quarter_price: 'store.period.quarter',
  half_year_price: 'store.period.halfYear',
  year_price: 'store.period.year',
  two_year_price: 'store.period.twoYears',
  three_year_price: 'store.period.threeYears',
  onetime_price: 'store.period.onetime'
}

const periodUnitKeyMap: Record<string, string> = {
  month_price: 'store.unit.month',
  quarter_price: 'store.unit.quarter',
  half_year_price: 'store.unit.halfYear',
  year_price: 'store.unit.year',
  two_year_price: 'store.unit.twoYears',
  three_year_price: 'store.unit.threeYears',
  onetime_price: 'store.unit.onetime'
}

const priceKeys: (keyof Plan)[] = [
  'month_price',
  'quarter_price',
  'half_year_price',
  'year_price',
  'two_year_price',
  'three_year_price',
  'onetime_price'
]

const formatPrice = (val?: number | null, t?: (k: string) => string): string => {
  if (val === null || val === undefined) return '-'
  if (val === 0) return t ? t('store.free') : 'Free'
  // Most panels return cents; show 2 decimals when divisible not evenly by 100
  const money = val / 100
  return money % 1 === 0 ? `¥${money.toFixed(0)}` : `¥${money.toFixed(2)}`
}

const htmlToFeatures = (html?: string | null): string[] => {
  if (!html) return []
  try {
    // Normalize <br> variations and split
    const normalized = html.replace(/<\\?br\s*\/?>(\n)?/gi, '\n')
    return normalized
      .split(/\n+/)
      .map((s) => s.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const Store: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { appConfig } = useAppConfig()
  const auth = useMemo(() => createUserAuthUtils(appConfig), [appConfig])
  const getBaseUrl = useCallback(() => {
    const backend = getActiveBackend(appConfig)
    return backend?.url?.replace(/\/+$/, '') || ''
  }, [appConfig])

  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)

  // Purchase modal state
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'select' | 'payment' | 'success'>('select')
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')
  const [coupon, setCoupon] = useState('')
  const [couponMsg, setCouponMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tradeNo, setTradeNo] = useState<string | null>(null)

  // Payment state
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [methodId, setMethodId] = useState<number | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [canceling, setCanceling] = useState(false)
  // Toast stack for errors/info
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([])
  const toastTimersRef = useRef<Map<number, number>>(new Map())

  // Redeem code state
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null)
  const [redeemOk, setRedeemOk] = useState<boolean | null>(null)

  // Horizontal scroller controls
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [hovering, setHovering] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const updateControls = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, clientWidth, scrollWidth } = el
    setCanScrollLeft(scrollLeft > 0)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  // Drag-to-scroll state
  const dragRef = useRef<{ startX: number; startLeft: number; dragging: boolean }>({
    startX: 0,
    startLeft: 0,
    dragging: false
  })
  const [dragging, setDragging] = useState(false)
  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = scrollerRef.current
    if (!el) return
    dragRef.current = { startX: e.clientX, startLeft: el.scrollLeft, dragging: true }
    setDragging(true)
  }, [])
  const onDragMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return
    e.preventDefault()
    const el = scrollerRef.current
    if (!el) return
    const dx = e.clientX - dragRef.current.startX
    el.scrollLeft = dragRef.current.startLeft - dx
  }, [])
  const onDragEnd = useCallback(() => {
    if (!dragRef.current.dragging) return
    dragRef.current.dragging = false
    setDragging(false)
  }, [])

  // Helpers
  const showErrorBanner = useCallback((raw: string) => {
    let msg = (raw || '').trim()
    try {
      const obj = JSON.parse(raw)
      const keys = ['message', 'msg', 'error', 'detail', 'info']
      for (const k of keys) {
        const v = (obj as any)[k]
        if (typeof v === 'string' && v.trim()) {
          msg = v.trim()
          break
        }
      }
      if (!msg && Array.isArray((obj as any).errors) && (obj as any).errors.length) {
        const first = (obj as any).errors[0]
        if (typeof first === 'string') msg = first
        else if (first && typeof first.message === 'string') msg = first.message
      }
    } catch {}
    if (!msg) msg = 'Server Error'
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((prev) => [...prev, { id, message: msg }])
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      const m = toastTimersRef.current
      const tid = m.get(id)
      if (tid) {
        window.clearTimeout(tid)
        m.delete(id)
      }
    }, 3000)
    toastTimersRef.current.set(id, timer)
  }, [])

  const cancelCurrentOrder = useCallback(async (): Promise<void> => {
    if (!tradeNo) return
    try {
      const res = await callV3Gateway(
        getBaseUrl(),
        'user/order/cancel',
        'POST',
        { trade_no: tradeNo },
        {
          Authorization: auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        }
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status >= 500) showErrorBanner(text)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setOrder(null)
      setTradeNo(null)
      setPhase('select')
    }
  }, [auth, getBaseUrl, tradeNo, showErrorBanner])

  const redeemGiftcard = async (): Promise<void> => {
    const code = redeemCode.trim()
    if (!code) return
    setRedeeming(true)
    setRedeemMsg(null)
    setRedeemOk(null)
    try {
      const res = await callV3Gateway(
        getBaseUrl(),
        'user/redeemgiftcard',
        'POST',
        { giftcard: code },
        {
          Authorization: auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        }
      )
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        if (res.status >= 500) {
          showErrorBanner(text)
        }
        try {
          const obj = JSON.parse(text)
          const msg = (obj?.message || obj?.msg || obj?.error || obj?.detail || '') as string
          setRedeemMsg((msg && msg.trim()) || text || '兑换失败')
        } catch {
          setRedeemMsg(text || '兑换失败')
        }
        setRedeemOk(false)
        return
      }
      // Success
      try {
        const obj = JSON.parse(text)
        const msg = (obj?.message || obj?.msg || obj?.data || '') as string
        setRedeemMsg((msg && String(msg).trim()) || '兑换成功')
      } catch {
        setRedeemMsg(text || '兑换成功')
      }
      setRedeemOk(true)
      setRedeemCode('')
    } catch (e) {
      console.error(e)
      setRedeemMsg('网络错误，请稍后重试')
      setRedeemOk(false)
    } finally {
      setRedeeming(false)
    }
  }

  useEffect(() => {
    if (!auth.isLoggedIn()) {
      try {
        new Notification(t('store.loginRequired') || '请先登录')
      } catch {}
      navigate('/user-center', { replace: true })
      return
    }
    const fetchPlans = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const res = await callV3Gateway(getBaseUrl(), 'user/plan/fetch', 'GET', undefined, {
          Authorization: auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        })
        if (res.status === 401) {
          navigate('/user-center', { replace: true })
          return
        }
        const data = await res.json()
        setPlans((data.data || []) as Plan[])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    fetchPlans()
  }, [auth, getBaseUrl, navigate, t])

  useEffect(() => {
    // Update arrow controls after plans render
    const timer = setTimeout(updateControls, 0)
    return () => clearTimeout(timer)
  }, [plans, updateControls])

  const openBuy = async (plan: Plan): Promise<void> => {
    setCurrentPlan(plan)
    setSelectedPeriod('')
    setCoupon('')
    setCouponMsg(null)
    setPhase('select')
    setTradeNo(null)
    setOrder(null)
    setMethods([])
    setMethodId(null)
    setOpen(true)
  }

  const validateCoupon = async (): Promise<void> => {
    if (!coupon.trim()) return setCouponMsg(null)
    try {
      const res = await callV3Gateway(
        getBaseUrl(),
        'user/coupon/check',
        'POST',
        { code: coupon.trim() },
        {
          Authorization: auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        }
      )
      if (!res.ok) {
        if (res.status >= 500) {
          const text = await res.text().catch(() => '')
          showErrorBanner(text)
          return
        }
        const d = await res.json().catch(() => ({}))
        setCouponMsg(d?.message || t('store.couponInvalid'))
        return
      }
      const data = await res.json().catch(() => ({}))
      // If API returns success info, show generic OK
      setCouponMsg(data?.message || t('store.couponOk'))
    } catch {
      setCouponMsg(t('store.couponInvalid'))
    }
  }

  const submitOrder = async (): Promise<void> => {
    if (!currentPlan) return
    // Decide default period if not chosen and exactly one price is available
    if (!selectedPeriod) {
      const options = priceKeys.filter((k) => (currentPlan[k] as number | null) != null)
      if (options.length === 1) {
        setSelectedPeriod(options[0] as string)
      } else {
        return
      }
    }
    setSubmitting(true)
    try {
      const params: Record<string, unknown> = {
        period: selectedPeriod,
        plan_id: currentPlan.id
      }
      if (coupon.trim()) params.coupon = coupon.trim()

      const res = await callV3Gateway(getBaseUrl(), 'user/order/save', 'POST', params, {
        Authorization: auth.getToken() || '',
        'User-Agent': API_USER_AGENT
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        if (res.status >= 500) {
          showErrorBanner(txt)
          return
        }
        throw new Error(txt || `HTTP ${res.status}`)
      }
      const data = await res.json().catch(() => ({}))
      const tn: string | undefined = data?.data
      if (!tn) throw new Error('No trade number')
      setTradeNo(tn)
      // Load order detail + payment method
      await loadPaymentData(tn)
      setPhase('payment')
    } catch (e) {
      setCouponMsg((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const loadPaymentData = async (tn: string): Promise<void> => {
    try {
      const headers = {
        Authorization: auth.getToken() || '',
        'User-Agent': API_USER_AGENT
      }
      const [detailRes, pmRes] = await Promise.all([
        callV3Gateway(getBaseUrl(), 'user/order/detail', 'GET', { trade_no: tn }, headers),
        callV3Gateway(getBaseUrl(), 'user/order/getPaymentMethod', 'GET', undefined, headers)
      ])
      if (detailRes.status >= 500) {
        const text = await detailRes.text().catch(() => '')
        showErrorBanner(text)
      }
      if (pmRes.status >= 500) {
        const text = await pmRes.text().catch(() => '')
        showErrorBanner(text)
      }
      const d = await detailRes.json().catch(() => ({}))
      const p = await pmRes.json().catch(() => ({}))
      if (d?.data) setOrder(d.data as OrderDetail)
      if (Array.isArray(p?.data)) setMethods(p.data as PaymentMethod[])
      if (Array.isArray(p?.data) && p.data.length) setMethodId(p.data[0].id)
    } catch {}
  }

  const doCheckout = async (): Promise<void> => {
    if (!tradeNo) return
    setCheckingOut(true)
    try {
      const params: Record<string, unknown> = { trade_no: tradeNo }
      if (methodId != null) params.payment_id = methodId

      const res = await callV3Gateway(getBaseUrl(), 'user/order/checkout', 'POST', params, {
        Authorization: auth.getToken() || '',
        'User-Agent': API_USER_AGENT
      })
      if (res.status >= 500) {
        const text500 = await res.text().catch(() => '')
        showErrorBanner(text500)
        return
      }
      // Some panels return a URL to open or JSON { type: -1, data: true }
      const text = await res.text()
      try {
        const obj = JSON.parse(text)
        if (typeof obj?.data === 'string' && /^https?:/i.test(obj.data)) {
          window.open(obj.data, '_blank')
        }
        if (obj?.data === true) {
          setPhase('success')
          return
        }
      } catch {
        if (/^https?:/i.test(text)) {
          window.open(text, '_blank')
          setPhase('success')
          return
        }
      }
      setPhase('success')
    } catch (e) {
      console.error(e)
    } finally {
      setCheckingOut(false)
    }
  }

  const renderPlanCard = (plan: Plan): React.ReactElement => {
    // Pick a primary price to display: month > year > onetime > others
    const preferred: (keyof Plan)[] = [
      'month_price',
      'year_price',
      'onetime_price',
      'quarter_price',
      'half_year_price',
      'two_year_price',
      'three_year_price'
    ]
    const key = preferred.find((k) => (plan[k] as number | null) != null)
    const priceText = formatPrice(key ? (plan[key] as number | null) : null, t)
    const features = htmlToFeatures(plan.content)

    return (
      <Card key={plan.id} className="shrink-0 flex-none w-[230px] rounded-2xl shadow-medium">
        <CardHeader className="flex-col items-start gap-1">
          <span className="text-sm font-semibold bg-gradient-to-r from-violet-500 to-orange-400 bg-clip-text text-transparent">
            {plan.name}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold">{priceText}</span>
            {key &&
              (key === 'onetime_price' ? (
                <span className="text-default-500 text-sm">{t('store.unit.onetime')}</span>
              ) : (
                <span className="text-default-500 text-sm">
                  / {t(periodUnitKeyMap[key] || 'store.unit.month')}
                </span>
              ))}
          </div>
        </CardHeader>
        <CardBody className="pt-0">
          <Button color="default" variant="flat" className="my-2" onPress={() => openBuy(plan)}>
            {t('store.getStarted')}
          </Button>
          <Divider className="my-3" />
          <div className="flex flex-col gap-2">
            {features.length === 0 && (
              <div className="text-default-500 text-sm">{t('store.noFeatures')}</div>
            )}
            {features.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <IoCheckmark className="text-success mt-1" />
                <span className="text-small">{f}</span>
              </div>
            ))}
          </div>
        </CardBody>
        <CardFooter>
          <Button size="sm" variant="light" color="default" onPress={() => navigate('/support')}>
            {t('store.needHigher')}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const periodOptions = useMemo(() => {
    const plan = currentPlan
    if (!plan) return [] as { key: string; label: string; price: number }[]
    const opts: { key: string; label: string; price: number }[] = []
    for (const k of priceKeys) {
      const val = plan[k] as number | null
      if (val !== null && val !== undefined) {
        opts.push({ key: k, label: t(periodLabelMap[k] || 'store.period.custom'), price: val })
      }
    }
    return opts
  }, [currentPlan, t])

  return (
    <BasePage title={t('store.title')}>
      {toasts.length > 0 && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,720px)] flex flex-col items-center">
          {toasts.map((toast, idx) => (
            <div key={toast.id} className={`w-full max-w-[720px] ${idx > 0 ? '-mt-2' : ''}`}>
              <div className="pointer-events-auto rounded-xl border border-danger bg-danger-50 text-danger-700 dark:bg-danger-200/20 dark:text-danger-200 px-4 py-3 shadow-lg text-center">
                <div className="whitespace-pre-wrap break-words text-sm">{toast.message}</div>
                <div className="absolute right-2 top-2">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    onPress={() => {
                      setToasts((prev) => prev.filter((t) => t.id !== toast.id))
                      const m = toastTimersRef.current
                      const tid = m.get(toast.id)
                      if (tid) {
                        window.clearTimeout(tid)
                        m.delete(toast.id)
                      }
                    }}
                  >
                    ×
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {loading && (
        <div className="flex justify-center items-center py-10">
          <Spinner />
        </div>
      )}
      {error && <div className="text-danger text-sm my-2">{error}</div>}
      {!loading && !error && (
        <div
          className="relative"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <div
            ref={scrollerRef}
            onScroll={updateControls}
            onMouseDown={onDragStart}
            onMouseMove={onDragMove}
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
            className={`overflow-x-auto px-10 py-4 ${dragging ? 'cursor-grabbing' : 'cursor-grab'} select-none`}
          >
            <div className="flex gap-6 justify-start">{plans.map((p) => renderPlanCard(p))}</div>
          </div>
          {hovering && canScrollLeft && (
            <Button
              isIconOnly
              size="sm"
              className="absolute left-2 top-1/2 -translate-y-1/2"
              onPress={() => scrollerRef.current?.scrollBy({ left: -400, behavior: 'smooth' })}
            >
              <IoChevronBack className="text-lg" />
            </Button>
          )}
          {hovering && canScrollRight && (
            <Button
              isIconOnly
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onPress={() => scrollerRef.current?.scrollBy({ left: 400, behavior: 'smooth' })}
            >
              <IoChevronForward className="text-lg" />
            </Button>
          )}
        </div>
      )}

      {/* Redeem gift card */}
      <div className="mt-6 w-full max-w-[720px] px-3 sm:px-4 mx-auto">
        <Card className="rounded-2xl shadow-medium">
          <CardHeader>
            <div className="font-semibold">兑换码</div>
          </CardHeader>
          <CardBody>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-0">
                <Input
                  label="兑换码"
                  placeholder="请输入兑换码"
                  value={redeemCode}
                  onValueChange={setRedeemCode}
                />
              </div>
              <Button
                color="primary"
                isDisabled={!redeemCode.trim()}
                isLoading={redeeming}
                onPress={redeemGiftcard}
              >
                兑换
              </Button>
            </div>
          </CardBody>
          {redeemMsg && (
            <CardFooter>
              <div className={`${redeemOk ? 'text-success' : 'text-danger'} text-sm`}>
                {redeemMsg}
              </div>
            </CardFooter>
          )}
        </Card>
      </div>

      <Modal
        isOpen={open}
        onOpenChange={(isOpen) => {
          // If user closes the modal in payment phase without paying or canceling, auto-cancel the order.
          if (!isOpen && phase === 'payment' && tradeNo) {
            // Fire-and-forget; modal will close immediately.
            void cancelCurrentOrder()
          }
          setOpen(isOpen)
        }}
        size="lg"
      >
        <ModalContent>
          {(onClose) => (
            <>
              {phase === 'select' && (
                <>
                  <ModalHeader>{t('store.buyPlan')}</ModalHeader>
                  <ModalBody>
                    <div className="flex flex-col gap-3">
                      <div className="text-lg font-bold">{currentPlan?.name}</div>
                      <Select
                        label={t('store.choosePeriod')}
                        selectedKeys={selectedPeriod ? [selectedPeriod] : []}
                        onSelectionChange={(keys) => {
                          const val = Array.from(keys as Set<string>)[0]
                          if (val) setSelectedPeriod(val)
                        }}
                      >
                        {periodOptions.map((opt) => {
                          const label = `${t(periodLabelMap[opt.key] || 'store.period.custom')} - ${formatPrice(opt.price, t)}`
                          return (
                            <SelectItem key={opt.key} textValue={label}>
                              {label}
                            </SelectItem>
                          )
                        })}
                      </Select>
                      <Input
                        label={t('store.coupon')}
                        placeholder={t('store.couponPlaceholder')}
                        value={coupon}
                        onValueChange={setCoupon}
                        onBlur={validateCoupon}
                      />
                      {couponMsg && <div className="text-default-500 text-sm">{couponMsg}</div>}
                    </div>
                  </ModalBody>
                  <ModalFooter>
                    <Button variant="light" onPress={onClose}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={!selectedPeriod && periodOptions.length !== 1}
                      isLoading={submitting}
                      onPress={submitOrder}
                    >
                      {t('store.createOrder')}
                    </Button>
                  </ModalFooter>
                </>
              )}

              {phase === 'payment' && (
                <>
                  <ModalHeader>{t('store.paymentTitle')}</ModalHeader>
                  <ModalBody>
                    <div className="flex flex-col gap-3">
                      <div className="text-sm text-default-500">
                        {t('store.orderNo')}: {order?.trade_no || tradeNo}
                      </div>
                      <div className="text-sm text-default-500">
                        {t('store.orderCreatedAt')}:{' '}
                        {order?.created_at
                          ? dayjs.unix(order.created_at).format('DD/MM/YYYY')
                          : '-'}
                      </div>
                      <Divider />
                      <div>
                        <div className="font-semibold">
                          {order?.plan?.name || currentPlan?.name}
                        </div>
                        <div className="text-default-600 text-sm">
                          {t('store.totalAmount')}:{' '}
                          {formatPrice(
                            order?.total_amount ??
                              ((currentPlan &&
                                (currentPlan as any)[selectedPeriod as keyof Plan]) as
                                | number
                                | null),
                            t
                          )}
                        </div>
                      </div>
                      <Select
                        label={t('store.paymentMethod')}
                        selectedKeys={methodId != null ? [String(methodId)] : []}
                        onChange={(e) => setMethodId(Number(e.target.value))}
                      >
                        {methods.map((m) => (
                          <SelectItem key={String(m.id)}>{m.name}</SelectItem>
                        ))}
                      </Select>
                    </div>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      color="danger"
                      variant="flat"
                      isLoading={canceling}
                      onPress={async () => {
                        setCanceling(true)
                        try {
                          await cancelCurrentOrder()
                          setOpen(false)
                        } finally {
                          setCanceling(false)
                        }
                      }}
                    >
                      {t('store.cancelOrder')}
                    </Button>
                    <Button color="primary" isLoading={checkingOut} onPress={doCheckout}>
                      {t('store.payNow')}
                    </Button>
                  </ModalFooter>
                </>
              )}

              {phase === 'success' && (
                <>
                  <ModalHeader>{t('store.purchaseSuccess')}</ModalHeader>
                  <ModalBody>
                    <div className="text-default-600">{t('store.successHint')}</div>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      color="primary"
                      onPress={() => {
                        onClose()
                        navigate('/user-center')
                      }}
                    >
                      {t('store.goUserCenter')}
                    </Button>
                  </ModalFooter>
                </>
              )}
            </>
          )}
        </ModalContent>
      </Modal>
    </BasePage>
  )
}

export default Store
