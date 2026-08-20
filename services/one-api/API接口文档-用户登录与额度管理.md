# One API - 用户登录与额度管理接口文档

## 目录
- [一、登录认证接口](#一登录认证接口)
- [二、用户额度管理接口](#二用户额度管理接口)
- [三、数据模型](#三数据模型)
- [四、权限说明](#四权限说明)

---

## 一、登录认证接口

### 1.1 用户登录

**接口地址**: `POST /api/user/login`

**请求参数**:
```json
{
  "username": "string",  // 用户名或邮箱
  "password": "string"   // 密码
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "admin",
    "display_name": "管理员",
    "role": 100,
    "status": 1
  }
}
```

**说明**:
- 支持使用用户名或邮箱登录
- 登录成功后会创建 session 会话
- 代码位置: `controller/user.go:26`

---

### 1.2 用户注册

**接口地址**: `POST /api/user/register`

**中间件**: 限流 + Turnstile 验证

**请求参数**:
```json
{
  "username": "string",           // 用户名 (最大12字符)
  "password": "string",           // 密码 (8-20字符)
  "email": "string",              // 邮箱 (可选，开启邮箱验证时必填)
  "verification_code": "string",  // 验证码 (开启邮箱验证时必填)
  "aff_code": "string"            // 邀请码 (可选)
}
```

**响应示例**:
```json
{
  "success": true,
  "message": ""
}
```

**说明**:
- 新用户注册成功后会自动获得初始额度 (`QuotaForNewUser`)
- 如果使用邀请码，邀请人和被邀请人都会获得额外额度
- 自动创建默认 token
- 代码位置: `controller/user.go:113`

---

### 1.3 用户登出

**接口地址**: `GET /api/user/logout`

**响应示例**:
```json
{
  "success": true,
  "message": ""
}
```

**说明**:
- 清除当前用户的 session 会话
- 代码位置: `controller/user.go:96`

---

### 1.4 第三方登录

#### GitHub OAuth
**接口地址**: `GET /api/oauth/github`

#### OIDC 登录
**接口地址**: `GET /api/oauth/oidc`

#### 飞书登录
**接口地址**: `GET /api/oauth/lark`

#### 微信登录
**接口地址**: `GET /api/oauth/wechat`

**说明**:
- 所有第三方登录接口都有限流保护
- 代码位置: `controller/auth/`

---

## 二、用户额度管理接口

### 2.1 查询用户信息（含额度）

**接口地址**: `GET /api/user/self`

**权限要求**: 需要登录

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 1,
    "username": "user123",
    "display_name": "用户123",
    "role": 1,
    "status": 1,
    "email": "user@example.com",
    "quota": 1000000,        // 可用额度
    "used_quota": 50000,     // 已使用额度
    "request_count": 100,    // 请求次数
    "group": "default",
    "aff_code": "ABC123"     // 邀请码
  }
}
```

**说明**:
- 返回当前登录用户的完整信息
- 代码位置: `controller/user.go:349`

---

### 2.2 获取用户仪表板

**接口地址**: `GET /api/user/dashboard`

**权限要求**: 需要登录

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": [
    {
      "date": "2024-03-01",
      "model": "gpt-4",
      "quota": 10000,
      "count": 5
    }
  ]
}
```

**说明**:
- 返回最近 7 天的使用统计数据
- 按日期和模型分组
- 代码位置: `controller/user.go:262`

---

### 2.3 用户充值（兑换码）

**接口地址**: `POST /api/user/topup`

**权限要求**: 需要登录

**请求参数**:
```json
{
  "key": "REDEMPTION-CODE-123"  // 兑换码
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": 100000  // 充值的额度数量
}
```

**说明**:
- 使用兑换码为当前用户充值
- 兑换码使用后会被标记为已使用
- 代码位置: `controller/user.go:754`

---

### 2.4 管理员充值

**接口地址**: `POST /api/topup`

**权限要求**: 管理员权限

**请求参数**:
```json
{
  "user_id": 123,           // 用户ID
  "quota": 100000,          // 充值额度
  "remark": "活动赠送"      // 备注 (可选)
}
```

**响应示例**:
```json
{
  "success": true,
  "message": ""
}
```

**说明**:
- 管理员可以直接为指定用户充值
- 会记录充值日志
- 代码位置: `controller/user.go:788`

---

### 2.5 更新用户信息（含额度）

**接口地址**: `PUT /api/user/`

**权限要求**: 管理员权限

**请求参数**:
```json
{
  "id": 123,
  "username": "user123",
  "display_name": "新名称",
  "role": 1,
  "status": 1,
  "quota": 2000000,         // 可以修改额度
  "password": "newpass123"  // 可选，修改密码
}
```

**响应示例**:
```json
{
  "success": true,
  "message": ""
}
```

**说明**:
- 管理员可以修改用户的所有信息，包括额度
- 如果修改了额度，会自动记录日志
- 不能修改同级或更高权限的用户
- 代码位置: `controller/user.go:367`

---

### 2.6 获取所有用户列表

**接口地址**: `GET /api/user/`

**权限要求**: 管理员权限

**查询参数**:
- `p`: 页码 (从0开始)
- `order`: 排序方式 (`quota` | `used_quota` | `request_count` | 默认按id倒序)

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": [
    {
      "id": 1,
      "username": "user1",
      "quota": 1000000,
      "used_quota": 50000
      // ... 其他字段
    }
  ]
}
```

**说明**:
- 支持分页和排序
- 不返回密码字段
- 代码位置: `controller/user.go:187`

---

### 2.7 搜索用户

**接口地址**: `GET /api/user/search`

**权限要求**: 管理员权限

**查询参数**:
- `keyword`: 搜索关键词 (匹配用户名、邮箱、显示名称)

**响应示例**:
```json
{
  "success": true,
  "message": "",
  "data": [
    // 匹配的用户列表
  ]
}
```

**说明**:
- 支持模糊搜索
- 代码位置: `controller/user.go:211`

---

## 三、数据模型

### 3.1 User 用户模型

**位置**: `model/user.go:34-54`

```go
type User struct {
    Id           int    `json:"id"`              // 用户ID
    Username     string `json:"username"`        // 用户名 (唯一)
    Password     string `json:"password"`        // 密码 (加密存储)
    DisplayName  string `json:"display_name"`    // 显示名称
    Role         int    `json:"role"`            // 角色
    Status       int    `json:"status"`          // 状态
    Email        string `json:"email"`           // 邮箱

    // OAuth 相关
    GitHubId     string `json:"github_id"`       // GitHub ID
    WeChatId     string `json:"wechat_id"`       // 微信ID
    LarkId       string `json:"lark_id"`         // 飞书ID
    OidcId       string `json:"oidc_id"`         // OIDC ID

    // 额度相关
    Quota        int64  `json:"quota"`           // 可用额度
    UsedQuota    int64  `json:"used_quota"`      // 已使用额度
    RequestCount int    `json:"request_count"`   // 请求次数

    // 其他
    AccessToken  string `json:"access_token"`    // 系统管理令牌
    Group        string `json:"group"`           // 用户组
    AffCode      string `json:"aff_code"`        // 邀请码
    InviterId    int    `json:"inviter_id"`      // 邀请人ID
}
```

### 3.2 角色定义

```go
const (
    RoleGuestUser  = 0    // 访客
    RoleCommonUser = 1    // 普通用户
    RoleAdminUser  = 10   // 管理员
    RoleRootUser   = 100  // 超级管理员
)
```

### 3.3 用户状态

```go
const (
    UserStatusEnabled  = 1  // 启用
    UserStatusDisabled = 2  // 禁用
    UserStatusDeleted  = 3  // 已删除
)
```

---

## 四、权限说明

### 4.1 权限级别

| 权限级别 | 中间件 | 说明 |
|---------|--------|------|
| 无需认证 | - | 登录、注册、第三方OAuth |
| 用户认证 | `middleware.UserAuth()` | 查看自己的信息、使用兑换码充值 |
| 管理员 | `middleware.AdminAuth()` | 管理用户、充值、查看所有数据 |
| 超级管理员 | `middleware.RootAuth()` | 系统配置、选项管理 |

### 4.2 接口权限矩阵

| 接口 | 无需认证 | 用户 | 管理员 | 超级管理员 |
|-----|---------|------|--------|-----------|
| POST /api/user/login | ✓ | - | - | - |
| POST /api/user/register | ✓ | - | - | - |
| GET /api/user/logout | ✓ | - | - | - |
| GET /api/user/self | - | ✓ | ✓ | ✓ |
| GET /api/user/dashboard | - | ✓ | ✓ | ✓ |
| POST /api/user/topup | - | ✓ | ✓ | ✓ |
| POST /api/topup | - | - | ✓ | ✓ |
| GET /api/user/ | - | - | ✓ | ✓ |
| PUT /api/user/ | - | - | ✓ | ✓ |
| DELETE /api/user/:id | - | - | ✓ | ✓ |

---

## 五、额度相关数据库操作

**位置**: `model/user.go`

### 5.1 查询操作

```go
// 获取用户额度
GetUserQuota(id int) (quota int64, err error)

// 获取已使用额度
GetUserUsedQuota(id int) (quota int64, err error)
```

### 5.2 修改操作

```go
// 增加用户额度
IncreaseUserQuota(id int, quota int64) error

// 减少用户额度
DecreaseUserQuota(id int, quota int64) error

// 更新已使用额度和请求次数
UpdateUserUsedQuotaAndRequestCount(id int, quota int64)
```

---

## 六、代码位置索引

| 功能模块 | 文件路径 | 说明 |
|---------|---------|------|
| 路由定义 | `router/api.go` | API 路由配置 |
| 用户控制器 | `controller/user.go` | 用户相关业务逻辑 |
| 用户模型 | `model/user.go` | 用户数据模型和数据库操作 |
| 认证中间件 | `middleware/auth.go` | 权限验证中间件 |
| OAuth控制器 | `controller/auth/` | 第三方登录逻辑 |

---

## 七、注意事项

1. **安全性**:
   - 密码使用哈希加密存储
   - 敏感接口有限流保护
   - Session 使用加密存储

2. **额度单位**:
   - 额度以 int64 存储
   - 具体单位由系统配置决定

3. **日志记录**:
   - 额度变更会自动记录日志
   - 管理员操作会记录操作日志

4. **批量更新**:
   - 支持批量更新模式以提高性能
   - 通过 `config.BatchUpdateEnabled` 配置

---

**文档生成时间**: 2026-03-09
**项目**: One API
**版本**: 基于当前代码库
