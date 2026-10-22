/**
 * Product overlay on the copied `dws-cli` skill.
 * The upstream skill documents robot and webhook sends only. Desktop DingTalk
 * is a personal login, so a request to message a person uses `dws chat +dm`
 * and must not open another login or search for a robot.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Marks a file that already carries the personal-DM instructions. */
export const DINGTALK_PERSONAL_DM_MARKER = '<!-- wanwei-personal-dm -->'

/** Marks a file that already tells the model to send a robot message straight into the group. */
export const DINGTALK_BOT_DIRECT_MARKER = '<!-- wanwei-bot-direct -->'

const PERSONAL_DM_BLOCK = `${DINGTALK_PERSONAL_DM_MARKER}
## 个人单聊（连接后的默认发消息方式）

给某人、给我、或按姓名发钉钉消息、私聊、单聊，且用户没有说「机器人」、也没有提供 Webhook Token 时：

1. 执行 \`dws auth status --format json\`。只看 JSON 里的 \`authenticated\`。为 true 时禁止再执行 \`dws auth login\`，不要打开浏览器。没有 \`DWS_CLIENT_ID\` / \`DWS_CLIENT_SECRET\` 是个人授权的正常状态，不是未登录，也不需要机器人。
2. 用当前登录身份发送：\`dws chat +dm --to <姓名> --content <内容> --yes --format json\`。用户要求把这句内容发给这个人，就是发送确认。
3. 姓名对应多人时停下来请用户选择，不要默认第一个。
4. 以命令返回的发送结果判断是否发出。这条消息出现在钉钉单聊里。
5. 不要执行 \`bot search\`、\`message send-by-bot\`、\`message send-by-webhook\`。那些只在用户明确要求机器人或给出 Webhook Token 时使用。
`

const BOT_DIRECT_BLOCK = `${DINGTALK_BOT_DIRECT_MARKER}
## 机器人直接发到群

用户明确说用机器人往某个群发通知时，机器人把消息直接发进该群。不要先把机器人加为群成员，不要执行 \`+chat-add-bot\` 或 \`group members add-bot\`。

1. 执行 \`dws auth status --format json\`。\`authenticated\` 为 true 时禁止 \`dws auth login\`，不要打开浏览器。用户这句要求就是发送确认，不要再问一次，命令加 \`--yes\`。
2. 用 \`dws chat +bot-find --limit 20 --format json\` 找当前账号可用的机器人，包含他人创建的和官方机器人。不要用 \`bot search\` 或 \`+bot-search\`，那只返回自己创建的，空列表不代表没有可用机器人。
3. 只有一个就用它的 robotCode。多个且用户没指定名字时列出名称让用户选，不要默认第一个。
4. 先把群名解析成唯一 openConversationId，再直接发送：\`dws chat +messages-send --as bot --robot-code <robotCode> --group <openConversationId> --text <内容> --yes --format json\`。多个群候选时停下来问。
5. \`+bot-find\` 没有任何可用机器人时，说明命令行不能创建机器人，这次机器人身份发送停止。不要引导用户去开放平台现造机器人来完成这次发送，也不要用本人身份顶替。
`

const PRECONDITION = `## 前置条件

1. 执行 \`dws --version\`，确认 CLI 已安装。
2. 执行 \`dws auth status --format json\`。\`authenticated\` 为 true 时直接继续，禁止 \`dws auth login\`。为 false 时才引导用户在连接器里点「连接」，或执行一次 \`dws auth login\`。
3. 个人单聊不读取 \`DWS_CLIENT_ID\` / \`DWS_CLIENT_SECRET\`。不要因为缺少这两个变量而要求重新授权或改用机器人。
`

const UPSTREAM_PRECONDITION = `## 前置条件

使用本 skill 前，需确认 dws CLI 已安装并完成授权：

1. **安装检查**：执行 \`dws --version\`，确认版本 >= 1.0.6
2. **授权检查**：执行 \`dws auth status\`，确认已登录
3. **环境变量**：dsh-dingtalk 插件运行时会自动注入以下环境变量，dws CLI 会自动读取，无需手动设置：
   - \`DWS_CHANNEL=dsh-dingtalk\` — 标识调用来源为 dsh-dingtalk 插件
   - \`DWS_CLIENT_ID=<clientId>\` — 当前钉钉应用的 Client ID
   - \`DWS_CLIENT_SECRET=<clientSecret>\` — 当前钉钉应用的 Client Secret

如果 CLI 未安装或未授权，请引导用户完成对应操作（详见下方错误处理章节）。`

const INTENT_ROW = '| 用户说... | 真实意图 | 应该用 | 不要用 | 理由 |\n|-----------|----------|--------|--------|------|\n| "给张三发一条钉钉消息" | 个人单聊 | `dws chat +dm --to 张三 --content "..." --yes` | `chat message send-by-bot` | 当前登录身份，不需要 robotCode |'

const UPSTREAM_INTENT_HEADER = `| 用户说... | 真实意图 | 应该用 | 不要用 | 理由 |
|-----------|----------|--------|--------|------|`

const CHAT_SECTION = `### 4. chat 内部 — 两种消息发送方式

**用 \`chat message send-by-bot\` 的场景**：
- "让机器人在群里发一条通知" — **机器人身份**发群消息
- "给张三发一条机器人单聊消息" — 机器人批量单聊

**用 \`chat message send-by-webhook\` 的场景**：
- "通过 Webhook 发告警到群里" — 自定义机器人 Webhook
- 用户有 Webhook Token

**判断关键**：企业内部机器人→ \`send-by-bot\`（需 robotCode）；有 Webhook Token→ \`send-by-webhook\``

const CHAT_SECTION_NEXT = `### 4. chat 内部 — 个人单聊优先

**用 \`dws chat +dm\` 的场景**（默认）：
- "给张三发一条钉钉消息" / "发个钉钉私聊" — 当前登录人的个人单聊，不要搜机器人
- \`authenticated\` 为 true 时不要执行 \`dws auth login\`

**用 \`chat message send-by-bot\` 的场景**：
- 用户明确说「机器人」

**用 \`chat message send-by-webhook\` 的场景**：
- 用户给出 Webhook Token

**判断关键**：没点名机器人、没有 Webhook Token → \`dws chat +dm\`；点名企业内部机器人 → \`send-by-bot\`；有 Webhook Token → \`send-by-webhook\``

const ROUTING_LINE = '用户提到"群聊/建群/群成员/群管理/机器人发消息/Webhook/机器人群发/机器人单聊/通知" → `chat`'

const ROUTING_NEXT = `用户要给某人发钉钉消息、单聊或私聊，且没说机器人、没给 Webhook Token → 个人单聊 \`dws chat +dm\`（见文首，不要改走机器人）
用户明确说机器人 / Webhook，或要建群、管群、改群 → \`chat\``

const BOT_DISTINCTION = '关键区分: chat send-by-bot(机器人身份发消息) vs send-by-webhook(自定义机器人Webhook告警)'

const BOT_DISTINCTION_NEXT = '关键区分: 没点名机器人时用 `dws chat +dm`（当前登录人单聊）；点名机器人用 send-by-bot；有 Webhook Token 用 send-by-webhook'

function insertAfterFrontmatter(text: string, block: string): string {
  if (!text.startsWith('---')) return `${block}\n${text}`
  const end = text.indexOf('\n---', 3)
  if (end < 0) return `${block}\n${text}`
  const after = end + '\n---'.length
  return `${text.slice(0, after)}\n\n${block}\n${text.slice(after)}`
}

function writeIfChanged(file: string, next: string, current: string): boolean {
  if (next === current) return false
  writeFileSync(file, next)
  return true
}

/**
 * Insert one instruction block into a copied skill file.
 * @param file - absolute path; missing files are skipped.
 * @param marker - comment that means this block is already present.
 * @param edit - produces the next file text. Called only when `marker` is absent.
 * @returns true when the file was written.
 */
function overlayFile(file: string, marker: string, edit: (text: string) => string): boolean {
  if (!existsSync(file)) return false
  const current = readFileSync(file, 'utf8')
  if (current.includes(marker)) return false
  return writeIfChanged(file, edit(current), current)
}

/**
 * Teach an installed `dws-cli` tree to send person-to-person messages as the logged-in user,
 * and to send an explicit robot notice straight into the group.
 * A file that already contains one marker can still receive the other.
 * @param skillDir - absolute `dws-cli` directory containing `SKILL.md`.
 * @returns true when at least one file was written.
 */
export function applyDingTalkPersonalDmOverlay(skillDir: string): boolean {
  const skillFile = join(skillDir, 'SKILL.md')
  const chatFile = join(skillDir, 'references', 'products', 'chat.md')
  const intentFile = join(skillDir, 'references', 'intent-guide.md')
  const skill = overlayFile(skillFile, DINGTALK_PERSONAL_DM_MARKER, (text) => {
    let next = text.replace(UPSTREAM_PRECONDITION, PRECONDITION)
    next = next.replace(ROUTING_LINE, ROUTING_NEXT)
    next = next.replace(BOT_DISTINCTION, BOT_DISTINCTION_NEXT)
    return insertAfterFrontmatter(next, PERSONAL_DM_BLOCK)
  })
  const chat = overlayFile(chatFile, DINGTALK_PERSONAL_DM_MARKER, (text) => {
    const row = '| `+dm` | 当前登录人给某人发单聊（默认；不要先搜机器人） |\n'
    const header = '| 子命令 | 用途 |\n|-------|------|\n'
    const withRow = text.includes(header) ? text.replace(header, header + row) : text
    return `${PERSONAL_DM_BLOCK}\n${withRow}`
  })
  const intent = overlayFile(intentFile, DINGTALK_PERSONAL_DM_MARKER, (text) => {
    let next = text.replace(UPSTREAM_INTENT_HEADER, INTENT_ROW)
    next = next.replace(CHAT_SECTION, CHAT_SECTION_NEXT)
    return `${PERSONAL_DM_BLOCK}\n${next}`
  })
  const botSkill = overlayFile(skillFile, DINGTALK_BOT_DIRECT_MARKER, text => insertAfterFrontmatter(text, BOT_DIRECT_BLOCK))
  const botChat = overlayFile(chatFile, DINGTALK_BOT_DIRECT_MARKER, text => `${BOT_DIRECT_BLOCK}\n${text}`)
  const botIntent = overlayFile(intentFile, DINGTALK_BOT_DIRECT_MARKER, text => `${BOT_DIRECT_BLOCK}\n${text}`)
  return skill || chat || intent || botSkill || botChat || botIntent
}

/**
 * Overlay an installed `dws-cli` directory when `SKILL.md` is already there.
 * A missing skill is left for install. A write failure is ignored so a status
 * poll can still report login state when the skill tree is not writable.
 * @param skillDir - absolute `dws-cli` directory (`dwsCliSkillInstallDir`).
 */
export function ensureDingTalkPersonalDmOverlay(skillDir: string): void {
  if (!existsSync(join(skillDir, 'SKILL.md'))) return
  try {
    applyDingTalkPersonalDmOverlay(skillDir)
  } catch {
    // The status poll still returns auth state when the skill directory cannot be updated.
  }
}
