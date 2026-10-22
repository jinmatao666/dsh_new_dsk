import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyDingTalkPersonalDmOverlay,
  DINGTALK_BOT_DIRECT_MARKER,
  DINGTALK_DWS_TOOL_MARKER,
  DINGTALK_PERSONAL_DM_MARKER,
  ensureDingTalkPersonalDmOverlay,
} from '../src/dingtalk-personal-dm.ts'

const skillBody = `---
name: dws-cli
description: robots
---

## 前置条件

使用本 skill 前，需确认 dws CLI 已安装并完成授权：

1. **安装检查**：执行 \`dws --version\`，确认版本 >= 1.0.6
2. **授权检查**：执行 \`dws auth status\`，确认已登录
3. **环境变量**：dsh-dingtalk 插件运行时会自动注入以下环境变量，dws CLI 会自动读取，无需手动设置：
   - \`DWS_CHANNEL=dsh-dingtalk\` — 标识调用来源为 dsh-dingtalk 插件
   - \`DWS_CLIENT_ID=<clientId>\` — 当前钉钉应用的 Client ID
   - \`DWS_CLIENT_SECRET=<clientSecret>\` — 当前钉钉应用的 Client Secret

如果 CLI 未安装或未授权，请引导用户完成对应操作（详见下方错误处理章节）。

通过 \`dws\` 命令管理钉钉产品能力。所有命令由 DSH 的 bash 工具在终端中执行，agent 负责生成正确的 CLI 命令。

用户提到"群聊/建群/群成员/群管理/机器人发消息/Webhook/机器人群发/机器人单聊/通知" → \`chat\`

关键区分: chat send-by-bot(机器人身份发消息) vs send-by-webhook(自定义机器人Webhook告警)
`

const chatBody = `# 群聊与机器人 (chat) 命令参考

## 命令总览

| 子命令 | 用途 |
|-------|------|
| \`message send-by-bot\` | 机器人发消息（群聊或批量单聊） |
`

const intentBody = `# 意图路由指南

| 用户说... | 真实意图 | 应该用 | 不要用 | 理由 |
|-----------|----------|--------|--------|------|
| "让机器人在群里发个通知" | 机器人群发 | \`chat message send-by-bot\` | \`chat message send-by-webhook\` | 企业内部机器人发消息，需 robotCode |

### 4. chat 内部 — 两种消息发送方式

**用 \`chat message send-by-bot\` 的场景**：
- "让机器人在群里发一条通知" — **机器人身份**发群消息
- "给张三发一条机器人单聊消息" — 机器人批量单聊

**用 \`chat message send-by-webhook\` 的场景**：
- "通过 Webhook 发告警到群里" — 自定义机器人 Webhook
- 用户有 Webhook Token

**判断关键**：企业内部机器人→ \`send-by-bot\`（需 robotCode）；有 Webhook Token→ \`send-by-webhook\`
`

function writeSkill(root: string): string {
  const skill = join(root, 'dws-cli')
  mkdirSync(join(skill, 'references', 'products'), { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), skillBody)
  writeFileSync(join(skill, 'references', 'products', 'chat.md'), chatBody)
  writeFileSync(join(skill, 'references', 'intent-guide.md'), intentBody)
  return skill
}

describe('DingTalk personal DM overlay', () => {
  it('tells an installed dws-cli skill to send as the logged-in user', () => {
    const skill = writeSkill(mkdtempSync(join(tmpdir(), 'wanwei-dm-')))
    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(true)

    const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8')
    expect(skillText).toContain(DINGTALK_PERSONAL_DM_MARKER)
    expect(skillText).toContain('["chat", "+dm", "--to", "<姓名>", "--content", "<内容>", "--yes", "--format", "json"]')
    expect(skillText).toContain('authenticated')
    expect(skillText).toContain('禁止再执行 `dws auth login`')
    expect(skillText).not.toContain('DWS_CLIENT_SECRET=<clientSecret>')
    expect(skillText).toContain('没点名机器人时用 `dws chat +dm`')
    expect(skillText).not.toContain('机器人单聊/通知" → `chat`')
    expect(skillText).toContain(DINGTALK_BOT_DIRECT_MARKER)
    expect(skillText).toContain('["chat", "+bot-find", "--limit", "20", "--format", "json"]')
    expect(skillText).toContain('dws chat +messages-send --as bot --robot-code <robotCode> --group <openConversationId> --text <内容> --yes --format json')
    expect(skillText).toContain('不要先把机器人加为群成员')
    expect(skillText).toContain('命令行不能创建机器人')
    expect(skillText).toContain(DINGTALK_DWS_TOOL_MARKER)
    expect(skillText).toContain('调用 `dingtalk_dws` 工具执行')
    expect(skillText).toContain('不要用 pwsh 或 bash 执行 `dws`')
    expect(skillText).toContain('每条命令调用 `dingtalk_dws` 工具执行')
    expect(skillText).not.toContain('所有命令由 DSH 的 bash 工具')

    const chatText = readFileSync(join(skill, 'references', 'products', 'chat.md'), 'utf8')
    expect(chatText.indexOf('个人单聊')).toBeLessThan(chatText.indexOf('message send-by-bot'))
    expect(chatText).toContain('| `+dm` | 当前登录人给某人发单聊（默认；不要先搜机器人） |')

    const intentText = readFileSync(join(skill, 'references', 'intent-guide.md'), 'utf8')
    expect(intentText).toContain('| "给张三发一条钉钉消息" | 个人单聊 |')
    expect(intentText).toContain('没点名机器人、没有 Webhook Token → `dws chat +dm`')
    expect(intentText).not.toContain('两种消息发送方式')

    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(false)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe(skillText)
  })

  it('skips a missing skill and still overlays a skill that is already installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'wanwei-dm-ensure-'))
    expect(() => { ensureDingTalkPersonalDmOverlay(join(root, 'missing')) }).not.toThrow()
    const skill = writeSkill(root)
    ensureDingTalkPersonalDmOverlay(skill)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toContain('dws chat +dm')
  })

  it('adds direct robot-to-group send when the personal-DM section is already present', () => {
    const skill = writeSkill(mkdtempSync(join(tmpdir(), 'wanwei-bot-direct-')))
    writeFileSync(join(skill, 'SKILL.md'), `---\nname: dws-cli\n---\n${DINGTALK_PERSONAL_DM_MARKER}\n`)
    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(true)
    const text = readFileSync(join(skill, 'SKILL.md'), 'utf8')
    expect(text).toContain(DINGTALK_BOT_DIRECT_MARKER)
    expect(text).toContain('不要执行 `+chat-add-bot`')
    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(false)
  })

  it('routes dws commands through dingtalk_dws when the earlier sections are already present', () => {
    const skill = writeSkill(mkdtempSync(join(tmpdir(), 'wanwei-dws-tool-')))
    writeFileSync(join(skill, 'SKILL.md'), `---\nname: dws-cli\n---\n${DINGTALK_PERSONAL_DM_MARKER}\n${DINGTALK_BOT_DIRECT_MARKER}\n`)
    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(true)
    const text = readFileSync(join(skill, 'SKILL.md'), 'utf8')
    expect(text).toContain(DINGTALK_DWS_TOOL_MARKER)
    expect(text.indexOf(DINGTALK_DWS_TOOL_MARKER)).toBeLessThan(text.indexOf(DINGTALK_PERSONAL_DM_MARKER))
    expect(text).toContain('调用 `dingtalk_dws` 工具执行')
    expect(text).toContain('不要用 pwsh 或 bash 执行 `dws`')
    for (const file of [join('references', 'products', 'chat.md'), join('references', 'intent-guide.md')]) {
      expect(readFileSync(join(skill, file), 'utf8')).toContain(DINGTALK_DWS_TOOL_MARKER)
    }
    expect(applyDingTalkPersonalDmOverlay(skill)).toBe(false)
  })
})
