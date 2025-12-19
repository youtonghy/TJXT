/**
 * Centralized API Service for V2Board API
 * Based on API_DOCUMENTATION.md specification
 * User-Agent: TJXT
 */

// Default User-Agent for all requests
export const API_USER_AGENT = 'TJXT'

// API Response types
export interface ApiResponse<T = unknown> {
  data?: T
  message?: string
}

export interface ApiError {
  message: string
  status: number
}

// User types
export interface UserInfo {
  email: string
  transfer_enable: number
  device_limit: number
  last_login_at: number
  created_at: number
  banned: number
  auto_renewal: number
  remind_expire: number
  remind_traffic: number
  expired_at: number | null
  balance: number
  commission_balance: number
  plan_id: number
  discount: number
  commission_rate: number
  telegram_id: number | null
  uuid: string
  sso_subject: string | null
  sso_provider: string | null
  avatar_url: string
}

export interface SubscribeInfo {
  plan_id: number
  token: string
  expired_at: number | null
  u: number // upload bytes
  d: number // download bytes
  transfer_enable: number
  device_limit: number
  email: string
  uuid: string
  plan: {
    id: number
    name: string
    content: string
  }
  alive_ip: number
  subscribe_url: string
  reset_day: number
  allow_new_period: number
  plan_started_at: number
}

export interface Notice {
  id: number
  title: string
  content: string
  created_at: number
  show?: number
}

export interface Plan {
  id: number
  name: string
  content?: string | null
  transfer_enable?: number | null
  device_limit?: number | null
  speed_limit?: number | null
  month_price?: number | null
  quarter_price?: number | null
  half_year_price?: number | null
  year_price?: number | null
  two_year_price?: number | null
  three_year_price?: number | null
  onetime_price?: number | null
  reset_price?: number | null
  capacity_limit?: number
  created_at?: number
  updated_at?: number
}

export interface OrderDetail {
  trade_no: string
  plan_id: number
  period: string
  total_amount: number
  balance_amount: number
  discount_amount: number
  status: number // 0: pending, 1: processing, 2: cancelled, 3: completed, 4: offset
  created_at: number
  plan: Plan
  try_out_plan_id?: number
}

export interface PaymentMethod {
  id: number
  name: string
  payment: string
  icon?: string | null
  handling_fee_fixed?: number
  handling_fee_percent?: number
}

export interface Coupon {
  id: number
  code: string
  type: number // 1: amount, 2: percentage
  value: number
  limit_use: number
}

export interface TicketItem {
  id: number
  user_id: number
  subject: string
  level: number // 0: low, 1: medium, 2: high
  status: number // 0: open, 1: closed
  reply_status: number
  created_at: number
  updated_at: number
}

export interface TicketMessage {
  id: number
  user_id: number
  ticket_id: number
  message: string
  created_at: number
  updated_at: number
  is_me: boolean
}

export interface TicketDetail extends TicketItem {
  message: TicketMessage[]
}

export interface GiftCardRedeemResult {
  data: boolean
  type: number // 1: balance, 2: days, 3: traffic(GB), 4: reset traffic, 5: plan
  value: number
}

export interface LoginResponse {
  token: string
  auth_data: string
}

// Auth error callback type
export type AuthErrorCallback = () => void

// API Service class
export class ApiService {
  private baseUrl: string
  private token: string | null
  private onAuthError: AuthErrorCallback | null

  constructor(baseUrl: string, token?: string | null, onAuthError?: AuthErrorCallback) {
    this.baseUrl = baseUrl
    this.token = token || null
    this.onAuthError = onAuthError || null
  }

  setToken(token: string | null): void {
    this.token = token
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl
  }

  setOnAuthError(callback: AuthErrorCallback | null): void {
    this.onAuthError = callback
  }

  getToken(): string | null {
    return this.token
  }

  private getHeaders(withAuth: boolean = true, contentType: 'json' | 'form' = 'json'): HeadersInit {
    const headers: HeadersInit = {
      'User-Agent': API_USER_AGENT
    }

    if (contentType === 'json') {
      headers['Content-Type'] = 'application/json'
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    if (withAuth && this.token) {
      headers['Authorization'] = this.token
    }

    return headers
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      // Handle 401 Unauthorized - token invalid or expired
      if (response.status === 401) {
        this.token = null
        if (this.onAuthError) {
          this.onAuthError()
        }
        throw { message: '登录已过期，请重新登录', status: 401 } as ApiError
      }

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
        // Use default error message
      }
      throw { message: errorMessage, status: response.status } as ApiError
    }

    const data = await response.json()
    return data.data !== undefined ? data.data : data
  }

  // ==================== Passport 认证模块 ====================

  /**
   * User login
   * POST /api/v3/passport/auth/login
   */
  async login(email: string, password: string, options?: {
    recaptcha_data?: string
    turnstile_token?: string
  }): Promise<LoginResponse> {
    const body = new URLSearchParams()
    body.set('email', email)
    body.set('password', password)
    if (options?.recaptcha_data) body.set('recaptcha_data', options.recaptcha_data)
    if (options?.turnstile_token) body.set('turnstile_token', options.turnstile_token)

    const response = await fetch(`${this.baseUrl}/api/v3/passport/auth/login`, {
      method: 'POST',
      headers: this.getHeaders(false, 'form'),
      body: body.toString()
    })

    return this.handleResponse<LoginResponse>(response)
  }

  /**
   * Send email verification code
   * POST /api/v3/passport/comm/sendEmailVerify
   */
  async sendEmailVerify(email: string, isForget: boolean = false, options?: {
    recaptcha_data?: string
    turnstile_token?: string
  }): Promise<boolean> {
    const body = new URLSearchParams()
    body.set('email', email)
    body.set('isforget', isForget ? '1' : '0')
    if (options?.recaptcha_data) body.set('recaptcha_data', options.recaptcha_data)
    if (options?.turnstile_token) body.set('turnstile_token', options.turnstile_token)

    const response = await fetch(`${this.baseUrl}/api/v3/passport/comm/sendEmailVerify`, {
      method: 'POST',
      headers: this.getHeaders(false, 'form'),
      body: body.toString()
    })

    return this.handleResponse<boolean>(response)
  }

  // ==================== User 用户模块 ====================

  /**
   * Get user info
   * GET /api/v3/user/info
   */
  async getUserInfo(): Promise<UserInfo> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/info`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<UserInfo>(response)
  }

  /**
   * Get subscription info
   * GET /api/v3/user/getSubscribe
   */
  async getSubscribe(): Promise<SubscribeInfo> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/getSubscribe`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<SubscribeInfo>(response)
  }

  /**
   * Get user statistics [pending orders, pending tickets, invited users]
   * GET /api/v3/user/getStat
   */
  async getUserStat(): Promise<[number, number, number]> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/getStat`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<[number, number, number]>(response)
  }

  /**
   * Check login status
   * GET /api/v3/user/checkLogin
   */
  async checkLogin(): Promise<{ is_login: boolean; is_admin: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/checkLogin`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<{ is_login: boolean; is_admin: boolean }>(response)
  }

  /**
   * Redeem gift card
   * POST /api/v3/user/redeemgiftcard
   */
  async redeemGiftCard(giftcard: string): Promise<GiftCardRedeemResult> {
    const body = new URLSearchParams()
    body.set('giftcard', giftcard)

    const response = await fetch(`${this.baseUrl}/api/v3/user/redeemgiftcard`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    // This endpoint returns { data: true, type: number, value: number }
    const data = await response.json()
    if (!response.ok) {
      throw { message: data.message || `HTTP ${response.status}`, status: response.status } as ApiError
    }
    return data as GiftCardRedeemResult
  }

  // ==================== Notice 通知模块 ====================

  /**
   * Get notices
   * GET /api/v3/user/notice/fetch
   */
  async getNotices(options?: { id?: number; current?: number; pageSize?: number }): Promise<{ data: Notice[]; total: number }> {
    const params = new URLSearchParams()
    if (options?.id) params.set('id', String(options.id))
    if (options?.current) params.set('current', String(options.current))
    if (options?.pageSize) params.set('pageSize', String(options.pageSize))

    const url = `${this.baseUrl}/api/v3/user/notice/fetch${params.toString() ? `?${params.toString()}` : ''}`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    const result = await response.json()
    if (!response.ok) {
      throw { message: result.message || `HTTP ${response.status}`, status: response.status } as ApiError
    }

    // Handle different response formats
    if (Array.isArray(result.data)) {
      return { data: result.data, total: result.total || result.data.length }
    } else if (result.data && Array.isArray(result.data.list)) {
      return { data: result.data.list, total: result.total || result.data.list.length }
    }
    return { data: result.data || [], total: 0 }
  }

  // ==================== Plan 套餐模块 ====================

  /**
   * Get plans
   * GET /api/v3/user/plan/fetch
   */
  async getPlans(id?: number): Promise<Plan[]> {
    const url = id
      ? `${this.baseUrl}/api/v3/user/plan/fetch?id=${encodeURIComponent(id)}`
      : `${this.baseUrl}/api/v3/user/plan/fetch`

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<Plan[]>(response)
  }

  // ==================== Order 订单模块 ====================

  /**
   * Get orders
   * GET /api/v3/user/order/fetch
   */
  async getOrders(status?: number): Promise<OrderDetail[]> {
    const url = status !== undefined
      ? `${this.baseUrl}/api/v3/user/order/fetch?status=${encodeURIComponent(status)}`
      : `${this.baseUrl}/api/v3/user/order/fetch`

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<OrderDetail[]>(response)
  }

  /**
   * Get order detail
   * GET /api/v3/user/order/detail
   */
  async getOrderDetail(tradeNo: string): Promise<OrderDetail> {
    const response = await fetch(
      `${this.baseUrl}/api/v3/user/order/detail?trade_no=${encodeURIComponent(tradeNo)}`,
      {
        method: 'GET',
        headers: this.getHeaders(true)
      }
    )

    return this.handleResponse<OrderDetail>(response)
  }

  /**
   * Create order
   * POST /api/v3/user/order/save
   */
  async createOrder(options: {
    plan_id: number
    period?: string
    coupon_code?: string
    deposit_amount?: number
  }): Promise<string> {
    const body = new URLSearchParams()
    body.set('plan_id', String(options.plan_id))
    if (options.period) body.set('period', options.period)
    if (options.coupon_code) body.set('coupon_code', options.coupon_code)
    if (options.deposit_amount !== undefined) body.set('deposit_amount', String(options.deposit_amount))

    const response = await fetch(`${this.baseUrl}/api/v3/user/order/save`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<string>(response)
  }

  /**
   * Checkout order
   * POST /api/v3/user/order/checkout
   */
  async checkoutOrder(tradeNo: string, method: number, token?: string): Promise<{ type: number; data: string | boolean }> {
    const body = new URLSearchParams()
    body.set('trade_no', tradeNo)
    body.set('method', String(method))
    if (token) body.set('token', token)

    const response = await fetch(`${this.baseUrl}/api/v3/user/order/checkout`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    const result = await response.json()
    if (!response.ok) {
      throw { message: result.message || `HTTP ${response.status}`, status: response.status } as ApiError
    }
    return result
  }

  /**
   * Check order status
   * GET /api/v3/user/order/check
   */
  async checkOrderStatus(tradeNo: string): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/api/v3/user/order/check?trade_no=${encodeURIComponent(tradeNo)}`,
      {
        method: 'GET',
        headers: this.getHeaders(true)
      }
    )

    return this.handleResponse<number>(response)
  }

  /**
   * Cancel order
   * POST /api/v3/user/order/cancel
   */
  async cancelOrder(tradeNo: string): Promise<boolean> {
    const body = new URLSearchParams()
    body.set('trade_no', tradeNo)

    const response = await fetch(`${this.baseUrl}/api/v3/user/order/cancel`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<boolean>(response)
  }

  /**
   * Get payment methods
   * GET /api/v3/user/order/getPaymentMethod
   */
  async getPaymentMethods(): Promise<PaymentMethod[]> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/order/getPaymentMethod`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<PaymentMethod[]>(response)
  }

  // ==================== Coupon 优惠券模块 ====================

  /**
   * Check coupon
   * POST /api/v3/user/coupon/check
   */
  async checkCoupon(code: string, planId?: number): Promise<Coupon> {
    const body = new URLSearchParams()
    body.set('code', code)
    if (planId !== undefined) body.set('plan_id', String(planId))

    const response = await fetch(`${this.baseUrl}/api/v3/user/coupon/check`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<Coupon>(response)
  }

  // ==================== Ticket 工单模块 ====================

  /**
   * Get tickets
   * GET /api/v3/user/ticket/fetch
   */
  async getTickets(): Promise<TicketItem[]> {
    const response = await fetch(`${this.baseUrl}/api/v3/user/ticket/fetch`, {
      method: 'GET',
      headers: this.getHeaders(true)
    })

    return this.handleResponse<TicketItem[]>(response)
  }

  /**
   * Get ticket detail
   * GET /api/v3/user/ticket/fetch?id=xxx
   */
  async getTicketDetail(id: number): Promise<TicketDetail> {
    const response = await fetch(
      `${this.baseUrl}/api/v3/user/ticket/fetch?id=${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: this.getHeaders(true)
      }
    )

    return this.handleResponse<TicketDetail>(response)
  }

  /**
   * Create ticket
   * POST /api/v3/user/ticket/save
   */
  async createTicket(subject: string, level: number, message: string): Promise<boolean> {
    const body = new URLSearchParams()
    body.set('subject', subject)
    body.set('level', String(level))
    body.set('message', message)

    const response = await fetch(`${this.baseUrl}/api/v3/user/ticket/save`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<boolean>(response)
  }

  /**
   * Reply to ticket
   * POST /api/v3/user/ticket/reply
   */
  async replyTicket(id: number, message: string): Promise<boolean> {
    const body = new URLSearchParams()
    body.set('id', String(id))
    body.set('message', message)

    const response = await fetch(`${this.baseUrl}/api/v3/user/ticket/reply`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<boolean>(response)
  }

  /**
   * Close ticket
   * POST /api/v3/user/ticket/close
   */
  async closeTicket(id: number): Promise<boolean> {
    const body = new URLSearchParams()
    body.set('id', String(id))

    const response = await fetch(`${this.baseUrl}/api/v3/user/ticket/close`, {
      method: 'POST',
      headers: this.getHeaders(true, 'form'),
      body: body.toString()
    })

    return this.handleResponse<boolean>(response)
  }

  // ==================== Guest 访客模块 ====================

  /**
   * Get public config
   * GET /api/v3/guest/comm/config
   */
  async getGuestConfig(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/api/v3/guest/comm/config`, {
      method: 'GET',
      headers: this.getHeaders(false)
    })

    return this.handleResponse<Record<string, unknown>>(response)
  }

  /**
   * Test server connection (ping)
   * Uses the guest config endpoint for latency testing
   */
  async testConnection(timeout: number = 10000): Promise<{ latency: number; online: boolean }> {
    const startTime = Date.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(`${this.baseUrl}/api/v3/guest/comm/config`, {
        method: 'GET',
        headers: this.getHeaders(false),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      const latency = Date.now() - startTime

      return {
        latency,
        online: response.ok
      }
    } catch {
      return {
        latency: -1,
        online: false
      }
    }
  }
}

// Factory function to create API service instance
export function createApiService(baseUrl: string, token?: string | null, onAuthError?: AuthErrorCallback): ApiService {
  return new ApiService(baseUrl, token, onAuthError)
}

// Export types for external use
export type { ApiService as ApiServiceType }
