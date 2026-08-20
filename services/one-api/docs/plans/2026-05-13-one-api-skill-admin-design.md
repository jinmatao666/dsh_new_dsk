# One-API Skill 管理台字段补齐 + 文件夹导入 设计文档

**日期**: 2026-05-13
**范围**: `packages/one-api`(Go 后端 + `web/air` React 管理台)
**目标**: 把数据库 `skills` 表里已有但代码没读的字段(`category` / `is_deleted`)接入管理台,并给 SkillEditor 加"从文件夹导入"交互

## 背景

线上 MySQL `skills` 表的真实 schema 已经先行加了 `category`(varchar 255)和 `is_deleted`(tinyint 1)两个字段,但 Go 模型、controller、管理台前端都没读到它们。
同时,公库 skill 当前只能靠 `scripts/bundle-and-upload-skills.sh` 脚本上传,管理台新建/编辑只能在 Monaco Editor 里手写 bundle 内容,体验差。

本次目标:

1. 让 Go 层 / 管理台读写 `category` 字段,列表页可按分类筛选
2. 用 `is_deleted` 作为软删生命周期,`status` 字段保留在 DB/模型但不再出现在管理台表单
3. SkillEditor 的 body Tab 加"从文件夹导入"按钮,选中文件夹后自动打包 bundle 写入 `content`,后端 `SplitContent()` 自动拆 body+assets
4. 管理台列表支持:分类下拉筛选 + "显示已删除"开关 + 行级批量操作(软删/恢复/改分类)
5. 同名冲突时管理台弹 3 按钮 Modal(更新 / 替换 / 取消)

## 非目标

- 不改 Parvis 客户端(`packages/app`)。Parvis 侧的公库文件夹上传是后续独立 PR
- 不改 `personal_skills` 表及相关接口
- 不改 `is_deleted` 字段的 DB 定义(只读写,不做 schema 变更)
- 不做 `tags` 相关改动

## 数据库现状(真实 schema,来自生产 47.110.42.93)

```sql
CREATE TABLE `skills` (
  `id`                bigint NOT NULL AUTO_INCREMENT,
  `name`              varchar(100)  NOT NULL,
  `category`          varchar(255)  DEFAULT NULL COMMENT 'skill 所属类别',   -- ★ Go 模型缺失
  `description`       varchar(500)  DEFAULT '',
  `content`           mediumtext    NOT NULL,
  `body`              mediumtext,
  `assets`            mediumtext,
  `submitter`         varchar(100)  DEFAULT '',
  `tags`              json          DEFAULT NULL,
  `downloads`         bigint        DEFAULT '0',
  `version`           varchar(50)   DEFAULT '1.0',
  `status`            bigint        DEFAULT '1',                            -- 保留,不暴露
  `created_at`        bigint        DEFAULT NULL,
  `updated_at`        bigint        DEFAULT NULL,
  `body_updated_at`   bigint        DEFAULT '0',
  `assets_updated_at` bigint        DEFAULT '0',
  `is_deleted`        tinyint(1)    NOT NULL DEFAULT '0'  COMMENT '是否软删除',  -- ★ Go 模型缺失
  `scenario`          varchar(500)  DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_skills_name` (`name`)
) ENGINE=InnoDB
```

**注意**:当前 DB 里 56 条公库 skill **全部** `is_deleted=1`(历史迁移遗留),56 条 `category` 全为 NULL。接入 `is_deleted` 过滤后管理台默认列表会变空 — 上线后需要管理员勾选"显示已删除"开关,逐条评估恢复或彻底删除。

## 架构总览

```
┌─ Go 后端 ─────────────────────────────────────────────┐
│ model/skill.go        +Category, +IsDeleted            │
│   SearchSkills 默认过滤 is_deleted=0                   │
│   SoftDeleteSkill / RestoreSkill                       │
│   BatchUpdateSkills / ListSkillCategories              │
│   SkillCache 初始化时过滤 is_deleted=0                 │
│ controller/skill.go   DeleteSkill 改软删(?force=1 物理)│
│   RestoreSkill / BatchSkill / ListSkillCategories      │
│   CreateSkill 重名检测返回 409+existing 详情           │
│ router/api.go         3 条新 admin-only 路由           │
└───────────────────────────────────────────────────────┘
┌─ 管理台 React (web/air) ──────────────────────────────┐
│ SkillsTable.js   分类下拉 / 显示已删除 / 批量操作条    │
│ SkillEditor.js   移除 status,加 category              │
│                  body Tab 加"从文件夹导入"             │
│                  保存冲突时 3 按钮 Modal               │
└───────────────────────────────────────────────────────┘
```

关键链路:
- **列表** `GET /api/skill/admin/list?category=xxx&includeDeleted=1`
- **软删** `DELETE /api/skill/:id` → `UPDATE is_deleted=1`(不带 force)
- **物理删** `DELETE /api/skill/:id?force=1` → `DB.Delete`
- **恢复** `POST /api/skill/:id/restore` → `UPDATE is_deleted=0`
- **文件夹导入** 浏览器端打包 folder → `content` 字段提交 → 后端 `SplitContent()` 自动拆 body/assets(`controller/skill.go:217-226` 已存在的链路,复用)
- **批量** `POST /api/skill/admin/batch` → `{ids, action, value?}`

## 后端详细设计

### Skill 结构体扩展

在 `model/skill.go` 的 `Skill struct` 中新增两个字段:

```go
Category  string `json:"category" gorm:"size:255;default:''"`
IsDeleted bool   `json:"is_deleted" gorm:"column:is_deleted;default:0"`
```

`Status` 字段保留在结构体上(避免破坏现有 GORM scan 和未暴露的老代码),但 controller 不再把 `status` 列出到表单。

### 新增 model 层方法

```go
// SearchSkills 公开列表 — 默认过滤 is_deleted=0
func SearchSkills(keyword, category string, page, perPage int) ([]Skill, int64, error)

// AdminSearchSkills admin 列表 — includeDeleted=true 时返回全部
func AdminSearchSkills(keyword, category string, page, perPage int, includeDeleted bool) ([]Skill, int64, error)

// SoftDeleteSkill UPDATE is_deleted=1 (幂等)
func SoftDeleteSkill(id int) (int64, error)

// RestoreSkill UPDATE is_deleted=0 (幂等)
func RestoreSkill(id int) (int64, error)

// HardDeleteSkill 物理删除,admin force 分支用
func HardDeleteSkill(id int) error

// BatchUpdateSkills 支持 3 种 action
type BatchAction string
const (
    BatchSoftDelete  BatchAction = "soft_delete"
    BatchRestore     BatchAction = "restore"
    BatchSetCategory BatchAction = "set_category"
)
func BatchUpdateSkills(ids []int, action BatchAction, value string) (int64, error)

// ListSkillCategories SELECT DISTINCT 去重
func ListSkillCategories() ([]string, error)
```

SQL 关键片段(`SearchSkills` / `AdminSearchSkills`):

```go
query := DB.Model(&Skill{})
if !includeDeleted {
    query = query.Where("is_deleted = ?", false)
}
if category != "" {
    query = query.Where("category = ?", category)
}
if keyword != "" {
    query = query.Where("name LIKE ? OR description LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
}
```

`ListSkillCategories`:

```go
DB.Model(&Skill{}).
    Where("is_deleted = ? AND category != ?", false, "").
    Distinct("category").
    Order("category").
    Pluck("category", &result)
```

### SkillCache 初始化过滤

`model/skill_cache.go`(或同等位置)的加载 SQL 加 `WHERE is_deleted = 0`。缓存不装软删行。

### controller/skill.go 变更

| Handler | 变更 |
|---|---|
| `ListSkills` | 读 `c.Query("category")`,透传 `SearchSkills(keyword, category, page, perPage)` |
| `AdminListSkills` | 读 `category` + `includeDeleted` (`c.Query("includeDeleted")=="1"`) |
| `CreateSkill` | payload 里加 `category` 字段;重名先 SELECT,命中返回 409 + `{existing_id, existing_is_deleted}`(HTTP 409) |
| `UpdateSkill` | payload 允许 `category` |
| `DeleteSkill` | 读 `c.Query("force")`。`force="1"` → `HardDeleteSkill`;否则 `SoftDeleteSkill` |
| `RestoreSkill` **(新)** | `POST /api/skill/:id/restore` → `model.RestoreSkill` + `RefreshSkillCache` |
| `ListSkillCategories` **(新)** | `GET /api/skill/admin/categories` → `{success:true, data:[...]}` |
| `BatchSkill` **(新)** | `POST /api/skill/admin/batch` 接 `{ids, action, value?}`,校验 + 调 `BatchUpdateSkills` + `RefreshSkillCache` |

### router/api.go 新增

```go
skillAdminRoute.GET("/categories", controller.ListSkillCategories)
skillAdminRoute.POST("/batch", controller.BatchSkill)
skillWriteRoute.POST("/:id/restore", controller.RestoreSkill)
```

### GORM AutoMigrate 兼容性

`model/main.go` 启动时的 `DB.AutoMigrate(&Skill{})` 会检测字段:`Category`/`IsDeleted` 对应列已存在,类型一致,不触发 schema 变更。**安全**。

### 错误处理矩阵

| 场景 | HTTP | body |
|---|---|---|
| 重名冲突 | 409 | `{success:false, message:"name exists", existing_id, existing_is_deleted}` |
| 批量 ids 空 | 400 | `{success:false, message:"ids is required"}` |
| 批量 action 非法 | 400 | `{success:false, message:"invalid action"}` |
| 批量 set_category + value="" | 400 | `{success:false, message:"category is required"}` |
| 软删幂等 | 200 | `{success:true, affected:0}` |
| 恢复幂等 | 200 | `{success:true, affected:0}` |

## 管理台前端详细设计

### SkillsTable.js

**新增 state**:
```js
const [category, setCategory]         = useState('')
const [categoryOptions, setCategories] = useState([])
const [includeDeleted, setIncludeDel] = useState(false)
const [selectedIds, setSelectedIds]   = useState([])
const [batchModal, setBatchModal]     = useState(null) // { action, value }
```

**挂载 + 保存回调时**拉分类:
```js
API.get('/api/skill/admin/categories').then(r => setCategories(r.data?.data || []))
```

**load 函数**:
```js
API.get('/api/skill/admin/list', {
  params: { keyword, page, perPage: PAGE_SIZE, category, includeDeleted: includeDeleted ? 1 : 0 }
})
```

**工具栏**(替换行 137 起的 `<Space>`):
```
[搜索框] [分类 Select 全部/...] [□ 显示已删除] [刷新] [新建]
--- 若 selectedIds.length > 0 ---
[批量软删] [批量恢复] [批量改分类] [取消选择(N)]
```

**列变更**:
- 新增 "分类" 列(`dataIndex:'category'`,`<Tag>` 或 "—")
- "状态" 列 `dataIndex` 改为 `is_deleted`,`render`:`v ? <Tag color='red'>已删除</Tag> : <Tag>正常</Tag>`
- "操作" 列渲染分支:
  ```js
  record.is_deleted
    ? <Space>[查看] [恢复] [彻底删除]</Space>
    : <Space>[查看] [编辑] [删除]</Space>
  ```

**行选择**:`<Table rowSelection={{selectedRowKeys:selectedIds, onChange:setSelectedIds}}>`

**批量操作**:
- 批量软删 / 恢复:`Modal.confirm` 二次确认 → `POST /api/skill/admin/batch`
- 批量改分类:`Modal` 自定义 body 带 Input(必填) → 空值前端拦截 + 后端二次防御
- 完成后:toast + `setSelectedIds([])` + `load(keyword, page)` + 重新拉 categories

### SkillEditor.js

**EMPTY 常量**:移除 `status`,新增 `category`:
```js
const EMPTY = {
  name: '', category: '', description: '', scenario: '',
  submitter: '', version: '1.0',
  tags: '', body: '', assets: '', content: '', forked_from: ''
}
```

**trackedKeys**(行 110, 131):把 `'status'` 换成 `'category'`。`buildPostBody` 对应删除 `status: Number(data.status)`,新增 `category: data.category`。

**表单 UI**:
- 删除 `Form.Select field='status'`(行 276-283)
- description 之后插入:
  ```jsx
  <Form.AutoComplete
    field='category'
    label='分类'
    placeholder='如 doc-processing / dev-tool,留空表示无分类'
    disabled={readOnly}
    initValue={data.category}
    data={categoryOptions}
    onChange={(v) => onFormChange('category', v)}
  />
  ```
  `categoryOptions` 通过 props 从 SkillsTable 传入,或 SkillEditor 自己调 `/categories` 端点。

**"从文件夹导入"按钮**(body Tab 激活且非 readOnly 时):
```jsx
{editorTab === 'body' && !readOnly && (
  <div style={{marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center'}}>
    <Button icon={<IconUpload />} onClick={() => folderInputRef.current?.click()}>
      从文件夹导入
    </Button>
    <input
      ref={folderInputRef}
      type='file'
      multiple
      style={{display: 'none'}}
      onChange={handleFolderImport}
      {...{webkitdirectory: '', directory: ''}}
    />
    <span style={{fontSize: 12, color: 'var(--semi-color-text-2)'}}>
      选择 SKILL 文件夹,保存时后端自动拆分 body/assets
    </span>
  </div>
)}
```

**handleFolderImport 逻辑**(参照 `packages/app/src/components/dialog-skills-plaza.tsx:196` 的浏览器端实现):

1. `files` 里找 `webkitRelativePath` 以 `/SKILL.md` 结尾的文件(大小写不敏感)
2. 没找到 → `showError('文件夹中未找到 SKILL.md')`,return
3. 总大小 > 5MB → `showError('文件夹总大小不能超过 5MB')`,return
4. 读 SKILL.md 文本,解析 `^---\n...\n---` frontmatter:若 `name`/`description` 表单还是空的就自动填
5. 遍历其它文本扩展名(`md|txt|ts|js|tsx|jsx|py|sh|json|yaml|yml|toml|css|html`),拼成 bundle:
   ```
   <SKILL.md 内容>

   <!-- file: <relPath> -->
   ```<ext>
   <file 内容>
   ```
   ```
6. `setData(prev => ({...prev, content: bundled}))`;**不**动 `body`/`assets`
7. 置 `importedFromFolder=true` 标志位
8. `showSuccess('已导入,保存后由后端自动拆分')`

**保存时跳过已导入的 body/assets**:
```js
const buildPostBody = () => {
  const body = { name, category, description, scenario, submitter, version, content, forked_from, ... }
  if (!importedFromFolder) {
    body.body   = data.body
    body.assets = data.assets
  }
  // tags 同原逻辑
  return body
}
```

`buildPutBody` 同理:若 `importedFromFolder` 则 trackedKeys 只比对 content,不比对 body/assets。

理由:后端 `SplitContent` 的触发条件是 `hasContent && !hasBody && !hasAssets`(`controller/skill.go:217-226`),如果把导入前的旧 body/assets 空值一起提交过去,链路会被打断。

### 重名冲突 Modal

`SkillEditor.handleSave` catch 块增加分支:

```js
if (err.response?.status === 409) {
  const { existing_id, existing_is_deleted } = err.response.data
  Modal.info({
    title: '名称已被占用',
    content: `已存在 skill "${data.name}" (id=${existing_id}, ${existing_is_deleted ? '已删除' : '正常'}),请选择操作:`,
    footer: (
      <Space>
        <Button onClick={closeModal}>取消</Button>
        <Button theme='solid' onClick={async () => {
          // 替换:物理删老的 + 新建
          await API.delete(`/api/skill/${existing_id}?force=1`)
          const res = await API.post('/api/skill/', buildPostBody())
          if (res.data?.success !== false) { showSuccess('替换成功'); onSaved(); onClose() }
          closeModal()
        }}>替换</Button>
        <Button type='primary' theme='solid' onClick={async () => {
          // 更新:PUT 覆盖,若原先软删则同时恢复
          const body = buildPutBody()
          if (existing_is_deleted) {
            // restore 先调用,再 PUT
            await API.post(`/api/skill/${existing_id}/restore`)
          }
          const res = await API.put(`/api/skill/${existing_id}`, body)
          if (res.data?.success !== false) { showSuccess('更新成功'); onSaved(); onClose() }
          closeModal()
        }}>更新</Button>
      </Space>
    )
  })
  return
}
```

### 已删除行的编辑按钮禁用

软删行的操作列**不渲染"编辑"按钮**,只有 [查看] [恢复] [彻底删除]。职责清晰:要改内容先恢复。

## 测试策略

### Go 单元测试

新增 `packages/one-api/model/skill_test.go`,沿用 `personal_skill_test.go` 的 sqlite 内存库模式:

| 用例 | 断言 |
|---|---|
| `TestSearchSkills_filtersDeleted` | 种 1 正常 + 1 软删,`SearchSkills` 只返回正常那条 |
| `TestAdminSearchSkills_includeDeleted` | `includeDeleted=true` 返回两条 |
| `TestSearchSkills_filtersByCategory` | 传 category 精确匹配 |
| `TestSoftDeleteSkill_idempotent` | 对已软删的行再调用返回 `affected=0`,`is_deleted` 仍为 true |
| `TestRestoreSkill` | 软删后恢复,`is_deleted` 变 false |
| `TestBatchUpdateSkills_softDelete` | 3 个 id,一次软删,`affected=3`,SearchSkills 返回空 |
| `TestBatchUpdateSkills_setCategory` | 3 个 id 一次改 category,全部生效 |
| `TestBatchUpdateSkills_invalidAction` | 返回 `invalid action` 错误 |
| `TestListSkillCategories_deduplicated` | 3 条同 category + 1 条 NULL + 1 条空串,只返回 1 条 |

### 管理台手工验证清单

| 步骤 | 期望 |
|---|---|
| 打开 "技能管理" 列表 | 默认看不到已软删的 skill(现有 56 条历史数据全隐藏) |
| 勾选 "显示已删除" | 56 条历史数据出现,操作列为 [查看] [恢复] [彻底删除] |
| 任选一条 → [恢复] | toast 成功,行"状态"由"已删除"变"正常",操作列变 [查看] [编辑] [删除] |
| 点 "新建" → body Tab → "从文件夹导入" → 选 `~/.claude/skills/pdf` | name / description 被 frontmatter 自动填;content 文本框填满 bundle |
| 填 category(如 `doc-processing`)→ 保存 | 新行出现,body / assets 字段已被后端拆分非空 |
| 顶部 category 下拉 | 新增选项 `doc-processing` |
| 同名再新建一次 | 弹 3 按钮 Modal;[更新] 覆盖原行,downloads 保留;[替换] 原 id 消失,新 id 出现 |
| 多选 3 行 → 批量改分类 → 输入 `tools` | 3 行 category 同步更新 |
| 多选 3 行 → 批量软删 | 3 行从默认列表消失 |
| 批量改分类 Modal 中不填值点确定 | 前端拦截提示"请输入分类" |

### 验证命令

```
cd packages/one-api && go test ./model/... -run TestSearchSkills -v
cd packages/one-api && go test ./model/... -run TestBatchUpdateSkills -v
cd packages/one-api && go test ./model/... -v
# 前端 build
cd packages/one-api/web/air && npm run build
```

## 上线流程

1. 后端部署(GORM AutoMigrate 不触发 schema 变更 — 字段已在 DB)
2. 前端 build 上传(`web/air` 构建产物)
3. 第一次打开管理台 → 列表为空 → 勾选"显示已删除" → 评估 56 条历史数据 → 恢复需要的 + 彻底删除废弃的
4. 对恢复的 skill 批量赋 category → 启用 category 筛选

## 风险与回滚

- **风险**:上线后默认列表为空可能让管理员误以为数据丢失。缓解:上线前提前沟通,并在管理台加一个提示条"当前 56 条历史数据为软删状态,请勾选上方开关查看"
- **回滚**:仅前端 build + Go 二进制回滚即可,DB schema 不变;软删状态不会丢失;唯一需要注意的是若已有部分行被管理员"彻底删除"(物理删),回滚也无法找回,这是预期行为
- **Parvis 客户端兼容性**:Parvis 客户端调用 `/api/skill/*` 公开接口。新版默认会过滤 `is_deleted=1` — Parvis 用户将看不到历史 56 条。这符合软删语义,**预期行为**
