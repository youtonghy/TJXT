# V2Board API 文档

> 本文档为 V2Board 系统的 API 接口参考，供客户端开发使用

## 目录

- [通用说明](#通用说明)
- [API V1](#api-v1)
  - [Passport 认证模块](#passport-认证模块)
  - [User 用户模块](#user-用户模块)
  - [Client 客户端模块](#client-客户端模块)
  - [Guest 访客模块](#guest-访客模块)
  - [Server 服务端模块](#server-服务端模块)
- [API V2](#api-v2)
  - [Server 服务器配置](#server-服务器配置)
- [API V3](#api-v3)

---

## 通用说明

### 基础 URL
```
/api/v1/...
/api/v2/...
/api/v3/...
```

### 认证方式

大多数接口需要携带认证信息，通过 `authorization` Header 传递：
```
Authorization: {auth_data}
```

`auth_data` 是登录后返回的加密认证数据。

### 通用响应格式

**成功响应：**
```json
{
  "data": { ... }
}
```

**错误响应：**
```json
{
  "message": "错误信息"
}
```

HTTP 状态码说明：
- `200` - 成功
- `304` - 未修改（使用 ETag 缓存）
- `400` - 请求参数错误
- `401` - 未授权
- `403` - 禁止访问
- `404` - 资源不存在
- `422` - 验证失败
- `429` - 请求过于频繁
- `500` - 服务器错误

---

# API V3

`/api/v3` 继续复用 V1 控制器，业务行为保持一致，但新版本默认禁止直接访问绝大多数 `/api/v3/*` 路径；客户端需要通过 `/api/v3/server` 网关转发。仅回调/授权相关接口允许直连（见下方白名单）。

### V3 网关调用（统一入口）

**ANY** `/api/v3/server`

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| endpoint | string | 是 | 目标接口路径（不包含 `/api/v3/` 前缀），例如 `passport/auth/login` |
| method | string | 否 | HTTP 方法，默认 `GET`；允许 `GET/POST/PUT/PATCH/DELETE/HEAD` |
| params | object|string | 否 | 目标接口参数；可传对象或 JSON 字符串。不传时使用除 `endpoint/method/params` 外的请求参数 |

补充说明：
- `endpoint` 不能为 `server` 或 `server/...`，不能包含 `..`，仅允许字母、数字、下划线、`-`、`/`
- `GET/HEAD` 请求参数会作为 query，其它方法会转换为 JSON body
- 响应体与目标接口保持一致

**示例：**
```http
POST /api/v3/server
Content-Type: application/json

{
  "endpoint": "passport/auth/login",
  "method": "POST",
  "params": {
    "email": "user@example.com",
    "password": "secret"
  }
}
```

### 允许直连的 V3 接口

以下路径不需要通过 `/api/v3/server`：
- `/api/v3/guest/payment/notify`（通过请求参数传递 `method`、`uuid`）
- `/api/v3/guest/telegram/webhook`
- `/api/v3/passport/auth/thirdPartyLogin`
- `/api/v3/passport/auth/thirdPartyLogin/init`
- `/api/v3/passport/auth/thirdPartyLogin/approve`
- `/api/v3/passport/auth/thirdPartyLogin/reject`

# API V1

## Passport 认证模块

基础路径: `/api/v1/passport`

### 用户注册

**POST** `/api/v1/passport/auth/register`

用途：新用户注册账号

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| password | string | 是 | 密码 |
| invite_code | string | 否 | 邀请码（如开启强制邀请则必填） |
| email_code | string | 否 | 邮箱验证码（如开启邮箱验证则必填） |
| recaptcha_data | string | 否 | reCAPTCHA 验证数据 |
| turnstile_token | string | 否 | Turnstile 验证 Token |

**响应：**
```json
{
  "data": {
    "token": "加密的认证数据",
    "auth_data": "认证数据"
  }
}
```

---

### 用户登录

**POST** `/api/v1/passport/auth/login`

用途：用户登录获取认证信息

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| password | string | 是 | 密码 |
| recaptcha_data | string | 否 | reCAPTCHA 验证数据 |
| turnstile_token | string | 否 | Turnstile 验证 Token |

**响应：**
```json
{
  "data": {
    "token": "加密的认证数据",
    "auth_data": "认证数据"
  }
}
```

---

### Token 登录

**GET** `/api/v1/passport/auth/token2Login`

用途：通过临时 Token 登录（邮件链接登录验证）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 否 | 临时登录 Token |
| verify | string | 否 | 验证码 |
| redirect | string | 否 | 登录后跳转路径 |

**响应：**
- 如果传入 `token`：重定向到登录页面
- 如果传入 `verify`：返回认证数据
```json
{
  "data": {
    "token": "加密的认证数据",
    "auth_data": "认证数据"
  }
}
```

---

### 邮件链接登录

**POST** `/api/v1/passport/auth/loginWithMailLink`

用途：发送登录链接到邮箱

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| redirect | string | 否 | 登录后跳转路径 |

**响应：**
```json
{
  "data": true
}
```

---

### 获取快速登录 URL

**POST** `/api/v1/passport/auth/getQuickLoginUrl`

用途：获取一次性快速登录链接

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| auth_data | string | 否 | 认证数据（或通过 Header 传递） |
| redirect | string | 否 | 跳转路径 |

**响应：**
```json
{
  "data": "https://example.com/#/login?verify=xxx&redirect=dashboard"
}
```

---

### Telegram 登录

**POST** `/api/v1/passport/auth/loginWithTelegram`

用途：通过 Telegram 发起登录请求

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| redirect | string | 否 | 登录后跳转路径 |

**响应：**
```json
{
  "data": {
    "token": "请求 Token"
  }
}
```

---

### 检查 Telegram 登录状态

**GET** `/api/v1/passport/auth/checkTelegramLogin`

用途：轮询 Telegram 登录请求状态

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 请求 Token |

**响应：**
```json
{
  "data": {
    "status": "pending|approved|rejected|expired",
    "verify_code": "验证码（approved 时返回）",
    "redirect": "跳转路径"
  }
}
```

---

### 第三方应用跳转登录

用途：第三方应用发起授权登录，用户在浏览器中登录并授权后跳转回应用并携带 access token。应用名称可在 `app/Http/Controllers/V1/Admin/UserController.php` 中调整。

V3 路径与 V1 保持一致，仅将 `/api/v1/` 替换为 `/api/v3/`，例如：`/api/v3/passport/auth/thirdPartyLogin/init`。  
V3 已完整支持以下接口：  
`/api/v3/passport/auth/thirdPartyLogin/init`  
`/api/v3/passport/auth/thirdPartyLogin`  
`/api/v3/passport/auth/thirdPartyLogin/approve`  
`/api/v3/passport/auth/thirdPartyLogin/reject`  
建议在 V3 中发起 `init`，返回的授权 URL 会对应 V3 版本的授权/回调流程。

**流程说明：**
1. 应用调用初始化接口获取授权页面 URL
2. 浏览器打开授权页面 URL
3. 用户登录后点击授权或拒绝
4. 系统重定向到 `redirect_uri` 并附带 `access_token` 或 `error`

**POST** `/api/v1/passport/auth/thirdPartyLogin/init`

用途：创建第三方登录请求并返回授权页面 URL

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| redirect_uri | string | 是 | 应用回调地址（支持自定义 Scheme 或 https） |
| state | string | 否 | 应用自定义状态参数 |

**响应：**
```json
{
  "data": {
    "token": "请求 Token",
    "url": "授权页面 URL",
    "expires_in": 300,
    "app_name": "Third-Party App"
  }
}
```

---

**GET** `/api/v1/passport/auth/thirdPartyLogin`

用途：浏览器打开授权页面

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 请求 Token |

**响应：**
- 返回授权 HTML 页面

---

**POST** `/api/v1/passport/auth/thirdPartyLogin/approve`

用途：授权登录并生成 access token

**认证：** 需要 `authorization` Header（用户已登录）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 请求 Token |

**响应：**
```json
{
  "data": {
    "redirect_url": "应用回调 URL（包含 access_token）",
    "access_token": "认证数据",
    "token_type": "bearer"
  }
}
```

---

**POST** `/api/v1/passport/auth/thirdPartyLogin/reject`

用途：拒绝登录请求

**认证：** 需要 `authorization` Header（用户已登录）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 请求 Token |

**响应：**
```json
{
  "data": {
    "redirect_url": "应用回调 URL（包含 error=access_denied）"
  }
}
```

**回调参数说明：**
- 授权成功：`access_token`、`token_type`、`state`
- 授权拒绝：`error=access_denied`、`state`

---

### 2FA 登录验证

**POST** `/api/v1/passport/auth/login2FA`

用途：完成 2FA 验证（TOTP 等）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 登录时返回的临时 Token |
| code | string | 是 | 2FA 验证码 |

**响应：**
```json
{
  "data": {
    "token": "加密的认证数据",
    "auth_data": "认证数据"
  }
}
```

---

### 忘记密码

**POST** `/api/v1/passport/auth/forget`

用途：重置密码

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| email_code | string | 是 | 邮箱验证码 |
| password | string | 是 | 新密码 |

**响应：**
```json
{
  "data": true
}
```

---

### SSO 登录初始化

**GET** `/api/v1/passport/auth/sso/init`

用途：获取 SSO 单点登录跳转 URL

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| redirect | string | 否 | 登录后跳转路径 |

**响应：**
```json
{
  "data": {
    "url": "SSO 授权 URL"
  }
}
```

---

### SSO 回调

**GET** `/api/v1/passport/auth/sso/callback`

用途：SSO 登录回调（由 SSO 服务器重定向）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| state | string | 是 | 状态参数 |
| code | string | 是 | 授权码 |

**响应：**
重定向到应用登录页面

---

### 发送邮箱验证码

**POST** `/api/v1/passport/comm/sendEmailVerify`

用途：发送邮箱验证码

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱地址 |
| isforget | integer | 否 | 0=注册, 1=找回密码 |
| recaptcha_data | string | 否 | reCAPTCHA 验证数据 |
| turnstile_token | string | 否 | Turnstile 验证 Token |

**响应：**
```json
{
  "data": true
}
```

---

### 邀请码 PV 统计

**POST** `/api/v1/passport/comm/pv`

用途：统计邀请链接访问量

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| invite_code | string | 是 | 邀请码 |

**响应：**
```json
{
  "data": true
}
```

---

## User 用户模块

基础路径: `/api/v1/user`

**认证要求：** 需要携带 `Authorization` Header

### 获取用户信息

**GET** `/api/v1/user/info`

用途：获取当前登录用户的基本信息

**响应：**
```json
{
  "data": {
    "email": "user@example.com",
    "transfer_enable": 107374182400,
    "device_limit": 3,
    "last_login_at": 1699999999,
    "created_at": 1699999999,
    "banned": 0,
    "auto_renewal": 0,
    "remind_expire": 1,
    "remind_traffic": 1,
    "expired_at": 1699999999,
    "balance": 10000,
    "commission_balance": 5000,
    "plan_id": 1,
    "discount": 0,
    "commission_rate": 10,
    "telegram_id": 123456789,
    "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "sso_subject": null,
    "sso_provider": null,
    "avatar_url": "https://cravatar.cn/avatar/xxx"
  }
}
```

**字段说明：**
- `transfer_enable`: 总流量（字节）
- `balance`: 余额（分）
- `commission_balance`: 佣金余额（分）
- `expired_at`: 到期时间戳

---

### 获取订阅信息

**GET** `/api/v1/user/getSubscribe`

用途：获取用户订阅详情

**响应：**
```json
{
  "data": {
    "plan_id": 1,
    "token": "订阅 token",
    "expired_at": 1699999999,
    "u": 1073741824,
    "d": 2147483648,
    "transfer_enable": 107374182400,
    "device_limit": 3,
    "email": "user@example.com",
    "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "plan": {
      "id": 1,
      "name": "套餐名称",
      "content": "套餐描述"
    },
    "alive_ip": 2,
    "subscribe_url": "https://example.com/api/v1/client/subscribe?token=xxx",
    "reset_day": 15,
    "allow_new_period": 1,
    "plan_started_at": 1699999999
  }
}
```

**字段说明：**
- `u`: 上传流量（字节）
- `d`: 下载流量（字节）
- `alive_ip`: 当前在线设备数
- `reset_day`: 距离流量重置天数

---

### 获取用户统计

**GET** `/api/v1/user/getStat`

用途：获取用户相关统计数据

**响应：**
```json
{
  "data": [
    0,
    1,
    5
  ]
}
```

**数组说明：**
- [0]: 待支付订单数
- [1]: 待处理工单数
- [2]: 邀请用户数

---

### 检查登录状态

**GET** `/api/v1/user/checkLogin`

用途：检查当前认证是否有效

**响应：**
```json
{
  "data": {
    "is_login": true,
    "is_admin": false
  }
}
```

---

### 修改密码

**POST** `/api/v1/user/changePassword`

用途：修改用户密码

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| old_password | string | 是 | 旧密码 |
| new_password | string | 是 | 新密码 |

**响应：**
```json
{
  "data": true
}
```

---

### 更新用户设置

**POST** `/api/v1/user/update`

用途：更新用户偏好设置

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| auto_renewal | integer | 否 | 自动续费 0/1 |
| remind_expire | integer | 否 | 到期提醒 0/1 |
| remind_traffic | integer | 否 | 流量提醒 0/1 |

**响应：**
```json
{
  "data": true
}
```

---

### 重置安全信息

**GET** `/api/v1/user/resetSecurity`

用途：重置用户 UUID 和 Token

**响应：**
```json
{
  "data": "新的订阅 URL"
}
```

---

### 开启 TOTP

**POST** `/api/v1/user/enable2FA`

用途：初始化 TOTP 设置，获取密钥

**响应：**
```json
{
  "data": {
    "secret": "密钥字符串",
    "otpauth": "otpauth://totp/..."
  }
}
```

---

### 验证并启用 TOTP

**POST** `/api/v1/user/verify2FA`

用途：验证 TOTP 代码并正式启用 2FA

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 验证码 |

**响应：**
```json
{
  "data": true
}
```

---

### 关闭 TOTP

**POST** `/api/v1/user/disable2FA`

用途：关闭 2FA

**响应：**
```json
{
  "data": true
}
```

---

### 解绑 Telegram

**GET** `/api/v1/user/unbindTelegram`

用途：解绑 Telegram 账号

**响应：**
```json
{
  "data": true
}
```

---

### 解绑 SSO

**GET** `/api/v1/user/sso/unbind`

用途：解绑 SSO 账号

**响应：**
```json
{
  "data": true
}
```

---

### SSO 绑定初始化

**GET** `/api/v1/user/sso/init`

用途：获取 SSO 绑定跳转 URL

**响应：**
```json
{
  "data": {
    "url": "SSO 授权 URL"
  }
}
```

---

### 兑换礼品卡

**POST** `/api/v1/user/redeemgiftcard`

用途：兑换礼品卡

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| giftcard | string | 是 | 礼品卡码 |

**响应：**
```json
{
  "data": true,
  "type": 1,
  "value": 1000
}
```

**type 类型说明：**
- 1: 余额（分）
- 2: 有效期（天）
- 3: 流量（GB）
- 4: 重置流量
- 5: 套餐

---

### 佣金划转

**POST** `/api/v1/user/transfer`

用途：将佣金划转到余额

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| transfer_amount | integer | 是 | 划转金额（分） |

**响应：**
```json
{
  "data": true
}
```

---

### 提前续期

**POST** `/api/v1/user/newPeriod`

用途：在流量用完后提前进入下一周期

**响应：**
```json
{
  "data": true
}
```

---

### 获取活跃会话

**GET** `/api/v1/user/getActiveSession`

用途：获取用户所有登录会话

**响应：**
```json
{
  "data": [
    {
      "session_id": "xxx",
      "ip": "1.2.3.4",
      "created_at": 1699999999,
      "ua": "Mozilla/5.0..."
    }
  ]
}
```

---

### 移除活跃会话

**POST** `/api/v1/user/removeActiveSession`

用途：踢出指定登录会话

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| session_id | string | 是 | 会话 ID |

**响应：**
```json
{
  "data": true
}
```

---

### 获取快速登录 URL

**POST** `/api/v1/user/getQuickLoginUrl`

用途：获取一次性快速登录链接

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| redirect | string | 否 | 跳转路径 |

**响应：**
```json
{
  "data": "https://example.com/#/login?verify=xxx"
}
```

---

## 订单模块

基础路径: `/api/v1/user/order`

### 获取订单列表

**GET** `/api/v1/user/order/fetch`

用途：获取用户订单列表

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | integer | 否 | 订单状态筛选 |

**响应：**
```json
{
  "data": [
    {
      "trade_no": "订单号",
      "plan_id": 1,
      "period": "month_price",
      "total_amount": 1000,
      "status": 0,
      "created_at": 1699999999,
      "plan": {
        "id": 1,
        "name": "套餐名称"
      }
    }
  ]
}
```

**status 状态说明：**
- 0: 待支付
- 1: 开通中
- 2: 已取消
- 3: 已完成
- 4: 已折抵

---

### 获取订单详情

**GET** `/api/v1/user/order/detail`

用途：获取订单详细信息

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trade_no | string | 是 | 订单号 |

**响应：**
```json
{
  "data": {
    "trade_no": "订单号",
    "plan_id": 1,
    "period": "month_price",
    "total_amount": 1000,
    "balance_amount": 0,
    "discount_amount": 0,
    "status": 0,
    "plan": {
      "id": 1,
      "name": "套餐名称"
    },
    "try_out_plan_id": 0
  }
}
```

---

### 创建订单

**POST** `/api/v1/user/order/save`

用途：创建新订单

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| plan_id | integer | 是 | 套餐 ID（0 为充值） |
| period | string | 否 | 周期类型 |
| coupon_code | string | 否 | 优惠券码 |
| deposit_amount | integer | 否 | 充值金额（plan_id=0 时） |

**period 周期类型：**
- `month_price`: 月付
- `quarter_price`: 季付
- `half_year_price`: 半年付
- `year_price`: 年付
- `two_year_price`: 两年付
- `three_year_price`: 三年付
- `onetime_price`: 一次性
- `reset_price`: 流量重置包

**响应：**
```json
{
  "data": "订单号"
}
```

---

### 订单结账

**POST** `/api/v1/user/order/checkout`

用途：提交订单支付

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trade_no | string | 是 | 订单号 |
| method | integer | 是 | 支付方式 ID |
| token | string | 否 | Stripe Token（Stripe 支付时） |

**响应：**
```json
{
  "type": 0,
  "data": "支付跳转 URL 或支付数据"
}
```

**type 类型说明：**
- -1: 无需支付
- 0: 跳转支付
- 1: 二维码支付
- 2: 表单提交

---

### 检查订单状态

**GET** `/api/v1/user/order/check`

用途：检查订单支付状态

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trade_no | string | 是 | 订单号 |

**响应：**
```json
{
  "data": 0
}
```

---

### 取消订单

**POST** `/api/v1/user/order/cancel`

用途：取消待支付订单

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| trade_no | string | 是 | 订单号 |

**响应：**
```json
{
  "data": true
}
```

---

### 获取支付方式

**GET** `/api/v1/user/order/getPaymentMethod`

用途：获取可用支付方式列表

**响应：**
```json
{
  "data": [
    {
      "id": 1,
      "name": "支付宝",
      "payment": "AlipayF2F",
      "icon": "https://...",
      "handling_fee_fixed": 0,
      "handling_fee_percent": 0
    }
  ]
}
```

---

## 套餐模块

基础路径: `/api/v1/user/plan`

### 获取套餐列表

**GET** `/api/v1/user/plan/fetch`

用途：获取可购买套餐列表

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 否 | 套餐 ID（获取单个套餐详情） |

**响应（列表）：**
```json
{
  "data": [
    {
      "id": 1,
      "name": "套餐名称",
      "content": "套餐描述",
      "month_price": 1000,
      "quarter_price": 2700,
      "half_year_price": 5000,
      "year_price": 9000,
      "transfer_enable": 100,
      "device_limit": 3,
      "capacity_limit": 50
    }
  ]
}
```

**字段说明：**
- 价格单位为分
- `transfer_enable`: 流量（GB）
- `capacity_limit`: 剩余可购买数量

---

## 邀请模块

基础路径: `/api/v1/user/invite`

### 获取邀请信息

**GET** `/api/v1/user/invite/fetch`

用途：获取邀请码和邀请统计

**响应：**
```json
{
  "data": {
    "codes": [
      {
        "id": 1,
        "code": "ABCD1234",
        "status": 0,
        "pv": 10
      }
    ],
    "stat": [
      5,
      10000,
      5000,
      10,
      15000
    ],
    "invite_admin_only": 0
  }
}
```

**stat 数组说明：**
- [0]: 已注册用户数
- [1]: 有效佣金（分）
- [2]: 确认中佣金（分）
- [3]: 佣金比例（%）
- [4]: 可用佣金余额（分）

---

### 生成邀请码

**GET** `/api/v1/user/invite/save`

用途：生成新邀请码

**响应：**
```json
{
  "data": true
}
```

---

### 获取佣金明细

**GET** `/api/v1/user/invite/details`

用途：获取佣金收入明细

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| current | integer | 否 | 当前页码（默认 1） |
| page_size | integer | 否 | 每页数量（默认 10） |

**响应：**
```json
{
  "data": [
    {
      "id": 1,
      "trade_no": "订单号",
      "order_amount": 1000,
      "get_amount": 100,
      "created_at": 1699999999
    }
  ],
  "total": 50
}
```

---

## 工单模块

基础路径: `/api/v1/user/ticket`

### 获取工单列表/详情

**GET** `/api/v1/user/ticket/fetch`

用途：获取工单列表或单个工单详情

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 否 | 工单 ID（获取详情时传入） |

**响应（列表）：**
```json
{
  "data": [
    {
      "id": 1,
      "subject": "工单主题",
      "level": 1,
      "status": 0,
      "created_at": 1699999999,
      "updated_at": 1699999999
    }
  ]
}
```

**响应（详情）：**
```json
{
  "data": {
    "id": 1,
    "subject": "工单主题",
    "level": 1,
    "status": 0,
    "message": [
      {
        "id": 1,
        "message": "消息内容",
        "created_at": 1699999999,
        "is_me": true
      }
    ]
  }
}
```

**level 优先级：**
- 0: 低
- 1: 中
- 2: 高

**status 状态：**
- 0: 待处理
- 1: 已关闭

---

### 创建工单

**POST** `/api/v1/user/ticket/save`

用途：创建新工单

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| subject | string | 是 | 工单主题 |
| level | integer | 是 | 优先级 0/1/2 |
| message | string | 是 | 工单内容 |

**响应：**
```json
{
  "data": true
}
```

---

### 回复工单

**POST** `/api/v1/user/ticket/reply`

用途：回复工单

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 是 | 工单 ID |
| message | string | 是 | 回复内容 |

**响应：**
```json
{
  "data": true
}
```

---

### 关闭工单

**POST** `/api/v1/user/ticket/close`

用途：关闭工单

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 是 | 工单 ID |

**响应：**
```json
{
  "data": true
}
```

---

### 发起提现

**POST** `/api/v1/user/ticket/withdraw`

用途：发起佣金提现请求（系统自动创建工单）

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| withdraw_method | string | 是 | 提现方式 |
| withdraw_account | string | 是 | 提现账号 |

**响应：**
```json
{
  "data": true
}
```

---

## 服务器模块

基础路径: `/api/v1/user/server`

### 获取服务器列表

**GET** `/api/v1/user/server/fetch`

用途：获取用户可用的服务器列表

**响应头：**
- `ETag`: 用于缓存验证

**响应：**
```json
{
  "data": [
    {
      "id": 1,
      "name": "服务器名称",
      "type": "vmess",
      "host": "example.com",
      "port": 443,
      "group_id": 1,
      "rate": 1.0,
      "tags": ["标签1", "标签2"]
    }
  ]
}
```

---

## 通知模块

基础路径: `/api/v1/user/notice`

### 获取通知列表

**GET** `/api/v1/user/notice/fetch`

用途：获取公告通知

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 否 | 通知 ID（获取单条详情） |
| current | integer | 否 | 当前页码（默认 1） |
| pageSize | integer | 否 | 每页数量（默认 5） |

**响应：**
```json
{
  "data": [
    {
      "id": 1,
      "title": "公告标题",
      "content": "公告内容",
      "created_at": 1699999999
    }
  ],
  "total": 10
}
```

---

## 优惠券模块

基础路径: `/api/v1/user/coupon`

### 验证优惠券

**POST** `/api/v1/user/coupon/check`

用途：验证优惠券是否可用

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 优惠券码 |
| plan_id | integer | 否 | 套餐 ID |

**响应：**
```json
{
  "data": {
    "id": 1,
    "code": "DISCOUNT10",
    "type": 1,
    "value": 1000,
    "limit_use": 100
  }
}
```

**type 类型说明：**
- 1: 金额抵扣（分）
- 2: 百分比折扣

---

## 知识库模块

基础路径: `/api/v1/user/knowledge`

### 获取知识库

**GET** `/api/v1/user/knowledge/fetch`

用途：获取知识库文章列表或详情

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 否 | 文章 ID（获取详情） |
| language | string | 否 | 语言（如 zh-CN） |
| keyword | string | 否 | 搜索关键词 |

**响应（列表）：**
```json
{
  "data": {
    "分类名称": [
      {
        "id": 1,
        "category": "分类名称",
        "title": "文章标题",
        "updated_at": 1699999999
      }
    ]
  }
}
```

**响应（详情）：**
```json
{
  "data": {
    "id": 1,
    "title": "文章标题",
    "category": "分类名称",
    "body": "文章内容 HTML"
  }
}
```

**内容变量替换：**
- `{{siteName}}`: 站点名称
- `{{subscribeUrl}}`: 订阅链接
- `{{urlEncodeSubscribeUrl}}`: URL 编码订阅链接
- `{{safeBase64SubscribeUrl}}`: Base64 订阅链接
- `{{subscribeToken}}`: 订阅 Token

---

### 获取分类

**GET** `/api/v1/user/knowledge/getCategory`

用途：获取知识库分类

**响应：**
```json
{
  "data": ["分类1", "分类2"]
}
```

---

## 统计模块

基础路径: `/api/v1/user/stat`

### 获取流量日志

**GET** `/api/v1/user/stat/getTrafficLog`

用途：获取用户本月流量使用记录

**响应：**
```json
{
  "data": [
    {
      "u": 1073741824,
      "d": 2147483648,
      "record_at": 1699999999,
      "user_id": 1,
      "server_rate": 1.0
    }
  ]
}
```

---

## Telegram 模块

基础路径: `/api/v1/user/telegram`

### 获取 Bot 信息

**GET** `/api/v1/user/telegram/getBotInfo`

用途：获取 Telegram Bot 用户名

**响应：**
```json
{
  "data": {
    "username": "bot_username"
  }
}
```

---

## 通用配置模块

基础路径: `/api/v1/user/comm`

### 获取用户配置

**GET** `/api/v1/user/comm/config`

用途：获取用户端配置信息

**响应：**
```json
{
  "data": {
    "is_telegram": 1,
    "telegram_discuss_link": "https://t.me/group",
    "stripe_pk": "pk_live_xxx",
    "withdraw_methods": ["alipay", "usdt"],
    "withdraw_close": 0,
    "currency": "CNY",
    "currency_symbol": "¥",
    "commission_distribution_enable": 0,
    "commission_distribution_l1": 100,
    "commission_distribution_l2": 0,
    "commission_distribution_l3": 0,
    "sso_login_enable": 0,
    "sso_auto_register": 1
  }
}
```

---

### 获取 Stripe 公钥

**POST** `/api/v1/user/comm/getStripePublicKey`

用途：获取 Stripe 支付公钥

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 是 | 支付方式 ID |

**响应：**
```json
{
  "data": "pk_live_xxx"
}
```

---

## Client 客户端模块

基础路径: `/api/v1/client`

**认证要求：** 通过 URL 参数 `token` 传递订阅 Token

### 获取订阅

**GET** `/api/v1/client/subscribe`

用途：获取代理订阅配置

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 订阅 Token |
| flag | string | 否 | 客户端标识（自动识别 User-Agent） |

**支持的客户端（flag）：**
- `clash`: Clash 配置
- `clashmeta` / `tjxt`: Clash Meta 配置
- `sing-box` / `sing`: Sing-Box 配置
- `v2rayn`: V2RayN 配置
- `shadowrocket`: Shadowrocket 配置
- `quantumult`: Quantumult 配置
- `surge`: Surge 配置
- 其他: 通用订阅格式

**响应：**
根据客户端类型返回对应格式的配置文件

---

### 获取 App 配置

**GET** `/api/v1/client/app/getConfig`

用途：获取应用专用配置

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 订阅 Token |

**响应：**
返回 YAML 格式的 Clash 配置

---

### 获取 App 版本

**GET** `/api/v1/client/app/getVersion`

用途：获取客户端版本信息

**响应：**
```json
{
  "data": {
    "windows_version": "1.0.0",
    "windows_download_url": "https://...",
    "macos_version": "1.0.0",
    "macos_download_url": "https://...",
    "android_version": "1.0.0",
    "android_download_url": "https://..."
  }
}
```

---

## Guest 访客模块

基础路径: `/api/v1/guest`

**认证要求：** 无需认证

### 获取公共配置

**GET** `/api/v1/guest/comm/config`

用途：获取网站公共配置信息

**响应：**
```json
{
  "data": {
    "tos_url": "https://...",
    "is_email_verify": 1,
    "is_invite_force": 0,
    "email_whitelist_suffix": ["gmail.com", "qq.com"],
    "is_recaptcha": 0,
    "is_turnstile": 1,
    "recaptcha_site_key": "xxx",
    "turnstile_site_key": "xxx",
    "telegram_login_enable": 1,
    "sso_login_enable": 0,
    "app_description": "站点描述",
    "app_url": "https://example.com",
    "logo": "https://...",
    "currency": "CNY",
    "currency_symbol": "¥"
  }
}
```

---

### Telegram Webhook

**POST** `/api/v1/guest/telegram/webhook`

用途：接收 Telegram Bot 回调

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| access_token | string | 是 | 访问令牌（MD5 of Bot Token） |

**响应：**
无

---

### 支付通知回调

**GET/POST** `/api/v1/guest/payment/notify/{method}/{uuid}`

用途：接收支付平台回调通知

**路径参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| method | string | 支付方式标识 |
| uuid | string | 支付配置 UUID |

**响应：**
`success` 或自定义返回内容

---

### 今日流量概览

**GET** `/api/v1/guest/stat/todayTrafficOverview`

用途：获取今日流量统计（匿名公开数据）

**响应：**
```json
{
  "data": {
    "total_usage_gb": 1234.5678,
    "top_usage_gb": [100.5, 80.3, 60.2, 40.1, 20.0],
    "unit": "GB"
  }
}
```

---

## Server 服务端模块

基础路径: `/api/v1/server`

**认证要求：** 通过 URL 参数 `token` 传递服务器通信 Token

### 动态路由

**ANY** `/api/v1/server/{class}/{action}`

用途：服务端动态调用

**示例：**
- `/api/v1/server/UniProxy/user` - 获取用户列表
- `/api/v1/server/UniProxy/push` - 提交流量数据
- `/api/v1/server/UniProxy/config` - 获取服务器配置
- `/api/v1/server/UniProxy/alive` - 提交在线数据
- `/api/v1/server/UniProxy/alivelist` - 获取在线列表

### UniProxy - 获取用户

**GET/POST** `/api/v1/server/UniProxy/user`

用途：服务端获取可用用户列表

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 服务器通信 Token |
| node_type | string | 是 | 节点类型 |
| node_id | integer | 是 | 节点 ID |

**响应：**
```json
{
  "users": [
    {
      "id": 1,
      "uuid": "xxx",
      "speed_limit": 0,
      "device_limit": 3
    }
  ]
}
```

---

### UniProxy - 获取配置

**GET/POST** `/api/v1/server/UniProxy/config`

用途：服务端获取节点配置

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 服务器通信 Token |
| node_type | string | 是 | 节点类型 |
| node_id | integer | 是 | 节点 ID |

**响应（根据节点类型不同）：**
```json
{
  "server_port": 443,
  "cipher": "aes-256-gcm",
  "base_config": {
    "push_interval": 60,
    "pull_interval": 60
  },
  "routes": []
}
```

---

### UniProxy - 提交流量

**POST** `/api/v1/server/UniProxy/push`

用途：服务端提交用户流量数据

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 服务器通信 Token |
| node_type | string | 是 | 节点类型 |
| node_id | integer | 是 | 节点 ID |

**请求体：**
```json
{
  "user_id": [上传字节, 下载字节],
  "user_id2": [上传字节, 下载字节]
}
```

**响应：**
```json
{
  "data": true
}
```

---

### UniProxy - 提交在线数据

**POST** `/api/v1/server/UniProxy/alive`

用途：服务端提交用户在线 IP 数据

**请求体：**
```json
{
  "user_id": ["ip1_nodeid", "ip2_nodeid"],
  "user_id2": ["ip3_nodeid"]
}
```

**响应：**
```json
{
  "data": true
}
```

---

### UniProxy - 获取在线列表

**GET** `/api/v1/server/UniProxy/alivelist`

用途：获取有设备限制用户的在线 IP 数

**响应：**
```json
{
  "alive": {
    "user_id": 2,
    "user_id2": 1
  }
}
```

---

# API V2

## Server 服务器配置

基础路径: `/api/v2/server`

### 获取 V2Node 配置

**ANY** `/api/v2/server/config`

用途：V2Node 类型节点获取配置

**请求参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 服务器通信 Token |
| node_id | integer | 是 | 节点 ID |

**响应：**
```json
{
  "listen_ip": "0.0.0.0",
  "server_port": 443,
  "network": "tcp",
  "network_settings": {},
  "protocol": "vmess",
  "tls": 1,
  "tls_settings": {},
  "encryption": "none",
  "encryption_settings": {},
  "flow": "",
  "cipher": "",
  "congestion_control": "",
  "zero_rtt_handshake": false,
  "up_mbps": 100,
  "down_mbps": 100,
  "obfs": "",
  "obfs_password": "",
  "padding_scheme": "",
  "server_key": "xxx",
  "ignore_client_bandwidth": false,
  "base_config": {
    "push_interval": 60,
    "pull_interval": 60,
    "node_report_min_traffic": 0,
    "device_online_min_traffic": 0
  },
  "routes": []
}
```

---

## 附录

### 货币单位

- 所有金额单位为「分」
- 1 元 = 100 分
- 显示时需要除以 100

### 流量单位

- 所有流量单位为「字节」
- 1 GB = 1073741824 字节
- 显示时需要转换

### 时间戳

- 所有时间戳为 Unix 时间戳（秒）
- 需要转换为本地时间显示

### ETag 缓存

部分接口支持 ETag 缓存：
- 请求时携带 `If-None-Match: "etag值"` Header
- 如果数据未变化，返回 304 状态码
- 客户端应使用缓存数据

### 错误处理

建议客户端统一处理以下错误：
- 401/403: 跳转登录页面
- 429: 显示频率限制提示
- 500: 显示服务器错误消息
